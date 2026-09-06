/**
 * 필터 "적용 불가" 사유 문장의 ko → en 표.
 *
 * 왜 로케일 팩이 아니라 모듈 내 표인가
 * -----------------------------------
 * `public/i18n/studio/*.json` 75개 팩은 **키 개수가 서로 같아야 한다**는 계약이 있다
 * (`studio-i18n-loader.test.ts` — 각 팩 정확히 1,297키). 즉 ko/en 두 팩에만 키를 넣을 수
 * 없고, 사유 하나를 옮기려면 75개 파일을 전부 고쳐야 한다. 그래서 이 저장소는 이미
 * "모듈 내 ko/en 표 + 로케일 프로브" 관례를 쓴다:
 *   - `studio-help-menu-items.ts` (Help 그룹 라벨, `LABELS.ko` / `LABELS.en`)
 *   - `studio-rail-tool-localization.ts` (레일 셸 문구, `STUDIO_RAIL_SHELL_EN`)
 * 이 모듈은 같은 관례를 필터 사유에 적용한 것이다. 팩이 이 문장들을 싣는 날 호출부를
 * `localizeText` 로 바꾸면 표는 통째로 사라진다.
 *
 * 왜 문장 단위인가
 * ----------------
 * 사유는 한 문장이 아니라 **조립된다**. `studio-raster-edit-preparation.ts` 의
 * `fidelityReason()` 은 "화면에 보이는 그대로 만들 수 없어…" 라는 머리말 뒤에 막힌 이유별
 * 조치 문장을 최대 2개 이어 붙인다 — 조합 수가 곱으로 늘어 통문장 표로는 감당이 안 된다.
 * 그래서 표는 **문장**을 담고, 조립된 사유는 문장으로 쪼개 각각 옮긴다.
 *
 * 왜 "하나라도 모르면 통째로 원문"인가
 * ------------------------------------
 * 반만 번역된 사유("Stop timeline playback. 지금은 선택 이미지 필터를 사용해 주세요.")는
 * 한국어 원문보다 나쁘다. 그래서 문장 하나라도 표에 없으면 **아무것도 바꾸지 않고** 저자형
 * 한국어를 그대로 돌려준다. 새 사유가 생기면 영어가 안 나올 뿐, 깨진 화면은 안 나온다.
 */

/** 사유를 만들어 낸 모듈이 아니라 화면이 쓰는 번역기 시그니처(로케일 팩 조회). */
export type StudioFilterReasonTranslate = (key: string) => string;

/**
 * 스튜디오 로케일 팩이 실제로 붙었는지 확인하는 탐침 — `studio-rail-tool-localization.ts` 의
 * `STUDIO_LOCALE_PROBE_KEY` 와 같은 키를 쓴다. 이 키는 정적 `DICT` 에 없고 런타임 스튜디오
 * 팩에만 있어서, 팩이 아직 안 붙었으면 번역기가 키를 그대로 되돌려준다.
 */
const STUDIO_LOCALE_PROBE_KEY = "studio.settings.tool.select";

/** 팩이 붙었을 때 위 프로브 키의 한국어 값. Help 그룹이 쓰는 "값 비교" 프로브와 같은 방식. */
const STUDIO_LOCALE_PROBE_KOREAN_VALUE = "선택";

function isMissingTranslation(value: string, id: string): boolean {
  return value === id || value.startsWith("studio.");
}

/**
 * 영어로 바꿔도 되는 상태인가. 두 조건을 모두 만족해야 한다.
 *  1. 팩이 붙어 있을 것 — 안 붙었으면 메뉴의 나머지 라벨이 한국어라, 사유만 영어면 짬뽕이 된다.
 *  2. 그 팩이 한국어가 아닐 것 — ko 는 저자형 원문이 정본이다.
 * ko 도 en 도 아닌 로케일(ja·zh 등)은 영어를 받는다. 이 저장소가 이미 쓰는
 * "미번역 로케일은 영어 pending-translation" 관례와 같다.
 */
function shouldLocalizeToEnglish(t: StudioFilterReasonTranslate | undefined): boolean {
  if (!t) return false;
  const probe = t(STUDIO_LOCALE_PROBE_KEY);
  if (isMissingTranslation(probe, STUDIO_LOCALE_PROBE_KEY)) return false;
  return probe !== STUDIO_LOCALE_PROBE_KOREAN_VALUE;
}

