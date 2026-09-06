import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("Studio p5.brush permanent real-runtime gate", () => {
  it("uses the exact production one-shot Worker client sequentially", () => {
    const browser = source(
      "scripts/studio-p5-brush-real-runtime-browser.ts",
    );
    const worker = source(
      "scripts/studio-p5-brush-real-runtime-worker.ts",
    );

    expect(browser).toContain(
      "renderStudioProceduralArtisticBrushInWorker(",
    );
    expect(browser).toContain("probeStudioProceduralArtisticBrushWorker({");
    expect(browser).toContain("for (const technique of");
    expect(browser).toContain("const first = await");
    expect(browser).toContain("const replay = await");
    expect(browser).not.toContain("Promise.all([");
    expect(browser).toContain(
      'new URL("./studio-p5-brush-real-runtime-worker.ts", import.meta.url)',
    );
    expect(browser).toContain('type: "module"');
    expect(worker).toContain(
      'from "../apps/web/src/domains/creator/brush/studio-p5-brush-standalone-runtime-adapter"',
    );
    expect(worker).toContain(
      "createStudioP5BrushStandaloneAdapterLoader()",
    );
    expect(worker).toContain("adapter.renderSettled(");
    expect(worker).toContain('new OffscreenCanvas(width, height)');
    expect(worker).toContain('canvas.getContext("webgl2"');
    expect(worker).toContain('context.getExtension("WEBGL_lose_context")');
    expect(worker).toContain("gl.isContextLost()");
    expect(worker).toContain("const code = gl.getError()");
    expect(worker).toContain("canvas.width = 1");
    expect(worker).toContain("canvas.height = 1");
    expect(worker).toContain("surfaceDisposeCount !== 2");
    expect(worker).toContain("sameContextExactPixelReplay: true");
    expect(worker).toContain("crossContextRejected: true");
  });

  it("gates all supported techniques, non-empty pixels and exact seeded replay", () => {
    const protocol = source(
      "scripts/studio-p5-brush-real-runtime-protocol.ts",
    );
    const verifier = source(
      "scripts/verify-studio-p5-brush-real-runtime.mjs",
    );
    const packageJson = JSON.parse(
      source("package.json"),
    ) as Readonly<{
      scripts?: Readonly<Record<string, string>>;
    }>;

    expect(protocol).toContain('"flow-field"');
    expect(protocol).toContain('"hatch"');
    expect(protocol).toContain('"mass"');
    expect(protocol).toContain('"watercolor-fill"');
    expect(protocol).toContain('"flat-wash"');
    expect(verifier).toContain(
      'const EXPECTED_ADAPTER_VERSION = "2.2.1-adapter.7"',
    );
    expect(verifier).toContain("const EXPECTED_SURFACE_COUNT = 10");
    expect(verifier).toContain("const EXPECTED_RENDER_WORKER_COUNT = 10");
    expect(verifier).toContain("MIN_PAINTED_PIXELS");
    expect(verifier).toContain("exactPixelReplay");
    expect(verifier).toContain("first?.pixelHash !== evidence.replay?.pixelHash");
    expect(verifier).toContain(
      "two production one-shot Workers did not produce identical bytes",
    );
    expect(verifier).toContain("contextAffinityStress.crossContextRejected");
    expect(packageJson.scripts?.["verify:studio-p5-brush-real-runtime"]).toBe(
      "node scripts/verify-studio-p5-brush-real-runtime.mjs",
    );
  });

  it("permits an environment skip only after a failed real WebGL2 context probe", () => {
    const browser = source(
      "scripts/studio-p5-brush-real-runtime-browser.ts",
    );
    const verifier = source(
      "scripts/verify-studio-p5-brush-real-runtime.mjs",
    );

    expect(browser).toContain("capability.reason === \"webgl2-unavailable\"");
    expect(browser).toContain(
      "webgl2ContextAttempted: capability.reason === \"webgl2-unavailable\"",
    );
    expect(verifier).toContain(
      'result.reason === "webgl2-unavailable"',
    );
    expect(verifier).toContain(
      "result.probe?.webgl2ContextAttempted === true",
    );
    expect(verifier).toContain("process.exitCode = 2");
  });

  it("isolates the graphics gate from application-wide Vite transforms and dependency scans", () => {
    const verifier = source(
      "scripts/verify-studio-p5-brush-real-runtime.mjs",
    );

    expect(verifier).toContain("configFile: false");
    expect(verifier).toContain("envFile: false");
    expect(verifier).toContain("entries: [HARNESS_ENTRY.slice(1)]");
    expect(verifier).not.toContain(
      'configFile: join(process.cwd(), "vite.config.ts")',
    );
  });

  it("ships the deterministic finite-difference fill compositor in the resolved standalone bundle", () => {
    const standaloneBundle = readFileSync(
      fileURLToPath(import.meta.resolve("p5.brush/standalone")),
      "utf8",
    );
    const dependencyPatch = source("patches/p5.brush@2.2.1.patch");
    const workspace = source("pnpm-workspace.yaml");

    expect(workspace).toContain(
      "p5.brush@2.2.1: patches/p5.brush@2.2.1.patch",
    );
    expect(dependencyPatch).toContain("finiteMaskGradient");
    expect(dependencyPatch).toContain("textureLod(u_mask");
    expect(standaloneBundle).toContain("finiteMaskGradient");
    expect(standaloneBundle).toContain("textureLod(u_mask");
    expect(standaloneBundle).not.toContain("dFdx(");
    expect(standaloneBundle).not.toContain("dFdy(");
  });

  it("keeps standalone runtime and resolved-peer license roles explicit", () => {
    const notice = source("THIRD_PARTY_NOTICES.md");
    const generator = source("scripts/generate-third-party-notices.mjs");

    expect(notice).toContain("| `lazy-brush` | 2.0.2 | MIT |");
    expect(notice).toContain("| `p5.brush` standalone entry | 2.2.1 | MIT |");
    expect(notice).toContain(
      "| `p5` peer resolution for `p5.brush` | 2.3.1 | LGPL-2.1 |",
    );
    expect(notice).toContain(
      "| `libtess` dependency of the resolved `p5` peer | 1.2.2 | SGI-B-2.0 |",
    );
    expect(notice).toContain(
      "does not statically import the resolved `p5` peer",
    );
    expect(notice).toContain(
      "deterministic finite-difference fill-compositor patch",
    );
    expect(generator).toContain(
      '"https://github.com/dulnan/lazy-brush"',
    );
    expect(generator).toContain('"p5.brush": "2.2.1"');
  });

  it("is a mandatory isolated GitHub CI job with a bounded runtime", () => {
    const workflow = parseYaml(
      source(".github/workflows/ci.yml"),
    ) as Readonly<{
      jobs?: Readonly<Record<string, Readonly<{
        "runs-on"?: string;
        "timeout-minutes"?: number;
        services?: unknown;
        steps?: readonly Readonly<{
          uses?: string;
          run?: string;
        }>[];
      }>>>;
    }>;
    const job = workflow.jobs?.["studio-p5-brush-real-runtime"];
    const steps = job?.steps ?? [];

    expect(job).toBeDefined();
    expect(job?.["runs-on"]).toBe("ubuntu-24.04");
    expect(job?.["timeout-minutes"]).toBe(12);
    expect(job?.services).toBeUndefined();
    expect(steps.map((step) => step.uses).filter(Boolean)).toEqual([
      "actions/checkout@v6",
      "pnpm/action-setup@v6",
      "actions/setup-node@v6",
    ]);
    expect(steps.map((step) => step.run).filter(Boolean)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm exec playwright install --with-deps chromium",
      "pnpm run verify:studio-p5-brush-real-runtime",
    ]);
  });
});
