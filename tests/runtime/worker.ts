import { WorkerEntrypoint } from "cloudflare:workers";
export { CatalogCoordinator } from "../../src/workers/catalog-coordinator";

/** Test-only Vectorize substitute; exercises RPC without a remote account. */
export class SemanticIndexFake extends WorkerEntrypoint<CloudflareEnv> {
  async query(_values: number[], options: VectorizeQueryOptions): Promise<VectorizeMatches> {
    const rows = await this.env.DB.prepare("SELECT vector_json FROM test_vectors WHERE namespace = ? ORDER BY id LIMIT ?")
      .bind(options.namespace, options.topK ?? 10)
      .all<{ vector_json: string }>();
    return { count: rows.results.length, matches: rows.results.map((row) => ({ ...JSON.parse(row.vector_json), score: 0.99 })) };
  }
  async upsert(vectors: VectorizeVector[]) {
    const mutationId = crypto.randomUUID();
    await this.env.DB.batch([
      ...vectors.map((vector) => this.env.DB.prepare("INSERT OR REPLACE INTO test_vectors VALUES (?, ?, ?)").bind(vector.id, vector.namespace, JSON.stringify(vector))),
      this.env.DB.prepare("INSERT OR REPLACE INTO test_controls VALUES ('mutation', ?)").bind(mutationId),
    ]);
    return { mutationId };
  }
  async describe() {
    const held = await this.env.DB.prepare("SELECT value FROM test_controls WHERE name = 'hold_index'").first<string>("value");
    const mutation = await this.env.DB.prepare("SELECT value FROM test_controls WHERE name = 'mutation'").first<string>("value");
    return { dimensions: 768, processedUpToMutation: held === "1" ? "waiting" : mutation };
  }
}
const handler = { fetch: () => new Response("test worker") };
export default handler;
