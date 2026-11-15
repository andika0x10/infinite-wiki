import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTitle, ROOT } from "../src/lib/topics";
import { embed, EMBEDDING_DIMENSIONS, verifyDuplicate } from "../src/services/semantic";
import { content, completion, entries } from "./fixtures";
import { contentHash } from "../src/services/catalog";

test("technical names C++, C# and C stay distinct", () => {
  assert.equal(new Set(["C++", "C#", "C"].map(normalizeTitle)).size, 3);
});
test("normalizes 768 dimensional embeddings and rejects invalid vectors", async () => {
  const vector = await embed("Sistem operasi", "key", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.taskType, "SEMANTIC_SIMILARITY");
    assert.equal(body.outputDimensionality, 768);
    return Response.json({ embedding: { values: Array(EMBEDDING_DIMENSIONS).fill(1) } });
  });
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-10);
  for (const values of [[], Array(768).fill(0), Array(768).fill(null)])
    await assert.rejects(
      embed("x", "key", async () => Response.json({ embedding: { values } })),
      { code: "INVALID_RESPONSE" }
    );
});
test("semantic verdicts allow related concepts and require a real canonical ID", async () => {
  const candidates = entries(2).map((entry) => ({ ...entry, jobKey: `append:${entry.sequence - 1}` }));
  const verifier = (value: unknown) => verifyDuplicate(ROOT, content, candidates, "key", async () => Response.json(completion(value)));
  assert.equal(await verifier({ verdict: "duplicate", duplicateId: ROOT.id }), ROOT.id);
  assert.equal(await verifier({ verdict: "distinct", duplicateId: null }), null);
  await assert.rejects(verifier({ verdict: "uncertain", duplicateId: null }), { code: "DEDUPLICATION_UNAVAILABLE" });
  await assert.rejects(verifier({ verdict: "duplicate", duplicateId: "invented" }), { code: "INVALID_RESPONSE" });
});
test("content hashes normalize whitespace and Unicode width but retain content", async () => {
  assert.equal(await contentHash(content), await contentHash({ ...content, importance: `  ${content.importance} \n` }));
  assert.notEqual(await contentHash(content), await contentHash({ ...content, importance: "Konsep lain." }));
});
