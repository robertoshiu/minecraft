import { defineConfig, type Plugin } from "vitest/config";

/**
 * Inline plugin that adds COOP/COEP headers in dev and preview servers.
 * Required for SharedArrayBuffer and cross-origin isolation features.
 */
function coopCoepPlugin(): Plugin {
  function applyHeaders(
    res: { setHeader: (name: string, value: string) => void },
  ): void {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }

  return {
    name: "coop-coep",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        applyHeaders(res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        applyHeaders(res);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [coopCoepPlugin()],

  build: {
    target: "esnext",
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes("@babylonjs/core")) {
            return "babylonjs-core";
          }
          return undefined;
        },
      },
    },
  },

  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
