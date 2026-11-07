import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // docs/*.md and docs/img live at the repo root; ship them with the server functions.
  outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
  outputFileTracingIncludes: { "/docs/**": ["../../docs/**/*"], "/docs": ["../../docs/**/*"] },
  partialPrefetching: true,
  // The SDK is a workspace TS package; let Next compile it.
  transpilePackages: ["@arkivzk/sdk", "@arkivzk/core", "@arkivzk/vault", "@arkivzk/zk", "@arkivzk/crypto", "@arkivzk/swarm"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Cross-origin isolation: required for SharedArrayBuffer, which the
  // multithreaded Barretenberg (UltraHonk) WASM prover needs.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
