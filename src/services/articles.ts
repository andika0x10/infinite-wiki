import { ArticleError, isArticleContent, type ArticleContent } from "../lib/article";
import { isBranches, isRecord, topicContext, type Branch, type Topic } from "../lib/topics";

/** One instance per browser feed. No mutable request state is shared on the server. */
export class GenerationClient {
  private cache = new Map<string, ArticleContent>();
  private pending = new Map<string, Promise<unknown>>();
  private cooldown = 0;
  private request(endpoint: string, topic: Topic, exclude: string[] = []): Promise<unknown> {
    if (this.cooldown > Date.now())
      return Promise.reject(new ArticleError("RATE_LIMITED", "Batas permintaan tercapai. Tunggu sebelum mencoba lagi.", 429, Math.ceil((this.cooldown - Date.now()) / 1000)));
    const body = JSON.stringify({ topic: topicContext(topic), ...(endpoint === "branches" ? { exclude: exclude.slice(-50) } : {}) });
    const key = `${endpoint}:${body}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = fetch(`/api/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(35_000) })
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok) {
          const failure = isRecord(result) && isRecord(result.error) ? result.error : {};
          const retryAfter = typeof failure.retryAfter === "number" && Number.isFinite(failure.retryAfter) && failure.retryAfter > 0 ? Math.min(failure.retryAfter, 86400) : 60;
          if (response.status === 429) this.cooldown = Date.now() + retryAfter * 1000;
          throw new ArticleError(
            response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR",
            typeof failure.message === "string" ? failure.message : "Layanan bacaan sedang tidak tersedia. Coba lagi.",
            response.status,
            response.status === 429 ? retryAfter : undefined
          );
        }
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof ArticleError) throw error;
        throw new ArticleError("UPSTREAM_ERROR", "Bacaan tidak dapat dimuat. Periksa jaringan lalu coba lagi.");
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async article(topic: Topic): Promise<ArticleContent> {
    const saved = this.cache.get(topic.id);
    if (saved) return saved;
    const result = await this.request("articles", topic);
    if (!isArticleContent(result)) throw new ArticleError("INVALID_RESPONSE", "Isi bacaan belum dapat ditampilkan. Coba lagi.");
    this.cache.set(topic.id, result);
    return result;
  }
  async branches(topic: Topic, exclude: string[]): Promise<Branch[]> {
    const result = await this.request("branches", topic, exclude);
    if (!isBranches(result)) throw new ArticleError("INVALID_RESPONSE", "Cabang bacaan belum dapat ditampilkan. Coba lagi.");
    return result.branches;
  }
}
