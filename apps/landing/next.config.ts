import type { NextConfig } from "next";

// Static export: this is a marketing page, not the app — no server, no API
// routes, deployable as plain files. `images.unoptimized` is required by
// `output: "export"` (the default Next.js image loader needs a running
// server); the screenshot is pre-sized and served as-is instead.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
