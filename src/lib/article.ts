export interface ArticleContent {
  explanation: string[];
  importance: string;
}

export type ArticleErrorCode = "INVALID_TOPIC" | "NOT_CONFIGURED" | "RATE_LIMITED" | "TIMEOUT" | "INVALID_RESPONSE" | "UPSTREAM_ERROR" | "EMPTY_BRANCHES";

export interface ArticleErrorBody {
  error: { code: ArticleErrorCode; message: string; retryAfter?: number };
}

export class ArticleError extends Error {
  constructor(
    public code: ArticleErrorCode,
    message: string,
    public status = 502,
    public retryAfter?: number
  ) {
    super(message);
  }
}

export function isArticleContent(value: unknown): value is ArticleContent {
  if (!value || typeof value !== "object" || !("explanation" in value) || !("importance" in value)) return false;
  const article = value;
  return (
    Array.isArray(article.explanation) &&
    article.explanation.length >= 2 &&
    article.explanation.length <= 4 &&
    article.explanation.every((text: unknown) => typeof text === "string" && text.trim().length > 0 && text.length <= 4000) &&
    typeof article.importance === "string" &&
    article.importance.trim().length > 0 &&
    article.importance.length <= 4000
  );
}
