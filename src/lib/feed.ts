import { ArticleError, type ArticleContent } from "./article";
import { ROOT, normalizeTitle, type Branch, type Topic } from "./topics";
export interface FeedGenerator {
  article(topic: Topic): Promise<ArticleContent>;
  branches(topic: Topic, exclude: string[]): Promise<Branch[]>;
}
export interface FeedEntry {
  topic: Topic;
  content: ArticleContent;
}
export interface FeedSnapshot {
  entries: FeedEntry[];
  loading: boolean;
  error: { message: string; retryAt: number } | null;
}
const INITIAL: FeedSnapshot = { entries: [], loading: true, error: null };

/** FIFO traversal with lazy expansion and one in-flight generation pipeline. */
export class FeedSession {
  private snapshot: FeedSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private queue: Topic[] = [ROOT];
  private frontier: Topic[] = [ROOT];
  private seen = new Set([normalizeTitle(ROOT.title)]);
  private titles = [ROOT.title];
  private running = false;
  private rootExpanded = false;
  private serial = 0;
  private target = 0;
  constructor(private generator: FeedGenerator) {}
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
  private async expand(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const parent = this.frontier[0] ?? ROOT;
      const branches = await this.generator.branches(parent, this.titles.slice(-50));
      const children: Topic[] = [];
      for (const branch of branches) {
        const title = branch.title.trim();
        const normalized = normalizeTitle(title);
        if (!normalized || this.seen.has(normalized)) continue;
        this.seen.add(normalized);
        this.titles.push(title);
        children.push({ id: `topic-${++this.serial}`, title, description: branch.description.trim(), parentId: parent.id, path: [...parent.path, title] });
      }
      // Network failure keeps the parent queued; valid empty batches try a different parent.
      this.frontier.shift();
      this.frontier.push(...children);
      this.queue.push(...children);
      if (children.length) {
        this.rootExpanded = true;
        return;
      }
    }
    throw new ArticleError("EMPTY_BRANCHES", "Belum menemukan cabang baru. Coba lagi untuk melanjutkan penjelajahan.");
  }
  async ensure(activeIndex: number): Promise<void> {
    this.target = Math.max(this.target, activeIndex + 2);
    if (this.running || this.snapshot.error || this.snapshot.entries.length >= this.target) return;
    this.running = true;
    this.publish({ loading: true });
    try {
      while (this.snapshot.entries.length < this.target) {
        if (!this.rootExpanded || this.queue.length <= 2) await this.expand();
        const topic = this.queue[0];
        const content = await this.generator.article(topic);
        this.queue.shift();
        this.publish({ entries: [...this.snapshot.entries, { topic, content }] });
      }
    } catch (error) {
      this.publish({
        error: {
          message: error instanceof Error ? error.message : "Bacaan belum dapat dimuat. Coba lagi.",
          retryAt: error instanceof ArticleError && error.retryAfter ? Date.now() + error.retryAfter * 1000 : 0,
        },
      });
    } finally {
      this.running = false;
      this.publish({ loading: false });
    }
  }
  retry(activeIndex: number): Promise<void> {
    if (this.snapshot.error && this.snapshot.error.retryAt > Date.now()) return Promise.resolve();
    this.publish({ error: null });
    return this.ensure(activeIndex);
  }
}
