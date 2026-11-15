import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig(async () => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [cloudflareTest({ wrangler: { configPath: "./tests/runtime/wrangler.jsonc" }, remoteBindings: false })],
  test: { include: ["tests/runtime/**/*.test.ts"], provide: { migrations: await readD1Migrations("./migrations") }, fileParallelism: false },
}));
