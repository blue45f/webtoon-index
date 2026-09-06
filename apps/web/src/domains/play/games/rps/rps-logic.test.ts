import { describe, expect, it } from "vitest";

import { classifyGesture, stabilizeGesture } from "./rps-logic";

import type { FingerEulerMap } from "@/src/domains/creator/vrm/studio-vrm-hand-solver";

// 손가락별 컬 합(rad)을 주면 3마디로 분배한 FingerEulerMap 생성(우측 손).
function curls(totals: { index: number; middle: number; ring: number; little: number }): FingerEulerMap {
  const map: Record<string, readonly [number, number, number]> = {};
  const set = (finger: string, total: number) => {
    for (const seg of ["Proximal", "Intermediate", "Distal"]) {
      map[`right${finger}${seg}`] = [0, 0, total / 3];
    }
  };
  set("Index", totals.index);
  set("Middle", totals.middle);
  set("Ring", totals.ring);
  set("Little", totals.little);
  return map;
}

const EXT = 0.3; // 편 손가락
const CURL = 2.7; // 접은 손가락

// 순수 엔진(beats/resolveRound/pickAiHand/scoreReducer/matchOver/mukjjippaStep)은
// @toonspectrum/play-core 의 rps-engine.test.ts 가 검증한다. 여기서는 MediaPipe
// FingerEulerMap 에 종속된 웹 전용 제스처 분류부만 테스트한다.
describe("rps-logic (gesture classification)", () => {
  it("classifyGesture: 보/바위/가위를 컬에서 분류", () => {
    expect(classifyGesture(curls({ index: EXT, middle: EXT, ring: EXT, little: EXT }), "right")).toBe("paper");
    expect(classifyGesture(curls({ index: CURL, middle: CURL, ring: CURL, little: CURL }), "right")).toBe("rock");
    expect(classifyGesture(curls({ index: EXT, middle: EXT, ring: CURL, little: CURL }), "right")).toBe("scissors");
  });

  it("classifyGesture: 애매한 자세는 null", () => {
    // 검지만 폄(가리키기) → 어떤 패도 아님
    expect(classifyGesture(curls({ index: EXT, middle: CURL, ring: CURL, little: CURL }), "right")).toBeNull();
  });

  it("stabilizeGesture: N프레임 동일할 때만 확정", () => {
    expect(stabilizeGesture(["rock", "rock", "rock", "rock", "rock"], 5)).toBe("rock");
    expect(stabilizeGesture(["rock", "paper", "rock", "rock", "rock"], 5)).toBeNull();
    expect(stabilizeGesture(["rock", "rock"], 5)).toBeNull(); // 표본 부족
  });
});
