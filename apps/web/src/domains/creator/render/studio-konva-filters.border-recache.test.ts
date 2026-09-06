/**
 * 원격(협업) borderEffect 변경 → Konva 필터 recache 회귀 검증.
 *
 * 질문(어드미션 슬라이스): reference envelope 하이드레이션은 props를 제네릭하게 복사한다 —
 * CRDT envelope로 도착한 원격 borderEffect 변경(기존 이미지 요소에 새 값)이 협업자
 * 캔버스에서 실제로 경계 효과 필터 recache와 cachePad 갱신을 유발하는가?
 *
 * 배선 사실관계(이 테스트가 고정하는 계약):
 * - 송신: `studioElementToCrdtSceneElement`가 STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS
 *   허용 목록으로 borderEffect를 reference envelope props에 싣고, 장면 스키마가
 *   `StudioWorkAssetBorderEffectSchema`로 fail-closed 검증한다.
 * - 수신: `studioCrdtElementToSceneElement`가 `{...referenceSource, ...referenceProps}`로
 *   병합하므로 envelope에 실린 새 값이 로컬 stale 값을 덮는다.
 * - 렌더: StudioKonvaImageNode는 `imageFilterCacheKey(el)`(borderEffect 포함)과
 *   `hasActiveImageFilters(el)`(경량)를 recache effect deps로 쓰고, `buildImageFilters`의
 *   cachePad가 Konva `cache({offset})` 패딩이 된다.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
  type StudioLayerBorderEffectSettings,
} from "../layer/studio-layer-border-effect";
import {
  studioCrdtElementToSceneElement,
  studioElementToCrdtSceneElement,
} from "../live/studio-crdt-page-bridge";

import {
  hasActiveImageFilters as hasLightweightActiveImageFilters,
  imageFilterCacheKey,
} from "./studio-konva-filter-fields";
import {
  buildImageFilters,
  hasActiveImageFilters,
  registerStudioKonvaFilters,
  type ImageFilterFields,
  type KonvaLike,
} from "./studio-konva-filters";

import type { StudioCrdtSceneElementRecord } from "../live/studio-crdt-document";

import { studioWorkAssetSourceUri } from "@/shared/lib/studio-work-asset-contract";

const PAGE_ID = "page-1";
const ASSET_ID = "img-1";
const ASSET_SRC = studioWorkAssetSourceUri({ assetId: ASSET_ID, elementType: "image" });

const ACTIVE_BORDER: StudioLayerBorderEffectSettings = {
  enabled: true,
  thickness: 3,
  color: "#ff0000",
  type: "outer",
  antiAliased: false,
};

/** 승인된(work-asset URI src) 이미지 참조 요소 — envelope 인코딩 대상 형태. */
function imageElement(
  borderEffect?: StudioLayerBorderEffectSettings,
): Record<string, unknown> & { id: string; type: string } {
  return {
    id: ASSET_ID,
    type: "image",
    src: ASSET_SRC,
    x: 10,
    y: 20,
    width: 120,
    height: 90,
    rotation: 0,
    ...(borderEffect !== undefined ? { borderEffect } : {}),
  };
}

/**
 * 원격 저자의 요소를 envelope로 인코딩(스키마 검증 포함)한 뒤, 협업자의 현재(stale)
 * 요소를 referenceSource로 삼아 하이드레이션한다 — 페이지 브리지 수렴 경로의 요소 단위 축약.
 */
function roundTripFromRemote(
  remote: ReturnType<typeof imageElement>,
  staleLocal: ReturnType<typeof imageElement>,
): ImageFilterFields {
  const record: StudioCrdtSceneElementRecord = {
    ...studioElementToCrdtSceneElement(PAGE_ID, remote),
    deleted: false,
    orderIndex: 0,
  };
  return studioCrdtElementToSceneElement(record, staleLocal) as unknown as ImageFilterFields;
}

function fakeKonva(): KonvaLike {
  return {
    Filters: {
      Blur() {},
      Brighten() {},
      Contrast() {},
      Grayscale() {},
      Sepia() {},
      HSL() {},
      Pixelate() {},
      Invert() {},
    },
  };
}

