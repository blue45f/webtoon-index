import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { build as viteBuild, defineConfig, type Plugin } from "vite";

import { createStudioManualChunks } from "./apps/web/config/vite-manual-chunks";

import {
  planStudioServiceWorkerPrecache,
  studioServiceWorkerBuildId,
  type StudioServiceWorkerManifest,
  type StudioViteManifest,
} from "./apps/web/src/app/service-worker/studio-service-worker-precache-plan";
import {
  STUDIO_CROSS_ORIGIN_ISOLATION_HEADERS,
  STUDIO_CROSS_ORIGIN_ISOLATION_WORKER_HEADERS,
  isStudioCrossOriginIsolationDocumentRequest,
  isStudioCrossOriginIsolationWorkerRequest,
} from "./apps/web/src/app/studio-cross-origin-isolation";

const webRoot = fileURLToPath(new URL("./apps/web", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("./", import.meta.url));

const apiTarget = process.env.NEST_API_URL ?? "http://127.0.0.1:4001";
// Chunks that must never be pulled into the entry document's <link rel="modulepreload"> set.
// A modulepreload is a highest-priority fetch on every route, so anything here competes with the
// entry script and the render-blocking stylesheet for the first round trip.
// "i18n" covers the shared dictionary chunk and the route i18n loaders: translations resolve
// through an explicit ko/en fallback chain, so nothing on the critical path blocks on them.
const ENTRY_PRELOAD_EXCLUSIONS = [
  "studio-konva-runtime",
  "StudioVrmPoser",
  "three.module",
  "three-vrm.module",
  "GLTFLoader",
  "lucide-studio-core-icons",
  "i18n",
];
const INITIAL_ICON_MODULES = new Set([
  "chevron-left",
  "chevron-right",
  "pause",
  "play",
  "sparkles",
  "star",
]);
const STUDIO_CORE_ICON_MODULES = new Set([
  "a-large-small",
  "align-justify",
  "arrow-up-to-line",
  "asterisk",
  "blend",
  "bookmark",
  "book-open",
  "brush",
  "check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "circle",
  "circle-check",
  "circle-dashed",
  "circle-dot",
  "circle-ellipsis",
  "clipboard-check",
  "cloud",
  "cloud-fog",
  "command",
  "copy",
  "credit-card",
  "download",
  "droplets",
  "eye",
  "eye-off",
  "eraser",
  "feather",
  "fence",
  "film",
  "flame",
  "flip-horizontal-2",
  "flower-2",
  "footprints",
  "gem",
  "grid-2x2",
  "grid-3x3",
  "grip",
  "hand",
  "heart",
  "highlighter",
  "history",
  "image",
  "image-plus",
  "images",
  "layers",
  "layers-3",
  "layout-grid",
  "layout-template",
  "leaf",
  "loader-circle",
  "lock",
  "lock-open",
  "maximize-2",
  "message-circle",
  "message-square",
  "minus",
  "minimize-2",
  "mouse-pointer-2",
  "move",
  "paint-bucket",
  "paint-roller",
  "paintbrush",
  "palette",
  "pen",
  "pen-line",
  "pen-tool",
  "pencil",
  "pipette",
  "plus",
  "redo-2",
  "rectangle-horizontal",
  "rectangle-vertical",
  "rows-3",
  "rotate-ccw",
  "scan-line",
  "scissors",
  "send",
  "shapes",
  "shield-check",
  "sliders-horizontal",
  "smartphone",
  "smile",
  "spline",
  "spray-can",
  "square",
  "star",
  "stamp",
  "sun",
  "trees",
  "trash-2",
  "type",
  "undo-2",
  "upload",
  "users-round",
  "video",
  "waves",
  "wand-sparkles",
  "wheat",
  "wind",
]);

function iconModuleName(id: string) {
  if (!id.includes("lucide-react") || !id.includes("/icons/")) return null;
  const fileName = id.slice(id.lastIndexOf("/") + 1);
  const match = fileName.match(/^(.+?)\.(?:[cm]?[jt]s)$/);
  return match ? match[1] : null;
}

function isInitialIconModule(id: string) {
  const moduleName = iconModuleName(id);
  return Boolean(moduleName && INITIAL_ICON_MODULES.has(moduleName));
}

function isStudioCoreIconModule(id: string) {
  const moduleName = iconModuleName(id);
  return Boolean(moduleName && STUDIO_CORE_ICON_MODULES.has(moduleName));
}

/**
 * Folder-move leftovers sometimes leave production specifiers pointing at `*.test.ts`.
 * Resolve the sibling implementation when one exists so the studio bundle never binds
 * runtime exports (e.g. STUDIO_RASTER_CRDT_VERSION) from a test module.
 */
function preferImplementationOverTestModulePlugin(): Plugin {
  return {
    name: "toonspectrum-prefer-implementation-over-test-module",
    apply: "serve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (process.env.VITEST || !importer) return null;
      if (!source.includes(".test.")) return null;
      if (/\.test\.tsx?(?:\?|$)/.test(importer)) return null;
      if (!/\.test\.tsx?(?:\?|$)/.test(source)) return null;
      const rewritten = source.replace(/\.test\.(tsx?)(?=\?|$)/, ".$1");
      return this.resolve(rewritten, importer, { ...options, skipSelf: true });
    },
  };
}

