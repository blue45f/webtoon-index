import { useLayoutEffect, useRef, useState } from "react";

import {
  createStudioEngineWebGpuPresentationSurface,
  type StudioEngineWebGpuPresentationLayout,
  type StudioEngineWebGpuPresentationSurface,
} from "./render/studio-engine-webgpu-presentation-surface";
import {
  createStudioEngineWebGpuTexturedBrushRuntime,
  type StudioEngineWebGpuTexturedBrushRuntime,
} from "./render/studio-engine-webgpu-textured-brush-runtime";
import { acquireStudioGpuPresentationDevice } from "./render/studio-gpu-presentation-device";
import {
  StudioCanonicalVNextDryMediaPresentationController,
  type StudioCanonicalVNextDryMediaFinalParityResult,
} from "./studio-canonical-vnext-dry-media-presentation-controller";
import { compileStudioCanonicalVNextDryMediaProductFrame } from "./studio-canonical-vnext-dry-media-product-adapter";
import { resolveStudioLiveSurfaceDevicePixelRatio } from "./studio-low-latency-canvas";

import type { StudioWebGpuSurfaceBounds } from "./render/studio-webgpu-viewport";
import type { DrawEl } from "./studio-element-model";

import { cn } from "@/shared/lib/utils";

export const STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CANVAS_VERSION = 1 as const;

export interface StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority {
  readonly kind: "studio-canonical-vnext-dry-media-canvas-authority";
  readonly version: typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CANVAS_VERSION;
  readonly status: "authorized";
  readonly element: DrawEl;
  readonly layoutKey: string;
  readonly canonicalPlanHash: string;
  readonly dynamicPlanDigest: `sha256:${string}`;
  readonly sourceDabCount: number;
  readonly texturedDabCount: number;
  readonly laneCount: 3 | 5;
  readonly parityReceipt: Extract<
    StudioCanonicalVNextDryMediaFinalParityResult,
    { readonly status: "completed" }
  >["receipt"];
}

export interface StudioCanonicalVNextDryMediaCanvasUnavailableAuthority {
  readonly kind: "studio-canonical-vnext-dry-media-canvas-authority";
  readonly version: typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CANVAS_VERSION;
  readonly status: "unavailable";
  readonly element: DrawEl;
  readonly layoutKey: string;
  readonly reason: string;
  readonly retainsLastGoodFrame: boolean;
  readonly lastPresented: StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority | null;
  readonly retryPolicy: "explicit-next-selection-only";
}

export type StudioCanonicalVNextDryMediaCanvasAuthority =
  | StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority
  | StudioCanonicalVNextDryMediaCanvasUnavailableAuthority;

export interface StudioCanonicalVNextDryMediaCanvasProps {
  readonly className?: string;
  readonly element: DrawEl | null;
  readonly layoutKey: string;
  readonly visible: boolean;
  readonly surfaceBounds: StudioWebGpuSurfaceBounds;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly documentScale: number;
  readonly flipX: boolean;
  readonly onAuthorityChange: (
    authority: StudioCanonicalVNextDryMediaCanvasAuthority | null,
  ) => void;
}

interface LayoutEpochs {
  presentation: number;
  resize: number;
  viewport: number;
  flip: number;
  resizeSignature: string | null;
  viewportSignature: string | null;
  flipSignature: string | null;
}

interface DryMediaGpuResources {
  readonly device: GPUDevice;
  readonly surface: StudioEngineWebGpuPresentationSurface;
  readonly runtime: StudioEngineWebGpuTexturedBrushRuntime;
  readonly controller: StudioCanonicalVNextDryMediaPresentationController;
  readonly epochs: LayoutEpochs;
  tail: Promise<void>;
}

type DryMediaCanvasDisplayState =
  | "awaiting-receipt"
  | "authorized"
  | "last-good-unavailable"
  | "unavailable";

function surfaceDevicePixelRatio(width: number, height: number): number {
  const native = Number(globalThis.devicePixelRatio);
  return resolveStudioLiveSurfaceDevicePixelRatio({
    cssWidth: width,
    cssHeight: height,
    devicePixelRatio: Number.isFinite(native) && native > 0 ? native : 1,
  });
}

