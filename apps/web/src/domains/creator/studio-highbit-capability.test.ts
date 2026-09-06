import { describe, expect, it } from "vitest";

import {
  probeStudioHighBitCanvasDisplayP3,
  probeStudioHighBitEnvironment,
  resolveStudioHighBitCapability,
  type StudioHighBitCanvasLike,
} from "./studio-highbit-capability";

function canvasStub(appliedColorSpace: string | null): StudioHighBitCanvasLike {
  return {
    getContext: () => ({
      getContextAttributes: () =>
        appliedColorSpace === null ? null : { colorSpace: appliedColorSpace },
    }),
  };
}

describe("캔버스 Display P3 프로브", () => {
  it("옵션을 실제로 적용한 경우에만 참이다", () => {
    expect(probeStudioHighBitCanvasDisplayP3(() => canvasStub("display-p3"))).toBe(true);
    // 옵션을 조용히 무시하고 sRGB 를 주는 브라우저 — 반드시 거짓이어야 한다.
    expect(probeStudioHighBitCanvasDisplayP3(() => canvasStub("srgb"))).toBe(false);
    expect(probeStudioHighBitCanvasDisplayP3(() => canvasStub(null))).toBe(false);
    expect(probeStudioHighBitCanvasDisplayP3(() => null)).toBe(false);
  });

  it("getContext 가 던져도 예외를 밖으로 흘리지 않는다", () => {
    expect(probeStudioHighBitCanvasDisplayP3(() => ({
      getContext: () => {
        throw new Error("no 2d");
      },
    }))).toBe(false);
  });

  it("getContextAttributes 가 없는 구형 컨텍스트는 미지원으로 본다", () => {
    expect(probeStudioHighBitCanvasDisplayP3(() => ({ getContext: () => ({}) }))).toBe(false);
  });
});

describe("환경 프로브", () => {
  it("전역이 비어 있어도 안전하게 미지원을 보고한다", () => {
    const probe = probeStudioHighBitEnvironment({});
    expect(probe.canvasDisplayP3).toBe(false);
    expect(probe.displayP3Gamut).toBe(false);
    expect(probe.imageDataDisplayP3).toBe(false);
    expect(probe.deviceMemoryGb).toBeUndefined();
  });

  it("P3 지원 환경을 모두 수집한다", () => {
    class FakeImageData {
      colorSpace: string;
      constructor(_width: number, _height: number, settings?: { colorSpace?: string }) {
        this.colorSpace = settings?.colorSpace ?? "srgb";
      }
    }
    const probe = probeStudioHighBitEnvironment({
      document: { createElement: () => canvasStub("display-p3") },
      matchMedia: (query) => ({ matches: query === "(color-gamut: p3)" }),
      navigator: { deviceMemory: 16 },
      ImageData: FakeImageData,
    });
    expect(probe).toEqual({
      canvasDisplayP3: true,
      displayP3Gamut: true,
      imageDataDisplayP3: true,
      deviceMemoryGb: 16,
    });
  });

  it("matchMedia/ImageData 예외를 흡수한다", () => {
    const probe = probeStudioHighBitEnvironment({
      matchMedia: () => {
        throw new Error("bad query");
      },
      ImageData: class {
        constructor() {
          throw new Error("unsupported colorSpace");
        }
      },
    });
    expect(probe.displayP3Gamut).toBe(false);
    expect(probe.imageDataDisplayP3).toBe(false);
  });
});

describe("능력 → 정책", () => {
  it("캔버스와 디스플레이가 모두 P3 면 와이드 개멋으로 작업한다", () => {
    const plan = resolveStudioHighBitCapability({
      canvasDisplayP3: true,
      displayP3Gamut: true,
      deviceMemoryGb: 16,
    });
    expect(plan.wideGamut).toBe(true);
    expect(plan.workingGamut).toBe("display-p3");
    expect(plan.outputGamut).toBe("display-p3");
    expect(plan.canvasColorSpace).toBe("display-p3");
    expect(plan.gamutClip).toBe("clamp");
    expect(plan.storage).toBe("float32");
    expect(plan.dither).toBe("blue-noise");
  });

  it("한쪽만 지원하면 sRGB 로 강등하고 근거를 남긴다", () => {
    const canvasOnly = resolveStudioHighBitCapability({ canvasDisplayP3: true });
    expect(canvasOnly.wideGamut).toBe(false);
    expect(canvasOnly.workingGamut).toBe("srgb");
    expect(canvasOnly.notes.join(" ")).toContain("디스플레이가 sRGB");

    const displayOnly = resolveStudioHighBitCapability({ displayP3Gamut: true });
    expect(displayOnly.wideGamut).toBe(false);
    expect(displayOnly.notes.join(" ")).toContain("캔버스 색공간 옵션");
  });

  it("sRGB 강등 시 개멋 밖 색을 채도 축소로 접는다", () => {
    expect(resolveStudioHighBitCapability({}).gamutClip).toBe("desaturate");
  });

  it("메모리와 저전력 힌트가 저장 포맷·디더를 바꾼다", () => {
    expect(resolveStudioHighBitCapability({ deviceMemoryGb: 4 }).storage).toBe("uint16");
    expect(resolveStudioHighBitCapability({ deviceMemoryGb: 8 }).storage).toBe("float32");
    expect(resolveStudioHighBitCapability({}).storage).toBe("uint16");
    expect(resolveStudioHighBitCapability({ lowPowerHint: true }).dither).toBe("ordered");
  });

  it("ImageData 가 P3 를 못 쓰면 경고를 덧붙인다", () => {
    const plan = resolveStudioHighBitCapability({
      canvasDisplayP3: true,
      displayP3Gamut: true,
      imageDataDisplayP3: false,
    });
    expect(plan.notes.join(" ")).toContain("ImageData");
  });

  it("같은 입력이면 같은 계획이다(순수 함수)", () => {
    const input = { canvasDisplayP3: true, displayP3Gamut: true, deviceMemoryGb: 8 } as const;
    expect(resolveStudioHighBitCapability(input)).toEqual(resolveStudioHighBitCapability(input));
  });
});
