import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow server-side WS connections to gateway
  serverExternalPackages: ["ws"],
};

export default nextConfig;
