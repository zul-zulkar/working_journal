/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evidence images are streamed through /api/image/[id]; no remote image loader needed.
};

export default nextConfig;
