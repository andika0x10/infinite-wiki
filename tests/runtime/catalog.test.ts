/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { abortAllDurableObjects, applyD1Migrations, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, afterEach, expect, inject, test, vi } from "vitest";
import { Catalog } from "../../src/services/catalog";
import { CATALOG_NAME } from "../../src/lib/feed-contract";
import { newJob, type GenerationJob } from "../../src/services/catalog-pipeline";
import { ROOT } from "../../src/lib/topics";
import { completion, content } from "../fixtures";
import { GET } from "../../src/app/api/feed/route";
import { POST } from "../../src/app/api/feed/extend/route";

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));

declare module "vitest" {
  interface ProvidedContext {
    migrations: { name: string; queries: string[] }[];
  }
}

let articleCalls = 0;
let failArticle = false;
let paraphrase = false;
let branchTitles: string[];
const stub = () => env.CATALOG.getByName(CATALOG_NAME);
const catalog = () => new Catalog(env.DB);

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, inject("migrations"));
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE test_vectors(id TEXT PRIMARY KEY, namespace TEXT, vector_json TEXT)"),
    env.DB.prepare("CREATE TABLE test_controls(name TEXT PRIMARY KEY, value TEXT)"),
  ]);
  articleCalls = 0;
  failArticle = false;
  paraphrase = false;
  branchTitles = ["Operating systems", "Sistem operasi", "Kernel", "Algorithms"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith(":embedContent")) return Response.json({ embedding: { values: Array(768).fill(1) } });
      const body = JSON.parse(String(init.body));
      const input = JSON.parse(body.contents[0].parts[0].text);
      const instruction: string = body.systemInstruction.parts[0].text;
      if (instruction.startsWith("Buat tepat")) return Response.json(completion({ branches: branchTitles.map((title) => ({ title, description: `Memahami ${title}.` })) }));
      if (instruction.startsWith("Periksa duplikasi")) {
        const same = input.candidates.find((candidate: { title: string }) => candidate.title === "Operating systems");
        const duplicate = input.topic.title === "Sistem operasi" || (paraphrase && input.content && input.topic.title === "Kernel");
        return Response.json(completion({ verdict: same && duplicate ? "duplicate" : "distinct", duplicateId: same && duplicate ? same.id : null }));
      }
      articleCalls++;
      if (failArticle) return Response.json({}, { status: 429, headers: { "Retry-After": "60" } });
      return Response.json(completion({ ...content, importance: `${input.topic.title}: ${content.importance}` }));
    })
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await reset();
});

async function drain() {
  for (let i = 0; i < 100; i++) {
    const state = await catalog().generation();
    if (state.state !== "pending") return state;
    await runDurableObjectAlarm(stub());
  }
  throw new Error("Pipeline did not finish");
}
async function append() {
  expect(await stub().extend(await catalog().tail())).toEqual({ status: "pending" });
  const state = await drain();
  expect(state.state).toBe("idle");
}

test("twenty concurrent readers share one generation and cached reads call no provider", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => stub().extend(0)));
  expect(results.every((result) => "status" in result)).toBe(true);
  await drain();
  expect(articleCalls).toBe(1);
  const a = await catalog().page(0, 2);
  const b = await catalog().page(0, 2);
  expect(a).toEqual(b);
  expect(a.entries[0].topic.id).toBe(ROOT.id);
  expect(await stub().extend(0)).toEqual({ status: "cached" });
  expect(articleCalls).toBe(1);
  expect(await stub().extend(100)).toMatchObject({ error: { code: "INVALID_CURSOR", status: 409 } });
});

test("persists drafts across restart without generating the article again", async () => {
  await stub().extend(0);
  for (let i = 0; i < 30; i++) {
    await runDurableObjectAlarm(stub());
    const job = await runInDurableObject(stub(), async (_instance, state) => {
      const row = state.storage.sql.exec<{ payload: string }>("SELECT payload FROM checkpoint WHERE id = 1").toArray()[0];
      const job = row ? (JSON.parse(row.payload) as GenerationJob) : null;
      if (job?.content) await state.storage.deleteAlarm();
      return job;
    });
    if (job?.content) break;
  }
  expect(articleCalls).toBe(1);
  await abortAllDurableObjects();
  await drain();
  expect(await catalog().tail()).toBe(1);
  expect(articleCalls).toBe(1);
});

test("does not generate the next article while Vectorize is behind", async () => {
  await env.DB.prepare("INSERT INTO test_controls VALUES ('hold_index', '1')").run();
  await stub().extend(0);
  for (let i = 0; i < 15 && (await catalog().tail()) === 0; i++) await runDurableObjectAlarm(stub());
  expect(await catalog().tail()).toBe(1);
  expect(await stub().extend(1)).toEqual({ status: "pending" });
  expect(articleCalls).toBe(1);
  await env.DB.prepare("UPDATE test_controls SET value = '0' WHERE name = 'hold_index'").run();
  await drain();
  await append();
  expect(articleCalls).toBe(2);
  expect(await catalog().tail()).toBe(2);
});

