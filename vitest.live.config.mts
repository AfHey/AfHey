import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Live-provider tests: real OpenAI calls against the pinned model, run on
 * demand with `npm run test:live` (needs OPENAI_API_KEY). Never part of
 * `npm test` or CI.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
