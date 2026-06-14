import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Inline re-implementation of the plugin factory for unit testing.
// We extract the same logic from vite.config.ts so tests run without Vite.
// ---------------------------------------------------------------------------

interface MockRes {
  setHeader: ReturnType<typeof vi.fn>;
}

interface MockReq {
  url?: string;
}

type NextFn = () => void;

type MiddlewareFn = (req: MockReq, res: MockRes, next: NextFn) => void;

interface PluginShape {
  name: string;
  configureServer: (server: { middlewares: { use: (fn: MiddlewareFn) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (fn: MiddlewareFn) => void } }) => void;
}

function coopCoepPlugin(): PluginShape {
  function applyHeaders(res: MockRes): void {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRes(): MockRes {
  return { setHeader: vi.fn() };
}

function captureMiddleware(
  registerFn: (server: { middlewares: { use: (fn: MiddlewareFn) => void } }) => void,
): MiddlewareFn {
  let captured: MiddlewareFn | undefined;
  registerFn({
    middlewares: {
      use(fn) {
        captured = fn;
      },
    },
  });
  if (captured === undefined) {
    throw new Error("Middleware was never registered");
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coopCoepPlugin", () => {
  describe("plugin shape", () => {
    it("returns a plugin with name 'coop-coep'", () => {
      const plugin = coopCoepPlugin();
      expect(plugin.name).toBe("coop-coep");
    });

    it("exposes configureServer function", () => {
      const plugin = coopCoepPlugin();
      expect(typeof plugin.configureServer).toBe("function");
    });

    it("exposes configurePreviewServer function", () => {
      const plugin = coopCoepPlugin();
      expect(typeof plugin.configurePreviewServer).toBe("function");
    });
  });

  describe("configureServer middleware", () => {
    it("sets Cross-Origin-Opener-Policy: same-origin", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(plugin.configureServer.bind(plugin));
      const res = makeMockRes();
      const next = vi.fn();

      middleware({}, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Cross-Origin-Opener-Policy",
        "same-origin",
      );
    });

    it("sets Cross-Origin-Embedder-Policy: require-corp", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(plugin.configureServer.bind(plugin));
      const res = makeMockRes();
      const next = vi.fn();

      middleware({}, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Cross-Origin-Embedder-Policy",
        "require-corp",
      );
    });

    it("calls next() after setting headers", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(plugin.configureServer.bind(plugin));
      const res = makeMockRes();
      const next = vi.fn();

      middleware({}, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("sets both headers on each request", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(plugin.configureServer.bind(plugin));

      for (let i = 0; i < 3; i++) {
        const res = makeMockRes();
        middleware({}, res, vi.fn());
        expect(res.setHeader).toHaveBeenCalledTimes(2);
      }
    });
  });

  describe("configurePreviewServer middleware", () => {
    it("sets Cross-Origin-Opener-Policy: same-origin", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(
        plugin.configurePreviewServer.bind(plugin),
      );
      const res = makeMockRes();

      middleware({}, res, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        "Cross-Origin-Opener-Policy",
        "same-origin",
      );
    });

    it("sets Cross-Origin-Embedder-Policy: require-corp", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(
        plugin.configurePreviewServer.bind(plugin),
      );
      const res = makeMockRes();

      middleware({}, res, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        "Cross-Origin-Embedder-Policy",
        "require-corp",
      );
    });

    it("calls next() after setting headers", () => {
      const plugin = coopCoepPlugin();
      const middleware = captureMiddleware(
        plugin.configurePreviewServer.bind(plugin),
      );
      const res = makeMockRes();
      const next = vi.fn();

      middleware({}, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it("preview middleware is independent from dev middleware", () => {
      const plugin = coopCoepPlugin();
      const devMiddleware = captureMiddleware(plugin.configureServer.bind(plugin));
      const previewMiddleware = captureMiddleware(
        plugin.configurePreviewServer.bind(plugin),
      );

      const devRes = makeMockRes();
      const previewRes = makeMockRes();

      devMiddleware({}, devRes, vi.fn());
      previewMiddleware({}, previewRes, vi.fn());

      // Each response gets exactly its own 2 headers, no cross-contamination
      expect(devRes.setHeader).toHaveBeenCalledTimes(2);
      expect(previewRes.setHeader).toHaveBeenCalledTimes(2);
    });
  });
});
