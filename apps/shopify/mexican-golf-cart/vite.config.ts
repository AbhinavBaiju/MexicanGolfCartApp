import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals({ nativeFetch: true });

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server. The CLI will eventually
// stop passing in HOST, so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

function resolveAppHost(appUrl: string | undefined): string {
  if (!appUrl) {
    return "localhost";
  }

  try {
    return new URL(appUrl).hostname || "localhost";
  } catch {
    console.warn(
      `[vite] Invalid SHOPIFY_APP_URL "${appUrl}". Falling back to localhost for HMR and host checks.`,
    );
    return "localhost";
  }
}

const host = resolveAppHost(process.env.SHOPIFY_APP_URL);
const isLocalHost = host === "localhost" || host === "127.0.0.1";
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? "8002", 10);
const resolvedFrontendPort = Number.isNaN(frontendPort) ? 8002 : frontendPort;

const hmrConfig = isLocalHost
  ? {
      protocol: "ws",
      host: "localhost",
      port: 64999,
      clientPort: 64999,
    }
  : {
      protocol: "wss",
      host,
      port: resolvedFrontendPort,
      clientPort: 443,
    };

export default defineConfig({
  server: {
    allowedHosts: Array.from(new Set(["localhost", "127.0.0.1", host])),
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "@shopify/polaris"],
  },
}) satisfies UserConfig;
