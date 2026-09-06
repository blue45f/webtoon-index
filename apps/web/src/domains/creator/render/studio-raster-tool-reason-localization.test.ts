import { describe, expect, it } from "vitest";

import {
  resolveStudioRasterToolAvailability,
  STUDIO_RASTER_TOOL_IDS,
  STUDIO_RASTER_TOOL_SPECS,
} from "./studio-raster-tool-availability";
import {
  localizeStudioRasterToolLabel,
  localizeStudioRasterToolReason,
} from "./studio-raster-tool-reason-localization";

/** 로케일 팩이 붙은 상태를 흉내 낸다 — 프로브 키만 답하면 된다(필터 표 테스트와 같은 방식). */
function packT(probeValue: string) {
  return (key: string) => (key === "studio.settings.tool.select" ? probeValue : key);
}

/** 팩이 아직 안 붙은 번역기: 무슨 키를 물어도 키를 그대로 돌려준다. */
const missingPackT = (key: string) => key;

const koreanT = packT("선택");
const englishT = packT("Select");
const japaneseT = packT("選択");

describe("raster tool reason localization", () => {
  it("keeps the authored Korean on a Korean pack and with no pack at all", () => {
    const reason = "적용할 픽셀 영역을 먼저 선택하세요.";
    expect(localizeStudioRasterToolReason(reason, koreanT)).toBe(reason);
    expect(localizeStudioRasterToolReason(reason, missingPackT)).toBe(reason);
    expect(localizeStudioRasterToolReason(reason)).toBe(reason);
  });

  it("localizes an apply-gate reason on an English pack", () => {
    expect(
      localizeStudioRasterToolReason("자르기 경계를 움직여 남길 영역을 정하세요.", englishT),
    ).toBe("Move the crop bounds to decide what to keep.");
  });

  it("localizes every sentence of an assembled two-sentence reason", () => {
    expect(
      localizeStudioRasterToolReason(
        "선택한 이미지 레이어가 숨겨져 있습니다. 표시한 뒤 픽셀을 편집하세요.",
        englishT,
      ),
    ).toBe("The selected image layer is hidden. Show it, then edit its pixels.");
  });

  it("localizes reasons that interpolate a tool name", () => {
    expect(
      localizeStudioRasterToolReason(
        "현재 선택은 리퀴파이의 픽셀 대상이 아닙니다. 원본 레이어를 유지한 채 표시 화면의 편집용 래스터 복사본을 만들 수 있어요.",
        englishT,
      ),
    ).toBe(
      "The current selection is not a pixel target for Liquify. You can make an editable raster copy of what is on screen while keeping the original layer.",
    );
  });

  it("localizes the pixel-count pattern", () => {
    expect(
      localizeStudioRasterToolReason(
        "채울 수 있는 이미지가 3개입니다. 대상 레이어를 하나 선택하세요.",
        englishT,
      ),
    ).toBe("There are 3 fillable images. Please select a single target layer.");
  });

  it("gives English to a locale that is neither ko nor en (pending translation)", () => {
    expect(localizeStudioRasterToolReason("편집할 표시 콘텐츠가 없습니다.", japaneseT)).toBe(
      "There is no visible content to edit.",
    );
  });

  it("keeps the whole authored Korean when one sentence is missing from the table", () => {
    // 반만 번역된 사유는 한국어 원문보다 나쁘다 — 하나라도 모르면 통째로 원문이어야 한다.
    const reason = "적용할 픽셀 영역을 먼저 선택하세요. 표에 아직 없는 새 문장입니다.";
    expect(localizeStudioRasterToolReason(reason, englishT)).toBe(reason);
  });

  it("keeps the whole reason when the interpolated tool name is unknown", () => {
    const reason = "현재 선택은 새도구의 픽셀 대상이 아닙니다.";
    expect(localizeStudioRasterToolReason(reason, englishT)).toBe(reason);
  });

  it("passes null and empty reasons through untouched", () => {
    expect(localizeStudioRasterToolReason(null, englishT)).toBeNull();
    expect(localizeStudioRasterToolReason("", englishT)).toBe("");
  });
});

describe("raster tool label localization", () => {
  it("localizes recovery action labels, status badges and target names", () => {
    expect(localizeStudioRasterToolLabel("편집용 래스터 복사본 만들기", englishT)).toBe(
      "Make an editable raster copy",
    );
    expect(localizeStudioRasterToolLabel("조치 필요", englishT)).toBe("Action needed");
    expect(localizeStudioRasterToolLabel("현재 페이지 합성본", englishT)).toBe(
      "Current page composite",
    );
  });

  it("keeps Korean labels on a Korean pack", () => {
    expect(localizeStudioRasterToolLabel("조치 필요", koreanT)).toBe("조치 필요");
  });

  it("returns unknown labels unchanged instead of blanking them", () => {
    expect(localizeStudioRasterToolLabel("표에 없는 라벨", englishT)).toBe("표에 없는 라벨");
  });

  it("covers every canonical tool label", () => {
    // 도구 이름은 사유 문장에 끼워 넣어진다 — 하나라도 빠지면 그 문장이 통째로 한국어로 남는다.
    for (const id of STUDIO_RASTER_TOOL_IDS) {
      const label = STUDIO_RASTER_TOOL_SPECS[id].label;
      expect(
        localizeStudioRasterToolLabel(label, englishT),
        `${id} (${label}) 이 라벨 표에 없습니다`,
      ).not.toBe(label);
    }
  });
});

describe("coverage against the live availability matrix", () => {
  /** 실제 게이트가 만들어 내는 사유·라벨이 표에 실려 있는지 본다(문자열을 손으로 베끼지 않는다). */
  const contexts = [
    { label: "빈 페이지", context: {} },
    { label: "저장 중", context: { busy: true } },
    { label: "숨긴 이미지", context: { selectedType: "image", selectedHidden: true } },
    {
      label: "잠긴 이미지",
      context: {
        selectedType: "image",
        selectedMutationBlockedReason: "선택한 이미지 레이어가 숨겨져 있습니다.",
      },
    },
    {
      label: "애니메이션 이미지",
      context: { selectedType: "image", selectedAnimated: true },
    },
    {
      label: "재생 중",
      context: { selectedType: "image", timelinePlaying: true },
    },
    { label: "이미지 1개", context: { visibleEditableRasterCount: 1 } },
    { label: "이미지 2개", context: { visibleEditableRasterCount: 2 } },
    { label: "벡터 선화만", context: { visibleVectorDrawCount: 3 } },
    { label: "합성 가능", context: { exactRenderableVisibleCount: 2 } },
    { label: "지원 불가 합성", context: { unsupportedVisibleCount: 1 } },
    { label: "전부 숨김", context: { hiddenContentCount: 4 } },
  ] as const;

  it("localizes every reason and action label the matrix can produce", () => {
    const untranslatedReasons: string[] = [];
    const untranslatedLabels: string[] = [];
    for (const { context } of contexts) {
      for (const id of STUDIO_RASTER_TOOL_IDS) {
        const availability = resolveStudioRasterToolAvailability(id, context);
        for (const gate of [availability.entry, availability.apply]) {
          if (gate.reason && localizeStudioRasterToolReason(gate.reason, englishT) === gate.reason) {
            untranslatedReasons.push(gate.reason);
          }
          if (
            gate.action &&
            localizeStudioRasterToolLabel(gate.action.label, englishT) === gate.action.label
          ) {
            untranslatedLabels.push(gate.action.label);
          }
        }
      }
    }
    expect([...new Set(untranslatedReasons)]).toEqual([]);
    expect([...new Set(untranslatedLabels)]).toEqual([]);
  });
});
