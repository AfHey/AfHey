import { loadEnvFile } from "node:process";

/**
 * Loads .env for standalone entrypoints (seed, jobs, tests). Next.js loads
 * .env itself; scripts run through tsx/vitest do not. Existing process
 * environment variables always win over .env values.
 */
export function loadLocalEnv(): void {
  try {
    loadEnvFile();
  } catch {
    // No .env present — rely on the process environment (e.g. CI).
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
