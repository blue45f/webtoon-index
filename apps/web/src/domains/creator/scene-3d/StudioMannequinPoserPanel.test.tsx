// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetStudioDestructiveActionLedger,
  setStudioDestructiveConfirmPresenter,
  type StudioDestructiveActionRequest,
} from "../studio-destructive-action-preview";

import { STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS } from "./studio-mannequin-model";
import { STUDIO_MANNEQUIN_POSE_PRESETS } from "./studio-mannequin-poses";

import type { StudioMannequinSceneHandle } from "./studio-mannequin-scene";

// Three.js 뷰포트는 jsdom 에서 만들 수 없으니 씬 계층 전체를 결정적 스텁으로 대체한다.
// (경로 계약: StudioMannequinPoserPanel 은 씬을 오직 이 모듈을 통해서만 만든다.)
const sceneHandle: StudioMannequinSceneHandle = {
  setBodySpec: vi.fn(),
  setPose: vi.fn(),
  getPose: vi.fn(() => ({ joints: {}, pelvisOffset: [0, 0, 0] as const })),
  setJointRotation: vi.fn(),
  getJointRotation: vi.fn(() => [0, 0, 0] as const),
  selectJoint: vi.fn(),
  setMaterialStyle: vi.fn(),
  getMaterialStyle: vi.fn(() => "wood" as const),
  setCameraPreset: vi.fn(),
  setProjection: vi.fn(),
  getProjection: vi.fn(() => "perspective" as const),
  resetCamera: vi.fn(),
  resize: vi.fn(),
  invalidate: vi.fn(),
  captureDataUrl: vi.fn(async () => ({
    pngDataUrl: "data:image/png;base64,AAAA",
    width: 640,
    height: 480,
    // 래스터는 dpr×배율 슈퍼샘플 — 논리 뷰 크기가 함께 전달돼야 캔버스에 논리 크기로 삽입된다.
    displayWidth: 320,
    displayHeight: 240,
  })),
  dispose: vi.fn(),
};

const createScene = vi.fn((_options: unknown) => sceneHandle);

const webcamRuntimeMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  init: vi.fn(),
}));
const persistenceRuntimeMocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<unknown>>(async () => null),
  save: vi.fn(async (state: unknown) => state),
}));
const photoPoseScannerMocks = vi.hoisted(() => {
  const worldLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  }));
  Object.assign(worldLandmarks[11]!, { x: 0.4, y: 0.25 });
  Object.assign(worldLandmarks[12]!, { x: 0.6, y: 0.25 });
  Object.assign(worldLandmarks[13]!, { x: 0.3, y: 0.45 });
  Object.assign(worldLandmarks[14]!, { x: 0.7, y: 0.45 });
  Object.assign(worldLandmarks[15]!, { x: 0.2, y: 0.65 });
  Object.assign(worldLandmarks[16]!, { x: 0.8, y: 0.65 });
  Object.assign(worldLandmarks[23]!, { x: 0.44, y: 0.55 });
  Object.assign(worldLandmarks[24]!, { x: 0.56, y: 0.55 });
  Object.assign(worldLandmarks[25]!, { x: 0.43, y: 0.75 });
  Object.assign(worldLandmarks[26]!, { x: 0.57, y: 0.75 });
  Object.assign(worldLandmarks[27]!, { x: 0.42, y: 0.95 });
  Object.assign(worldLandmarks[28]!, { x: 0.58, y: 0.95 });
  Object.assign(worldLandmarks[29]!, { x: 0.42, y: 0.98, z: 0.08 });
  Object.assign(worldLandmarks[30]!, { x: 0.58, y: 0.98, z: 0.08 });
  const confidence = {
    overall: 0.9,
    coverage: 1,
    quality: "high" as const,
    groups: { torso: 0.9, leftArm: 0.9, rightArm: 0.9, leftLeg: 0.9, rightLeg: 0.9 },
    joints: {
      leftShoulder: 0.9,
      rightShoulder: 0.9,
      leftElbow: 0.9,
      rightElbow: 0.9,
      leftWrist: 0.9,
      rightWrist: 0.9,
      leftHip: 0.9,
      rightHip: 0.9,
      leftKnee: 0.9,
      rightKnee: 0.9,
      leftAnkle: 0.9,
      rightAnkle: 0.9,
    },
    lowConfidenceGroups: [] as const,
  };
  const payload = {
    sourceName: "photo-a.png",
    bones: {},
    landmarks: worldLandmarks,
    worldLandmarks,
    confidence,
    fingerEdits: {},
    detectedHandSides: [] as const,
  };
  return {
    payload,
    lowPayload: {
      ...payload,
      sourceName: "photo-low.png",
      confidence: { ...confidence, overall: 0.3, coverage: 0.25, quality: "low" as const },
    },
  };
});

