import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

// Real environment variables win over .env (Node keeps existing values), so
// tests can point the CLI at TEST_DATABASE_URL by overriding DATABASE_URL.
try {
  loadEnvFile();
} catch {
  // No .env file (e.g. CI) — env must come from the process environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
