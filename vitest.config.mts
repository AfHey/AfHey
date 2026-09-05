import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Live-provider tests run only via `npm run test:live`.
    exclude: ["tests/live/**", "node_modules/**"],
    // DB suites share one afhey_test database; files must not run concurrently.
    fileParallelism: false,
  },
});
