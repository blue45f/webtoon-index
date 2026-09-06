import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_NORMAL_PROFILE,
  STUDIO_BG3D_STABLE_ID_PROFILE,
} from "../apps/web/src/domains/creator/bg3d/studio-bg3d-artifact-capture-v2";

import {
  BABYLON_ALIGNED_RASTER_SMOKE_SIZE,
  BABYLON_STABLE_ID_PARITY_HEIGHT,
  BABYLON_STABLE_ID_PARITY_WIDTHS,
  createBabylonAlignedRasterSmokeRequest,
  createBabylonStableIdParityRequests,
  classifyStudio3dWebGpuRetryableFailure,
  collectStudioVrmMannequinChromaFailures,
  formatStudio3dWebGpuDiagnosticConsoleMessage,
  isExpectedStaticPreviewSocketIoHandshakeClose,
  runStudio3dWebGpuConformanceWithFreshBrowserRetry,
  runStudio3dWebGpuProofShardsWithFreshBrowserRetry,
  runStudio3dWebGpuShardWithCleanup,
  STUDIO_3D_WEBGPU_BROWSER_CHANNEL,
  STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS,
  STUDIO_3D_WEBGPU_DIAGNOSTIC_MAX_LOG_LENGTH,
  STUDIO_3D_WEBGPU_DIAGNOSTIC_PREFIX,
  STUDIO_3D_WEBGPU_MAX_BROWSER_ATTEMPTS,
  STUDIO_3D_WEBGPU_PROOF_SHARDS,
  STUDIO_3D_WEBGPU_SWIFTSHADER_LAUNCH_ARGS,
  STUDIO_VRM_CHROMA_DELTA_THRESHOLD,
  STUDIO_VRM_COLOR_MIN_RATIO,
  STUDIO_VRM_MANNEQUIN_MAX_RATIO,
  resolveStudio3dWebGpuLaunchArgs,
} from "./verify-studio-3d-console.mts";

const PREVIEW_URL = "http://127.0.0.1:51758/studio";
const EXPECTED_HANDSHAKE_CLOSE = [
  "WebSocket connection to ",
  "'ws://127.0.0.1:51758/socket.io/?EIO=4&transport=websocket' failed: ",
  "Connection closed before receiving a handshake response",
].join("");
const verifierSource = readFileSync(
  new URL("./verify-studio-3d-console.mts", import.meta.url),
  "utf8",
);
const magicProductionProofSource = readFileSync(
  new URL("../apps/web/src/domains/creator/bg3d/studio-bg3d-magic-production-proof.ts",
    import.meta.url,
  ),
  "utf8",
);

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = verifierSource.indexOf(startMarker);
  const end = verifierSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return verifierSource.slice(start, end);
}

