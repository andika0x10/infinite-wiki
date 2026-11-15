import { DurableObject } from "cloudflare:workers";
import { ArticleError } from "../lib/article";
import { isCursor, type ExtendResult, type FeedFailure } from "../lib/feed-contract";
import { Catalog } from "../services/catalog";
import { CatalogPipeline, newJob, type GenerationJob } from "../services/catalog-pipeline";

export class CatalogCoordinator extends DurableObject<CloudflareEnv> {
  private reservation: Promise<ExtendResult> | null = null;
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)");
    ctx.blockConcurrencyWhile(async () => {
      const job = this.read();
      if (job && !job.failurePublished && (await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 100);
    });
  }
  private read(): GenerationJob | null {
    const row = this.ctx.storage.sql.exec<{ payload: string }>("SELECT payload FROM checkpoint WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.payload) : null;
  }
  private save(job: GenerationJob | null): void {
    if (!job) this.ctx.storage.sql.exec("DELETE FROM checkpoint WHERE id = 1");
    else this.ctx.storage.sql.exec("INSERT INTO checkpoint(id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload", JSON.stringify(job));
  }
  async extend(after: number): Promise<ExtendResult | { error: FeedFailure }> {
    try {
      return await this.extendInternal(after);
    } catch (error) {
      const failure = error instanceof ArticleError ? error : new ArticleError("CACHE_UNAVAILABLE", "Layanan bacaan sedang tidak tersedia. Coba lagi.", 503);
      return { error: { code: failure.code, message: failure.message, status: failure.status, retryAt: failure.retryAfter ? Date.now() + failure.retryAfter * 1000 : 0 } };
    }
  }
  private async extendInternal(after: number): Promise<ExtendResult> {
    if (!isCursor(after)) throw new ArticleError("INVALID_CURSOR", "Posisi bacaan tidak valid.", 400);
    // Serialize only admission, never the provider I/O performed by alarms.
    if (this.reservation) {
      await this.reservation;
      return this.extendInternal(after);
    }
    const pending = this.admit(after);
    this.reservation = pending;
    try {
      return await pending;
    } finally {
      this.reservation = null;
    }
  }
  private async admit(after: number): Promise<ExtendResult> {
    const catalog = new Catalog(this.env.DB);
    const tail = await catalog.tail();
    if (after > tail) throw new ArticleError("INVALID_CURSOR", "Posisi bacaan melampaui katalog.", 409);
    if (after < tail) return { status: "cached" };
    let job = this.read();
    if (job?.failure && !job.failurePublished) {
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
      return { status: "pending" };
    }
    if (job?.failure && job.failure.retryAt > Date.now())
      throw new ArticleError(job.failure.code, job.failure.message, job.failure.status, Math.ceil((job.failure.retryAt - Date.now()) / 1000));
    if (job && !job.failure) {
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
      return { status: "pending" };
    }
    if (!this.env.GEMINI_API_KEY?.trim() || !this.env.SEMANTIC_INDEX) throw new ArticleError("NOT_CONFIGURED", "Layanan penambahan bacaan belum dikonfigurasi.", 503);
    if (job?.failure) {
      // Retry the last completed checkpoint, retaining any generated draft.
      job = { ...job, failure: undefined, failurePublished: undefined, attempts: 0, emptyExpansions: 0, indexPolls: 0 };
    } else {
      job = newJob(after);
      if (await catalog.pendingOutbox()) job.stage = "index";
    }
    this.save(job);
    await catalog.setGeneration({ state: "pending" });
    await this.ctx.storage.setAlarm(Date.now());
    console.log(JSON.stringify({ event: "generation_requested", after }));
    return { status: "pending" };
  }
  async alarm(): Promise<void> {
    const job = this.read();
    if (!job) return;
    const catalog = new Catalog(this.env.DB);
    if (job.failure) {
      await catalog.setGeneration({ state: "failed", error: job.failure });
      this.save({ ...job, failurePublished: true });
      return;
    }
    // A persisted watchdog also covers interruption during external I/O.
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    try {
      const next = await new CatalogPipeline(catalog, this.env.SEMANTIC_INDEX, this.env.GEMINI_API_KEY).step(job);
      this.save(next);
      if (next) await this.ctx.storage.setAlarm(Date.now() + (next.stage === "index" ? 2000 : 100));
      else await this.ctx.storage.deleteAlarm();
    } catch (error) {
      const failure = error instanceof ArticleError ? error : new ArticleError("UPSTREAM_ERROR", "Layanan bacaan sedang tidak tersedia. Coba lagi.", 503);
      const failed: GenerationJob = {
        ...job,
        failure: { code: failure.code, message: failure.message, status: failure.status, retryAt: failure.retryAfter ? Date.now() + failure.retryAfter * 1000 : 0 },
      };
      this.save(failed);
      // If D1 is unavailable the scheduled watchdog retries publishing this error.
      await catalog.setGeneration({ state: "failed", error: failed.failure });
      this.save({ ...failed, failurePublished: true });
      await this.ctx.storage.deleteAlarm();
      console.error(JSON.stringify({ event: "generation_failed", stage: job.stage, code: failure.code }));
    }
  }
}
