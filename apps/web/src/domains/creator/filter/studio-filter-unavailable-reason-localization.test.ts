import { describe, expect, it } from "vitest";

import { localizeStudioFilterUnavailableReason } from "./studio-filter-unavailable-reason-localization";

/** 로케일 팩이 붙은 상태를 흉내 낸다 — 프로브 키만 답하면 된다. */
function packT(probeValue: string) {
  return (key: string) =>
    key === "studio.settings.tool.select" ? probeValue : key;
}

/** 팩이 아직 안 붙은 번역기: 무슨 키를 물어도 키를 그대로 돌려준다. */
const missingPackT = (key: string) => key;

const koreanT = packT("선택");
const englishT = packT("Select");
const japaneseT = packT("選択");

describe("filter unavailable reason localization", () => {
  it("keeps the authored Korean when the active pack is Korean", () => {
    const reason = "타임라인 재생을 멈춘 뒤 필터를 적용하세요.";
    expect(localizeStudioFilterUnavailableReason(reason, koreanT)).toBe(reason);
  });

  it("keeps the authored Korean when no locale pack has loaded yet", () => {
    // 팩이 없으면 메뉴의 나머지 라벨도 한국어다 — 사유만 영어로 뒤집으면 짬뽕이 된다.
    const reason = "타임라인 재생을 멈춘 뒤 필터를 적용하세요.";
    expect(localizeStudioFilterUnavailableReason(reason, missingPackT)).toBe(reason);
    expect(localizeStudioFilterUnavailableReason(reason)).toBe(reason);
  });

  it("localizes a session reason on an English pack", () => {
    expect(
      localizeStudioFilterUnavailableReason(
        "마스터 편집에서는 필터를 적용할 이미지 레이어를 선택하세요.",
        englishT,
      ),
    ).toBe("While master editing, select the image layer you want to filter.");
  });

  it("localizes a document preflight reason on an English pack", () => {
    expect(
      localizeStudioFilterUnavailableReason(
        "검토 잠금을 해제한 뒤 현재 페이지에 필터를 적용해 주세요.",
        englishT,
      ),
    ).toBe("Please release the review lock, then filter the current page.");
  });

  it("localizes every sentence of a multi-sentence reason", () => {
    expect(
      localizeStudioFilterUnavailableReason(
        "‘나만 숨기기’ 레이어를 먼저 다시 표시해 주세요. 개인 표시 상태는 공유·저장되는 필터 합성본에 포함하지 않습니다.",
        englishT,
      ),
    ).toBe(
      "Please show the layers you hid with “hide for me only” first. Personal visibility is never baked into a filter composite that is shared or saved.",
    );
  });

  it("localizes an assembled fidelity reason (헤드라인 + 조치 문장들)", () => {
    // studio-raster-edit-preparation.ts fidelityReason() 이 실제로 조립하는 모양.
    const reason =
      "화면에 보이는 그대로 만들 수 없어 아무것도 바꾸지 않았습니다."
      + " 지우개로 지운 자국이 남은 그리기 레이어가 있습니다."
      + " 그 레이어를 먼저 이미지로 병합한 뒤 다시 시도해 주세요.";
    expect(localizeStudioFilterUnavailableReason(reason, englishT)).toBe(
      "The result could not be built exactly as shown on screen, so nothing was changed."
      + " A drawing layer still carries eraser marks."
      + " Please merge that layer into an image first, then try again.",
    );
  });

  it("localizes interpolated reasons without losing the values", () => {
    expect(
      localizeStudioFilterUnavailableReason(
        "잠긴 원본 a · b은(는) 숨길 수 없습니다. 요소 또는 그룹 잠금을 해제한 뒤 다시 시도해 주세요.",
        englishT,
      ),
    ).toBe(
      "Locked sources a · b cannot be hidden."
      + " Please unlock the element or its group, then try again.",
    );
    expect(
      localizeStudioFilterUnavailableReason(
        "현재 페이지는 90000000픽셀로 필터 허용치 40000000픽셀을 넘습니다. 페이지를 나누거나 해상도를 낮춰 주세요.",
        englishT,
      ),
    ).toBe(
      "This page is 90000000 pixels, over the 40000000-pixel filter budget."
      + " Please split the page or lower the resolution.",
    );
  });

  it("sends English to locales that have no translation of their own", () => {
    // 이 저장소의 "미번역 로케일은 영어 pending-translation" 관례.
    expect(
      localizeStudioFilterUnavailableReason("저장이 끝난 뒤 필터를 적용하세요.", japaneseT),
    ).toBe("Wait for the save to finish, then apply the filter.");
  });

  it("returns the authored Korean untouched when any sentence is unknown", () => {
    // 반쪽 번역은 원문보다 나쁘다 — 새 사유가 생겨도 화면이 깨지지 않아야 한다.
    const reason = "저장이 끝난 뒤 필터를 적용하세요. 아직 표에 없는 새 사유 문장입니다.";
    expect(localizeStudioFilterUnavailableReason(reason, englishT)).toBe(reason);
  });

  it("passes null through", () => {
    expect(localizeStudioFilterUnavailableReason(null, englishT)).toBeNull();
  });
});