test("synonyms become aliases while related subtopics remain separate", async () => {
  await append();
  await append();
  await append();
  const all = await catalog().page(0, 20);
  expect(all.entries.map((entry) => entry.topic.title)).toEqual([ROOT.title, "Operating systems", "Kernel"]);
  expect((await catalog().byName("Sistem operasi"))?.topic.title).toBe("Operating systems");
  expect(articleCalls).toBe(3);
});

test("paraphrased content is rejected before publication", async () => {
  paraphrase = true;
  await append();
  await append();
  await append();
  expect((await catalog().page(0, 20)).entries.map((entry) => entry.topic.title)).toEqual([ROOT.title, "Operating systems", "Algorithms"]);
  expect((await catalog().byName("Kernel"))?.topic.title).toBe("Operating systems");
});

test("global cooldown preserves cached articles and prevents provider retries", async () => {
  await append();
  failArticle = true;
  await stub().extend(1);
  expect((await drain()).state).toBe("failed");
  const calls = articleCalls;
  expect(await stub().extend(1)).toMatchObject({ error: { code: "RATE_LIMITED", status: 429 } });
  expect(articleCalls).toBe(calls);
  expect((await catalog().page(0, 2)).entries).toHaveLength(1);
  expect(await stub().extend(0)).toEqual({ status: "cached" });
});

test("D1 commit survives a crash before the DO checkpoint advances", async () => {
  const candidate = { ordinal: null, topic: ROOT };
  await catalog().publish("append:0", 0, candidate, content, [
    { id: `concept:${ROOT.id}`, namespace: "concepts-v1", values: Array(768).fill(1) },
    { id: `article:${ROOT.id}`, namespace: "articles-v1", values: Array(768).fill(1) },
  ]);
  await catalog().setGeneration({ state: "pending" });
  await runInDurableObject(stub(), (_instance, state) => {
    state.storage.sql.exec("INSERT OR REPLACE INTO checkpoint(id, payload) VALUES (1, ?)", JSON.stringify({ ...newJob(0), candidate, content, stage: "publish" }));
    return state.storage.setAlarm(Date.now() + 60000);
  });
  await drain();
  expect(await catalog().tail()).toBe(1);
  expect(await catalog().pendingOutbox()).toBeNull();
  expect(articleCalls).toBe(0);
});

test("D1 constraints roll back an entire duplicate publication", async () => {
  await catalog().publish("append:0", 0, { ordinal: null, topic: ROOT }, content, []);
  const child = { ...ROOT, id: "different", title: "Other", parentId: ROOT.id, path: [ROOT.title, "Other"] };
  await expect(catalog().publish("append:1", 1, { ordinal: null, topic: child }, content, [])).rejects.toThrow();
  expect(await catalog().tail()).toBe(1);
  expect(await env.DB.prepare("SELECT id FROM topics WHERE id = 'different'").first()).toBeNull();
});

test("normalized title and alias conflicts also roll back publication", async () => {
  await append();
  const topic = { ...ROOT, id: "different", title: "COMPUTER SCIENCE!", parentId: ROOT.id, path: [ROOT.title, "COMPUTER SCIENCE!"] };
  await expect(catalog().publish("append:1", 1, { ordinal: null, topic }, content, [])).rejects.toThrow();
  expect(await catalog().tail()).toBe(1);
  expect(await env.DB.prepare("SELECT id FROM topics WHERE id = 'different'").first()).toBeNull();
});

test("duplicate-only branches stop with a manual retry error", async () => {
  await append();
  branchTitles = Array(4).fill(ROOT.title);
  await stub().extend(1);
  expect(await drain()).toMatchObject({ state: "failed", error: { code: "EMPTY_BRANCHES" } });
  expect(articleCalls).toBe(1);
  branchTitles = ["Algorithms", "Operating systems", "Kernel", "Compilers"];
  await append();
  expect(await catalog().tail()).toBe(2);
});

test("HTTP feed handlers read D1 and preserve RPC error status", async () => {
  const start = await POST(new Request("https://wiki.test/api/feed/extend", { method: "POST", body: JSON.stringify({ after: 0 }) }));
  expect(start.status).toBe(202);
  expect(await start.json()).toEqual({ status: "pending" });
  await drain();
  const a = await GET(new Request("https://wiki.test/api/feed?after=0&limit=2"));
  const b = await GET(new Request("https://wiki.test/api/feed?after=0&limit=2"));
  expect(a.status).toBe(200);
  expect(a.headers.get("Cache-Control")).toBe("no-store");
  expect(await a.json()).toEqual(await b.json());
  expect(articleCalls).toBe(1);
  const invalid = await POST(new Request("https://wiki.test/api/feed/extend", { method: "POST", body: JSON.stringify({ after: 100 }) }));
  expect(invalid.status).toBe(409);
  expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_CURSOR" } });
});
