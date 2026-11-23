/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint is a separate step (`npm run lint`) so a style warning can never block a production build.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Keep native/server-only packages out of the client bundle
    serverComponentsExternalPackages: ["bullmq", "ioredis", "fluent-ffmpeg", "archiver"],
  },
};

export default nextConfig;