/**
 * 저자형 한국어 문장 → 영어. 키는 **문장 하나**다(마침표 포함).
 *
 * 출처 표기:
 *  - `session:`  StudioPage `studioFilterUnavailableReason` 의 세션 사유(타임라인·저장·잠금 등)
 *  - `document:` `studio-raster-edit-preparation.ts` 의 문서 preflight 사유
 */
const STUDIO_FILTER_REASON_EN: Readonly<Record<string, string>> = {
  // session: StudioPage.tsx studioFilterUnavailableReason
  "타임라인 재생을 멈춘 뒤 필터를 적용하세요.":
    "Stop timeline playback, then apply the filter.",
  "타임랩스 캡처가 끝난 뒤 필터를 적용하세요.":
    "Wait for the timelapse capture to finish, then apply the filter.",
  "저장이 끝난 뒤 필터를 적용하세요.":
    "Wait for the save to finish, then apply the filter.",
  "검토 잠금을 해제한 뒤 필터를 적용하세요.":
    "Release the review lock, then apply the filter.",
  "공동 작업 문서의 페이지 합성 필터는 준비 중입니다.":
    "Page-composite filters are not ready yet on shared documents.",
  "지금은 이미지 레이어를 선택해 필터를 적용하세요.":
    "For now, select an image layer and filter that instead.",
  "마스터 편집에서는 필터를 적용할 이미지 레이어를 선택하세요.":
    "While master editing, select the image layer you want to filter.",
  "이미지와 상위 그룹의 잠금을 해제한 뒤 필터를 적용하세요.":
    "Unlock the image and its parent groups, then apply the filter.",
  "애니메이션 이미지는 정적 프레임으로 만든 뒤 필터를 적용하세요.":
    "Turn the animated image into a static frame, then apply the filter.",
  "숨긴 이미지 레이어를 다시 표시한 뒤 필터를 적용하세요.":
    "Show the hidden image layer again, then apply the filter.",

  // document: createStudioEditablePageRasterContext — documentMutationBlockedReason
  "공동 작업 문서에서는 편집용 래스터 복사본 동기화를 준비 중이에요.":
    "Syncing an editable raster copy on shared documents is still in progress.",
  "개인 문서에서 픽셀 선택을 사용해 주세요.":
    "Please use pixel selection in a personal document.",
  "공동 작업 문서의 페이지 합성 필터는 모든 참여자에게 동일한 픽셀 결과를 전달할 수 있도록 준비 중이에요.":
    "Page-composite filters on shared documents are still being prepared so every collaborator gets identical pixels.",
  "지금은 선택 이미지 필터를 사용해 주세요.":
    "For now, please use the selected-image filter.",
  "‘나만 숨기기’ 레이어를 먼저 다시 표시해 주세요.":
    "Please show the layers you hid with “hide for me only” first.",
  "개인 표시 상태는 공유·저장되는 필터 합성본에 포함하지 않습니다.":
    "Personal visibility is never baked into a filter composite that is shared or saved.",
  "마스터 편집을 끝낸 뒤 현재 페이지 합성 필터를 사용할 수 있어요.":
    "Finish master editing to use the current-page composite filter.",
  "검토 잠금을 해제한 뒤 현재 페이지에 필터를 적용해 주세요.":
    "Please release the review lock, then filter the current page.",
  "타임라인 재생을 멈춘 뒤 현재 프레임을 기준으로 필터를 적용해 주세요.":
    "Please stop timeline playback, then filter based on the current frame.",
  "애니메이션 레이어는 현재 프레임의 정적 복사본을 만든 뒤 페이지 필터에 포함할 수 있어요.":
    "Animated layers join a page filter once you make a static copy of the current frame.",
  "저장·내보내기·타임랩스 캡처가 끝난 뒤 현재 페이지에 필터를 적용해 주세요.":
    "Please filter the current page after the save, export, or timelapse capture finishes.",

  // document: preflightStudioEditableRasterCopy / finalizeStudioEditableRasterCopyPlan
  "편집용 복사본을 연결할 페이지를 찾지 못했습니다.":
    "Could not find the page to attach the editable copy to.",
  "페이지 크기가 올바르지 않습니다. 양수 정수 해상도로 조정해 주세요.":
    "The page size is invalid. Please use a positive whole-number resolution.",
  "페이지를 나누거나 해상도를 낮춰 주세요.":
    "Please split the page or lower the resolution.",
  "표시 상태와 대상을 다시 확인해 주세요.":
    "Please check the visibility and the targets again.",
  "요소 또는 그룹 잠금을 해제한 뒤 다시 시도해 주세요.":
    "Please unlock the element or its group, then try again.",
  "픽셀 선택용 복사본으로 만들 표시 요소가 없습니다.":
    "There is no visible element to copy for a pixel selection.",
  "완전 투명·숨김 레이어가 아닌 선이나 객체를 먼저 추가해 주세요.":
    "Please add a stroke or object that is neither fully transparent nor hidden.",
  "편집용 복사본으로 만들 표시 레이어가 없습니다.":
    "There is no visible layer to make an editable copy from.",
  "표시 레이어 데이터를 안전하게 읽지 못해 편집용 복사본을 만들지 않았습니다.":
    "The visible layer data could not be read safely, so no editable copy was made.",
  "표시 레이어 데이터가 안전 처리 한도를 넘었습니다.":
    "The visible layer data exceeds the safe processing budget.",
  "합성된 벡터 데이터가 안전 처리 한도를 넘었습니다.":
    "The composited vector data exceeds the safe processing budget.",
  "페이지를 나누거나 일부 레이어를 먼저 병합해 주세요.":
    "Please split the page or merge some layers first.",
  "편집용 래스터를 준비하는 동안 페이지 내용이나 잠금 상태가 바뀌었습니다.":
    "The page content or lock state changed while the editable raster was being prepared.",
  "최신 화면에서 다시 시도해 주세요.":
    "Please try again from the current view.",
  "래스터 합성 결과가 올바른 PNG가 아니어서 원본을 변경하지 않았습니다.":
    "The raster composite was not a valid PNG, so the original was left untouched.",
  "필터 합성 레이어가 현재 페이지와 일치하지 않아 원본을 변경하지 않았습니다.":
    "The filter composite layer does not match the current page, so the original was left untouched.",

  // document: fidelityReason 머리말 + FIDELITY_ACTIONS / FIDELITY_FALLBACK_ACTION
  "화면에 보이는 그대로 만들 수 없어 아무것도 바꾸지 않았습니다.":
    "The result could not be built exactly as shown on screen, so nothing was changed.",
  "말풍선·글상자의 글이 상자보다 길어 자동으로 줄이 바뀝니다.":
    "Text in a bubble or text box is longer than its box, so lines wrap automatically.",
  "상자를 조금 넓히거나 원하는 자리에서 엔터로 줄을 나눈 뒤 다시 시도해 주세요.":
    "Please widen the box a little, or break the lines yourself with Enter, then try again.",
  "지우개로 지운 자국이 남은 그리기 레이어가 있습니다.":
    "A drawing layer still carries eraser marks.",
  "그 레이어를 먼저 이미지로 병합한 뒤 다시 시도해 주세요.":
    "Please merge that layer into an image first, then try again.",
  "세로쓰기 안의 영문·숫자 구간은 줄 나눔이 화면과 조금 달라질 수 있습니다.":
    "Latin and numeric runs inside vertical text can break lines slightly differently than on screen.",
  "해당 텍스트를 가로쓰기로 바꾸거나 이미지로 병합한 뒤 다시 시도해 주세요.":
    "Please switch that text to horizontal writing or merge it into an image, then try again.",
  "인터넷 주소로 연결된 이미지가 있습니다.":
    "An image is linked by internet address.",
  "그 이미지를 작업 파일에 넣어 두거나(다시 올리기) 잠시 숨긴 뒤 다시 시도해 주세요.":
    "Please embed that image in the document (re-upload it) or hide it for now, then try again.",
  "혼합 모드나 아래 레이어로 자르기가 걸린 레이어가 있습니다.":
    "A layer uses a blend mode or clips to the layer below.",
  "그 레이어를 먼저 아래 레이어와 병합한 뒤 다시 시도해 주세요.":
    "Please merge that layer with the one below it first, then try again.",
  "이미 색보정이 걸려 있는 이미지 레이어가 있습니다.":
    "An image layer already has a color adjustment applied.",
  "그 보정을 레이어에 먼저 적용(병합)한 뒤 다시 시도해 주세요.":
    "Please apply (merge) that adjustment into the layer first, then try again.",
  "레이어 구조가 어긋난 요소가 있습니다.":
    "An element has an inconsistent layer structure.",
  "문제 레이어를 그룹에서 꺼내거나 지운 뒤 다시 시도해 주세요.":
    "Please move the offending layer out of its group or delete it, then try again.",
  "화면과 똑같이 합칠 수 없는 레이어가 있습니다.":
    "A layer cannot be flattened exactly as shown on screen.",

  // 필터 메뉴의 일반 문구(구체적 사유를 못 구했을 때) — studio-main-menu-items-filter.ts
  "현재 편집 상태에서는 필터를 적용할 수 없습니다.":
    "Filters cannot be applied in the current editing state.",
};

