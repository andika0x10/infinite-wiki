import { ArticleError, type ArticleContent } from "../lib/article";
import { type FeedEntry, type FeedPage, type GenerationState } from "../lib/feed-contract";
import { normalizeTitle, ROOT, type Branch, type Topic } from "../lib/topics";

export interface Candidate {
  ordinal: number | null;
  topic: Topic;
}
export interface StoredArticle extends FeedEntry {
  jobKey: string;
}
export interface Outbox {
  job_key: string;
  vectors_json: string;
  mutation_id: string | null;
}
interface ArticleRow {
  sequence: number;
  id: string;
  title: string;
  description: string;
  parent_id: string | null;
  path_json: string;
  content_json: string;
  job_key: string;
}
const ARTICLE_SELECT = `SELECT f.sequence, t.*, a.content_json, a.job_key
  FROM feed_entries f JOIN articles a ON a.topic_id = f.topic_id JOIN topics t ON t.id = a.topic_id`;
function decode(row: ArticleRow): StoredArticle {
  return {
    sequence: row.sequence,
    topic: { id: row.id, title: row.title, description: row.description, parentId: row.parent_id, path: JSON.parse(row.path_json) },
    content: JSON.parse(row.content_json),
    jobKey: row.job_key,
  };
}
export async function contentHash(content: ArticleContent): Promise<string> {
  const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const bytes = new TextEncoder().encode(JSON.stringify({ explanation: content.explanation.map(normalize), importance: normalize(content.importance) }));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** D1 is the source of truth. All catalog mutations are owned by the coordinator. */
export class Catalog {
  private db: D1DatabaseSession;
  constructor(db: D1Database) {
    this.db = db.withSession("first-primary");
  }
  async tail(): Promise<number> {
    return (await this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS tail FROM feed_entries").first<number>("tail"))!;
  }
  async generation(): Promise<GenerationState> {
    const row = await this.db.prepare("SELECT state, error_json FROM catalog_state WHERE id = 1").first<{ state: GenerationState["state"]; error_json: string | null }>();
    if (!row) throw new ArticleError("CACHE_UNAVAILABLE", "Penyimpanan bacaan belum disiapkan.", 503);
    return { state: row.state, ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}) };
  }
  async setGeneration(value: GenerationState): Promise<void> {
    await this.db
      .prepare("UPDATE catalog_state SET state = ?, error_json = ? WHERE id = 1")
      .bind(value.state, value.error ? JSON.stringify(value.error) : null)
      .run();
  }
  async page(after: number, limit: number): Promise<FeedPage> {
    const rows = await this.db
      .prepare(`${ARTICLE_SELECT} WHERE f.sequence > ? ORDER BY f.sequence LIMIT ?`)
      .bind(after, limit + 1)
      .all<ArticleRow>();
    const entries = rows.results.slice(0, limit).map((row) => {
      const { sequence, topic, content } = decode(row);
      return { sequence, topic, content };
    });
    return { entries, nextCursor: entries.at(-1)?.sequence ?? after, hasMore: rows.results.length > limit, generation: await this.generation() };
  }
  async byId(id: string): Promise<StoredArticle | null> {
    const row = await this.db.prepare(`${ARTICLE_SELECT} WHERE t.id = ?`).bind(id).first<ArticleRow>();
    return row ? decode(row) : null;
  }
  async byName(title: string): Promise<StoredArticle | null> {
    const row = await this.db.prepare(`${ARTICLE_SELECT} JOIN topic_names n ON n.topic_id = t.id WHERE n.normalized_name = ?`).bind(normalizeTitle(title)).first<ArticleRow>();
    return row ? decode(row) : null;
  }
  async byHash(hash: string): Promise<StoredArticle | null> {
    const row = await this.db.prepare(`${ARTICLE_SELECT} WHERE a.content_hash = ?`).bind(hash).first<ArticleRow>();
    return row ? decode(row) : null;
  }
  async byJob(key: string): Promise<StoredArticle | null> {
    const row = await this.db.prepare(`${ARTICLE_SELECT} WHERE a.job_key = ?`).bind(key).first<ArticleRow>();
    return row ? decode(row) : null;
  }
  async nextCandidate(): Promise<Candidate | null> {
    if ((await this.tail()) === 0) return { ordinal: null, topic: ROOT };
    const row = await this.db.prepare("SELECT ordinal, topic_json FROM frontier ORDER BY ordinal LIMIT 1").first<{ ordinal: number; topic_json: string }>();
    return row ? { ordinal: row.ordinal, topic: JSON.parse(row.topic_json) } : null;
  }
  async nextParent(): Promise<Topic> {
    const row = await this.db.prepare(`${ARTICLE_SELECT} ORDER BY t.expanded ASC, f.sequence ASC LIMIT 1`).first<ArticleRow>();
    return row ? decode(row).topic : ROOT;
  }
  async recentTitles(): Promise<string[]> {
    const rows = await this.db.prepare("SELECT t.title FROM feed_entries f JOIN topics t ON f.topic_id = t.id ORDER BY f.sequence DESC LIMIT 50").all<{ title: string }>();
    return rows.results.map((row) => row.title);
  }
  async enqueue(parent: Topic, branches: Branch[]): Promise<number> {
    const seen = new Set<string>();
    const children: Topic[] = [];
    for (const branch of branches) {
      const title = branch.title.trim();
      const name = normalizeTitle(title);
      if (!name || seen.has(name) || (await this.byName(title))) continue;
      seen.add(name);
      children.push({ id: crypto.randomUUID(), title, description: branch.description.trim(), parentId: parent.id, path: [...parent.path, title] });
    }
    const statements = children.map((topic) =>
      this.db.prepare("INSERT OR IGNORE INTO frontier(topic_json, parent_id, normalized_name) VALUES (?, ?, ?)").bind(JSON.stringify(topic), parent.id, normalizeTitle(topic.title))
    );
    if (children.length) statements.push(this.db.prepare("UPDATE topics SET expanded = 1 WHERE id = ?").bind(parent.id));
    if (!statements.length) return 0;
    const results = await this.db.batch(statements);
    return results.slice(0, children.length).reduce((sum, result) => sum + result.meta.changes, 0);
  }
  async alias(candidate: Candidate, canonicalId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO topic_names(normalized_name, topic_id) VALUES (?, ?)").bind(normalizeTitle(candidate.topic.title), canonicalId),
      this.db.prepare("DELETE FROM frontier WHERE ordinal = ?").bind(candidate.ordinal),
    ]);
    console.log(JSON.stringify({ event: "duplicate_rejected", canonicalId, candidateId: candidate.topic.id }));
  }
  async publish(key: string, after: number, candidate: Candidate, content: ArticleContent, vectors: VectorizeVector[]): Promise<void> {
    if (await this.byJob(key)) return;
    const { topic } = candidate;
    await this.db.batch([
      this.db
        .prepare("INSERT OR IGNORE INTO topics(id, title, description, parent_id, path_json) VALUES (?, ?, ?, ?, ?)")
        .bind(topic.id, topic.title, topic.description, topic.parentId, JSON.stringify(topic.path)),
      this.db
        .prepare("INSERT INTO topic_names(normalized_name, topic_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM topic_names WHERE normalized_name = ? AND topic_id = ?)")
        .bind(normalizeTitle(topic.title), topic.id, normalizeTitle(topic.title), topic.id),
      this.db
        .prepare("INSERT INTO articles(topic_id, content_json, content_hash, job_key, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(topic.id, JSON.stringify(content), await contentHash(content), key, Date.now()),
      this.db.prepare("INSERT INTO feed_entries(sequence, topic_id) VALUES (?, ?)").bind(after + 1, topic.id),
      this.db.prepare("INSERT INTO semantic_outbox(job_key, vectors_json) VALUES (?, ?)").bind(key, JSON.stringify(vectors)),
      this.db.prepare("DELETE FROM frontier WHERE ordinal = ?").bind(candidate.ordinal),
    ]);
    console.log(JSON.stringify({ event: "article_published", sequence: after + 1, topicId: topic.id }));
  }
  async pendingOutbox(): Promise<Outbox | null> {
    return this.db.prepare("SELECT job_key, vectors_json, mutation_id FROM semantic_outbox WHERE indexed = 0 ORDER BY rowid LIMIT 1").first<Outbox>();
  }
  async setMutation(key: string, mutation: string): Promise<void> {
    await this.db.prepare("UPDATE semantic_outbox SET mutation_id = ? WHERE job_key = ?").bind(mutation, key).run();
  }
  async finishIndex(key: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE semantic_outbox SET indexed = 1, vectors_json = '[]' WHERE job_key = ?").bind(key),
      this.db.prepare("UPDATE catalog_state SET state = 'idle', error_json = NULL WHERE id = 1"),
    ]);
  }
}
