/**
 * 캡처 비율(output.exportAspectRatio)이 문서 모델에 들어오면서, 이미 저장된 장면의 삽입 결과가
 * 조용히 바뀌지 않는지를 고정하는 계약 테스트.
 */

import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_ASPECT_MAX,
  STUDIO_BG3D_CAPTURE_ASPECT_MIN,
  resolveStudioBg3dCaptureFrame,
} from "./studio-bg3d-capture-frame-geometry";
import { resolveStudioBg3dLtCaptureSize } from "./studio-bg3d-lt-capture-size";
import {
  createDefaultStudioBg3dSceneDocument,
  normalizeStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type { StudioBg3dSceneDocument } from "./studio-bg3d-scene-document";

function withOutputAspect(
  document: StudioBg3dSceneDocument,
  exportAspectRatio: unknown,
): unknown {
  return {
    ...document,
    output: { ...document.output, exportAspectRatio },
  };
}

/** 실제 삽입 경로가 쓰는 두 단계(프레임 → 캡처 크기)를 그대로 재현한다. */
function resolveInsertRaster(
  document: StudioBg3dSceneDocument,
  viewportWidth: number,
  viewportHeight: number,
) {
  const frame = resolveStudioBg3dCaptureFrame({
    viewportWidth,
    viewportHeight,
    aspectRatio: document.output.exportAspectRatio ?? null,
  });
  if (!frame) return null;
  return resolveStudioBg3dLtCaptureSize({
    sourceWidth: viewportWidth,
    sourceHeight: viewportHeight,
    aspectRatio: frame.aspectRatio,
    requestedHeight: document.output.exportHeight,
    maxPixels: 8_294_400,
  });
}

describe("Studio BG3D 출력 비율 문서 필드", () => {
  it("기본 문서에는 비율 키가 없다(자동 = 레거시 동작)", () => {
    const document = createDefaultStudioBg3dSceneDocument();
    expect("exportAspectRatio" in document.output).toBe(false);
    expect(document.output.exportAspectRatio).toBeUndefined();
  });

  it("비율 키가 없는 문서는 strict 왕복을 그대로 통과한다", () => {
    const document = createDefaultStudioBg3dSceneDocument();
    const serialized = serializeStudioBg3dSceneDocument(document);
    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain("exportAspectRatio");
    const parsed = parseStudioBg3dSceneDocument(serialized!);
    expect(parsed).not.toBeNull();
    expect(serializeStudioBg3dSceneDocument(parsed)).toBe(serialized);
  });

  it("비율을 고정한 문서도 canonical 왕복이 멱등이다", () => {
    const document = normalizeStudioBg3dSceneDocument(
      withOutputAspect(createDefaultStudioBg3dSceneDocument(), 16 / 9),
    );
    expect(document.output.exportAspectRatio).toBe(16 / 9);
    const serialized = serializeStudioBg3dSceneDocument(document);
    expect(serialized).not.toBeNull();
    const parsed = parseStudioBg3dSceneDocument(serialized!);
    expect(parsed?.output.exportAspectRatio).toBe(16 / 9);
    expect(serializeStudioBg3dSceneDocument(parsed)).toBe(serialized);
  });

  it("손상된 비율은 방어적으로 떨어뜨리고, 범위 밖 값은 계약 범위로 클램프한다", () => {
    const base = createDefaultStudioBg3dSceneDocument();
    for (const corrupt of [null, "16:9", Number.NaN, Number.POSITIVE_INFINITY, 0, -3, {}, []]) {
      const normalized = normalizeStudioBg3dSceneDocument(withOutputAspect(base, corrupt));
      expect("exportAspectRatio" in normalized.output).toBe(false);
    }
    expect(
      normalizeStudioBg3dSceneDocument(withOutputAspect(base, 99)).output.exportAspectRatio,
    ).toBe(STUDIO_BG3D_CAPTURE_ASPECT_MAX);
    expect(
      normalizeStudioBg3dSceneDocument(withOutputAspect(base, 0.01)).output.exportAspectRatio,
    ).toBe(STUDIO_BG3D_CAPTURE_ASPECT_MIN);
    // strict 경계는 손상된 값을 조용히 고치지 않고 문서를 거부한다.
    expect(
      parseStudioBg3dSceneDocument(JSON.stringify(withOutputAspect(base, "16:9"))),
    ).toBeNull();
    expect(parseStudioBg3dSceneDocument(JSON.stringify(withOutputAspect(base, 99)))).toBeNull();
  });

  it("컷 오버라이드를 적용해도 고정 비율이 살아남는다", () => {
    const document = normalizeStudioBg3dSceneDocument(
      withOutputAspect(createDefaultStudioBg3dSceneDocument(), 3 / 4),
    );
    expect(document.output.exportAspectRatio).toBe(3 / 4);
    const serialized = serializeStudioBg3dSceneDocument(document);
    expect(parseStudioBg3dSceneDocument(serialized!)?.output.exportAspectRatio).toBe(3 / 4);
  });
});

describe("삽입 래스터 하위 호환", () => {
  it("비율 키가 없는 문서는 뷰포트마다 예전과 똑같은 캡처 크기를 낸다", () => {
    const legacy = createDefaultStudioBg3dSceneDocument();
    for (const [width, height] of [[1_512, 851], [960, 540], [640, 900], [1_001, 337]] as const) {
      // 예전 코드: 소스 비율에서 직접 파생(aspectRatio 인자 없음).
      const before = resolveStudioBg3dLtCaptureSize({
        sourceWidth: width,
        sourceHeight: height,
        requestedHeight: legacy.output.exportHeight,
        maxPixels: 8_294_400,
      });
      expect(before).not.toBeNull();
      expect(resolveInsertRaster(legacy, width, height)).toEqual(before);
    }
  });

  it("비율을 고정하면 3D 패널 크기가 달라져도 같은 래스터가 나온다", () => {
    const fixed = normalizeStudioBg3dSceneDocument(
      withOutputAspect(createDefaultStudioBg3dSceneDocument(), 16 / 9),
    );
    const rasters = ([[1_512, 851], [960, 540], [640, 900], [1_001, 337]] as const).map(
      ([width, height]) => resolveInsertRaster(fixed, width, height),
    );
    expect(rasters[0]).not.toBeNull();
    for (const raster of rasters) expect(raster).toEqual(rasters[0]);
  });

  it("자동 문서는 패널 크기에 따라 실제로 달라진다(회귀의 원인 자체를 고정)", () => {
    const legacy = createDefaultStudioBg3dSceneDocument();
    expect(resolveInsertRaster(legacy, 1_512, 851)).not.toEqual(
      resolveInsertRaster(legacy, 640, 900),
    );
  });
});
