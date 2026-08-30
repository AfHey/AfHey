import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module; must not be bundled.
  serverExternalPackages: ["argon2"],
};

export default nextConfig;
