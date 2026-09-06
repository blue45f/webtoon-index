import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const PANEL_STACK_SOURCE_PATH = fileURLToPath(
  new URL("../StudioThreeDPreviewPanelStack.tsx", import.meta.url),
);
const RETAINED_HOST_SOURCE_PATH = fileURLToPath(
  new URL("./StudioBg3dRetainedOwnerHost.tsx", import.meta.url),
);
const RETAINED_ROUTE_SOURCE_PATH = fileURLToPath(
  new URL("./StudioBg3dRetainedOwnerRouteBridge.tsx", import.meta.url),
);
const RETAINED_STORE_SOURCE_PATH = fileURLToPath(
  new URL("./studio-bg3d-retained-owner.ts", import.meta.url),
);

describe("Studio BG3D WebXR product boundary", () => {
  it("plans from the lossless live scene and admitted production bounds before requesting XR", async () => {
    const source = readStudioBg3dEditorSource();

    expect(source).toContain("readCurrentCanonicalSceneForShot()");
    expect(source).toContain("sceneBounds: shadowSceneBounds");
    expect(source).toContain("planStudioBg3dImmersiveStage({");
    expect(source.indexOf("flushSync(() =>", source.indexOf("startStudioBg3dWebXr")))
      .toBeLessThan(source.indexOf("controller.start(mode)", source.indexOf("startStudioBg3dWebXr")));
    expect(source).toContain("setIsQuadView(false)");
  });

  it("reuses the one Canvas and bypasses the DOM scissor without remounting its portal scene", async () => {
    const source = readStudioBg3dEditorSource();

    expect(source.match(/<Canvas\b/gu)).toHaveLength(1);
    expect(source).toContain("<StudioBg3dWebXrSessionBridge");
    expect(source).toContain("visible={!immersiveSceneActive}");
    expect(source).toContain("{immersiveCameraNode ?? mainCameraNode}");
    expect(source).toContain("{mainScenePresentationNode}");
    expect(source).toContain("<StudioBg3dImmersiveRenderBridge active={immersiveSceneActive} />");
    expect(source.match(/\{mainScenePresentationNode\}/gu)).toHaveLength(1);
    expect(source).toMatch(
      /userData=\{\{ \[STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY\]: true \}\}/u,
    );
    expect(source).toContain("<CaptureBridge onCaptureUpdate={onCaptureUpdate} />");
    expect(source).not.toMatch(/new\s+THREE\.WebGLRenderer/u);
    expect(source).not.toMatch(/@babylonjs\/core\/XR/u);
  });

  it("keeps AR transparent and omits editor-only scene helpers during presentation", async () => {
    const source = readStudioBg3dEditorSource();

    expect(source).toContain('immersiveStagePlan?.mode === "immersive-ar" ? 0 : 1');
    expect(source).toContain('immersiveStagePlan?.mode !== "immersive-ar"');
    expect(source).toContain("!immersiveSceneActive ? <BgSectionPlaneController");
    expect(source).toContain("!immersiveSceneActive && placementSession.phase");
    expect(source).toContain("!immersiveSceneActive &&");
  });

  it("blocks editing and persistence actions until the browser session is restored", async () => {
    const source = readStudioBg3dEditorSource();

    expect(source).toContain("inert={immersiveSceneActive || undefined}");
    expect(source).toContain("|| immersiveSceneActive");
    expect(source).toContain("webXrControllerRef.current?.end()");
    expect(source).toContain("pendingInitialCameraRef.current = restoreCamera");
    expect(source).not.toMatch(/XRSession[^\n]*(?:serialize|JSON\.stringify)/u);
  });

  it("closes logically at once while retaining the one Canvas through non-cancellable XR cleanup", async () => {
    const source = readStudioBg3dEditorSource();
    const [panelStack, retainedHost, retainedRoute, retainedStore] = await Promise.all([
      readFile(PANEL_STACK_SOURCE_PATH, "utf8"),
      readFile(RETAINED_HOST_SOURCE_PATH, "utf8"),
      readFile(RETAINED_ROUTE_SOURCE_PATH, "utf8"),
      readFile(RETAINED_STORE_SOURCE_PATH, "utf8"),
    ]);
    const closeStart = source.indexOf("function requestUserClose()");
    const closeEnd = source.indexOf("async function handleSaveToLibrary()", closeStart);
    const closeHandler = source.slice(closeStart, closeEnd);
    const cancelStart = source.indexOf("function disposeCurrentWebXrControllerGeneration()");
    const cancelEnd = source.indexOf("const handleWebXrControllerReady", cancelStart);
    const cancelGeneration = source.slice(cancelStart, cancelEnd);

    expect(cancelStart).toBeGreaterThanOrEqual(0);
    expect(cancelGeneration).toContain("webXrControllerRef.current = null");
    expect(cancelGeneration).toContain("const cleanup = controller.dispose()");
    expect(cancelGeneration).toContain("setWebXrRendererLifetimeRetained(true)");
    expect(cancelGeneration).toContain("onWebXrCleanupPendingChange?.(true)");
    expect(closeHandler).toContain("disposeCurrentWebXrControllerGeneration();");
    expect(closeHandler.indexOf("disposeCurrentWebXrControllerGeneration();"))
      .toBeLessThan(closeHandler.indexOf("onClose();"));
    expect(closeHandler).not.toMatch(/await\s+controller\.dispose/u);
    expect(closeHandler).not.toContain('xrState.status === "requesting"');
    expect(closeHandler).not.toContain("controller.end().then");
    expect(source).toContain("disabled={isCapturing}");
    expect(source).toContain("if (!open && !webXrRendererLifetimeRetained) return null;");
    expect(source).toContain("hidden={!open}");
    expect(source).toContain("inert={!open ? true : undefined}");
    expect(source.match(/<Canvas\b/gu)).toHaveLength(1);
    expect(panelStack).toContain("<StudioBg3dRetainedOwnerRouteBridge");
    expect(panelStack).toContain("element={bg3dElement}");
    expect(retainedHost).toContain("HostedBg3dRetainedElement");
    expect(retainedHost).toContain("onHostMounted");
    expect(retainedHost).toContain("onHostUnmounted");
    expect(retainedHost).toContain("onWebXrCleanupPendingChange");
    expect(retainedHost).toContain("reportStudioBg3dRetainedOwnerCleanup(");
    expect(retainedRoute).toContain("detachStudioBg3dRetainedOwnerRoute(generation)");
    expect(retainedStore).toContain("cleanupPending: snapshot.element !== null");
    expect(retainedStore).toContain("if (snapshot.routeAttached || snapshot.element !== null) return null;");
    expect(retainedStore).not.toMatch(/\b(?:setSession|requestSession|end)\s*\(/u);
  });
});
