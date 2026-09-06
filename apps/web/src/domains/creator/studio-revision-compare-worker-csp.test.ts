import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import ts from "typescript";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseStudioProjectFile } from "./studio-project-file";
import {
  createStudioRevisionCompareModuleWorker,
  runStudioRevisionComparison,
  type StudioRevisionCompareWorkerRequest,
} from "./studio-revision-compare-worker-client";
import {
  buildStudioServerRevisionComparison,
  type StudioServerRevisionComparisonInput,
} from "./studio-server-revision-comparison";

const CREATOR_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(CREATOR_DIRECTORY, "../../..");
const BOOTSTRAP_PATH = join(
  CREATOR_DIRECTORY,
  "studio-revision-compare.worker-bootstrap.ts"
);
const CLIENT_PATH = join(
  CREATOR_DIRECTORY,
  "studio-revision-compare-worker-client.ts"
);
const RUNTIME_URL_TOKEN = "__TOONSPECTRUM_REVISION_COMPARE_RUNTIME_MODULE_URL__";
const BOOTSTRAP_READY_MESSAGE = {
  type: "studio-revision-compare/bootstrap-ready",
  version: 1,
} as const;
const CAPTURED_BOOTSTRAP_URL =
  "blob:https://toonstudio.test/revision-worker-bootstrap";

interface CapturedNativeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: {
    error?: unknown;
    message?: string;
    preventDefault?(): void;
  }) => void) | null;
  readonly posted: Promise<void>;
  readonly postedMessages: unknown[];
  terminateCount: number;
  emitMessage(data: unknown): void;
  emitError(error?: Error): { preventDefault: ReturnType<typeof vi.fn> };
}

function installWorkerLifecycleHarness(options: { constructorError?: Error } = {}) {
  const createdBlobs: Blob[] = [];
  const revokedUrls: string[] = [];
  const workers: CapturedNativeWorker[] = [];
  let constructedUrl: string | URL | undefined;
  let constructedOptions: WorkerOptions | undefined;
  let resolveConstructed: (worker: CapturedNativeWorker) => void = () => undefined;
  const constructed = new Promise<CapturedNativeWorker>((resolveWorker) => {
    resolveConstructed = resolveWorker;
  });

  class CapturingWorker implements CapturedNativeWorker {
    onmessage: CapturedNativeWorker["onmessage"] = null;
    onerror: CapturedNativeWorker["onerror"] = null;
    readonly postedMessages: unknown[] = [];
    terminateCount = 0;
    private resolvePosted: () => void = () => undefined;
    readonly posted = new Promise<void>((resolvePost) => {
      this.resolvePosted = resolvePost;
    });

    constructor(url: string | URL, workerOptions?: WorkerOptions) {
      constructedUrl = url;
      constructedOptions = workerOptions;
      if (options.constructorError) throw options.constructorError;
      workers.push(this);
      resolveConstructed(this);
    }

    postMessage(message: unknown): void {
      this.postedMessages.push(message);
      this.resolvePosted();
    }

    terminate(): void {
      this.terminateCount += 1;
    }

    emitMessage(data: unknown): void {
      this.onmessage?.({ data } as MessageEvent<unknown>);
    }

    emitError(error = new Error("bootstrap failed")) {
      const event = {
        error,
        message: error.message,
        preventDefault: vi.fn(),
      };
      this.onerror?.(event);
      return event;
    }
  }

  class CapturingUrl extends URL {
    static createObjectURL(blob: Blob): string {
      createdBlobs.push(blob);
      return CAPTURED_BOOTSTRAP_URL;
    }

    static revokeObjectURL(url: string): void {
      revokedUrls.push(url);
    }
  }

  vi.stubGlobal("Worker", CapturingWorker);
  vi.stubGlobal("URL", CapturingUrl);

  return {
    constructed,
    createdBlobs,
    get constructedOptions() {
      return constructedOptions;
    },
    get constructedUrl() {
      return constructedUrl;
    },
    revokedUrls,
    workers,
  };
}

function revisionComparisonInput(): StudioServerRevisionComparisonInput {
  const page = (text: string) => ({
    id: "page-1",
    elements: [{ id: "text-1", type: "text", text }],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1200,
  });
  return {
    targetRevision: 2,
    baseRevision: 4,
    targetSnapshot: { title: "초안", tags: [], doc: { pagesList: [page("처음")] } },
    baseSnapshot: { title: "현재", tags: [], doc: { pagesList: [page("안녕")] } },
    localProject: parseStudioProjectFile({
      version: 2,
      title: "현재",
      pagesList: [page("안녕!")],
    }),
  };
}

