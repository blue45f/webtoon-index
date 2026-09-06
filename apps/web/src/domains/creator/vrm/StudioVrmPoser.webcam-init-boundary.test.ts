import { describe, expect, it } from "vitest";

import poserSource from "./StudioVrmPoser.tsx?raw";
// 2026-08-21 의도적 변경: 웹캠 세션 effect(startCamera/loop/scheduleNext)가
// StudioVrmPoser.tsx에서 use-studio-vrm-webcam-session.ts로 분리됐다. 마커만 새 모듈로
// 옮기고 검증 대상(엔진 준비 → getUserMedia 순서, 실패 단계 구분)은 그대로 유지한다.
import webcamPanelSource from "./StudioVrmPoserPanelBodyD.tsx?raw";
import webcamSessionSource from "./use-studio-vrm-webcam-session.ts?raw";
// 2026-08-25 의도적 변경: 엔진/권한 오류 카피는 포저 셸에서 웹캠 패널 슬라이스로 이동했다.

describe("VRM webcam initialization boundary", () => {
  it("prepares both motion engines before requesting a camera stream", () => {
    const start = webcamSessionSource.indexOf("const startCamera = async () =>");
    const finish = webcamSessionSource.indexOf("startCamera();", start);
    const flow = webcamSessionSource.slice(start, finish);
    expect(start).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(start);
    expect(flow.indexOf("initFaceLandmarker()")).toBeGreaterThan(-1);
    expect(flow.indexOf("initPoseLandmarker()")).toBeGreaterThan(-1);
    expect(flow.indexOf("getUserMedia({")).toBeGreaterThan(flow.indexOf("initPoseLandmarker()"));
    expect(flow).toContain('let failureStage: "camera" | "engine" = "engine"');
    expect(flow).toContain('failureStage = "camera"');
  });

  it("separates engine guidance from camera permission recovery", () => {
    expect(webcamPanelSource).toContain('webcamErrorStage === "engine"');
    expect(webcamPanelSource).toContain("동작 인식 엔진 오류");
    expect(webcamPanelSource).toContain("카메라 권한 및 연결 오류");
    expect(webcamPanelSource).toContain('webcamErrorStage !== "engine"');
    expect(poserSource).toContain("useStudioVrmPoserController");
  });
});
