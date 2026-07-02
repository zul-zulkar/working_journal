/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evidence images are streamed through /api/image/[id]; no remote image loader needed.
  //
  // Silence the Next.js dev cross-origin warning when opening the dev server
  // from another device on the LAN (e.g. testing on a phone). Harmless in prod.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.local"],
  // Enable instrumentation.ts (used to suppress a noisy third-party DEP0169).
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
