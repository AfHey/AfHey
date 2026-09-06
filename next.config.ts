import type { NextConfig } from "next";
import { parseDevOrigins } from "./src/lib/dev-origins";

const nextConfig: NextConfig = {
  // Native module; must not be bundled.
  serverExternalPackages: ["argon2"],
  // Development only (ignored by `next start`): hosts besides localhost that
  // may load dev resources, e.g. a phone reaching `next dev` over the LAN.
  // Without this Next 16 returns 403 for the page's own scripts, the login
  // form never hydrates, and submitting it just reloads /login.
  allowedDevOrigins: parseDevOrigins(process.env.AFHEY_DEV_ORIGINS),
  // The Playwright web server builds into its own directory so it can run
  // beside a manually started `next dev`, which holds a per-directory lock.
  distDir: process.env.AFHEY_DIST_DIR ?? ".next",
};

export default nextConfig;
