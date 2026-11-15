import { ArticleError, type ArticleErrorCode } from "../lib/article";
import { isFeedPage, type FeedPage } from "../lib/feed-contract";
import { isRecord } from "../lib/topics";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Browser memory holds only the reading session; D1 owns the shared catalog. */
export class FeedClient {
  private cooldown = 0;
  private async request(url: string, signal: AbortSignal, body?: object): Promise<unknown> {
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const failure = isRecord(result) && isRecord(result.error) ? result.error : {};
        const seconds = typeof failure.retryAfter === "number" && Number.isFinite(failure.retryAfter) && failure.retryAfter > 0 ? Math.min(failure.retryAfter, 86400) : undefined;
        if (response.status === 429) this.cooldown = Date.now() + (seconds ?? 60) * 1000;
        throw new ArticleError(
          typeof failure.code === "string" ? (failure.code as ArticleErrorCode) : "UPSTREAM_ERROR",
          typeof failure.message === "string" ? failure.message : "Layanan bacaan sedang tidak tersedia.",
          response.status,
          seconds
        );
      }
      return result;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ArticleError) throw error;
      throw new ArticleError("UPSTREAM_ERROR", "Bacaan tidak dapat dimuat. Periksa jaringan lalu coba lagi.");
    }
  }
  async next(after: number, limit: number, signal: AbortSignal, retry = false): Promise<FeedPage> {
    let requested = false;
    let delay = 1000;
    while (true) {
      const page = await this.request(`/api/feed?after=${after}&limit=${limit}`, signal);
      if (
        !isFeedPage(page) ||
        page.entries.some((entry, i) => entry.sequence !== after + i + 1) ||
        page.entries.length > limit ||
        page.nextCursor !== (page.entries.at(-1)?.sequence ?? after)
      )
        throw new ArticleError("INVALID_RESPONSE", "Urutan bacaan tidak valid. Coba lagi.");
      if (page.entries.length) return page;
      if (page.generation.state === "failed" && (!retry || requested)) {
        const error = page.generation.error!;
        throw new ArticleError(error.code, error.message, error.status, error.retryAt > Date.now() ? Math.ceil((error.retryAt - Date.now()) / 1000) : undefined);
      }
      if (!requested || page.generation.state === "idle") {
        if (this.cooldown > Date.now()) throw new ArticleError("RATE_LIMITED", "Tunggu sebelum mencoba lagi.", 429, Math.ceil((this.cooldown - Date.now()) / 1000));
        const result = await this.request("/api/feed/extend", signal, { after });
        if (!isRecord(result) || !["cached", "pending"].includes(String(result.status))) throw new ArticleError("INVALID_RESPONSE", "Status bacaan tidak valid.");
        requested = true;
        if (result.status === "cached") continue;
      }
      await wait(delay, signal);
      delay = Math.min(delay + 1000, 5000);
    }
  }
}
