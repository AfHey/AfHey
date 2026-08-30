import { PrismaPg } from "@prisma/adapter-pg";
import { requiredEnv } from "@/lib/env";
import { PrismaClient } from "./generated/client";

/**
 * Creates a PrismaClient bound to the given database. Tests pass
 * TEST_DATABASE_URL; the app uses the default DATABASE_URL.
 */
export function createPrismaClient(
  connectionString: string = requiredEnv("DATABASE_URL"),
): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalStore = globalThis as unknown as { __afheyPrisma?: PrismaClient };

/** App-wide client, created lazily and reused across Next.js dev reloads. */
export function getPrisma(): PrismaClient {
  globalStore.__afheyPrisma ??= createPrismaClient();
  return globalStore.__afheyPrisma;
}
