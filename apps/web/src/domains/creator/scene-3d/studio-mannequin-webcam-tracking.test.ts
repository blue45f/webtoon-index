import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeStudioMannequinPoseLandmarker,
  getStudioMannequinWebcamErrorMessage,
  initStudioMannequinPoseLandmarker,
  requestStudioMannequinCameraStream,
  solvePoseToMannequinJoints,
  smoothMannequinJointRotations,
  type PoseLandmark,
  type StudioMannequinPoseLandmarker,
} from "./studio-mannequin-webcam-tracking";

afterEach(() => {
  disposeStudioMannequinPoseLandmarker();
  vi.useRealTimers();
});

describe("studio-mannequin-webcam-tracking", () => {
  it("solves MediaPipe pose landmarks into 3D mannequin joint rotations", () => {
    // Create minimal 33 landmarks mock
    const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.9,
    }));

    // Position shoulders and elbows
    landmarks[11] = { x: 0.4, y: 0.3, z: 0, visibility: 0.9 }; // leftShoulder
    landmarks[12] = { x: 0.6, y: 0.3, z: 0, visibility: 0.9 }; // rightShoulder
    landmarks[13] = { x: 0.3, y: 0.5, z: 0, visibility: 0.9 }; // leftElbow
    landmarks[14] = { x: 0.7, y: 0.5, z: 0, visibility: 0.9 }; // rightElbow
    landmarks[15] = { x: 0.2, y: 0.7, z: 0, visibility: 0.9 }; // leftWrist
    landmarks[16] = { x: 0.8, y: 0.7, z: 0, visibility: 0.9 }; // rightWrist

    const joints = solvePoseToMannequinJoints(landmarks);
    expect(joints.leftUpperArm).toBeDefined();
    expect(joints.rightUpperArm).toBeDefined();
    expect(joints.leftUpperArm?.[0]).toBeTypeOf("number");
  });

  it("smooths joint rotations via EMA factor", () => {
    const prev = { leftUpperArm: [0, 0, 0] as const };
    const curr = { leftUpperArm: [1, 1, 1] as const };

    const smoothed = smoothMannequinJointRotations(prev, curr, 0.5);
    expect(smoothed.leftUpperArm?.[0]).toBe(0.5);
    expect(smoothed.leftUpperArm?.[1]).toBe(0.5);
    expect(smoothed.leftUpperArm?.[2]).toBe(0.5);
  });

  it("loads SIMD and non-SIMD Wasm from Vite-owned URLs instead of a CSP-blocked CDN", () => {
    const runtimeSource = readFileSync(
      new URL("./studio-mannequin-webcam-tracking.ts", import.meta.url),
      "utf8",
    );
    const assetSource = readFileSync(
      new URL("../studio-mediapipe-vision-assets.ts", import.meta.url),
      "utf8",
    );

    expect(runtimeSource).toContain("resolveStudioMediaPipeVisionWasmFileset");
    expect(assetSource).toContain("vision_wasm_internal.js?url");
    expect(assetSource).toContain("vision_wasm_nosimd_internal.js?url");
    expect(runtimeSource).toContain("modelAssetBuffer");
    expect(`${runtimeSource}\n${assetSource}`).not.toMatch(/cdn\.jsdelivr\.net|unpkg\.com/i);
    expect(runtimeSource).not.toContain("falling back to CPU");
    expect(runtimeSource.match(/PoseLandmarker\.createFromOptions/gu)).toHaveLength(1);
  });

  it("keeps the selected delegate in the singleton identity", async () => {
    const cpuLandmarker: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    };
    const cpuFactory = vi.fn(async () => cpuLandmarker);
    const gpuFactory = vi.fn(async () => cpuLandmarker);

    await expect(initStudioMannequinPoseLandmarker({
      delegate: "CPU",
      factory: cpuFactory,
    })).resolves.toBe(cpuLandmarker);
    expect(cpuFactory).toHaveBeenCalledWith(undefined, "CPU");
    await expect(initStudioMannequinPoseLandmarker({
      delegate: "GPU",
      factory: gpuFactory,
    })).rejects.toMatchObject({ name: "StudioMannequinDelegateIdentityError" });
    expect(gpuFactory).not.toHaveBeenCalled();
  });

  it("dispose 직후 retry도 이전 MediaPipe 초기화가 끝나기 전에는 factory를 중첩하지 않는다", async () => {
    const stale: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    };
    const fresh: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    };
    let resolveStale: ((value: StudioMannequinPoseLandmarker) => void) | undefined;
    const staleFactory = vi.fn(() => new Promise<StudioMannequinPoseLandmarker>((resolve) => {
      resolveStale = resolve;
    }));
    const freshFactory = vi.fn(async () => fresh);

    const stalePending = initStudioMannequinPoseLandmarker({ factory: staleFactory });
    disposeStudioMannequinPoseLandmarker();
    const retryPending = initStudioMannequinPoseLandmarker({ factory: freshFactory });

    await Promise.resolve();
    expect(freshFactory).not.toHaveBeenCalled();
    resolveStale?.(stale);
    await expect(stalePending).rejects.toMatchObject({ name: "AbortError" });
    await expect(retryPending).resolves.toBe(fresh);
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(freshFactory).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent VIDEO runtime initialization and closes the cached task", async () => {
    const landmarker: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(() => {
        throw new Error("MediaPipe close failed");
      }),
    };
    let resolveFactory: ((value: StudioMannequinPoseLandmarker) => void) | undefined;
    const factory = vi.fn(
      () =>
        new Promise<StudioMannequinPoseLandmarker>((resolve) => {
          resolveFactory = resolve;
        }),
    );

    const first = initStudioMannequinPoseLandmarker({ factory });
    const second = initStudioMannequinPoseLandmarker({ factory });
    expect(factory).toHaveBeenCalledTimes(1);

    resolveFactory?.(landmarker);
    await expect(first).resolves.toBe(landmarker);
    await expect(second).resolves.toBe(landmarker);

    expect(() => disposeStudioMannequinPoseLandmarker()).not.toThrow();
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it("best-effort closes a stale task after stop/dispose and allows a clean retry", async () => {
    const staleLandmarker: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(() => {
        throw new Error("Stale MediaPipe close failed");
      }),
    };
    let resolveFactory: ((value: StudioMannequinPoseLandmarker) => void) | undefined;
    const pending = initStudioMannequinPoseLandmarker({
      factory: () =>
        new Promise<StudioMannequinPoseLandmarker>((resolve) => {
          resolveFactory = resolve;
        }),
    });

    disposeStudioMannequinPoseLandmarker();
    resolveFactory?.(staleLandmarker);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(staleLandmarker.close).toHaveBeenCalledTimes(1);

    const retryLandmarker: StudioMannequinPoseLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    };
    await expect(
      initStudioMannequinPoseLandmarker({ factory: async () => retryLandmarker }),
    ).resolves.toBe(retryLandmarker);
  });

  it("bounds camera permission waiting and stops a stream that resolves after timeout", async () => {
    vi.useFakeTimers();
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    let resolveCamera: ((value: MediaStream) => void) | undefined;
    const pending = requestStudioMannequinCameraStream(
      () => new Promise<MediaStream>((resolve) => {
        resolveCamera = resolve;
      }),
      { timeoutMs: 250 },
    );
    const failure = pending.catch((cause: unknown) => cause);

    await vi.advanceTimersByTimeAsync(250);
    await expect(failure).resolves.toMatchObject({
      name: "StudioMannequinCameraPermissionTimeoutError",
    });

    resolveCamera?.(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("stops a camera stream that resolves after the permission wait was cancelled", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const controller = new AbortController();
    let resolveCamera: ((value: MediaStream) => void) | undefined;
    const pending = requestStudioMannequinCameraStream(
      () => new Promise<MediaStream>((resolve) => {
        resolveCamera = resolve;
      }),
      { signal: controller.signal },
    );

    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    resolveCamera?.(stream);
    await vi.waitFor(() => {
      expect(stopTrack).toHaveBeenCalledTimes(1);
    });
  });

  it("distinguishes permission, busy-camera, model timeout, and runtime file failures", () => {
    expect(
      getStudioMannequinWebcamErrorMessage(
        "camera",
        Object.assign(new Error(), { name: "NotAllowedError" }),
      ),
    ).toContain("카메라 권한");
    expect(
      getStudioMannequinWebcamErrorMessage(
        "camera",
        Object.assign(new Error(), { name: "NotReadableError" }),
      ),
    ).toContain("다른 앱");
    expect(
      getStudioMannequinWebcamErrorMessage(
        "camera",
        Object.assign(new Error(), { name: "StudioMannequinCameraPermissionTimeoutError" }),
      ),
    ).toContain("엔진은 준비");
    expect(
      getStudioMannequinWebcamErrorMessage(
        "engine",
        Object.assign(new Error(), { name: "StudioMannequinPoseModelTimeoutError" }),
      ),
    ).toContain("시간이 오래");
    expect(
      getStudioMannequinWebcamErrorMessage(
        "engine",
        Object.assign(new Error(), { name: "StudioMannequinVisionWasmLoadError" }),
      ),
    ).toContain("엔진 파일");
    expect(
      getStudioMannequinWebcamErrorMessage(
        "engine",
        Object.assign(new Error(), { name: "StudioMannequinPoseEngineCreationError" }),
      ),
    ).toContain("선택한 동작 인식 엔진");
  });
});
