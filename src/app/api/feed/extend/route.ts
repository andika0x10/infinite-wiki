import { ArticleError } from "@/lib/article";
import { feedEnvironment, feedResponse, json, readBody } from "@/lib/feed-api";
import { CATALOG_NAME, isCursor } from "@/lib/feed-contract";
import { isRecord } from "@/lib/topics";

export function POST(request: Request): Promise<Response> {
  return feedResponse(async () => {
    const body = await readBody(request);
    if (!isRecord(body) || !isCursor(body.after)) throw new ArticleError("INVALID_CURSOR", "Posisi bacaan tidak valid.", 400);
    const env = await feedEnvironment();
    if (!env.CATALOG) throw new ArticleError("NOT_CONFIGURED", "Koordinator bacaan belum dikonfigurasi.", 503);
    const result = await env.CATALOG.getByName(CATALOG_NAME).extend(body.after);
    if ("error" in result) {
      const failure = result.error;
      throw new ArticleError(failure.code, failure.message, failure.status, failure.retryAt > Date.now() ? Math.ceil((failure.retryAt - Date.now()) / 1000) : undefined);
    }
    return json(result, result.status === "pending" ? 202 : 200);
  });
}
