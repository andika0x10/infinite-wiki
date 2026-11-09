import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { ArticleError, isArticleContent } from "../src/lib/article";
import { ROOT, isTopic, isBranches, normalizeTitle, topicContext, type Topic } from "../src/lib/topics";
import { FeedSession, type FeedGenerator } from "../src/lib/feed";
import { generateArticle, generateBranches, MODEL } from "../src/services/gemini";
import { GenerationClient } from "../src/services/articles";

const content = {
  explanation: ["Komputasi mengubah masukan menjadi keluaran.", "Algoritma menjelaskan langkah-langkah yang digunakan."],
  importance: "Memahami dasar komputasi membantu kita menilai sistem.",
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function mockResponse(body: unknown, status = 200, headers?: HeadersInit): typeof fetch {
  return async () => Response.json(body, { status, headers });
}
function completion(value: unknown = content, finishReason = "STOP") {
  return { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] };
}
function fixture() {
  let batch = 0;
  const events: string[] = [];
  const generator: FeedGenerator = {
    branches: async (parent) => {
      events.push(`branches:${parent.id}`);
      return Array.from({ length: 4 }, (_, i) => ({ title: `Concept ${batch * 4 + i + 1}`, description: "Cabang Computer Science." })).map((branch, i) => {
        if (i === 3) batch++;
        return branch;
      });
    },
    article: async (topic) => {
      events.push(`article:${topic.id}`);
      return content;
    },
  };
  return { generator, events };
}

test("validates topic, branch and article contracts; bounds deep context without limiting session depth", () => {
  assert.ok(isArticleContent(content));
  for (const value of [null, {}, { ...content, explanation: ["one"] }, { ...content, importance: " " }, { ...content, explanation: [1, 2] }])
    assert.equal(isArticleContent(value), false);
  assert.ok(isTopic(ROOT));
  assert.equal(isTopic({ ...ROOT, path: ["Physics"] }), false);
  assert.equal(isTopic({ ...ROOT, title: " ", id: 5 }), false);
  assert.equal(isBranches({ branches: [] }), false);
  const deep: Topic = { ...ROOT, id: "deep", parentId: "parent", title: "Leaf", path: [ROOT.title, ...Array.from({ length: 30 }, (_, i) => `Level ${i}`), "Leaf"] };
  assert.ok(isTopic(topicContext(deep)));
  assert.equal(deep.path.length, 32);
  assert.equal(topicContext(deep).path.length, 16);
  assert.equal(normalizeTitle("  ＳＱＬ—injection! "), "sql injection");
});