async function createResources(
  canvas: HTMLCanvasElement,
  onDeviceLost: (info: GPUDeviceLostInfo) => void,
): Promise<DryMediaGpuResources | null> {
  const acquired = await acquireStudioGpuPresentationDevice();
  if (!acquired) return null;
  const { device, deviceEpoch, canvasFormat } = acquired;
  let surface: StudioEngineWebGpuPresentationSurface | null = null;
  let runtime: StudioEngineWebGpuTexturedBrushRuntime | null = null;
  try {
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      device.destroy();
      return null;
    }
    const surfaceResult = createStudioEngineWebGpuPresentationSurface({
      device,
      context,
      canvas,
      canvasFormat,
      initialDeviceEpoch: deviceEpoch,
      ownsDevice: false,
      onDeviceLost,
    });
    if (surfaceResult.status !== "ready") {
      device.destroy();
      return null;
    }
    surface = surfaceResult.surface;
    const runtimeResult = createStudioEngineWebGpuTexturedBrushRuntime({
      device,
      initialDeviceEpoch: deviceEpoch,
      presentationOnly: true,
      ownsDevice: false,
      onDeviceLost,
    });
    if (runtimeResult.status !== "ready") {
      surface.dispose();
      device.destroy();
      return null;
    }
    runtime = runtimeResult.runtime;
    return {
      device,
      surface,
      runtime,
      controller: new StudioCanonicalVNextDryMediaPresentationController({
        surface,
        runtime,
      }),
      epochs: {
        presentation: 0,
        resize: 0,
        viewport: 0,
        flip: 0,
        resizeSignature: null,
        viewportSignature: null,
        flipSignature: null,
      },
      tail: Promise.resolve(),
    };
  } catch {
    runtime?.dispose();
    surface?.dispose();
    device.destroy();
    return null;
  }
}

function configureSurface(
  resources: DryMediaGpuResources,
  input: Pick<
    StudioCanonicalVNextDryMediaCanvasProps,
    | "surfaceBounds"
    | "documentWidth"
    | "documentHeight"
    | "documentScale"
    | "flipX"
  >,
): boolean {
  const { surfaceBounds } = input;
  if (
    !Number.isFinite(surfaceBounds.left)
    || !Number.isFinite(surfaceBounds.top)
    || !Number.isFinite(surfaceBounds.width)
    || !Number.isFinite(surfaceBounds.height)
    || surfaceBounds.width <= 0
    || surfaceBounds.height <= 0
    || !Number.isFinite(input.documentWidth)
    || !Number.isFinite(input.documentHeight)
    || input.documentWidth <= 0
    || input.documentHeight <= 0
    || !Number.isFinite(input.documentScale)
    || input.documentScale <= 0
  ) return false;
  const dpr = surfaceDevicePixelRatio(surfaceBounds.width, surfaceBounds.height);
  const resizeSignature = [
    surfaceBounds.width,
    surfaceBounds.height,
    dpr,
  ].join(":");
  const viewportSignature = [
    input.documentWidth,
    input.documentHeight,
    input.documentScale,
    surfaceBounds.left,
    surfaceBounds.top,
  ].join(":");
  const flipSignature = input.flipX ? "flip-x" : "normal";
  const epochs = resources.epochs;
  const first = epochs.presentation === 0;
  const resizeChanged = first || epochs.resizeSignature !== resizeSignature;
  const viewportChanged = first || epochs.viewportSignature !== viewportSignature;
  const flipChanged = first || epochs.flipSignature !== flipSignature;
  if (resizeChanged) epochs.resize += 1;
  if (viewportChanged) epochs.viewport += 1;
  if (flipChanged) epochs.flip += 1;
  if (resizeChanged || viewportChanged || flipChanged) epochs.presentation += 1;
  epochs.resizeSignature = resizeSignature;
  epochs.viewportSignature = viewportSignature;
  epochs.flipSignature = flipSignature;
  const layout: StudioEngineWebGpuPresentationLayout = {
    presentationEpoch: epochs.presentation,
    resizeEpoch: epochs.resize,
    viewportEpoch: epochs.viewport,
    flipEpoch: epochs.flip,
    cssWidth: surfaceBounds.width,
    cssHeight: surfaceBounds.height,
    dpr,
    viewport: {
      logicalWidth: input.documentWidth,
      logicalHeight: input.documentHeight,
      scaleX: input.documentScale,
      scaleY: input.documentScale,
      offsetX: -surfaceBounds.left,
      offsetY: -surfaceBounds.top,
      flipX: input.flipX,
      flipY: false,
    },
  };
  const configured = resources.surface.configure(layout);
  return configured.status === "ready" || configured.status === "unchanged";
}

