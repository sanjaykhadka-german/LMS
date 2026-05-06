import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tracey/ui", "@tracey/auth", "@tracey/db", "@tracey/types"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
