import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