function studioCrossOriginIsolationPlugin(): Plugin {
  const applyHeaders = (
    request: {
      readonly url?: string;
      readonly method?: string;
      readonly headers: {
        readonly accept?: string;
        readonly "sec-fetch-dest"?: string;
      };
    },
    response: { setHeader(name: string, value: string): void },
  ) => {
    // The Service Worker script itself. `credentialless` matches the Studio
    // document's embedder policy: a worker may only control a client whose COEP
    // it is compatible with, and a non-isolated public page accepts it too.
    // `no-cache` keeps the field-recovery window short if a bad worker ships.
    if ((request.url ?? "").split("?")[0] === "/sw.js") {
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Service-Worker-Allowed", "/");
      response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    }
    if (isStudioCrossOriginIsolationWorkerRequest({
      url: request.url,
      method: request.method,
      accept: request.headers.accept,
      secFetchDest: request.headers["sec-fetch-dest"],
    })) {
      for (const [name, value] of Object.entries(
        STUDIO_CROSS_ORIGIN_ISOLATION_WORKER_HEADERS,
      )) {
        response.setHeader(name, value);
      }
    }
    if (
      !isStudioCrossOriginIsolationDocumentRequest({
        url: request.url,
        method: request.method,
        accept: request.headers.accept,
        secFetchDest: request.headers["sec-fetch-dest"],
      })
    ) {
      return;
    }
    for (const [name, value] of Object.entries(STUDIO_CROSS_ORIGIN_ISOLATION_HEADERS)) {
      response.setHeader(name, value);
    }
  };

  return {
    name: "toonspectrum-studio-cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        applyHeaders(request, response);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        applyHeaders(request, response);
        next();
      });
    },
  };
}

/**
 * Same-origin URLs the Studio route *blocks* on but that are not part of any JS
 * module graph: `AppRouter` `Promise.all`s these two dictionaries with the route
 * chunk, so the route cannot commit until they resolve.
 */
const STUDIO_I18N_NAMESPACES = [
  "aiNotice", "aiToolPopover", "assetMenu", "background", "bubble", "bubbleTail", "canvas",
  "commandBar", "commandSearch", "community", "creativeModes", "customFonts", "hub",
  "imageAdjustments", "mainMenu", "mobileDock", "quickShape", "quickStart", "settings",
  "shortcuts", "toolsCompanion", "tutorial", "tutorialTry",
];
const STUDIO_SERVICE_WORKER_WARM_URLS = STUDIO_I18N_NAMESPACES.flatMap((namespace) =>
  ["ko", "en"].map((locale) => `/i18n/studio/${namespace}/${locale}.json`),
);

/**
 * Compiles `src/app/service-worker/studio-service-worker-entry.ts` into
 * `dist/sw.js`, injecting a precache manifest derived from the app build.
 *
 * A nested `vite.build()` (rather than an extra Rollup entry) is what keeps the
 * worker out of `dist/.vite/manifest.json`. `scripts/check-studio-bundle.mjs`
 * reads that manifest to police the eager module graph, so emitting the worker
 * as an app chunk would put a precache list on the studio bundle ratchet.
 */
