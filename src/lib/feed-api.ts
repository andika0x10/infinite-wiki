import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArticleError } from "./article";

export async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ArticleError("INVALID_CURSOR", "Data permintaan belum lengkap.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24000) {
        await reader.cancel();
        throw new ArticleError("INVALID_CURSOR", "Data permintaan terlalu panjang.", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ArticleError) throw error;
    throw new ArticleError("INVALID_CURSOR", "Data permintaan tidak dapat dibaca.", 400);
  } finally {
    reader.releaseLock();
  }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export async function feedEnvironment(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) throw new ArticleError("CACHE_UNAVAILABLE", "Penyimpanan bacaan belum dikonfigurasi.", 503);
  return env;
}
export async function feedResponse(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    const failure = error instanceof ArticleError ? error : new ArticleError("CACHE_UNAVAILABLE", "Layanan bacaan sedang tidak tersedia. Coba lagi.", 503);
    console.error(JSON.stringify({ event: "feed_request_failed", code: failure.code, status: failure.status }));
    return Response.json(
      { error: { code: failure.code, message: failure.message, ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}) } },
      {
        status: failure.status,
        headers: { "Cache-Control": "no-store", ...(failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {}) },
      }
    );
  }
}
