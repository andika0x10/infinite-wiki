import { isArticleContent, type ArticleContent, type ArticleErrorCode } from "./article";
import { isRecord, isTopic, type Topic } from "./topics";

export const CATALOG_NAME = "computer-science:v1";

export interface FeedEntry {
  sequence: number;
  topic: Topic;
  content: ArticleContent;
}
export interface FeedFailure {
  code: ArticleErrorCode;
  message: string;
  status: number;
  retryAt: number;
}
export interface GenerationState {
  state: "idle" | "pending" | "failed";
  error?: FeedFailure;
}
export interface FeedPage {
  entries: FeedEntry[];
  nextCursor: number;
  hasMore: boolean;
  generation: GenerationState;
}
export interface ExtendResult {
  status: "cached" | "pending";
}
export function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isFeedPage(value: unknown): value is FeedPage {
  if (!isRecord(value) || !Array.isArray(value.entries) || !isCursor(value.nextCursor) || typeof value.hasMore !== "boolean" || !isRecord(value.generation)) return false;
  if (!["idle", "pending", "failed"].includes(String(value.generation.state))) return false;
  if (value.generation.state === "failed") {
    const error = value.generation.error;
    if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string" || !isCursor(error.retryAt) || typeof error.status !== "number") return false;
  }
  return value.entries.every(
    (entry: unknown) => isRecord(entry) && isCursor(entry.sequence) && entry.sequence > 0 && isTopic(entry.topic, Infinity) && isArticleContent(entry.content)
  );
}