/**
 * 값이 끼어드는 문장(요소 id·픽셀 수·바이트 한도)은 통문장 표에 못 담는다 — 패턴으로 옮긴다.
 * 순서대로 첫 일치를 쓴다.
 */
const STUDIO_FILTER_REASON_PATTERNS: readonly {
  readonly match: RegExp;
  readonly en: (groups: RegExpMatchArray) => string;
}[] = [
  {
    match: /^현재 페이지는 (.+?)픽셀로 필터 허용치 (.+?)픽셀을 넘습니다\.$/u,
    en: (m) => `This page is ${m[1]} pixels, over the ${m[2]}-pixel filter budget.`,
  },
  {
    match: /^요청한 합성 원본 (.+?)이\(가\) 숨김·제외·누락 또는 완전 투명 상태입니다\.$/u,
    en: (m) =>
      `The requested composite sources ${m[1]} are hidden, excluded, missing, or fully transparent.`,
  },
  {
    match: /^숨김 대상으로 지정한 원본 (.+?)을\(를\) 현재 문서에서 찾지 못했습니다\.$/u,
    en: (m) => `The sources marked to hide (${m[1]}) are not in the current document.`,
  },
  {
    match: /^잠긴 원본 (.+?)은\(는\) 숨길 수 없습니다\.$/u,
    en: (m) => `Locked sources ${m[1]} cannot be hidden.`,
  },
  {
    match: /^필터 합성 PNG가 허용치 (.+?)바이트를 넘어 적용하지 않았습니다\.$/u,
    en: (m) => `The filter composite PNG exceeds the ${m[1]}-byte budget, so it was not applied.`,
  },
];

