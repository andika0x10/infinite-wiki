import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { ArticleError } from "../src/lib/article";
import { FeedSession, type FeedReader } from "../src/lib/feed";
import { FeedClient } from "../src/services/articles";
import { entries, page } from "./fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const signal = () => new AbortController().signal;

test("cached articles use GET only and share stable IDs and content across sessions", async () => {
  const items = entries(10);
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, "GET");
    const params = new URL(String(url), "http://test").searchParams;
    return Response.json(page(items, Number(params.get("after")), Number(params.get("limit"))));
  };
  const a = new FeedSession(new FeedClient());
  const b = new FeedSession(new FeedClient());
  await Promise.all([a.ensure(0), b.ensure(0)]);
  assert.deepEqual(a.getSnapshot().entries, b.getSnapshot().entries);
  assert.equal(a.getSnapshot().entries.length, 2);
});
test("client validates ordering and never generates after a cache outage", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: "CACHE_UNAVAILABLE", message: "Unavailable" } }, { status: 503 });
  };
  await assert.rejects(new FeedClient().next(0, 2, signal()), { code: "CACHE_UNAVAILABLE" });
  assert.equal(calls, 1);
  globalThis.fetch = async () => Response.json({ ...page(entries(2)), nextCursor: 5 });
  await assert.rejects(new FeedClient().next(0, 2, signal()), { code: "INVALID_RESPONSE" });
});
test("cache miss appends once then polls for the shared result", async () => {
  let published = false;
  const calls: string[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init?.method ?? "GET");
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)), { after: 0 });
      published = true;
      return Response.json({ status: "pending" }, { status: 202 });
    }
    return Response.json(page(entries(published ? 1 : 0)));
  };
  const result = await new FeedClient().next(0, 2, signal());
  assert.equal(result.entries.length, 1);
  assert.deepEqual(calls, ["GET", "POST", "GET"]);
});
test("cooldown blocks extension while still allowing reads of cached articles", async () => {
  const client = new FeedClient();
  let extensions = 0;
  let cached = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      extensions++;
      return Response.json({ error: { code: "RATE_LIMITED", message: "Wait", retryAfter: 60 } }, { status: 429 });
    }
    return Response.json(page(entries(cached ? 2 : 0)));
  };
  await assert.rejects(client.next(0, 2, signal()), { code: "RATE_LIMITED" });
  await assert.rejects(client.next(0, 2, signal()), { code: "RATE_LIMITED" });
  assert.equal(extensions, 1);
  cached = true;
  assert.equal((await client.next(0, 2, signal())).entries.length, 2);
});
test("feed serializes reading, keeps one article ahead and continues beyond 32 articles", async () => {
  const items = entries(50);
  let calls = 0;
  let concurrent = 0;
  let maximum = 0;
  const reader: FeedReader = {
    next: async (after, limit) => {
      calls++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent--;
      return page(items, after, limit);
    },
  };
  const session = new FeedSession(reader);
  await Promise.all([session.ensure(0), session.ensure(3)]);
  assert.equal(maximum, 1);
  assert.equal(session.getSnapshot().entries.length, 5);
  for (let i = 4; i < 40; i++) await session.ensure(i);
  assert.equal(session.getSnapshot().entries.length, 41);
  const previous = calls;
  await session.ensure(0);
  assert.equal(calls, previous);
});
test("failure preserves readable articles and manual retry does not duplicate them", async () => {
  const items = entries(3);
  let fail = true;
  const session = new FeedSession({
    next: async (after, _limit, _signal, retry) => {
      if (after === 0) return page(items, 0, 1);
      if (fail) {
        fail = false;
        throw new ArticleError("UPSTREAM_ERROR", "Network");
      }
      assert.equal(retry, true);
      return page(items, after, 1);
    },
  });
  await session.ensure(0);
  assert.equal(session.getSnapshot().entries.length, 1);
  assert.ok(session.getSnapshot().error);
  await session.retry(0);
  assert.equal(session.getSnapshot().error, null);
  assert.equal(session.getSnapshot().entries.length, 2);
});
test("unmount cancels polling without displaying an error", async () => {
  const session = new FeedSession({
    next: (_after, _limit, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  });
  const reading = session.ensure(0);
  session.stop();
  await reading;
  assert.equal(session.getSnapshot().error, null);
});
