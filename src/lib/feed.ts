import { ArticleError } from "./article";
import type { FeedEntry, FeedPage } from "./feed-contract";
export type { FeedEntry } from "./feed-contract";

export interface FeedReader {
  next(after: number, limit: number, signal: AbortSignal, retry?: boolean): Promise<FeedPage>;
}
export interface FeedSnapshot {
  entries: FeedEntry[];
  loading: boolean;
  error: { message: string; retryAt: number } | null;
}
const INITIAL: FeedSnapshot = { entries: [], loading: true, error: null };

/** One reader pipeline and one article of lookahead; ordering belongs to D1. */
export class FeedSession {
  private snapshot: FeedSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private target = 0;
  constructor(private reader: FeedReader) {}
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => INITIAL;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<FeedSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }
  async ensure(activeIndex: number, retry = false): Promise<void> {
    this.target = Math.max(this.target, activeIndex + 2);
    if (this.controller || this.snapshot.error || this.snapshot.entries.length >= this.target) return;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ loading: true });
    try {
      while (this.snapshot.entries.length < this.target) {
        const after = this.snapshot.entries.at(-1)?.sequence ?? 0;
        const page = await this.reader.next(after, Math.min(20, this.target - this.snapshot.entries.length), controller.signal, retry);
        controller.signal.throwIfAborted();
        const existing = new Set(this.snapshot.entries.map((entry) => entry.topic.id));
        if (!page.entries.length) throw new ArticleError("INVALID_RESPONSE", "Urutan bacaan tidak valid.");
        for (const [i, entry] of page.entries.entries()) {
          if (entry.sequence !== after + i + 1 || existing.has(entry.topic.id)) throw new ArticleError("INVALID_RESPONSE", "Urutan bacaan tidak valid.");
          existing.add(entry.topic.id);
        }
        this.publish({ entries: [...this.snapshot.entries, ...page.entries] });
        retry = false;
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.publish({
          error: {
            message: error instanceof Error ? error.message : "Bacaan belum dapat dimuat. Coba lagi.",
            retryAt: error instanceof ArticleError && error.retryAfter ? Date.now() + error.retryAfter * 1000 : 0,
          },
        });
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.publish({ loading: false });
      }
    }
  }
  retry(activeIndex: number): Promise<void> {
    if (this.snapshot.error && this.snapshot.error.retryAt > Date.now()) return Promise.resolve();
    this.publish({ error: null });
    return this.ensure(activeIndex, true);
  }
}