test("missing server key makes no upstream call", async () => {
  await assert.rejects(
    generateArticle(ROOT, undefined, async () => {
      throw new Error("must not call");
    }),
    { code: "NOT_CONFIGURED", status: 503 }
  );
});
test("uses existing model, secret header and structured JSON; separates planning from article generation", async () => {
  const result = await generateArticle(ROOT, "test-key", async (url, init) => {
    assert.ok(String(url).includes(MODEL));
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.ok(body.generationConfig.responseJsonSchema.properties.explanation);
    assert.ok(!String(init?.body).includes("test-key"));
    return Response.json(completion());
  });
  assert.deepEqual(result, content);
  const branches = Array.from({ length: 4 }, (_, i) => ({ title: `Topic ${i}`, description: "A branch." }));
  assert.deepEqual(
    await generateBranches(ROOT, ["Already seen"], "key", async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(body.generationConfig.responseJsonSchema.properties.branches);
      assert.ok(body.contents[0].parts[0].text.includes("Already seen"));
      return Response.json(completion({ branches }));
    }),
    branches
  );
  await assert.rejects(generateBranches(ROOT, [], "key", mockResponse(completion({ branches: [] }))), { code: "INVALID_RESPONSE" });
});
test("rejects blocked, empty, truncated and malformed provider output", async () => {
  for (const body of [
    {},
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [] },
    completion(content, "MAX_TOKENS"),
    completion({ explanation: [] }),
    { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } }] },
  ]) {
    await assert.rejects(generateArticle(ROOT, "key", mockResponse(body)), { code: "INVALID_RESPONSE" });
  }
});
test("maps timeout, network failure, rate limits and upstream failure", async () => {
  await assert.rejects(
    generateArticle(ROOT, "key", async () => {
      throw new DOMException("timeout", "TimeoutError");
    }),
    { code: "TIMEOUT", status: 504 }
  );
  await assert.rejects(
    generateArticle(ROOT, "key", async () => {
      throw new Error("network");
    }),
    { code: "UPSTREAM_ERROR" }
  );
  await assert.rejects(generateArticle(ROOT, "key", mockResponse({}, 500)), { code: "UPSTREAM_ERROR" });
  await assert.rejects(generateArticle(ROOT, "key", mockResponse({}, 429, { "Retry-After": "12" })), { code: "RATE_LIMITED", retryAfter: 12 });
  await assert.rejects(generateArticle(ROOT, "key", mockResponse({}, 429)), { code: "RATE_LIMITED", retryAfter: 60 });
});
test("client deduplicates requests, validates responses and caches successes", async () => {
  let calls = 0;
  const client = new GenerationClient();
  globalThis.fetch = async () => {
    calls++;
    return Response.json(content);
  };
  await Promise.all([client.article(ROOT), client.article(ROOT)]);
  await client.article(ROOT);
  assert.equal(calls, 1);
  globalThis.fetch = mockResponse({ explanation: [] });
  await assert.rejects(new GenerationClient().article(ROOT), { code: "INVALID_RESPONSE" });
});
test("client retries failed requests and applies cooldown across both endpoints", async () => {
  const client = new GenerationClient();
  globalThis.fetch = mockResponse({ error: { message: "Unavailable" } }, 502);
  await assert.rejects(client.article(ROOT), ArticleError);
  globalThis.fetch = mockResponse(content);
  assert.deepEqual(await client.article(ROOT), content);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: "Wait", retryAfter: 60 } }, { status: 429 });
  };
  await assert.rejects(client.branches(ROOT, []), { code: "RATE_LIMITED" });
  await assert.rejects(client.article({ ...ROOT, id: "other" }), { code: "RATE_LIMITED" });
  assert.equal(calls, 1);
});
test("branches precede root article, preserves FIFO parents and prefetches just one article", async () => {
  const { generator, events } = fixture();
  const session = new FeedSession(generator);
  await Promise.all([session.ensure(0), session.ensure(0)]);
  assert.deepEqual(events, ["branches:computer-science", "article:computer-science", "article:topic-1"]);
  assert.equal(session.getSnapshot().entries.length, 2);
  await session.ensure(0);
  assert.equal(events.length, 3);
  for (let i = 1; i < 40; i++) await session.ensure(i);
  const entries = session.getSnapshot().entries;
  assert.equal(entries.length, 41);
  assert.equal(new Set(entries.map((entry) => normalizeTitle(entry.topic.title))).size, 41);
  assert.equal(entries[5].topic.parentId, entries[1].topic.id);
  assert.deepEqual(entries[5].topic.path, [...entries[1].topic.path, entries[5].topic.title]);
  await session.ensure(2);
  assert.equal(session.getSnapshot().entries.length, 41);
});
test("generation is serialized even when user advances while loading", async () => {
  const { generator } = fixture();
  let concurrent = 0;
  let maximum = 0;
  const delayed: FeedGenerator = {
    branches: async (...args) => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const result = await generator.branches(...args);
      concurrent--;
      return result;
    },
    article: async (...args) => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const result = await generator.article(...args);
      concurrent--;
      return result;
    },
  };
  const session = new FeedSession(delayed);
  await Promise.all([session.ensure(0), session.ensure(3)]);
  assert.equal(maximum, 1);
  assert.equal(session.getSnapshot().entries.length, 5);
});
test("empty or duplicate branches stop after two attempts and can be retried manually", async () => {
  let calls = 0;
  const { generator } = fixture();
  const session = new FeedSession({
    ...generator,
    branches: async (...args) => {
      calls++;
      return calls <= 2 ? Array(4).fill({ title: "COMPUTER SCIENCE!", description: "Duplicate" }) : generator.branches(...args);
    },
  });
  await session.ensure(0);
  assert.equal(calls, 2);
  assert.equal(session.getSnapshot().entries.length, 0);
  assert.ok(session.getSnapshot().error);
  await session.ensure(0);
  assert.equal(calls, 2);
  await session.retry(0);
  assert.equal(session.getSnapshot().error, null);
  assert.equal(session.getSnapshot().entries.length, 2);
});
test("article failure preserves generated branches and existing articles; cooldown prevents retry", async () => {
  const { generator, events } = fixture();
  let fail = true;
  const session = new FeedSession({
    ...generator,
    article: async (topic) => {
      if (topic.id !== ROOT.id && fail) throw new ArticleError("RATE_LIMITED", "Wait", 429, 60);
      return generator.article(topic);
    },
  });
  await session.ensure(0);
  assert.equal(session.getSnapshot().entries.length, 1);
  assert.ok(session.getSnapshot().error!.retryAt > Date.now());
  const prior = events.length;
  await session.retry(0);
  assert.equal(events.length, prior);
  fail = false;
  // A fresh session tests retry without waiting for a real cooldown.
  let attempts = 0;
  const second = new FeedSession({
    ...generator,
    article: async (topic) => {
      if (++attempts === 2) throw new Error("Network");
      return generator.article(topic);
    },
  });
  await second.ensure(0);
  await second.retry(0);
  assert.equal(second.getSnapshot().entries.length, 2);
  assert.equal(second.getSnapshot().entries[1].topic.id, "topic-1");
});