function translateSentence(sentence: string): string | null {
  const exact = STUDIO_FILTER_REASON_EN[sentence];
  if (exact) return exact;
  for (const pattern of STUDIO_FILTER_REASON_PATTERNS) {
    const matched = sentence.match(pattern.match);
    if (matched) return pattern.en(matched);
  }
  return null;
}

/**
 * 조립된 사유를 문장 단위로 옮긴다. 한 문장이라도 표에 없으면 `null` — 호출부가 저자형
 * 한국어를 그대로 쓰게 해서 반쪽 번역을 막는다.
 */
function translateReason(reason: string): string | null {
  const sentences = reason.split(/(?<=[.!?])\s+/u).filter((part) => part.length > 0);
  if (sentences.length === 0) return null;
  const translated: string[] = [];
  for (const sentence of sentences) {
    const next = translateSentence(sentence);
    if (!next) return null;
    translated.push(next);
  }
  return translated.join(" ");
}

/**
 * 필터 비활성 사유를 현재 로케일로 옮긴다.
 *
 * 한국어 로케일이거나, 로케일 팩이 아직 안 붙었거나, 문장 하나라도 표에 없으면 저자형
 * 한국어를 **그대로** 돌려준다(정직한 무변화). 사유를 만든 모듈은 계속 한국어만 만들면 되고,
 * 이 함수는 화면 경계에서만 불린다.
 */
export function localizeStudioFilterUnavailableReason(
  reason: string,
  t?: StudioFilterReasonTranslate,
): string;
export function localizeStudioFilterUnavailableReason(
  reason: string | null,
  t?: StudioFilterReasonTranslate,
): string | null;
export function localizeStudioFilterUnavailableReason(
  reason: string | null,
  t?: StudioFilterReasonTranslate,
): string | null {
  if (!reason) return reason;
  if (!shouldLocalizeToEnglish(t)) return reason;
  return translateReason(reason) ?? reason;
}
