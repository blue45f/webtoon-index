/**
 * 래스터(픽셀) 도구 "사용 불가/준비 필요" 사유·라벨의 ko → en 표.
 *
 * `studio-filter-unavailable-reason-localization.ts` 와 같은 관례의 **두 번째 표**다.
 * 왜 로케일 팩이 아니라 모듈 내 표인지, 왜 문장 단위인지, 왜 "하나라도 모르면 통째로 원문"인지는
 * 그 모듈의 머리말이 정본이다 — 요지만 옮기면:
 *   - `public/i18n/studio/*.json` 75개 팩은 팩당 키 개수가 같아야 한다는 계약이 있어
 *     (`studio-i18n-loader.test.ts`) ko/en 두 팩에만 키를 넣을 수 없다.
 *   - 사유는 통문장이 아니라 **조립된다**. 그래서 표는 문장을 담는다.
 *   - 반만 번역된 사유는 한국어 원문보다 나쁘다. 한 문장이라도 모르면 아무것도 바꾸지 않는다.
 *
 * 이 표가 덮는 저자형 한국어의 출처는 두 곳이다.
 *  - `studio-raster-tool-availability.ts` — 진입/적용 게이트의 `reason` 과 복구 액션 `label`
 *  - `studio-inspector-raster-tool-policy.ts` — 인스펙터 어댑터의 status/action/target 라벨과 설명
 *
 * 필터 표와 다른 점이 하나 있다: 이 사유들은 **도구 이름을 문장 안에 끼워 넣는다**
 * (`${tool.label}에 사용할 이미지 레이어를 선택하세요.`). 도구 이름 자체가 한국어라
 * 통문장 표로는 18개 도구 × 문장 수만큼 줄이 늘어난다. 그래서 도구 이름은 별도 표로 빼고,
 * 문장은 이름을 캡처하는 패턴으로 옮긴다. **모르는 도구 이름이 잡히면 그 문장은 실패**로 처리해
 * "하나라도 모르면 통째로 원문" 원칙을 그대로 지킨다.
 */

import type { StudioInspectorRasterToolPolicy } from "../studio-inspector-raster-tool-policy";
import type {
  StudioRasterToolAvailability,
  StudioRasterToolGate,
} from "./studio-raster-tool-availability";

/** 사유를 만들어 낸 모듈이 아니라 화면이 쓰는 번역기 시그니처(로케일 팩 조회). */
export type StudioRasterReasonTranslate = (key: string) => string;

/**
 * 스튜디오 로케일 팩이 실제로 붙었는지 확인하는 탐침 — 필터 표·레일 표와 같은 키를 쓴다.
 * 이 키는 정적 `DICT` 에 없고 런타임 스튜디오 팩에만 있어서, 팩이 아직 안 붙었으면 번역기가
 * 키를 그대로 되돌려준다.
 */
const STUDIO_LOCALE_PROBE_KEY = "studio.settings.tool.select";

/** 팩이 붙었을 때 위 프로브 키의 한국어 값. */
const STUDIO_LOCALE_PROBE_KOREAN_VALUE = "선택";

function isMissingTranslation(value: string, id: string): boolean {
  return value === id || value.startsWith("studio.");
}

/**
 * 영어로 바꿔도 되는 상태인가. 두 조건을 모두 만족해야 한다.
 *  1. 팩이 붙어 있을 것 — 안 붙었으면 패널의 나머지 라벨이 한국어라, 사유만 영어면 짬뽕이 된다.
 *  2. 그 팩이 한국어가 아닐 것 — ko 는 저자형 원문이 정본이다.
 * ko 도 en 도 아닌 로케일(ja·zh 등)은 영어를 받는다(미번역 로케일 = 영어 pending-translation).
 */
function shouldLocalizeToEnglish(t: StudioRasterReasonTranslate | undefined): boolean {
  if (!t) return false;
  const probe = t(STUDIO_LOCALE_PROBE_KEY);
  if (isMissingTranslation(probe, STUDIO_LOCALE_PROBE_KEY)) return false;
  return probe !== STUDIO_LOCALE_PROBE_KOREAN_VALUE;
}

/**
 * 도구 이름. `STUDIO_RASTER_TOOL_SPECS[*].label` 의 저자형 한국어와 **글자까지 같아야** 한다.
 * 사유 문장에 끼워 넣어지는 값이라 여기 없는 이름이 나오면 그 문장은 옮기지 않는다.
 */
