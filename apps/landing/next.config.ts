import type { NextConfig } from "next";

// `images.unoptimized` is required by `output: "export"`: the default image
// loader needs a running server.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
