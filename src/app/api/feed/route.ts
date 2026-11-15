import { ArticleError } from "@/lib/article";
import { feedEnvironment, feedResponse, json } from "@/lib/feed-api";
import { Catalog } from "@/services/catalog";

export const dynamic = "force-dynamic";
export function GET(request: Request): Promise<Response> {
  return feedResponse(async () => {
    const params = new URL(request.url).searchParams;
    const after = params.get("after") ?? "0";
    const limit = params.get("limit") ?? "2";
    if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 20)
      throw new ArticleError("INVALID_CURSOR", "Posisi atau jumlah bacaan tidak valid.", 400);
    const env = await feedEnvironment();
    const page = await new Catalog(env.DB).page(Number(after), Number(limit));
    console.log(JSON.stringify({ event: "feed_cache_read", after: Number(after), entries: page.entries.length }));
    return json(page);
  });
}