function disposeResources(resources: DryMediaGpuResources | null): void {
  if (!resources) return;
  resources.surface.dispose();
  resources.runtime.dispose();
  resources.device.destroy();
}

function disposeResourcesAfterTail(resources: DryMediaGpuResources | null): void {
  if (!resources) return;
  void resources.tail.finally(() => disposeResources(resources));
}

function snapshotPresentedCanvas(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
): boolean {
  // This is a display-only copy of an already receipted WebGPU frame. It never lowers the scene,
  // executes brush commands, or grants Canvas2D provider authority; it only survives WebGPU
  // unconfigure/device-loss clearing the browser's current presentation texture.
  try {
    const context = target.getContext("2d");
    if (!context || source.width <= 0 || source.height <= 0) return false;
    target.width = source.width;
    target.height = source.height;
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function clearPresentedSnapshot(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export function StudioCanonicalVNextDryMediaCanvas({
  className,
  element,
  layoutKey,
  visible,
  surfaceBounds,
  documentWidth,
  documentHeight,
  documentScale,
  flipX,
  onAuthorityChange,
}: StudioCanonicalVNextDryMediaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement>(null);
  const callbackRef = useRef(onAuthorityChange);
  const resourcesRef = useRef<DryMediaGpuResources | null>(null);
  const resourcesPromiseRef = useRef<Promise<DryMediaGpuResources | null> | null>(
    null,
  );
  const resourceGenerationRef = useRef(0);
  const jobEpochRef = useRef(0);
  const compileEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const blockedElementIdRef = useRef<string | null>(null);
  const unavailableReasonRef = useRef<string | null>(null);
  const lastAuthorizedRef =
    useRef<StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority | null>(null);
  const [display, setDisplay] = useState<Readonly<{
    state: DryMediaCanvasDisplayState;
    reason: string | null;
  }>>({ state: "awaiting-receipt", reason: null });
  const surfaceLeft = surfaceBounds.left;
  const surfaceTop = surfaceBounds.top;
  const surfaceWidth = surfaceBounds.width;
  const surfaceHeight = surfaceBounds.height;

  useLayoutEffect(() => {
    callbackRef.current = onAuthorityChange;
  }, [onAuthorityChange]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      jobEpochRef.current += 1;
      resourceGenerationRef.current += 1;
      callbackRef.current(null);
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      resourcesPromiseRef.current = null;
      disposeResourcesAfterTail(resources);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const snapshotCanvas = snapshotCanvasRef.current;
    const jobEpoch = ++jobEpochRef.current;
    const controller = new AbortController();

    const relinquishResources = () => {
      resourceGenerationRef.current += 1;
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      resourcesPromiseRef.current = null;
      disposeResourcesAfterTail(resources);
    };

    const publishUnavailable = (reason: string) => {
      if (!element) return;
      blockedElementIdRef.current = element.id;
      unavailableReasonRef.current = reason;
      // Only a frame receipted for this exact DrawEl in this exact layout may stand in for the
      // document pixels. A snapshot from a previous surface size/scale/DPR would be stretched into
      // the current bounds, so it is not "last good" here — the ordinary element paints instead.
      const lastPresented = lastAuthorizedRef.current?.element === element
        && lastAuthorizedRef.current.layoutKey === layoutKey
        ? lastAuthorizedRef.current
        : null;
      const retainsLastGoodFrame = lastPresented !== null;
      canvas?.setAttribute(
        "data-studio-canonical-vnext-dry-media-state",
        "unavailable",
      );
      if (canvas) {
        canvas.dataset.studioCanonicalVnextDryMediaReason = reason;
      }
      setDisplay({
        state: retainsLastGoodFrame ? "last-good-unavailable" : "unavailable",
        reason,
      });
      callbackRef.current(Object.freeze({
        kind: "studio-canonical-vnext-dry-media-canvas-authority",
        version: STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CANVAS_VERSION,
        status: "unavailable",
        element,
        layoutKey,
        reason,
        retainsLastGoodFrame,
        lastPresented,
        retryPolicy: "explicit-next-selection-only",
      }));
    };

    const rejectAndRelease = (reason: string) => {
      publishUnavailable(reason);
      relinquishResources();
    };

    if (!canvas || !snapshotCanvas || !element) {
      blockedElementIdRef.current = null;
      unavailableReasonRef.current = null;
      lastAuthorizedRef.current = null;
      callbackRef.current(null);
      setDisplay({ state: "awaiting-receipt", reason: null });
      clearPresentedSnapshot(snapshotCanvas);
      /*
       * The shared RGBA16F surface can be tens or hundreds of MiB at tablet resolutions. No
       * eligible selected DrawEl means there is no specialist owner, so release immediately
       * instead of retaining that allocation behind an invisible canvas.
       */
      relinquishResources();
      return () => controller.abort();
    }

    if (
      blockedElementIdRef.current !== null
      && blockedElementIdRef.current !== element.id
    ) {
      blockedElementIdRef.current = null;
      unavailableReasonRef.current = null;
      lastAuthorizedRef.current = null;
      callbackRef.current(null);
      clearPresentedSnapshot(snapshotCanvas);
    }
    if (blockedElementIdRef.current === element.id) {
      publishUnavailable(unavailableReasonRef.current ?? "provider-unavailable");
      return () => controller.abort();
    }
    canvas.dataset.studioCanonicalVnextDryMediaState = "awaiting-receipt";
    delete canvas.dataset.studioCanonicalVnextDryMediaReason;
    setDisplay((current) => current.state === "authorized"
      ? current
      : { state: "awaiting-receipt", reason: null });
    if (
      lastAuthorizedRef.current?.element !== element
      || lastAuthorizedRef.current.layoutKey !== layoutKey
    ) {
      // A layout change (resize, zoom, flip, DPR) invalidates the retained bitmap even for the
      // same DrawEl: the viewport resolver already refuses a stale-layout authority, so drop the
      // snapshot here too instead of letting a later failure resurrect it at the wrong geometry.
      lastAuthorizedRef.current = null;
      callbackRef.current(null);
      clearPresentedSnapshot(snapshotCanvas);
    }

    const ensureResources = async () => {
      if (resourcesRef.current) return resourcesRef.current;
      const existing = resourcesPromiseRef.current;
      if (existing) return existing;

      const generation = resourceGenerationRef.current + 1;
      resourceGenerationRef.current = generation;
      const pending = createResources(canvas, () => {
        if (
          !mountedRef.current
          || resourceGenerationRef.current !== generation
        ) return;
        jobEpochRef.current += 1;
        rejectAndRelease("device-lost");
      });
      resourcesPromiseRef.current = pending;

      const resources = await pending.catch(() => null);

      const ownsPending =
        resourcesPromiseRef.current === pending
        && resourceGenerationRef.current === generation;
      if (
        !mountedRef.current
        || !ownsPending
        || canvasRef.current !== canvas
      ) {
        disposeResourcesAfterTail(resources);
        return null;
      }
      resourcesPromiseRef.current = null;
      resourcesRef.current = resources;
      return resources;
    };

    void (async () => {
      const resources = await ensureResources();
      if (
        !resources
        || controller.signal.aborted
        || jobEpoch !== jobEpochRef.current
      ) {
        if (
          !controller.signal.aborted
          && jobEpoch === jobEpochRef.current
        ) {
          rejectAndRelease("webgpu-unavailable");
        }
        return;
      }
      const run = async () => {
        if (
          controller.signal.aborted
          || jobEpoch !== jobEpochRef.current
        ) return;
        if (!configureSurface(resources, {
          surfaceBounds: {
            left: surfaceLeft,
            top: surfaceTop,
            width: surfaceWidth,
            height: surfaceHeight,
          },
          documentWidth,
          documentHeight,
          documentScale,
          flipX,
        })) {
          rejectAndRelease("surface-config-rejected");
          return;
        }
        compileEpochRef.current += 1;
        const compiled =
          await compileStudioCanonicalVNextDryMediaProductFrame({
            element,
            sessionEpoch: 1,
            strokeEpoch: compileEpochRef.current,
            commandSequence: compileEpochRef.current,
            signal: controller.signal,
          });
        if (
          compiled.status !== "ready"
          || controller.signal.aborted
          || jobEpoch !== jobEpochRef.current
        ) {
          if (
            !controller.signal.aborted
            && jobEpoch === jobEpochRef.current
          ) {
            rejectAndRelease(
              compiled.status === "ready"
                ? "stale-compile"
                : [
                    "compile",
                    compiled.reason,
                    compiled.detail,
                  ].filter(Boolean).join(":"),
            );
          }
          return;
        }
        const parity = await resources.controller.presentFinalLiveAndCommit(
          compiled.frame,
          controller.signal,
        );
        if (
          parity.status !== "completed"
          || controller.signal.aborted
          || jobEpoch !== jobEpochRef.current
        ) {
          if (
            !controller.signal.aborted
            && jobEpoch === jobEpochRef.current
          ) {
            rejectAndRelease(
              parity.status === "completed"
                ? "stale-presentation"
                : `presentation:${parity.reason}`,
            );
          }
          return;
        }
        if (!snapshotPresentedCanvas(canvas, snapshotCanvas)) {
          rejectAndRelease("last-good-snapshot-unavailable");
          return;
        }
        canvas.dataset.studioCanonicalVnextDryMediaState = "authorized";
        delete canvas.dataset.studioCanonicalVnextDryMediaReason;
        const authority = Object.freeze({
          kind: "studio-canonical-vnext-dry-media-canvas-authority",
          version: STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CANVAS_VERSION,
          status: "authorized",
          element,
          layoutKey,
          canonicalPlanHash: compiled.frame.canonicalPlanHash,
          dynamicPlanDigest: compiled.dynamicPlanDigest,
          sourceDabCount: compiled.sourceDabCount,
          texturedDabCount: compiled.texturedDabCount,
          laneCount: compiled.laneCount,
          parityReceipt: parity.receipt,
        }) satisfies StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority;
        lastAuthorizedRef.current = authority;
        unavailableReasonRef.current = null;
        setDisplay({ state: "authorized", reason: null });
        callbackRef.current(authority);
      };
      const queued = resources.tail.then(run, run);
      resources.tail = queued.then(
        () => undefined,
        () => undefined,
      );
      await queued;
    })();

    return () => controller.abort();
  }, [
    documentHeight,
    documentScale,
    documentWidth,
    element,
    flipX,
    layoutKey,
    surfaceHeight,
    surfaceLeft,
    surfaceTop,
    surfaceWidth,
  ]);

  const showLastGoodSnapshot = visible && display.state === "last-good-unavailable";
  const showWebGpuCanvas = visible && display.state === "authorized";

  return (
    <>
      <canvas
        ref={snapshotCanvasRef}
        aria-hidden="true"
        data-studio-canonical-vnext-dry-media-last-good="true"
        className={cn("pointer-events-none absolute z-[12]", className)}
        style={{
          left: surfaceLeft,
          top: surfaceTop,
          width: surfaceWidth,
          height: surfaceHeight,
          visibility: showLastGoodSnapshot ? "visible" : "hidden",
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-studio-canonical-vnext-dry-media="true"
        data-studio-canonical-vnext-dry-media-authorized={
          showWebGpuCanvas ? "true" : "false"
        }
        className={cn("pointer-events-none absolute z-[12]", className)}
        style={{
          left: surfaceLeft,
          top: surfaceTop,
          width: surfaceWidth,
          height: surfaceHeight,
          visibility: showWebGpuCanvas ? "visible" : "hidden",
        }}
      />
      {display.reason ? (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          data-studio-canonical-vnext-dry-media-unavailable="true"
          className="pointer-events-none absolute inset-x-4 top-4 z-[31] rounded-md border border-red-400/50 bg-red-950/90 px-4 py-3 text-sm font-medium text-red-50 shadow-lg"
        >
          선택한 WebGPU 드라이 미디어 엔진을 유지하지 못했습니다. 다른 렌더러로 자동 전환하지 않았습니다.
          {showLastGoodSnapshot
            ? " 마지막으로 검증된 WebGPU 프레임을 유지합니다."
            : " 이 엔진의 프레임은 표시하지 않습니다."}
          {" "}
          선택을 해제한 뒤 다시 선택하면 같은 엔진을 명시적으로 재시도할 수 있습니다.
        </div>
      ) : null}
    </>
  );
}
