import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone server output for Docker — produces .next/standalone/server.js so
  // the runtime image needs only Node + the minimal traced node_modules.
  output: "standalone",
  // Allow the dev server's internal assets (/_next/* chunks, HMR) to be served
  // when the site is opened from a phone over the LAN IP. Without this, Next 16
  // treats the LAN origin as cross-origin and blocks the JS → React never
  // hydrates on mobile (buttons dead). localhost is always allowed.
  allowedDevOrigins: ["192.168.7.171"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
