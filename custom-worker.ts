import handler from "./.open-next/worker.js";
export { CatalogCoordinator } from "./src/workers/catalog-coordinator";
export default { fetch: handler.fetch } satisfies ExportedHandler<CloudflareEnv>;