vi.mock("./studio-mannequin-scene", () => ({
  createStudioMannequinScene: (options: unknown) => createScene(options),
}));

vi.mock("./studio-mannequin-webcam-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-mannequin-webcam-tracking")>();
  return {
    ...actual,
    disposeStudioMannequinPoseLandmarker: webcamRuntimeMocks.dispose,
    initStudioMannequinPoseLandmarker: webcamRuntimeMocks.init,
  };
});

vi.mock("./studio-mannequin-bg3d-preset-sqlite-repository", () => ({
  getProductStudioMannequinStateSqliteRepository: () => ({
    authority: "sqlite",
    load: persistenceRuntimeMocks.load,
    save: persistenceRuntimeMocks.save,
  }),
}));

vi.mock("../vrm/StudioVrmPhotoPoseScanner", async () => {
  const { createElement } = await import("react");
  return {
    StudioVrmPhotoPoseScanner: ({
      disabled,
      onApply,
    }: {
      disabled?: boolean;
      onApply: (
        payload:
          | typeof photoPoseScannerMocks.payload
          | typeof photoPoseScannerMocks.lowPayload
      ) => boolean;
    }) => createElement(
      "div",
      { "aria-label": "사진 포즈 스캐너" },
      createElement(
        "button",
        {
          disabled,
          onClick: () => onApply(photoPoseScannerMocks.payload),
          type: "button",
        },
        "테스트 사진 포즈 적용",
      ),
      createElement(
        "button",
        {
          disabled,
          onClick: () => onApply(photoPoseScannerMocks.lowPayload),
          type: "button",
        },
        "테스트 낮은 신뢰도 포즈 적용",
      ),
    ),
  };
});

const { StudioMannequinPoserPanel } = await import("./StudioMannequinPoserPanel");

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalSecureContextDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");