function studioServiceWorkerPlugin(): Plugin {
  let root = process.cwd();
  let outDir = path.resolve(root, "dist");

  return {
    name: "toonspectrum-service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const manifestPath = path.join(outDir, ".vite", "manifest.json");
      // Only the app build emits a manifest; any nested/library build skips.
      if (!existsSync(manifestPath)) return;

      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as StudioViteManifest;
      const sizeOf = (url: string): number | null => {
        try {
          return statSync(path.join(outDir, url.replace(/^\/+/u, ""))).size;
        } catch {
          return null;
        }
      };

      const plan = planStudioServiceWorkerPrecache({
        manifest,
        appEntryKey: "index.html",
        warmUrls: STUDIO_SERVICE_WORKER_WARM_URLS,
        sizeOf,
      });
      for (const warning of plan.warnings) this.warn(warning);
      if (plan.violations.length > 0) {
        // Failing the build is the point: a precache that quietly grew into the
        // lazy graph would ship megabytes to every first-time visitor.
        throw new Error(
          `service worker precache plan rejected:\n  ${plan.violations.join("\n  ")}`,
        );
      }

      const swManifest: StudioServiceWorkerManifest = {
        buildId: studioServiceWorkerBuildId(plan, (value) =>
          createHash("sha256").update(value).digest("hex"),
        ),
        shellUrls: plan.shellUrls,
        criticalUrls: plan.criticalUrls,
        warmUrls: plan.warmUrls,
      };

      await viteBuild({
        configFile: false,
        root,
        logLevel: "warn",
        define: {
          __STUDIO_SERVICE_WORKER_MANIFEST__: JSON.stringify(swManifest),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          manifest: false,
          sourcemap: false,
          reportCompressedSize: false,
          // `iife`, not `module`: classic worker registration is the only shape
          // every supported browser accepts today.
          lib: {
            entry: path.resolve(
              root,
              "src/app/service-worker/studio-service-worker-entry.ts",
            ),
            formats: ["iife"],
            name: "toonspectrumServiceWorker",
            fileName: () => "sw.js",
          },
        },
      });

      this.warn(
        `service worker ${swManifest.buildId}: `
        + `${plan.criticalUrls.length} critical precache URLs (${plan.criticalBytes} B), `
        + `${plan.warmUrls.length} warm URLs (${plan.warmBytes} B)`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    preferImplementationOverTestModulePlugin(),
    studioCrossOriginIsolationPlugin(),
    studioServiceWorkerPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  // 정적 카탈로그 모드에선 lib/server/* (예: live.ts) 가 브라우저 번들로 끌려오며
  // 모듈 로드 시점에 process.env.* 를 읽어 "process is not defined" 백스크린을 유발한다.
  // 브라우저엔 서버 env 가 없으므로 빈 객체로 치환해 서버 기본값으로 폴백시키고,
  // 라이브러리가 참조하는 NODE_ENV 만 보존한다. (NestJS api 는 별도 빌드라 실 env 유지)
  define: {
    "process.env": JSON.stringify({
      NODE_ENV: mode === "production" ? "production" : "development",
    }),
  },
  root: webRoot,
  publicDir: path.resolve(webRoot, "public"),
  resolve: {
    alias: {
      "@/shared": path.resolve(webRoot, "src/shared"),
      "@/domains": path.resolve(webRoot, "src/domains"),
      "@": webRoot,
    },
  },
  // Industrial OCCT: allow Vite to emit wasm asset URLs for browser fetch/locateFile.
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["opencascade.js"],
  },
  build: {
    outDir: path.resolve(repositoryRoot, "dist"),
    // CI reads this graph to enforce the mobile Studio's initial-JS budgets and lazy-only engines.
    manifest: true,
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType !== "html") return deps;
        return deps.filter((dep) => !ENTRY_PRELOAD_EXCLUSIONS.some((chunkName) => dep.includes(chunkName)));
      },
    },
    rolldownOptions: {
      output: {
        manualChunks: createStudioManualChunks({
          isInitialIconModule,
          isStudioCoreIconModule,
        }),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        changeOrigin: false,
        ws: true,
      },
      "/studio-live": {
        target: apiTarget,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
}));
