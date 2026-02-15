import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow server-side packages
  serverExternalPackages: ["ws", "web-push"],
};

export default nextConfig;