const STUDIO_RASTER_TOOL_LABEL_EN: Readonly<Record<string, string>> = {
  채우기: "Paint bucket",
  필터: "Filter",
  "픽셀 선택": "Pixel selection",
  "올가미 선택": "Lasso selection",
  마술봉: "Magic wand",
  "선택 내용 변형": "Transform selection",
  "콘텐츠 인식 채우기": "Content-aware fill",
  자르기: "Crop",
  "혼합(스머지)": "Smudge",
  "닷지/번": "Dodge / Burn",
  "혼색 브러시": "Mixer brush",
  리퀴파이: "Liquify",
  "복구 브러시": "Healing brush",
  "복제 도장": "Clone stamp",
  "히스토리 브러시": "History brush",
  "퍼펫 워프": "Puppet warp",
  "레이어 마스크": "Layer mask",
  "프레임 애니메이션": "Frame animation",
};

/**
 * 문장이 아니라 **짧은 라벨**인 것들 — 버튼 문구, 상태 배지, 대상 이름.
 * 마침표가 없어 문장 분해기를 태울 수 없으므로 통문자열로 맞춘다.
 */
const STUDIO_RASTER_LABEL_EN: Readonly<Record<string, string>> = {
  // studio-raster-tool-availability.ts — 복구 액션 라벨
  "편집 잠금 확인": "Check the edit lock",
  "완료 후 다시 시도": "Retry when it finishes",
  "선택 레이어 표시": "Show the selected layer",
  "편집 가능한 복사본 만들기": "Make an editable copy",
  "레이어 잠금·권한 확인": "Check the layer lock and permissions",
  "현재 프레임 정적 복사본 만들기": "Make a static copy of the current frame",
  "타임라인 멈추기": "Stop the timeline",
  "이미지 레이어 선택": "Select an image layer",
  "대상 레이어 보기": "Show the target layer",
  "채울 레이어 선택": "Select the layer to fill",
  "벡터 채색 레이어 준비": "Prepare a vector color layer",
  "선화 또는 이미지 추가": "Add line art or an image",
  "편집용 래스터 복사본 만들기": "Make an editable raster copy",
  "숨긴 레이어 확인": "Check the hidden layers",
  "이미지 추가": "Add an image",
  "콘텐츠 추가": "Add content",
  "픽셀 영역 선택": "Select a pixel area",
  "캔버스에서 소스 지정": "Pick a source on the canvas",
  "작업 내역에서 소스 지정": "Pick a source from history",
  "핀 놓고 움직이기": "Place a pin and move it",
  "자르기 영역 조정": "Adjust the crop area",

  // studio-inspector-raster-tool-policy.ts — 상태 배지
  "조치 필요": "Action needed",
  "사용 불가": "Unavailable",
  "즉시 실행": "Run now",
  "자동 대상": "Automatic target",
  "벡터 채색": "Vector coloring",
  "합성본 준비": "Composite prepared",

  // studio-inspector-raster-tool-policy.ts — 실행 라벨
  "사용할 수 없음": "Not available",
  "선택 이미지에서 바로 실행": "Run directly on the selected image",
  "이미지 대상 자동 연결 후 실행": "Attach an image target automatically, then run",
  "벡터 채색 레이어 준비 후 실행": "Prepare a vector color layer, then run",
  "페이지 합성본 준비 후 실행": "Prepare a page composite, then run",

  // studio-inspector-raster-tool-policy.ts — 대상 이름
  "대상 준비 필요": "Target needs preparing",
  "선택 이미지": "Selected image",
  "표시 이미지": "Visible image",
  "벡터 선화": "Vector line art",
  "현재 페이지 합성본": "Current page composite",
};

/**
 * 저자형 한국어 **문장** → 영어. 키는 문장 하나다(마침표 포함).
 * 도구 이름이 끼는 문장은 여기가 아니라 아래 패턴 표에 있다.
 */