beforeEach(() => {
  persistenceRuntimeMocks.load.mockReset().mockResolvedValue(null);
  persistenceRuntimeMocks.save.mockReset().mockImplementation(async (state: unknown) => state);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  resetStudioDestructiveActionLedger();
  vi.clearAllMocks();
  webcamRuntimeMocks.init.mockReset();
  webcamRuntimeMocks.dispose.mockReset();
  if (originalMediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  if (originalSecureContextDescriptor) {
    Object.defineProperty(window, "isSecureContext", originalSecureContextDescriptor);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function renderPanel(overrides: {
  onClose?: () => void;
  onInsert?: (result: unknown) => boolean | void | Promise<boolean | void>;
} = {}) {
  return render(
    <StudioMannequinPoserPanel
      open
      onClose={overrides.onClose ?? vi.fn()}
      onInsert={overrides.onInsert ?? vi.fn()}
    />,
  );
}

async function waitForPersistenceReady(): Promise<void> {
  await waitFor(() => {
    expect(
      (screen.getByRole("button", { name: "3D 데생 인형 닫기" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
}

function installWebcamBrowserStubs(getUserMedia: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 17);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

describe("StudioMannequinPoserPanel", () => {
  it("닫혀 있으면 아무것도 렌더링하지 않는다", () => {
    render(<StudioMannequinPoserPanel open={false} onClose={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createScene).not.toHaveBeenCalled();
  });

  it("열리면 다이얼로그·탭·뷰포트를 렌더링하고 씬을 한 번 만든다", () => {
    renderPanel();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("3D 데생 인형")).toBeTruthy();
    for (const label of ["셰이퍼", "체형", "포즈", "관절", "카메라"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(createScene).toHaveBeenCalledTimes(1);
  });

  it("셰이퍼 탭은 독립 ToonStudio 레시피를 열고 지원되는 얼굴형을 씬에 반영한다", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^셰이퍼/ }));

    expect(screen.getByRole("tab", { name: "캐릭터 레시피" })).toBeTruthy();
    expect(screen.queryByText("SHAPER")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "얼굴형" }));
    fireEvent.click(screen.getByRole("button", { name: /둥근 동안형/u }));
    await waitFor(() => {
      expect(sceneHandle.setBodySpec).toHaveBeenCalled();
    });
  });

  it("포즈 탭에 모든 프리셋 칩이 있고 클릭하면 씬에 포즈가 반영된다", async () => {
    renderPanel();
    for (const preset of STUDIO_MANNEQUIN_POSE_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "달리기" }));
    await waitFor(() => {
      expect(sceneHandle.setPose).toHaveBeenCalled();
    });
  });

  it("검증된 사진 landmark를 한 번의 포즈 스냅샷으로 적용하고 한 단계 실행 취소한다", async () => {
    renderPanel();
    await waitFor(() => expect(persistenceRuntimeMocks.load).toHaveBeenCalledTimes(1));
    vi.mocked(sceneHandle.setPose).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "테스트 사진 포즈 적용" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("관절");
      expect(screen.getByRole("status").textContent).toContain("신뢰도 90%");
      expect(sceneHandle.setPose).toHaveBeenCalledTimes(1);
    });
    const applied = vi.mocked(sceneHandle.setPose).mock.calls[0]?.[0];
    expect(applied?.joints.leftUpperArm).toBeDefined();
    expect(applied?.joints.rightUpperLeg).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "1단계 실행 취소" }));
    await waitFor(() => expect(sceneHandle.setPose).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sceneHandle.setPose).mock.calls[1]?.[0]).toEqual({
      joints: {},
      pelvisOffset: [0, 0, 0],
    });
    expect(screen.queryByRole("button", { name: "1단계 실행 취소" })).toBeNull();
  });

  it("낮은 신뢰도의 사진 포즈는 기존 마네킹 포즈를 변경하지 않는다", async () => {
    renderPanel();
    await waitFor(() => expect(persistenceRuntimeMocks.load).toHaveBeenCalledTimes(1));
    vi.mocked(sceneHandle.setPose).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "테스트 낮은 신뢰도 포즈 적용" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("신뢰도가 낮아 적용하지 않았습니다");
    });
    expect(sceneHandle.setPose).not.toHaveBeenCalled();
  });

  it("체형 탭 슬라이더 조작이 새 스펙을 씬으로 보낸다", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^체형/ }));
    const heightSlider = screen.getByLabelText(/신장/);
    fireEvent.change(heightSlider, { target: { value: "190" } });
    await waitFor(() => {
      expect(sceneHandle.setBodySpec).toHaveBeenCalled();
    });
  });

  it("캡처 버튼은 씬 캡처 → onInsert → onClose 순으로 흐르고 논리 크기를 함께 전달한다", async () => {
    const onClose = vi.fn();
    const onInsert = vi.fn(() => true);
    renderPanel({ onClose, onInsert });
    await waitForPersistenceReady();
    fireEvent.click(screen.getByRole("button", { name: /카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: /캔버스로 캡처/ }));
    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith({
        pngDataUrl: "data:image/png;base64,AAAA",
        width: 640,
        height: 480,
        displayWidth: 320,
        displayHeight: 240,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("display 쌍이 없는 캡처 결과(예산 축소 등)는 그대로 래스터 크기만 전달한다", async () => {
    vi.mocked(sceneHandle.captureDataUrl).mockResolvedValueOnce({
      pngDataUrl: "data:image/png;base64,BBBB",
      width: 500,
      height: 400,
    });
    const onInsert = vi.fn(() => true);
    renderPanel({ onInsert });
    await waitForPersistenceReady();
    fireEvent.click(screen.getByRole("button", { name: /카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: /캔버스로 캡처/ }));
    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith({
        pngDataUrl: "data:image/png;base64,BBBB",
        width: 500,
        height: 400,
      });
    });
  });

  it("same-origin 동작 인식 엔진이 준비되면 카메라를 시작하고 중지 시 모든 자원을 정리한다", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installWebcamBrowserStubs(getUserMedia);
    webcamRuntimeMocks.init.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "실시간 동작 인식 중지" })).toBeTruthy();
    });
    expect(webcamRuntimeMocks.init).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: { ideal: "user" },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "실시간 동작 인식 중지" }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(webcamRuntimeMocks.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" })).toBeTruthy();
  });

  it("엔진 준비와 카메라 권한 대기를 구분해서 안내하고 권한 대기를 취소한다", async () => {
    const getUserMedia = vi.fn(
      () => new Promise<MediaStream>(() => undefined),
    );
    installWebcamBrowserStubs(getUserMedia);
    webcamRuntimeMocks.init.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("엔진 준비 완료");
    });
    expect(screen.getByRole("button", { name: "카메라 연결 취소" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "카메라 연결 취소" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" })).toBeTruthy();
    });
    expect(webcamRuntimeMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("카메라 트랙 하나의 종료 실패가 나머지 트랙과 인식 엔진 정리를 막지 않는다", async () => {
    const stopBrokenTrack = vi.fn(() => {
      throw new Error("track already closed");
    });
    const stopHealthyTrack = vi.fn();
    const stream = {
      getTracks: () => [
        { stop: stopBrokenTrack },
        { stop: stopHealthyTrack },
      ],
    } as unknown as MediaStream;
    installWebcamBrowserStubs(vi.fn().mockResolvedValue(stream));
    webcamRuntimeMocks.init.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "실시간 동작 인식 중지" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "실시간 동작 인식 중지" }));
    expect(stopBrokenTrack).toHaveBeenCalledTimes(1);
    expect(stopHealthyTrack).toHaveBeenCalledTimes(1);
    expect(webcamRuntimeMocks.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" })).toBeTruthy();
  });

  it("웹캠 활성 상태에서 언마운트하면 프레임·스트림·인식 엔진을 모두 정리한다", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    installWebcamBrowserStubs(vi.fn().mockResolvedValue(stream));
    webcamRuntimeMocks.init.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    });

    const { unmount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "실시간 동작 인식 중지" })).toBeTruthy();
    });

    unmount();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(webcamRuntimeMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("엔진 자산 로드 실패를 카메라 권한 오류와 구분하고 즉시 재시도 버튼을 제공한다", async () => {
    const getUserMedia = vi.fn();
    installWebcamBrowserStubs(getUserMedia);
    webcamRuntimeMocks.init.mockRejectedValue(
      Object.assign(new Error("Failed to load local Wasm loader."), {
        name: "StudioMannequinVisionWasmLoadError",
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("엔진 파일");
    });
    expect(screen.getByRole("button", { name: "웹캠 동작 인식 다시 시도" })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(webcamRuntimeMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("카메라 권한 거부를 정확히 안내하고 준비 중 취소도 AbortSignal로 중단한다", async () => {
    const permissionDenied = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    const getUserMedia = vi.fn().mockRejectedValue(permissionDenied);
    installWebcamBrowserStubs(getUserMedia);
    webcamRuntimeMocks.init.mockResolvedValueOnce({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("카메라 권한이 차단");
    });
    expect(screen.getByRole("button", { name: "웹캠 동작 인식 다시 시도" })).toBeTruthy();

    let receivedSignal: AbortSignal | undefined;
    webcamRuntimeMocks.init.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
            { once: true },
          );
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "웹캠 동작 인식 다시 시도" }));
    expect(screen.getByRole("button", { name: "엔진 준비 취소" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "엔진 준비 취소" }));

    expect(receivedSignal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "웹캠 실시간 동작 인식 시작" })).toBeTruthy();
  });

  it("onInsert 가 false 를 반환하면 닫지 않고 오류를 보여준다", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose, onInsert: () => false });
    await waitForPersistenceReady();
    fireEvent.click(screen.getByRole("button", { name: /카메라/ }));
    fireEvent.click(screen.getByRole("button", { name: /캔버스로 캡처/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("삽입하지 않았습니다");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("언마운트 시 씬을 dispose 한다(rAF/GPU 정리 하우스 규칙)", () => {
    const { unmount } = renderPanel();
    unmount();
    expect(sceneHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("명시적 닫기 없이 언마운트돼도 마지막 체형·포즈를 SQLite 저장 큐에 넘긴다", async () => {
    const { unmount } = renderPanel();
    await waitFor(() => expect(persistenceRuntimeMocks.load).toHaveBeenCalledTimes(1));
    persistenceRuntimeMocks.save.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "테스트 사진 포즈 적용" }));
    await waitFor(() => expect(sceneHandle.setPose).toHaveBeenCalled());
    const appliedPose = vi.mocked(sceneHandle.setPose).mock.calls.at(-1)?.[0];
    expect(appliedPose).toBeDefined();

    unmount();

    await waitFor(() => expect(persistenceRuntimeMocks.save).toHaveBeenCalledWith({
      params: STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
      pose: appliedPose,
    }));
  });

  it("초기 SQLite 읽기가 끝나기 전 언마운트하면 기본값으로 기존 저장본을 덮지 않는다", () => {
    persistenceRuntimeMocks.load.mockReturnValueOnce(new Promise(() => undefined));
    const { unmount } = renderPanel();
    persistenceRuntimeMocks.save.mockClear();

    unmount();

    expect(persistenceRuntimeMocks.save).not.toHaveBeenCalled();
  });

  it("초기 SQLite 읽기가 해결된 같은 turn에 언마운트해도 저장본을 기본값으로 덮지 않는다", async () => {
    let resolveLoad!: (value: {
      params: typeof STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS;
      pose: { joints: Record<string, never>; pelvisOffset: [number, number, number] };
    }) => void;
    persistenceRuntimeMocks.load.mockReturnValueOnce(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    const stored = {
      params: { ...STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS, heightCm: 182 },
      pose: { joints: {}, pelvisOffset: [0, 0.25, 0] as [number, number, number] },
    };
    const { unmount } = renderPanel();
    persistenceRuntimeMocks.save.mockClear();

    resolveLoad(stored);
    await Promise.resolve();
    unmount();

    await waitFor(() => expect(persistenceRuntimeMocks.save).toHaveBeenCalledWith(stored));
  });

  it("닫기 버튼은 마지막 체형/포즈를 SQLite에 저장한 뒤 닫는다", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitForPersistenceReady();
    fireEvent.click(screen.getByRole("button", { name: "3D 데생 인형 닫기" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(persistenceRuntimeMocks.save).toHaveBeenCalledWith({
      params: STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS,
      pose: { joints: {}, pelvisOffset: [0, 0, 0] },
    });
    expect(localStorage.getItem("toonspectrum-studio-mannequin-state:v1")).toBeNull();
  });

  it("SQLite 저장 실패 시 닫지 않고 memory-only 경고와 JSON 탈출구를 유지한다", async () => {
    persistenceRuntimeMocks.save.mockRejectedValueOnce(new Error("quota exhausted"));
    const onClose = vi.fn();
    renderPanel({ onClose });

    await waitForPersistenceReady();

    fireEvent.click(screen.getByRole("button", { name: "3D 데생 인형 닫기" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("현재 탭 메모리 임시");
    });
    expect(screen.getByRole("button", { name: /내보내기/ })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("초기 SQLite 읽기 중에는 닫기·Escape·캡처가 기존 저장본을 덮거나 삽입하지 않는다", async () => {
    persistenceRuntimeMocks.load.mockReturnValueOnce(new Promise(() => undefined));
    const onClose = vi.fn();
    const onInsert = vi.fn();
    renderPanel({ onClose, onInsert });
    persistenceRuntimeMocks.save.mockClear();

    const closeButton = screen.getByRole("button", { name: "3D 데생 인형 닫기" }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    fireEvent.click(closeButton);
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    const captureButton = screen.getByRole("button", { name: /캔버스로 캡처/ }) as HTMLButtonElement;
    expect(captureButton.disabled).toBe(true);
    fireEvent.click(captureButton);

    expect(persistenceRuntimeMocks.save).not.toHaveBeenCalled();
    expect(sceneHandle.captureDataUrl).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("초기 SQLite 읽기 실패 뒤에도 닫기·캡처가 알 수 없는 저장본을 기본값으로 덮지 않는다", async () => {
    persistenceRuntimeMocks.load.mockRejectedValueOnce(new Error("sqlite read failed"));
    const onClose = vi.fn();
    const onInsert = vi.fn();
    renderPanel({ onClose, onInsert });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("불러오지 못해");
    });
    persistenceRuntimeMocks.save.mockClear();
    const approvals: StudioDestructiveActionRequest[] = [];
    let approveClose = false;
    setStudioDestructiveConfirmPresenter((request) => {
      approvals.push(request);
      return approveClose;
    });

    const closeButton = screen.getByRole("button", { name: "3D 데생 인형 닫기" }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(false);
    fireEvent.click(closeButton);
    await waitFor(() => expect(approvals).toHaveLength(1));
    expect(approvals[0]).toMatchObject({
      id: "studio.mannequin.discard-unpersisted-state",
      reversibility: "irreversible",
      confirmLabel: "저장하지 않고 닫기",
    });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^카메라/ }));
    const captureButton = screen.getByRole("button", { name: /캔버스로 캡처/ }) as HTMLButtonElement;
    expect(captureButton.disabled).toBe(true);
    fireEvent.click(captureButton);

    expect(persistenceRuntimeMocks.save).not.toHaveBeenCalled();
    expect(sceneHandle.captureDataUrl).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /내보내기/ })).toBeTruthy();

    approveClose = true;
    fireEvent.click(closeButton);
    expect(persistenceRuntimeMocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("늦은 SQLite hydration이 사용자가 먼저 바꾼 체형을 덮어쓰지 않는다", async () => {
    let resolveLoad!: (state: {
      params: typeof STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS;
      pose: {
        joints: Record<string, never>;
        pelvisOffset: readonly [number, number, number];
      };
    }) => void;
    persistenceRuntimeMocks.load.mockReturnValueOnce(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^체형/ }));
    const heightSlider = screen.getByLabelText(/신장/);
    fireEvent.change(heightSlider, { target: { value: "190" } });
    // Resolve the durable read immediately, before a passive React effect could observe the edit.
    // The mutation authority must advance synchronously in the input handler.
    resolveLoad({
      params: { ...STUDIO_MANNEQUIN_DEFAULT_BODY_PARAMS, heightCm: 150 },
      pose: { joints: {}, pelvisOffset: [0, 0, 0] },
    });
    await waitFor(() => expect((heightSlider as HTMLInputElement).value).toBe("190"));
  });

  it("exposes 3D Head Model (Face Proportions) presets and morphing sliders (CSP 2.0)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^체형/ }));

    expect(screen.getByText("3D 헤드 모델 (Face Proportions)")).toBeDefined();
    expect(screen.getByRole("button", { name: /웹툰\/애니형/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /날카로운 턱/ })).toBeDefined();

    // Click '날카로운 턱' preset
    fireEvent.click(screen.getByRole("button", { name: /날카로운 턱/ }));

    // Verify chin/face sliders exist
    const faceWidthSlider = screen.getByLabelText(/턱\/얼굴 너비/);
    expect(faceWidthSlider).toBeDefined();
    fireEvent.change(faceWidthSlider, { target: { value: "0.85" } });
    await waitFor(() => expect((faceWidthSlider as HTMLInputElement).value).toBe("0.85"));
  });
});