describe("3D static-preview Socket.IO diagnostics", () => {
  it("allows only the exact handshake close from the active 127.0.0.1 preview", () => {
    expect(
      isExpectedStaticPreviewSocketIoHandshakeClose(
        EXPECTED_HANDSHAKE_CLOSE,
        PREVIEW_URL,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "another preview port",
      EXPECTED_HANDSHAKE_CLOSE.replace(":51758/socket.io", ":51759/socket.io"),
      PREVIEW_URL,
    ],
    [
      "localhost hostname",
      EXPECTED_HANDSHAKE_CLOSE.replace("127.0.0.1", "localhost"),
      PREVIEW_URL,
    ],
    [
      "another WebSocket route",
      EXPECTED_HANDSHAKE_CLOSE.replace("/socket.io/", "/studio-live/"),
      PREVIEW_URL,
    ],
    [
      "another Socket.IO transport",
      EXPECTED_HANDSHAKE_CLOSE.replace("transport=websocket", "transport=polling"),
      PREVIEW_URL,
    ],
    [
      "another failure reason",
      EXPECTED_HANDSHAKE_CLOSE.replace(
        "Connection closed before receiving a handshake response",
        "net::ERR_CONNECTION_REFUSED",
      ),
      PREVIEW_URL,
    ],
    [
      "non-loopback preview",
      EXPECTED_HANDSHAKE_CLOSE,
      "http://192.168.0.8:51758/studio",
    ],
    [
      "secure preview",
      EXPECTED_HANDSHAKE_CLOSE,
      "https://127.0.0.1:51758/studio",
    ],
    [
      "malformed preview URL",
      EXPECTED_HANDSHAKE_CLOSE,
      "not-a-url",
    ],
  ])("rejects %s", (_label, message, studioUrl) => {
    expect(
      isExpectedStaticPreviewSocketIoHandshakeClose(message, studioUrl),
    ).toBe(false);
  });
});

describe("3D character production-preview color boundary", () => {
  const colored = {
    chromaticPixels: 26_300,
    pixelCount: 1_000_000,
    ratio: 0.0263,
  } as const;
  const neutral = {
    chromaticPixels: 0,
    pixelCount: 1_000_000,
    ratio: 0,
  } as const;

  it("accepts a colored → neutral → colored mannequin transition", () => {
    expect(STUDIO_VRM_CHROMA_DELTA_THRESHOLD).toBe(40);
    expect(STUDIO_VRM_COLOR_MIN_RATIO).toBe(0.002);
    expect(STUDIO_VRM_MANNEQUIN_MAX_RATIO).toBe(0.005);
    expect(
      collectStudioVrmMannequinChromaFailures(colored, neutral, {
        ...colored,
        chromaticPixels: 24_000,
        ratio: 0.024,
      }),
    ).toEqual([]);
  });

  it("rejects the stale gray framebuffer left after mannequin mode is disabled", () => {
    expect(
      collectStudioVrmMannequinChromaFailures(colored, neutral, neutral),
    ).toEqual([
      "the VRM frame stayed grayscale after mannequin mode was disabled (0.0000)",
      "the restored VRM frame retained less than 65% of its baseline chroma " +
        "(0.0000 vs 0.0263)",
    ]);
  });

  it("keeps the real production verifier wired to the toggle and screenshot gate", () => {
    const productionPreview = sourceBetween(
      "async function run(page: Page, studioUrl: string): Promise<void>",
      "async function runBabylonStableIdOrientationParityProof(",
    );
    const threeDMenu = sourceBetween(
      "async function openThreeDMenu(page: Page): Promise<Locator>",
      "async function closeCanvasDialog(",
    );
    const baseline = productionPreview.indexOf(
      "const baselineChroma = await measureSettledStudioVrmChroma(page, vrmCanvas,",
    );
    const toggleOn = productionPreview.indexOf("await mannequinSwitch.click();", baseline);
    const mannequin = productionPreview.indexOf(
      "const mannequinChroma = await measureSettledStudioVrmChroma(page, vrmCanvas,",
      toggleOn,
    );
    const toggleOff = productionPreview.indexOf("await mannequinSwitch.click();", toggleOn + 1);
    const restored = productionPreview.indexOf(
      "const restoredChroma = await measureSettledStudioVrmChroma(page, vrmCanvas,",
      toggleOff,
    );

    // 메뉴바 프레젠테이션(UX 감사 2026-09-02)이 3D 를 삽입 메뉴로 옮겼으므로 진입은
    // 삽입 트리거와 삽입 드롭다운을 거친다. 항목 id·라벨은 카탈로그 그대로다.
    expect(threeDMenu).toContain('name: STUDIO_INSERT_MENU_TITLE, exact: true');
    expect(threeDMenu).toContain('[role="menu"][aria-label="${STUDIO_INSERT_MENU_TITLE}"]');
    expect(verifierSource).toContain('const STUDIO_INSERT_MENU_TITLE = "삽입"');
    expect(productionPreview).toContain('name: "중립 데생 인형 보기"');
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(toggleOn).toBeGreaterThan(baseline);
    expect(mannequin).toBeGreaterThan(toggleOn);
    expect(toggleOff).toBeGreaterThan(mannequin);
    expect(restored).toBeGreaterThan(toggleOff);
  });

  it("dismisses the SQLite-hydrated first-use coach before opening 3D menus", () => {
    const dismissQuickStart = sourceBetween(
      "async function dismissHydratedQuickStart(page: Page): Promise<void>",
      "async function openThreeDMenu(page: Page): Promise<Locator>",
    );
    const productionPreview = sourceBetween(
      "async function run(page: Page, studioUrl: string): Promise<void>",
      "async function runBabylonStableIdOrientationParityProof(",
    );
    const dismissIndex = productionPreview.indexOf(
      "await dismissHydratedQuickStart(page);",
    );
    const openMenuIndex = productionPreview.indexOf(
      "const characterMenu = await openThreeDMenu(page);",
    );

    expect(dismissQuickStart).toContain(
      "data-studio-creative-starter=\"true\"",
    );
    expect(dismissQuickStart).toContain(
      "data-studio-quickstart-dismiss=\"true\"",
    );
    expect(dismissQuickStart).toContain('state: "detached"');
    expect(dismissIndex).toBeGreaterThanOrEqual(0);
    expect(openMenuIndex).toBeGreaterThan(dismissIndex);
  });
});

describe("3D WebGPU conformance browser boundary", () => {
  it("uses regular headed Chromium for the high-fidelity WebGPU proof", () => {
    const webGpuAttempt = sourceBetween(
      "async function runStudio3dWebGpuConformanceBrowserAttempt(",
      "async function main(): Promise<void>",
    );
    expect(STUDIO_3D_WEBGPU_BROWSER_CHANNEL).toBe("chromium");
    expect(webGpuAttempt).toContain(
      "channel: STUDIO_3D_WEBGPU_BROWSER_CHANNEL",
    );
    expect(webGpuAttempt).toContain("headless: false");
    expect(webGpuAttempt).not.toContain("headless: true");
    expect(webGpuAttempt).toContain(
      "mode=headed channel=${STUDIO_3D_WEBGPU_BROWSER_CHANNEL}",
    );
    expect(webGpuAttempt).toContain("resolveStudio3dWebGpuLaunchArgs()");
    expect(webGpuAttempt).toContain(
      'adapterPath=${process.platform === "darwin" ? "native" : "forced-swiftshader"}',
    );
    expect(webGpuAttempt).toContain(
      "version=${webGpuBrowser.version()}",
    );
  });

  it("relays bounded production device diagnostics outside the retry cause chain", () => {
    const babylonProof = sourceBetween(
      "async function runBabylonStableIdOrientationParityProof(",
      "async function runMagicLayerProductionAlignmentProof(",
    );
    const webGpuAttempt = sourceBetween(
      "async function runStudio3dWebGpuConformanceBrowserAttempt(",
      "async function main(): Promise<void>",
    );
    const magicProof = sourceBetween(
      "async function runMagicLayerProductionAlignmentProof(",
      "async function runStudio3dWebGpuConformanceBrowserAttempt(",
    );
    const listenerIndex = webGpuAttempt.indexOf('webGpuPage.on("console"');
    const proofIndex = webGpuAttempt.indexOf(
      "await runBabylonStableIdOrientationParityProof(webGpuPage, rootUrl);",
    );

    expect(STUDIO_3D_WEBGPU_DIAGNOSTIC_PREFIX).toBe(
      "[verify-studio-3d-console:webgpu-diagnostic]",
    );
    expect(babylonProof).toContain('readonly onDiagnostic?: (diagnostic: unknown) => void;');
    expect(babylonProof).toContain('onDiagnostic: backend === "webgpu"');
    expect(babylonProof).toContain(
      "console.warn(`${webGpuDiagnosticPrefix}${JSON.stringify(diagnostic)}`);",
    );
    expect(magicProof).toContain('onDiagnostic: createdBackend === "webgpu"');
    expect(magicProof).toContain(
      "`${webGpuDiagnosticPrefix}${JSON.stringify(diagnostic)}`",
    );
    expect(magicProof).toContain(
      "product Magic ${backend} object-ID capture failed: ` +",
    );
    expect(magicProof).toContain("Object.getOwnPropertyDescriptor(value, key)");
    expect(magicProof).toContain("return Reflect.get(value, key);");
    expect(magicProof).toContain('safeDisplayValue(current, "name")');
    expect(magicProof).toContain('safeDisplayValue(current, "message")');
    expect(magicProof).toContain('const attemptsValue = ownDataValue(value, "attempts");');
    expect(magicProof).toContain("const attemptCount = Math.min(lengthValue, 4);");
    expect(magicProof).toContain("JSON.stringify({ runtimeId, outcome, errorCode })");
    expect(magicProof).toContain('entries.push("[circular cause]")');
    expect(magicProof).toContain('entries.join(" <- ").slice(0, 4_096)');
    expect(magicProof).toContain("receipts here so a WebGPU device loss remains retryable");
    expect(magicProof).toContain("without starting WebGL2");
    expect(listenerIndex).toBeGreaterThanOrEqual(0);
    expect(proofIndex).toBeGreaterThan(listenerIndex);
    expect(webGpuAttempt).toContain(
      "formatStudio3dWebGpuDiagnosticConsoleMessage(message.text())",
    );
    expect(webGpuAttempt).not.toContain(
      "classifyStudio3dWebGpuRetryableFailure(value)",
    );
  });

  it("admits only prefixed WebGPU diagnostics and bounds their CI log line", () => {
    expect(formatStudio3dWebGpuDiagnosticConsoleMessage("ordinary warning")).toBeNull();
    const oversized = `${STUDIO_3D_WEBGPU_DIAGNOSTIC_PREFIX}${"x".repeat(8_192)}`;
    const formatted = formatStudio3dWebGpuDiagnosticConsoleMessage(oversized);
    expect(formatted).toHaveLength(STUDIO_3D_WEBGPU_DIAGNOSTIC_MAX_LOG_LENGTH);
    expect(formatted?.startsWith(STUDIO_3D_WEBGPU_DIAGNOSTIC_PREFIX)).toBe(true);
  });

  it("pins Chromium Vulkan, Dawn WebGPU, and ANGLE WebGL to SwiftShader on Linux", () => {
    expect(Object.isFrozen(STUDIO_3D_WEBGPU_SWIFTSHADER_LAUNCH_ARGS)).toBe(true);
    expect(STUDIO_3D_WEBGPU_SWIFTSHADER_LAUNCH_ARGS).toEqual([
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=CDPScreenshotNewSurface,Vulkan",
      "--use-vulkan=swiftshader",
      "--use-webgpu-adapter=swiftshader",
      "--use-gpu-in-tests",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ]);
    expect(resolveStudio3dWebGpuLaunchArgs("linux")).toBe(
      STUDIO_3D_WEBGPU_SWIFTSHADER_LAUNCH_ARGS,
    );
  });

  it("keeps Darwin on native Metal instead of the wedged forced-SwiftShader path", () => {
    expect(Object.isFrozen(STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS)).toBe(true);
    expect(resolveStudio3dWebGpuLaunchArgs("darwin")).toBe(
      STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS,
    );
    expect(STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS).toEqual([
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--use-gpu-in-tests",
    ]);
    expect(STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS).not.toContain(
      "--use-vulkan=swiftshader",
    );
    expect(STUDIO_3D_WEBGPU_DARWIN_NATIVE_LAUNCH_ARGS).not.toContain(
      "--use-webgpu-adapter=swiftshader",
    );
  });

  it("keeps unaligned parity captures limited to compact stable-ID planes", () => {
    const requests = createBabylonStableIdParityRequests();

    expect(Object.isFrozen(requests)).toBe(true);
    expect(requests.map(({ width }) => width)).toEqual([
      ...BABYLON_STABLE_ID_PARITY_WIDTHS,
    ]);
    expect(requests.every(({ width }) => width % 64 !== 0)).toBe(true);
    for (const request of requests) {
      expect(request.height).toBe(BABYLON_STABLE_ID_PARITY_HEIGHT);
      expect(request.artifacts).toEqual([
        { kind: "object-id", profile: STUDIO_BG3D_STABLE_ID_PROFILE },
        { kind: "material-id", profile: STUDIO_BG3D_STABLE_ID_PROFILE },
      ]);
    }
  });

  it("keeps beauty, depth, and normal smoke capture on a row-aligned target", () => {
    const request = createBabylonAlignedRasterSmokeRequest();

    expect(Object.isFrozen(request)).toBe(true);
    expect(request.width).toBe(BABYLON_ALIGNED_RASTER_SMOKE_SIZE);
    expect(request.height).toBe(BABYLON_ALIGNED_RASTER_SMOKE_SIZE);
    expect(request.width % 64).toBe(0);
    expect(request.artifacts).toEqual([
      { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
      { kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
      { kind: "normal", profile: STUDIO_BG3D_NORMAL_PROFILE },
    ]);
  });

  it.each([
    [
      "structured context-loss code",
      Object.assign(new Error("capture stopped"), { code: "context-lost" }),
      "context-or-device-lost",
    ],
    [
      "serialized specialist context-loss code",
      new Error("StudioBg3dBabylonSpecialistError[context-lost]: context unavailable"),
      "context-or-device-lost",
    ],
    [
      "explicit WebGPU device loss",
      new Error("WebGPU device was lost."),
      "context-or-device-lost",
    ],
    [
      "Playwright-transported Magic device loss",
      new Error(
        "page.evaluate: product Magic webgpu object-ID capture failed: " +
          "StudioBg3dBabylonSpecialistError[device-lost]: GPU watchdog timeout",
      ),
      "context-or-device-lost",
    ],
    [
      "exact Chromium external-instance readback abort",
      new DOMException(
        "Failed to execute 'mapAsync' on 'GPUBuffer': " +
          "A valid external Instance reference no longer exists.",
        "AbortError",
      ),
      "external-instance-map-readback",
    ],
    [
      "serialized Chromium external-instance readback abort",
      new Error(
        "page.evaluate: AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': " +
          "A valid external Instance reference no longer exists.",
      ),
      "external-instance-map-readback",
    ],
  ] as const)("classifies only retryable GPU lifetime failure: %s", (_label, error, reason) => {
    expect(classifyStudio3dWebGpuRetryableFailure(error)).toBe(reason);
  });

  it("keeps an outer verifier timeout authoritative over an inner cleanup loss", () => {
    const loss = Object.assign(new Error("GPU queue timeout after the device was lost"), {
      code: "device-lost",
    });
    const deadline = new Error("TimeoutError: Magic proof timed out", { cause: loss });

    expect(classifyStudio3dWebGpuRetryableFailure(loss)).toBe(
      "context-or-device-lost",
    );
    expect(classifyStudio3dWebGpuRetryableFailure(deadline)).toBeNull();
  });

  it("orders plain device-loss and watchdog-timeout evidence within one transported message", () => {
    expect(classifyStudio3dWebGpuRetryableFailure(
      new Error("WebGPU device was lost after watchdog timeout."),
    )).toBe("context-or-device-lost");
    expect(classifyStudio3dWebGpuRetryableFailure(
      new Error("GPU watchdog timeout; WebGPU device was lost."),
    )).toBeNull();
  });

  it("classifies transported atomic attempts only when a candidate receipt records loss", () => {
    const deviceLossAttempts = JSON.stringify([
      {
        runtimeId: "babylon-webgpu-lab",
        outcome: "failed",
        errorCode: "device-lost",
      },
      {
        runtimeId: "babylon-webgl-lab",
        outcome: "failed",
        errorCode: "engine-init-failed",
      },
    ]);
    const ordinaryFailureAttempts = JSON.stringify([
      {
        runtimeId: "babylon-webgpu-lab",
        outcome: "failed",
        errorCode: "engine-init-failed",
      },
      {
        runtimeId: "babylon-webgl-lab",
        outcome: "failed",
        errorCode: "renderer-unavailable",
      },
    ]);

    expect(classifyStudio3dWebGpuRetryableFailure(new Error(
      "page.evaluate: StudioBg3dAtomicSpecialistError[all-candidates-failed]: " +
        `atomic capture failed attempts=${deviceLossAttempts}`,
    ))).toBe("context-or-device-lost");
    expect(classifyStudio3dWebGpuRetryableFailure(new Error(
      "page.evaluate: StudioBg3dAtomicSpecialistError[all-candidates-failed]: " +
        `atomic capture failed attempts=${ordinaryFailureAttempts}`,
    ))).toBeNull();
  });

  it("preserves a real DOMException display marker across a Playwright-style message", () => {
    const browserCause = new DOMException(
      "Failed to execute 'mapAsync' on 'GPUBuffer': " +
        "A valid external Instance reference no longer exists.",
      "AbortError",
    );
    const transported = new Error(
      `page.evaluate: ${browserCause.name}: ${browserCause.message}`,
    );

    expect(classifyStudio3dWebGpuRetryableFailure(transported)).toBe(
      "external-instance-map-readback",
    );
  });

  it.each([
    ["semantic parity", new Error("WebGPU/WebGL2 object-id spatial parity failed")],
    ["timeout", new Error("TimeoutError: aligned raster exceeded 60000ms")],
    [
      "generic map abort",
      new DOMException("Failed to execute 'mapAsync': operation aborted.", "AbortError"),
    ],
    [
      "external-instance without readback abort",
      new Error("A valid external Instance reference no longer exists."),
    ],
    [
      "assertion mentioning diagnostics",
      new Error("context lost diagnostics should remain zero"),
    ],
    [
      "timeout followed by disposal map abort",
      new Error("WebGPU capture timed out after 60000ms", {
        cause: new DOMException(
          "Failed to execute 'mapAsync' on 'GPUBuffer': " +
            "A valid external Instance reference no longer exists.",
          "AbortError",
        ),
      }),
    ],
  ] as const)("hard-fails non-lifetime verifier error: %s", (_label, error) => {
    expect(classifyStudio3dWebGpuRetryableFailure(error)).toBeNull();
  });

  it("restarts a fresh attempt after a classified loss", async () => {
    const attempts: number[] = [];
    const retryReasons: string[] = [];

    await runStudio3dWebGpuConformanceWithFreshBrowserRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt === 1) {
          throw Object.assign(new Error("lost during map readback"), {
            code: "device-lost",
          });
        }
      },
      ({ reason }) => {
        retryReasons.push(reason);
      },
    );

    expect(STUDIO_3D_WEBGPU_MAX_BROWSER_ATTEMPTS).toBe(3);
    expect(attempts).toEqual([1, 2]);
    expect(retryReasons).toEqual(["context-or-device-lost"]);
  });

  it("does not retry semantic, parity, or timeout failures", async () => {
    const failure = new Error("WebGPU/WebGL2 normal spatial parity failed");
    const attempts: number[] = [];

    await expect(
      runStudio3dWebGpuConformanceWithFreshBrowserRetry(async (attempt) => {
        attempts.push(attempt);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(attempts).toEqual([1]);
  });

  it("allows two fresh attempts for consecutive classified losses", async () => {
    const attempts: number[] = [];
    const retries: number[] = [];

    await runStudio3dWebGpuConformanceWithFreshBrowserRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < STUDIO_3D_WEBGPU_MAX_BROWSER_ATTEMPTS) {
          throw Object.assign(new Error("WebGPU context was lost."), {
            code: "context-lost",
          });
        }
      },
      ({ attempt }) => {
        retries.push(attempt);
      },
    );

    expect(attempts).toEqual([1, 2, 3]);
    expect(retries).toEqual([1, 2]);
  });

  it("does not hide a semantic failure after a classified retry", async () => {
    const semanticFailure = new Error("WebGPU/WebGL2 normal spatial parity failed");
    const attempts: number[] = [];
    const retries: number[] = [];

    await expect(
      runStudio3dWebGpuConformanceWithFreshBrowserRetry(
        async (attempt) => {
          attempts.push(attempt);
          if (attempt === 1) {
            throw Object.assign(new Error("WebGPU context was lost."), {
              code: "context-lost",
            });
          }
          throw semanticFailure;
        },
        ({ attempt }) => {
          retries.push(attempt);
        },
      ),
    ).rejects.toBe(semanticFailure);

    expect(attempts).toEqual([1, 2]);
    expect(retries).toEqual([1]);
  });

  it("hard-fails the third classified loss without a fourth attempt", async () => {
    const failure = Object.assign(new Error("WebGPU context was lost."), {
      code: "context-lost",
    });
    const attempts: number[] = [];
    const retries: number[] = [];

    await expect(
      runStudio3dWebGpuConformanceWithFreshBrowserRetry(
        async (attempt) => {
          attempts.push(attempt);
          throw failure;
        },
        ({ attempt }) => {
          retries.push(attempt);
        },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toEqual([1, 2, 3]);
    expect(retries).toEqual([1, 2]);
  });

  it("isolates heavyweight proofs in ordered fresh-browser shards", async () => {
    const attempts: string[] = [];
    const retries: string[] = [];

    await runStudio3dWebGpuProofShardsWithFreshBrowserRetry(
      async (shard, attempt) => {
        attempts.push(`${shard}:${String(attempt)}`);
        if (shard === "magic-layer-alignment" && attempt === 1) {
          throw Object.assign(new Error("lost during Magic capture"), {
            code: "device-lost",
          });
        }
      },
      ({ attempt, reason, shard }) => {
        retries.push(`${shard}:${String(attempt)}:${reason}`);
      },
    );

    expect(Object.isFrozen(STUDIO_3D_WEBGPU_PROOF_SHARDS)).toBe(true);
    expect(STUDIO_3D_WEBGPU_PROOF_SHARDS).toEqual([
      "babylon-artifact-parity",
      "magic-layer-alignment",
    ]);
    expect(attempts).toEqual([
      "babylon-artifact-parity:1",
      "magic-layer-alignment:1",
      "magic-layer-alignment:2",
    ]);
    expect(retries).toEqual([
      "magic-layer-alignment:1:context-or-device-lost",
    ]);
  });

  it("does not retry or continue after a semantic shard failure", async () => {
    const failure = new Error("WebGPU/WebGL2 object-id spatial parity failed");
    const attempts: string[] = [];

    await expect(
      runStudio3dWebGpuProofShardsWithFreshBrowserRetry(
        async (shard, attempt) => {
          attempts.push(`${shard}:${String(attempt)}`);
          if (shard === "magic-layer-alignment") throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toEqual([
      "babylon-artifact-parity:1",
      "magic-layer-alignment:1",
    ]);
  });

  it("surfaces cleanup failure after a successful proof and still closes every boundary", async () => {
    const cleanupFailure = new Error("browser context did not close");
    const events: string[] = [];

    await expect(
      runStudio3dWebGpuShardWithCleanup(
        async () => {
          events.push("proof");
        },
        [
          {
            close: () => {
              events.push("context-close");
              throw cleanupFailure;
            },
            label: "browser context",
          },
          {
            close: () => {
              events.push("browser-close");
            },
            label: "browser",
          },
        ],
      ),
    ).rejects.toBe(cleanupFailure);
    expect(events).toEqual(["proof", "context-close", "browser-close"]);
  });

  it("preserves the original proof failure when every cleanup boundary also fails", async () => {
    const proofFailure = new Error("stable-ID parity failed");
    const events: string[] = [];

    await expect(
      runStudio3dWebGpuShardWithCleanup(
        async () => {
          events.push("proof");
          throw proofFailure;
        },
        [
          {
            close: () => {
              events.push("context-close");
              throw new Error("context close failed");
            },
            label: "browser context",
          },
          {
            close: () => {
              events.push("browser-close");
              throw new Error("browser close failed");
            },
            label: "browser",
          },
        ],
      ),
    ).rejects.toBe(proofFailure);
    expect(events).toEqual(["proof", "context-close", "browser-close"]);
  });

  it("aggregates multiple cleanup failures after a successful proof", async () => {
    const contextFailure = new Error("context close failed");
    const browserFailure = new Error("browser close failed");

    await expect(
      runStudio3dWebGpuShardWithCleanup(
        async () => undefined,
        [
          { close: () => { throw contextFailure; }, label: "browser context" },
          { close: () => { throw browserFailure; }, label: "browser" },
        ],
      ),
    ).rejects.toMatchObject({
      errors: [contextFailure, browserFailure],
      message: "WebGPU shard cleanup failed at browser context, browser",
    });
  });

  it("closes every exclusive WebGPU shard browser before launching normal Chromium", () => {
    const webGpuAttempt = sourceBetween(
      "async function runStudio3dWebGpuConformanceBrowserAttempt(",
      "async function main(): Promise<void>",
    );
    const main = sourceBetween(
      "async function main(): Promise<void>",
      "if (process.argv[1]",
    );
    const webGpuProof = main.indexOf(
      "await runStudio3dWebGpuProofShardsWithFreshBrowserRetry(",
    );
    const normalBrowser = main.indexOf(
      'browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });',
    );

    expect(webGpuAttempt).toContain("await runStudio3dWebGpuShardWithCleanup(");
    expect(webGpuAttempt).toContain("await webGpuContext?.close()");
    expect(webGpuAttempt).toContain("close: () => webGpuBrowser.close()");
    expect(webGpuAttempt).not.toContain(".close().catch(() => undefined)");
    expect(webGpuAttempt).toContain('case "babylon-artifact-parity"');
    expect(webGpuAttempt).toContain('case "magic-layer-alignment"');
    expect(webGpuProof).toBeGreaterThanOrEqual(0);
    expect(normalBrowser).toBeGreaterThan(webGpuProof);
  });

  it("explicitly releases both temporary WebGL2 capability probes", () => {
    expect(
      verifierSource.match(/getExtension\("WEBGL_lose_context"\)\?\.loseContext\(\)/gu),
    ).toHaveLength(2);
  });
});

describe("3D Magic production-preview product boundary", () => {
  it("re-exports and exercises the shipped registry coordinator instead of a runtime shortcut", () => {
    const alignmentProof = sourceBetween(
      "async function runMagicLayerProductionAlignmentProof(",
      "async function main(): Promise<void>",
    );
    const sameOriginNavigation = alignmentProof.indexOf(
      'await page.goto(rootUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });',
    );
    const snapshot = alignmentProof.indexOf(
      "productionProofEntry.createStudioBg3dRuntimeSnapshot(",
    );
    const capture = alignmentProof.indexOf(
      "productionProofEntry.captureStudioBg3dMagicObjectIds!({",
    );

    expect(magicProductionProofSource).toContain(
      "captureStudioBg3dMagicObjectIds,",
    );
    expect(magicProductionProofSource).toContain(
      'from "./studio-bg3d-magic-object-id-capture"',
    );
    expect(magicProductionProofSource).toContain(
      "createStudioBg3dRuntimeSnapshot,",
    );
    expect(magicProductionProofSource).not.toContain(
      "function captureStudioBg3dMagicObjectIds(",
    );
    expect(sameOriginNavigation).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeGreaterThan(sameOriginNavigation);
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(capture).toBeGreaterThan(snapshot);
    expect(alignmentProof).toContain("backends: [backend]");
    expect(alignmentProof).not.toContain('backends: ["webgpu", "webgl2"]');
    const explicitWebGpuCapture = alignmentProof.indexOf(
      'captureObjectIdsForBackend("webgpu")',
    );
    const explicitWebGl2Capture = alignmentProof.indexOf(
      'captureObjectIdsForBackend("webgl2")',
    );
    expect(explicitWebGpuCapture).toBeGreaterThan(capture);
    expect(explicitWebGl2Capture).toBeGreaterThan(explicitWebGpuCapture);
    expect(alignmentProof).toContain(
      "createRuntime: ({ backend: createdBackend, canvas, capabilities, settings }) =>",
    );
    expect(alignmentProof).toContain("capabilities,");
    expect(alignmentProof).toContain("capture.backend !== backend");
    expect(alignmentProof).not.toContain("capture.fallbackUsed");
    expect(alignmentProof).toContain(
      'capture.attempts[0]?.outcome !== "succeeded"',
    );
    expect(alignmentProof).toContain('backends: ["webgpu"]');
    expect(alignmentProof).toContain('failedRuntimeCreations[0] !== "webgpu"');
    expect(alignmentProof).toContain('failedRuntimeCreations.includes("webgl2")');
    expect(alignmentProof).toContain(
      "product Magic WebGPU failure invoked WebGL2 instead of failing closed",
    );
    expect(alignmentProof).not.toContain(".runIsolated(");
    expect(alignmentProof).not.toContain('kind: "artifact-capture-v2"');
  });
});