const STUDIO_RASTER_REASON_EN: Readonly<Record<string, string>> = {
  // studio-raster-tool-availability.ts — resolveEntryGate
  "원본 레이어를 유지한 채 표시 화면의 편집용 래스터 복사본을 만들 수 있어요.":
    "You can make an editable raster copy of what is on screen while keeping the original layer.",
  "완료된 뒤 다시 시도하세요.": "Please try again once it finishes.",
  "선택한 이미지 레이어가 숨겨져 있습니다.": "The selected image layer is hidden.",
  "표시한 뒤 픽셀을 편집하세요.": "Show it, then edit its pixels.",
  "애니메이션 레이어의 원본 프레임은 직접 픽셀 편집하지 않습니다.":
    "The original frames of an animated layer are never pixel-edited directly.",
  "현재 프레임의 정적 복사본을 만들어 편집하세요.":
    "Make a static copy of the current frame and edit that.",
  "재생 중에는 픽셀 기준 프레임이 계속 바뀝니다.":
    "While playback runs, the reference frame for pixels keeps changing.",
  "타임라인을 멈춘 뒤 편집하세요.": "Stop the timeline, then edit.",
  "그 레이어를 선택하세요.": "Please select that layer.",
  "이미지를 추가하거나 가져오세요.": "Please add or import an image.",
  "채울 수 있는 이미지 레이어 하나를 자동으로 선택합니다.":
    "One fillable image layer is selected automatically.",
  "대상 레이어를 하나 선택하세요.": "Please select a single target layer.",
  "표시 중인 벡터 선화 아래에 비파괴 채색 레이어를 준비합니다.":
    "A non-destructive color layer is prepared under the visible vector line art.",
  "채울 래스터 이미지나 표시 중인 벡터 선화가 없습니다.":
    "There is no raster image to fill and no visible vector line art.",
  "표시 레이어 중 일부를 화면과 똑같이 래스터 복사본으로 만들 수 없습니다.":
    "Some visible layers cannot be copied to raster exactly as shown on screen.",
  "지원되지 않는 합성·지우개 획을 먼저 정리하세요.":
    "Please clear the unsupported compositing and eraser strokes first.",
  "페이지의 콘텐츠가 모두 숨겨져 있습니다.": "Every piece of content on the page is hidden.",
  "필요한 레이어를 표시한 뒤 다시 시도하세요.":
    "Please show the layers you need, then try again.",
  "편집할 표시 콘텐츠가 없습니다.": "There is no visible content to edit.",
  "그림을 그리거나 이미지를 추가한 뒤 다시 시도하세요.":
    "Please draw something or add an image, then try again.",

  // studio-raster-tool-availability.ts — resolveApplyGate
  "적용할 픽셀 영역을 먼저 선택하세요.": "Please select the pixel area to apply this to first.",
  "Alt(Option)+클릭으로 복제할 소스 위치를 먼저 지정하세요.":
    "Alt(Option)+click to pick the clone source position first.",
  "작업 내역에서 복원할 시점을 히스토리 브러시 소스로 먼저 지정하세요.":
    "Pick the history step you want to restore as the history brush source first.",
  "핀을 하나 이상 놓고 원본 위치에서 움직여야 적용할 수 있습니다.":
    "Place at least one pin and move it off its original position before applying.",
  "자르기 경계를 움직여 남길 영역을 정하세요.":
    "Move the crop bounds to decide what to keep.",

  // studio-inspector-raster-tool-policy.ts — 설명·폴백
  "현재 페이지 상태에서는 이 도구를 시작할 수 없습니다.":
    "This tool cannot be started in the current page state.",
  "선택한 이미지 레이어에서 별도 합성 준비 없이 바로 실행합니다.":
    "Runs directly on the selected image layer with no separate composite step.",
  "사용 가능한 이미지 레이어를 자동으로 연결한 뒤 실행합니다.":
    "Attaches an available image layer automatically, then runs.",
  "표시 중인 벡터 선화를 보존하고 별도 채색 레이어를 준비한 뒤 실행합니다.":
    "Keeps the visible vector line art and prepares a separate color layer, then runs.",
  "원본 벡터 레이어를 보존한 페이지 합성본을 준비한 뒤 실행합니다.":
    "Prepares a page composite that preserves the original vector layers, then runs.",

  // StudioInspectorAside.tsx — lockedCompositeSourceReason
  "페이지 합성본으로 바꿀 표시 레이어 중 잠긴 레이어가 있습니다.":
    "Some of the visible layers destined for the page composite are locked.",
  "해당 레이어의 잠금을 해제한 뒤 다시 시도하세요.":
    "Please unlock those layers, then try again.",
};

/** 도구 이름이 끼어드는 문장은 통문장 표에 못 담는다 — 이름을 캡처해 따로 옮긴다. */
const STUDIO_RASTER_REASON_PATTERNS: readonly {
  readonly match: RegExp;
  readonly en: (groups: RegExpMatchArray) => string | null;
}[] = [
  {
    match: /^현재 선택은 (.+?)의 픽셀 대상이 아닙니다\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `The current selection is not a pixel target for ${tool}.` : null;
    },
  },
  {
    match: /^(.+?) 작업을 마치는 중입니다\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `${tool} is still finishing.` : null;
    },
  },
  {
    match: /^(.+?)에 사용할 이미지 레이어가 하나 있습니다\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `There is one image layer available for ${tool}.` : null;
    },
  },
  {
    match: /^(.+?)에 사용할 이미지 레이어 하나를 선택하세요\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `Please select a single image layer for ${tool}.` : null;
    },
  },
  {
    match: /^(.+?)에 사용할 이미지 레이어를 선택하세요\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `Please select the image layer to use for ${tool}.` : null;
    },
  },
  {
    match: /^(.+?)은 이미지 레이어가 필요합니다\.$/u,
    en: (m) => {
      const tool = STUDIO_RASTER_TOOL_LABEL_EN[m[1]];
      return tool ? `${tool} needs an image layer.` : null;
    },
  },
  {
    match: /^채울 수 있는 이미지가 (\d+)개입니다\.$/u,
    en: (m) => `There are ${m[1]} fillable images.`,
  },
];

