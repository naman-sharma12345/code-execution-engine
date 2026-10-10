import type { NextConfig } from "next";

// Optional: serve the API from the C++ engine (cpp/). Set AETHER_CPP_BACKEND=http://127.0.0.1:3001
// and every /api/* request is proxied to it; the React UI needs no changes.
const cppBackend = process.env.AETHER_CPP_BACKEND?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    // beforeFiles: the built-in /api route handlers must not shadow the C++ backend.
    return cppBackend
      ? { beforeFiles: [{ source: "/api/:path*", destination: `${cppBackend}/api/:path*` }], afterFiles: [], fallback: [] }
      : [];
  },
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
