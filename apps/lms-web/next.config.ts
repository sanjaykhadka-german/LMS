import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tracey/ui", "@tracey/auth", "@tracey/db", "@tracey/types"],
  experimental: {
    // 10mb covers photo upload (capped at 8mb in lib/lms/photos.ts) and
    // CSV bulk upload (a few hundred KB at most). Stripe webhooks have
    // their own raw-body parser so this doesn't affect them.
    serverActions: { bodySizeLimit: "10mb" },
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