describe("원격 borderEffect 변경 — reference envelope 왕복 recache", () => {
  it("원격 활성화가 envelope 왕복 뒤 imageFilterCacheKey를 바꾼다(유지된 노드 recache)", () => {
    const staleLocal = imageElement(); // 협업자가 현재 렌더 중인 요소(경계 효과 없음)
    const hydrated = roundTripFromRemote(imageElement(ACTIVE_BORDER), staleLocal);

    // envelope 스키마 왕복이 값을 훼손하지 않는다(antiAliased:false 포함).
    expect(hydrated.borderEffect).toEqual(ACTIVE_BORDER);
    // 키가 바뀌어야 StudioKonvaImageNode의 recache effect가 다시 돈다.
    expect(imageFilterCacheKey(hydrated))
      .not.toBe(imageFilterCacheKey(staleLocal as unknown as ImageFilterFields));
    // 같은 envelope는 같은 키 — 불필요한 재캐시 없음(결정적 직렬화).
    expect(imageFilterCacheKey(roundTripFromRemote(imageElement(ACTIVE_BORDER), staleLocal)))
      .toBe(imageFilterCacheKey(hydrated));
  });

  it("원격 활성화·비활성화가 경량/정규 hasActiveImageFilters를 함께 뒤집는다(패리티)", () => {
    const staleLocal = imageElement();
    expect(hasLightweightActiveImageFilters(staleLocal as unknown as ImageFilterFields)).toBe(false);
    expect(hasActiveImageFilters(staleLocal as unknown as ImageFilterFields)).toBe(false);

    const enabledRemote = roundTripFromRemote(imageElement(ACTIVE_BORDER), staleLocal);
    expect(hasLightweightActiveImageFilters(enabledRemote)).toBe(true);
    expect(hasActiveImageFilters(enabledRemote)).toBe(true);

    // 패널의 끄기는 키 삭제가 아니라 enabled:false 전체 객체로 전파된다 — 끈 상태도
    // envelope에 실려 협업자 쪽 판정이 양쪽 변형 모두 꺼진다.
    const disabledRemote = roundTripFromRemote(
      imageElement({ ...ACTIVE_BORDER, enabled: false }),
      imageElement(ACTIVE_BORDER),
    );
    expect(hasLightweightActiveImageFilters(disabledRemote)).toBe(false);
    expect(hasActiveImageFilters(disabledRemote)).toBe(false);
    // 끄기도 키를 바꿔야 캐시가 해제된다.
    expect(imageFilterCacheKey(disabledRemote))
      .not.toBe(imageFilterCacheKey(imageElement(ACTIVE_BORDER) as unknown as ImageFilterFields));
  });

  it("원격 활성화가 cachePad를 키운다 — outer/center 굵기+1, inner 0", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const staleLocal = imageElement();

    for (const [type, expectedPad] of [
      ["outer", 4],
      ["center", 4],
      ["inner", 0],
    ] as const) {
      const hydrated = roundTripFromRemote(
        imageElement({ ...ACTIVE_BORDER, type }),
        staleLocal,
      );
      const built = buildImageFilters(hydrated, konva);
      expect(built.filters, type).toHaveLength(1);
      expect(built.attrs.layerBorderType, type).toBe(type);
      expect(built.cachePad, type).toBe(expectedPad);
    }
  });

  it("원격 파라미터 변경(굵기/종류)도 키와 cachePad를 갱신한다", () => {
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    const staleWithBorder = imageElement(ACTIVE_BORDER); // outer, 3px → pad 4
    const staleKey = imageFilterCacheKey(staleWithBorder as unknown as ImageFilterFields);

    const thicker = roundTripFromRemote(
      imageElement({ ...ACTIVE_BORDER, thickness: 5 }),
      staleWithBorder,
    );
    expect(imageFilterCacheKey(thicker)).not.toBe(staleKey);
    expect(buildImageFilters(thicker, konva).cachePad).toBe(6);

    const toInner = roundTripFromRemote(
      imageElement({ ...ACTIVE_BORDER, type: "inner" }),
      staleWithBorder,
    );
    expect(imageFilterCacheKey(toInner)).not.toBe(staleKey);
    // pad 축소(4→0)도 키 변경으로 함께 반영된다 — 잘린 캐시/과잉 패딩이 남지 않는다.
    expect(buildImageFilters(toInner, konva).cachePad).toBe(0);
  });

  it("기본값(꺼짐) borderEffect envelope는 필터·캐시를 켜지 않는다(fail-closed)", () => {
    const hydrated = roundTripFromRemote(
      imageElement({ ...DEFAULT_STUDIO_LAYER_BORDER_EFFECT }),
      imageElement(),
    );
    expect(hasLightweightActiveImageFilters(hydrated)).toBe(false);
    expect(hasActiveImageFilters(hydrated)).toBe(false);
    const konva = fakeKonva();
    registerStudioKonvaFilters(konva);
    expect(buildImageFilters(hydrated, konva).filters).toHaveLength(0);
    expect(buildImageFilters(hydrated, konva).cachePad).toBe(0);
  });

  /**
   * envelope에서 borderEffect *키 자체가 사라진* 경우(원격 제거가 publisher unset으로
   * 전파되거나, 동시 편집 LWW로 이전 payload가 이기거나, 히스토리 undo가 키 없던 payload를
   * 복원할 때) — `studioCrdtElementToSceneElement`의 reference 분기가 비-토폴로지
   * work-asset 참조에 대해 envelope props에 없는 허용 목록 편집 키
   * (STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS)를 병합 결과에서 삭제한다. stale 로컬 값이
   * 지워지고 imageFilterCacheKey가 바뀌어 recache가 돌며, 새로 합류한 피어(원본에
   * borderEffect 없음)와 기존 피어의 화면이 수렴한다.
   */
  it("원격 payload에서 키가 제거된 borderEffect는 stale 값을 지운다", () => {
    const staleWithBorder = imageElement(ACTIVE_BORDER);
    const hydrated = roundTripFromRemote(imageElement(), staleWithBorder);
    // envelope에 없는 borderEffect는 제거되고 키가 바뀌어 recache가 돈다.
    expect(hydrated.borderEffect).toBeUndefined();
    expect(imageFilterCacheKey(hydrated))
      .not.toBe(imageFilterCacheKey(staleWithBorder as unknown as ImageFilterFields));
    // 제거 뒤에는 양쪽 활성 판정도 함께 꺼진다 — 유지된 노드의 캐시가 해제된다.
    expect(hasLightweightActiveImageFilters(hydrated)).toBe(false);
    expect(hasActiveImageFilters(hydrated)).toBe(false);
  });
});