function translateSentence(sentence: string): string | null {
  const exact = STUDIO_RASTER_REASON_EN[sentence];
  if (exact) return exact;
  for (const pattern of STUDIO_RASTER_REASON_PATTERNS) {
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
 * 래스터 도구 사유(진입·적용 게이트의 `reason`, 인스펙터 정책의 `description`)를 현재 로케일로.
 *
 * 한국어 로케일이거나, 로케일 팩이 아직 안 붙었거나, 문장 하나라도 표에 없으면 저자형 한국어를
 * **그대로** 돌려준다(정직한 무변화).
 */
export function localizeStudioRasterToolReason(
  reason: string,
  t?: StudioRasterReasonTranslate,
): string;
export function localizeStudioRasterToolReason(
  reason: string | null,
  t?: StudioRasterReasonTranslate,
): string | null;
export function localizeStudioRasterToolReason(
  reason: string | null,
  t?: StudioRasterReasonTranslate,
): string | null {
  if (!reason) return reason;
  if (!shouldLocalizeToEnglish(t)) return reason;
  return translateReason(reason) ?? reason;
}

/**
 * 짧은 라벨(버튼 문구·상태 배지·대상 이름·도구 이름)을 현재 로케일로.
 * 문장이 아니므로 분해하지 않고 통문자열로 맞춘다. 표에 없으면 원문 그대로.
 */
export function localizeStudioRasterToolLabel(
  label: string,
  t?: StudioRasterReasonTranslate,
): string {
  if (!label) return label;
  if (!shouldLocalizeToEnglish(t)) return label;
  return STUDIO_RASTER_LABEL_EN[label] ?? STUDIO_RASTER_TOOL_LABEL_EN[label] ?? label;
}

/**
 * 게이트 하나를 화면용으로 옮긴다 — 사유는 문장 표, 복구 액션 라벨은 라벨 표.
 * 아래 세 함수는 화면 경계(인스펙터)가 쓰는 조립기다. 표 바로 옆에 두어야 새 사유가 생겼을 때
 * 어디를 고쳐야 하는지가 한 파일 안에서 보인다.
 */
export function localizeStudioRasterToolGate(
  gate: StudioRasterToolGate,
  t?: StudioRasterReasonTranslate,
): StudioRasterToolGate {
  return {
    ...gate,
    reason: localizeStudioRasterToolReason(gate.reason, t),
    action: gate.action
      ? { ...gate.action, label: localizeStudioRasterToolLabel(gate.action.label, t) }
      : gate.action,
  };
}

/** 진입·적용 게이트와 도구 이름까지 한 번에 옮긴 사본. 원본은 건드리지 않는다. */
export function localizeStudioRasterToolAvailability(
  availability: StudioRasterToolAvailability,
  t?: StudioRasterReasonTranslate,
): StudioRasterToolAvailability {
  return {
    tool: { ...availability.tool, label: localizeStudioRasterToolLabel(availability.tool.label, t) },
    entry: localizeStudioRasterToolGate(availability.entry, t),
    apply: localizeStudioRasterToolGate(availability.apply, t),
  };
}

/** 인스펙터 어댑터가 만든 정책의 문구 전부(상태·실행·대상·설명·사유)를 옮긴 사본. */
export function localizeStudioInspectorRasterPolicy(
  policy: StudioInspectorRasterToolPolicy,
  t?: StudioRasterReasonTranslate,
): StudioInspectorRasterToolPolicy {
  return {
    ...policy,
    statusLabel: localizeStudioRasterToolLabel(policy.statusLabel, t),
    actionLabel: localizeStudioRasterToolLabel(policy.actionLabel, t),
    targetLabel: localizeStudioRasterToolLabel(policy.targetLabel, t),
    description: localizeStudioRasterToolReason(policy.description, t),
    unavailableReason: localizeStudioRasterToolReason(policy.unavailableReason, t),
  };
}
