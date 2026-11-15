import { ArticleError, type ArticleContent } from "../lib/article";
import { type FeedFailure } from "../lib/feed-contract";
import { isRecord, topicContext } from "../lib/topics";
import { Catalog, contentHash, type Candidate } from "./catalog";
import { generateArticle, generateBranches } from "./gemini";
import { articleText, conceptText, CONCEPT_NAMESPACE, CONTENT_NAMESPACE, embed, SemanticIndex, type SemanticBinding } from "./semantic";

export type Stage = "select" | "concept-embed" | "concept-check" | "article" | "content-embed" | "content-check" | "publish" | "index";
export interface GenerationJob {
  key: string;
  after: number;
  stage: Stage;
  attempts: number;
  emptyExpansions: number;
  indexPolls: number;
  candidate?: Candidate;
  content?: ArticleContent;
  conceptVector?: number[];
  contentVector?: number[];
  failure?: FeedFailure;
  failurePublished?: boolean;
}
export function newJob(after: number): GenerationJob {
  return { key: `append:${after}`, after, stage: "select", attempts: 0, emptyExpansions: 0, indexPolls: 0 };
}

/** One checkpoint per phase; committed articles and index mutations are idempotent. */
export class CatalogPipeline {
  private semantic: SemanticIndex;
  constructor(
    private catalog: Catalog,
    private index: SemanticBinding,
    private key: string | undefined
  ) {
    this.semantic = new SemanticIndex(index, catalog, key);
  }
  private async reject(job: GenerationJob, canonicalId: string): Promise<GenerationJob> {
    await this.catalog.alias(job.candidate!, canonicalId);
    return { ...newJob(job.after), attempts: job.attempts + 1, emptyExpansions: job.emptyExpansions };
  }
  async step(job: GenerationJob): Promise<GenerationJob | null> {
    // Recover a crash between the D1 commit and the local checkpoint.
    if (job.stage !== "index" && (await this.catalog.byJob(job.key))) return { ...job, stage: "index" };
    switch (job.stage) {
      case "select": {
        if (job.attempts >= 3 || job.emptyExpansions >= 2) throw new ArticleError("EMPTY_BRANCHES", "Belum menemukan topik unik. Coba lagi untuk melanjutkan penjelajahan.");
        const candidate = await this.catalog.nextCandidate();
        if (!candidate) {
          const parent = await this.catalog.nextParent();
          const branches = await generateBranches(topicContext(parent), await this.catalog.recentTitles(), this.key);
          const count = await this.catalog.enqueue(parent, branches);
          return { ...job, emptyExpansions: count ? job.emptyExpansions : job.emptyExpansions + 1 };
        }
        const existing = await this.catalog.byName(candidate.topic.title);
        if (existing) return this.reject({ ...job, candidate }, existing.topic.id);
        return { ...job, candidate, stage: "concept-embed" };
      }
      case "concept-embed":
        return { ...job, conceptVector: await embed(conceptText(job.candidate!.topic), this.key), stage: "concept-check" };
      case "concept-check": {
        const duplicate = await this.semantic.duplicate(job.candidate!.topic, job.conceptVector!);
        return duplicate ? this.reject(job, duplicate) : { ...job, stage: "article" };
      }
      case "article":
        return { ...job, content: await generateArticle(topicContext(job.candidate!.topic), this.key), stage: "content-embed" };
      case "content-embed": {
        const duplicate = await this.catalog.byHash(await contentHash(job.content!));
        return duplicate ? this.reject(job, duplicate.topic.id) : { ...job, contentVector: await embed(articleText(job.content!), this.key), stage: "content-check" };
      }
      case "content-check": {
        const duplicate = await this.semantic.duplicate(job.candidate!.topic, job.contentVector!, job.content);
        return duplicate ? this.reject(job, duplicate) : { ...job, stage: "publish" };
      }
      case "publish": {
        const id = job.candidate!.topic.id;
        const vectors: VectorizeVector[] = [
          { id: `concept:${id}`, namespace: CONCEPT_NAMESPACE, values: job.conceptVector! },
          { id: `article:${id}`, namespace: CONTENT_NAMESPACE, values: job.contentVector! },
        ];
        await this.catalog.publish(job.key, job.after, job.candidate!, job.content!, vectors);
        return { ...job, stage: "index" };
      }
      case "index": {
        const outbox = await this.catalog.pendingOutbox();
        if (!outbox) {
          await this.catalog.setGeneration({ state: "idle" });
          return null;
        }
        if (!outbox.mutation_id) {
          const mutation = await this.index.upsert(JSON.parse(outbox.vectors_json));
          if (!isRecord(mutation) || typeof mutation.mutationId !== "string")
            throw new ArticleError("DEDUPLICATION_UNAVAILABLE", "Indeks semantik harus menggunakan Vectorize V2.", 503);
          await this.catalog.setMutation(outbox.job_key, mutation.mutationId);
          return job;
        }
        const details = await this.index.describe();
        if (!isRecord(details) || details.dimensions !== 768) throw new ArticleError("DEDUPLICATION_UNAVAILABLE", "Konfigurasi indeks semantik tidak sesuai.", 503);
        if (String(details.processedUpToMutation) !== outbox.mutation_id) {
          if (job.indexPolls >= 30) throw new ArticleError("DEDUPLICATION_UNAVAILABLE", "Indeks bacaan belum selesai diperbarui. Coba lagi.", 503);
          return { ...job, indexPolls: job.indexPolls + 1 };
        }
        await this.catalog.finishIndex(outbox.job_key);
        return null;
      }
    }
  }
}
