import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArticleError } from "./article";
import { isRecord, isTopic, type Topic } from "./topics";

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ArticleError("INVALID_TOPIC", "Data topik belum lengkap.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24000) {
        await reader.cancel();
        throw new ArticleError("INVALID_TOPIC", "Data topik terlalu panjang.", 413);
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
    throw new ArticleError("INVALID_TOPIC", "Data topik tidak dapat dibaca.", 400);
  } finally {
    reader.releaseLock();
  }
}
export function generationHandler(generate: (topic: Topic, exclude: string[], key: string | undefined) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    try {
      const body = await readBody(request);
      if (!isRecord(body) || !isTopic(body.topic)) throw new ArticleError("INVALID_TOPIC", "Data topik atau jalur bacaan tidak valid.", 400);
      const exclude = body.exclude ?? [];
      if (!Array.isArray(exclude) || exclude.length > 50 || !exclude.every((title: unknown) => typeof title === "string" && title.length <= 160))
        throw new ArticleError("INVALID_TOPIC", "Daftar topik sebelumnya tidak valid.", 400);
      const { env } = await getCloudflareContext({ async: true });
      const result = await generate(body.topic, exclude, env.GEMINI_API_KEY);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const failure = error instanceof ArticleError ? error : new ArticleError("UPSTREAM_ERROR", "Layanan bacaan sedang tidak tersedia. Coba lagi.", 503);
      console.error(JSON.stringify({ event: "generation_failed", code: failure.code, status: failure.status }));
      return Response.json(
        { error: { code: failure.code, message: failure.message, retryAfter: failure.retryAfter } },
        {
          status: failure.status,
          headers: { "Cache-Control": "no-store", ...(failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {}) },
        }
      );
    }
  };
}