function readBootstrapSource(): string {
  return readFileSync(BOOTSTRAP_PATH, "utf8");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("revision comparison Worker strict-CSP bootstrap", () => {
  it("has no static imports and mutates existing Zod config before its dynamic import", () => {
    const source = readBootstrapSource();
    const sourceFile = ts.createSourceFile(
      BOOTSTRAP_PATH,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const staticImports = sourceFile.statements.filter(ts.isImportDeclaration);
    const dynamicImports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        dynamicImports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(staticImports).toEqual([]);
    expect(dynamicImports).toHaveLength(1);
    expect(dynamicImports[0]?.arguments[0]?.getText(sourceFile)).toBe(
      "RUNTIME_MODULE_URL"
    );
    expect(source).not.toMatch(/from\s+["']zod(?:\/[^"']*)?["']/u);
    expect(source).not.toContain("studio-server-revision-comparison");
    expect(source).not.toContain("revokeObjectURL");

    const mutationIndex = source.indexOf('Reflect.set(zodConfig, "jitless", true)');
    const dynamicImportIndex = source.indexOf("await import(RUNTIME_MODULE_URL)");
    const readyIndex = source.indexOf(
      'type: "studio-revision-compare/bootstrap-ready"'
    );
    expect(mutationIndex).toBeGreaterThanOrEqual(0);
    expect(dynamicImportIndex).toBeGreaterThan(mutationIndex);
    expect(readyIndex).toBeGreaterThan(dynamicImportIndex);

    const executablePrefix = source.slice(0, dynamicImportIndex);
    const existingConfig = { customError: "keep-me" };
    const sandbox: Record<string, unknown> = {
      __zod_globalConfig: existingConfig,
    };
    runInNewContext(executablePrefix, sandbox);

    expect(sandbox.__zod_globalConfig).toBe(existingConfig);
    expect(existingConfig).toEqual({ customError: "keep-me", jitless: true });
  });

  it("constructs the product Worker from the bootstrap Blob and revokes it once on ready", async () => {
    const clientSource = readFileSync(CLIENT_PATH, "utf8");
    expect(clientSource).toContain(
      'from "./studio-revision-compare.worker-bootstrap.ts?raw"'
    );
    expect(clientSource).toContain(
      'from "./studio-revision-compare.worker.ts?worker&url"'
    );
    expect(clientSource).toContain("new Worker(bootstrapUrl");
    expect(clientSource).not.toContain(
      'new Worker(new URL("./studio-revision-compare.worker.ts"'
    );

    const harness = installWorkerLifecycleHarness();

    const worker = createStudioRevisionCompareModuleWorker();
    expect(worker).not.toBeNull();
    expect(harness.constructedUrl).toBe(CAPTURED_BOOTSTRAP_URL);
    expect(harness.constructedOptions).toEqual({
      type: "module",
      name: "toonspectrum-revision-compare",
    });
    expect(harness.createdBlobs).toHaveLength(1);
    expect(harness.revokedUrls).toEqual([]);

    const generatedBootstrap = await harness.createdBlobs[0]!.text();
    expect(generatedBootstrap).not.toContain(RUNTIME_URL_TOKEN);
    expect(generatedBootstrap).not.toContain("revokeObjectURL");
    expect(generatedBootstrap).toContain('Reflect.set(zodConfig, "jitless", true)');
    expect(generatedBootstrap).toMatch(
      /const RUNTIME_MODULE_URL = "(?:file:|https?:|\/)[^"\n]+studio-revision-compare\.worker[^"\n]*";/u
    );
    expect(generatedBootstrap).toContain("await import(RUNTIME_MODULE_URL)");
    expect(generatedBootstrap.indexOf('Reflect.set(zodConfig, "jitless", true)'))
      .toBeLessThan(generatedBootstrap.indexOf("await import("));
    expect(generatedBootstrap.indexOf("await import("))
      .toBeLessThan(generatedBootstrap.indexOf(BOOTSTRAP_READY_MESSAGE.type));

    const publicMessageHandler = vi.fn();
    worker!.onmessage = publicMessageHandler;
    const nativeWorker = harness.workers[0]!;
    nativeWorker.emitMessage(BOOTSTRAP_READY_MESSAGE);
    nativeWorker.emitMessage(BOOTSTRAP_READY_MESSAGE);

    expect(publicMessageHandler).not.toHaveBeenCalled();
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);

    worker!.terminate();
    worker!.terminate();
    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("revokes exactly once when the native Worker constructor throws", () => {
    const harness = installWorkerLifecycleHarness({
      constructorError: new Error("constructor blocked"),
    });

    expect(() => createStudioRevisionCompareModuleWorker()).toThrow(
      "constructor blocked"
    );
    expect(harness.workers).toEqual([]);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("revokes exactly once when the Worker errors before bootstrap ready", async () => {
    const harness = installWorkerLifecycleHarness();
    const pending = runStudioRevisionComparison(revisionComparisonInput(), {
      executionBackend: "worker",
    });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "StudioRevisionCompareWorkerError",
      message: "버전 비교 Worker 실행에 실패했습니다.",
    });
    const nativeWorker = await harness.constructed;
    await nativeWorker.posted;

    const errorEvent = nativeWorker.emitError();
    await rejection;

    expect(errorEvent.preventDefault).toHaveBeenCalledOnce();
    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("revokes exactly once when terminated immediately before bootstrap executes", () => {
    const harness = installWorkerLifecycleHarness();
    const worker = createStudioRevisionCompareModuleWorker();
    const nativeWorker = harness.workers[0]!;

    worker!.terminate();
    worker!.terminate();
    nativeWorker.emitMessage(BOOTSTRAP_READY_MESSAGE);
    nativeWorker.emitError();

    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("revokes exactly once when an in-flight comparison is aborted before ready", async () => {
    const harness = installWorkerLifecycleHarness();
    const controller = new AbortController();
    const pending = runStudioRevisionComparison(revisionComparisonInput(), {
      signal: controller.signal,
    });
    const nativeWorker = await harness.constructed;
    await nativeWorker.posted;

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("revokes exactly once when an in-flight comparison times out before ready", async () => {
    vi.useFakeTimers();
    const harness = installWorkerLifecycleHarness();
    const pending = runStudioRevisionComparison(revisionComparisonInput());
    const rejection = expect(pending).rejects.toThrow(
      "버전 비교 시간이 너무 오래 걸려 중단했습니다."
    );
    const nativeWorker = await harness.constructed;
    await nativeWorker.posted;

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("keeps bootstrap ready private and starts the unchanged comparison protocol", async () => {
    const harness = installWorkerLifecycleHarness();
    const pending = runStudioRevisionComparison(revisionComparisonInput());
    const nativeWorker = await harness.constructed;
    await nativeWorker.posted;
    const request = nativeWorker.postedMessages[0] as StudioRevisionCompareWorkerRequest;

    nativeWorker.emitMessage(BOOTSTRAP_READY_MESSAGE);
    nativeWorker.emitMessage({
      type: "studio-revision-compare/success",
      version: 1,
      comparison: buildStudioServerRevisionComparison(request.input),
    });

    const comparison = await pending;
    expect(comparison.targetRevision).toBe(request.input.targetRevision);
    expect(nativeWorker.postedMessages).toEqual([{
      type: "studio-revision-compare/run",
      version: 1,
      input: request.input,
    }]);
    expect(nativeWorker.terminateCount).toBe(1);
    expect(harness.revokedUrls).toEqual([CAPTURED_BOOTSTRAP_URL]);
  });

  it("emits a production-mode Worker asset that is reachable only through the bootstrap", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "toonspectrum-revision-worker-csp-")
    );
    const rootPath = join(temporaryDirectory, "root");
    const outputPath = join(temporaryDirectory, "dist");
    mkdirSync(rootPath, { recursive: true });
    mkdirSync(outputPath, { recursive: true });
    const root = realpathSync(rootPath);
    const output = realpathSync(outputPath);
    writeFileSync(
      join(root, "index.html"),
      '<!doctype html><script type="module" src="/entry.ts"></script>'
    );
    writeFileSync(
      join(root, "entry.ts"),
      [
        'import { createStudioRevisionCompareModuleWorker } from "virtual:revision-client";',
        "globalThis.__revisionWorkerFactory = createStudioRevisionCompareModuleWorker;",
        "",
      ].join("\n")
    );

    try {
      await build({
        root,
        configFile: false,
        logLevel: "error",
        resolve: {
          alias: [
            { find: "virtual:revision-client", replacement: CLIENT_PATH },
            { find: "@", replacement: REPOSITORY_ROOT },
          ],
        },
        build: {
          outDir: output,
          emptyOutDir: true,
          target: "es2022",
          minify: false,
        },
      });

      const assetDirectory = join(output, "assets");
      const javascriptAssets = readdirSync(assetDirectory)
        .filter((name) => name.endsWith(".js"));
      const runtimeAsset = javascriptAssets.find((name) =>
        /^studio-revision-compare\.worker-[\w-]+\.js$/u.test(name));
      expect(runtimeAsset).toBeDefined();
      const runtimeCode = readFileSync(join(assetDirectory, runtimeAsset!), "utf8");
      expect(runtimeCode).toContain("__zod_globalConfig");
      expect(runtimeCode).toContain("Cloudflare");
      expect(runtimeCode).toContain("Function");
      expect(runtimeCode).not.toContain(
        "Unable to enable the Zod strict-CSP configuration."
      );

      const entryAsset = javascriptAssets.find((name) => {
        if (name === runtimeAsset) return false;
        return readFileSync(join(assetDirectory, name), "utf8").includes(
          "Unable to enable the Zod strict-CSP configuration."
        );
      });
      expect(entryAsset).toBeDefined();
      const entryCode = readFileSync(join(assetDirectory, entryAsset!), "utf8");
      expect(entryCode).toContain(`/assets/${runtimeAsset}`);
      expect(entryCode).toContain("URL.createObjectURL(new Blob([");
      expect(entryCode).toContain("URL.revokeObjectURL.bind(URL)");
      expect(entryCode).toContain(BOOTSTRAP_READY_MESSAGE.type);
      expect(entryCode).not.toContain("URL.revokeObjectURL(import.meta.url)");
      expect(entryCode).toMatch(/new Worker\(bootstrapUrl,\s*\{/u);
      expect(entryCode).not.toMatch(/new Worker\([^)]*studio_revision_compare_worker_default/u);
      expect(entryCode.indexOf('Reflect.set(zodConfig, \\"jitless\\", true)'))
        .toBeLessThan(entryCode.indexOf("await import(RUNTIME_MODULE_URL)"));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
