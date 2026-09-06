/**
 * Studio AI Generation Label — 생성형 AI 표기가 **결과물 자체에 필요한지** 판정하는 순수 플래너.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 게시 패키지는 AI 사용 사실을 이미 기록한다. 다만 기록되는 **자리**가 문제다:
 *  · `studio-publish-package.planStudioPublishPackage` → `aiUsage !== "none"`이면
 *    `ai-disclosure.json` 아티팩트를 계획하고, manifest 의 `ai.disclosure` 필드에 문구를 넣는다.
 *  · `studio-publish-compliance.validateStudioPublishCompliance` → `aiDisclosureConfirmed`가
 *    꺼져 있으면 오류를 낸다. 즉 "고지했는가"만 묻고 "**어디에** 고지했는가"는 묻지 않는다.
 * 두 경로 모두 고지문을 **에피소드 이미지 옆의 별도 JSON**에만 남긴다. 이미지 파일 하나만 받아
 * 보는 독자는 그 JSON을 열지 않으므로 표기를 영영 보지 못한다. 아래 [AI기본법]은 표기를
 * **결과물 자체에** 두라고 요구하므로, 현재 구조는 그 요구를 만족한다고 볼 근거가 없다.
 *
 * 그래서 이 모듈은 "사용 방식 + 로케일 → 표기 의무 등급 · 표기 문구 · 근거"만 계산한다. 판정을
 * 데이터로 뽑아 두면 (1) 컴플라이언스 경고가 창작자에게 그대로 붙여 넣을 문구를 줄 수 있고,
 * (2) 나중에 눈에 보이는 워터마크를 그리기로 결정하더라도 같은 판정을 그대로 먹일 수 있다.
 *
 * 이 모듈이 하지 않는 것
 * ---------------------
 *  · **법적 충족을 보장하지 않는다.** `studio-publish-compliance`와 같은 입장이다 — 자체 점검을
 *    돕는 도구이지 법률 자문이나 인증이 아니다. §5의 면책 문구가 결과에 항상 따라붙는다.
 *  · **픽셀을 건드리지 않는다.** §4의 `visibleMark`는 렌더러가 **읽을 수 있는 사양**일 뿐이고
 *    `enabledByDefault`는 항상 `false`다. 내보낸 이미지를 말없이 바꾸는 것은 이 레인의 범위가
 *    아니다. 워터마크를 켜는 결정은 사람이 내린다.
 *  · **새 내보내기 산출물을 만들지 않는다.** `ai-disclosure.json` 옆에 파일을 하나 더 두면
 *    독자가 못 보는 사이드카가 둘이 될 뿐이다.
 *  · **대한민국 밖의 의무를 단정하지 않는다.** 검증된 출처가 하나뿐이라 나머지 관할은 전부
 *    `"unverified"`로 표시하고 권고에서 멈춘다(§3).
 *
 * 출처 (이 파일의 상수는 아래 중 하나에서 온다. 인용되지 않은 값은 UNVERIFIED로 명시했다)
 * ------------------------------------------------------------------------------------
 *  [AI기본법]  인공지능 발전과 신뢰 기반 조성 등에 관한 기본법 제31조 제2항 및 같은 법 시행령
 *              제22조. 시행일 2026-01-22. 생성형 인공지능으로 만든 결과물에는 그 사실을
 *              **결과물 자체에** 표시하도록 요구한다. (이 레인의 프로브가 확인한 유일한 조문)
 *  [WCAG]      WCAG 2.2 SC 1.4.3 Contrast (Minimum) — 일반 텍스트 4.5:1. §4의 대비 하한.
 *  [정책]      위 어느 출처에도 없는, 이 저장소가 정한 값. §4의 크기·여백 하한이 전부이며 그
 *              자리에 UNVERIFIED로 표시했다.
 *
 * §1. 사용 방식 · 관할 · 의무 등급 — 판정의 축.
 * §2. 표기 문구 카탈로그 — 결과물에 그대로 넣을 수 있는 완성 문장.
 * §3. 관할 판정 — 로케일에서 관할을 읽고, 근거 없는 곳은 권고에서 멈춘다.
 * §4. 워터마크 사양 — 렌더러가 읽을 수 있는 데이터. 기본값은 항상 꺼짐.
 * §5. 플래너 — 위를 합쳐 하나의 frozen 결과로.
 *
 * 전부 순수·결정적이며 브라우저 API에 의존하지 않는다. 입력은 변형하지 않고 반환값은 freeze 한다.
 */

export const STUDIO_AI_GENERATION_LABEL_RULESET_VERSION = 1 as const;

// ── §1. 사용 방식 · 관할 · 의무 등급 ──────────────────────────────────────────

/** `studio-publish-compliance.StudioPublishComplianceAiUsage`와 같은 축이다. 값이 어긋나면 안 된다. */
export type StudioAiGenerationUsage = "none" | "assisted" | "generated";

/**
 * 표기 의무를 판정할 근거가 있는 관할.
 *
 * `"kr"` 하나만 실제 조문에 근거한다. `"unverified"`는 "이 저장소가 확인한 근거가 없다"는 뜻이지
 * "의무가 없다"는 뜻이 **아니다** — 결과의 `unverified` 배열이 그 차이를 문장으로 말한다.
 */
export type StudioAiGenerationLabelJurisdiction = "kr" | "unverified";

/**
 * 의무 등급.
 *  · `"not-required"`   — AI를 쓰지 않았다. 표기할 대상이 없다.
 *  · `"advisory"`       — 표기를 권장하지만, 이 저장소가 인용할 수 있는 강제 근거가 없다.
 *  · `"required-on-result"` — 인용 가능한 조문이 **결과물 자체에** 표기를 요구한다. [AI기본법]
 */
export type StudioAiGenerationLabelObligation = "not-required" | "advisory" | "required-on-result";

/**
 * 기계가 읽는 판정 키. 저장·비교·텔레메트리는 문구가 아니라 이 값을 쓴다(문구는 로케일마다 다르고
 * 교정될 수 있지만 키는 룰셋 버전이 오르기 전까지 고정이다).
 */
export type StudioAiGenerationLabelKey =
  | "ai-label/none/v1"
  | "ai-label/kr/generated/on-result/v1"
  | "ai-label/kr/assisted/advisory/v1"
  | "ai-label/unverified/generated/advisory/v1"
  | "ai-label/unverified/assisted/advisory/v1";

export interface StudioAiGenerationLabelStatute {
  /** 안정적인 식별자. 조문 번호가 개정돼도 이 키로 과거 판정을 추적한다. */
  readonly id: "kr-ai-framework-act";
  readonly name: string;
  readonly shortName: string;
  readonly provision: string;
  readonly decree: string;
  /** ISO 8601 날짜. 시행일 이전 판정과 이후 판정을 구분해야 할 때 쓴다. */
  readonly inForce: string;
  readonly requirement: string;
}

/**
 * 이 레인의 프로브가 확인한 단 하나의 조문. [AI기본법]
 *
 * 여기에 없는 관할·조문은 이 모듈이 인용하지 않는다. 근거를 늘리려면 조문을 확인한 뒤 이 상수와
 * §3의 관할 표를 함께 늘려야 한다.
 */
export const STUDIO_AI_GENERATION_LABEL_STATUTE: StudioAiGenerationLabelStatute = Object.freeze({
  id: "kr-ai-framework-act",
  name: "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
  shortName: "AI기본법",
  provision: "제31조 제2항",
  decree: "시행령 제22조",
  inForce: "2026-01-22",
  requirement:
    "생성형 인공지능으로 만든 결과물에는 생성형 인공지능으로 만들었다는 사실을 결과물 자체에 표시해야 합니다.",
});

/**
 * 결과에 항상 따라붙는 면책 문구. `studio-publish-compliance`의 면책과 같은 입장을 유지한다 —
 * 자체 점검 도구이며 법률 자문·권리 인증·플랫폼 승인 보장이 아니다.
 */
export const STUDIO_AI_GENERATION_LABEL_DISCLAIMER =
  "이 판정은 창작자의 자체 점검을 돕는 도구이며 법률 자문이나 법적 요건 충족 보장이 아닙니다. 실제 표기 방식과 범위는 게시 전에 최신 법령과 게시처 정책을 직접 확인하세요." as const;

// ── §2. 표기 문구 카탈로그 ───────────────────────────────────────────────────

/**
 * 결과물 위에 **그대로** 올릴 수 있는 완성 문장이어야 한다. 창작자가 편집 없이 복사해 넣는 것이
 * 이 문구의 유일한 용도이므로, 빈칸이나 자리표시자를 두지 않는다.
 *
 * 한국어가 기본이다. 저장소 규약상 사용자 대상 문구는 한국어지만, 이 문구는 스튜디오 UI가 아니라
 * **작품을 받아 보는 독자**를 향한다. 그래서 한국어 외 로케일에는 영어 문장을 준다 — 독자가 읽지
 * 못하는 표기는 표기가 아니기 때문이다.
 */
interface StudioAiGenerationLabelCopy {
  readonly generated: string;
  readonly assisted: string;
}

const LABEL_COPY_KO: StudioAiGenerationLabelCopy = Object.freeze({
  generated: "이 콘텐츠는 생성형 AI로 만들어졌습니다.",
  assisted: "이 콘텐츠의 제작에 생성형 AI가 사용되었습니다.",
});

const LABEL_COPY_EN: StudioAiGenerationLabelCopy = Object.freeze({
  generated: "This content was created with generative AI.",
  assisted: "Generative AI was used in the making of this content.",
});

// ── §3. 관할 판정 ────────────────────────────────────────────────────────────

/**
 * 로케일이 비어 있을 때 가정하는 값.
 *
 * 이 저장소는 한국어 우선으로 배포되고, 확인된 표기 의무도 대한민국 것 하나뿐이다. 모르는 상태를
 * "의무 없음"으로 접는 것보다 가장 엄격한 확인된 관할로 접는 편이 안전하다 — 잘못 보수적이면
 * 경고가 하나 더 뜰 뿐이지만, 잘못 관대하면 독자가 표기를 못 본 채로 배포된다.
 */
export const STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE = "ko" as const;

interface NormalizedLocale {
  /** 정규화된 BCP-47 태그. 판정에 실제로 쓰인 값을 결과에 그대로 싣는다. */
  readonly tag: string;
  readonly language: string;
  readonly region: string;
}

function normalizeLocale(value: unknown): NormalizedLocale {
  const raw =
    typeof value === "string" && value.trim() ? value.trim() : STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE;
  // BCP-47은 구분자로 "-"를 쓰지만 POSIX 스타일 "ko_KR"도 흔히 흘러들어온다.
  const parts = raw.replace(/_/gu, "-").split("-").filter(Boolean);
  const language = (parts[0] ?? "").toLowerCase();
  // 두 번째 서브태그가 두 글자면 지역, 네 글자면 문자체계(Hant 등)라 지역이 아니다.
  const regionPart = parts.slice(1).find((part) => /^[A-Za-z]{2}$/u.test(part) || /^\d{3}$/u.test(part));
  const region = (regionPart ?? "").toUpperCase();
  if (!language) {
    return Object.freeze({ tag: STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE, language: "ko", region: "" });
  }
  return Object.freeze({ tag: region ? `${language}-${region}` : language, language, region });
}

/**
 * 관할 판정. [AI기본법]은 대한민국 법이므로 한국어이거나 지역이 KR일 때만 근거로 삼는다.
 *
 * 언어가 한국어면 지역 표기가 없어도 KR로 접는다. 한국어 독자를 상대로 배포하면서 다른 관할이라고
 * 우기는 것보다, 지역을 밝히지 않은 한국어 배포를 국내 배포로 보는 편이 실제에 가깝다.
 */
function jurisdictionFor(locale: NormalizedLocale): StudioAiGenerationLabelJurisdiction {
  return locale.language === "ko" || locale.region === "KR" ? "kr" : "unverified";
}

// ── §4. 워터마크 사양 ────────────────────────────────────────────────────────

/**
 * 눈에 보이는 표기를 **그릴 수 있는** 렌더러용 사양. 이 모듈은 아무것도 그리지 않는다.
 *
 * `enabledByDefault`가 리터럴 `false`인 것은 실수가 아니다 — 내보낸 픽셀을 말없이 바꾸는 변경은
 * 별도 결정이 필요하고, 타입 수준에서 켜는 길을 막아 두면 "기본으로 켜졌다"는 사고가 나지 않는다.
 * 워터마크를 실제로 출하하기로 하면 이 사양을 소비하는 렌더러를 새로 만들고, 켜는 스위치는 그
 * 렌더러 쪽에 둔다.
 */
export interface StudioAiGenerationVisibleMarkSpec {
  readonly enabledByDefault: false;
  /** 그릴 문구. 판정된 `labelText`와 같은 값이다. */
  readonly text: string;
  /**
   * 배경 대비 최소 명암비 4.5:1. [WCAG 2.2 SC 1.4.3]
   * 표기가 읽히지 않으면 표기가 아니므로 장식이 아니라 본문 텍스트 기준을 쓴다.
   */
  readonly minContrastRatio: number;
  /**
   * 캔버스 짧은 변 대비 최소 글자 높이 비율. UNVERIFIED — 법령도 WCAG도 이 값을 정하지 않는다.
   * 세로 스크롤 웹툰의 690px 폭 기준에서 약 11px에 해당하도록 이 저장소가 고른 값이며, 실제
   * 출하 전에 가독성 실측으로 다시 정해야 한다.
   */
  readonly minHeightRatioOfShortEdge: number;
  /**
   * 캔버스 짧은 변 대비 최소 안쪽 여백 비율. UNVERIFIED — 위와 같은 성격의 저장소 정책값이며,
   * 플랫폼이 가장자리를 잘라내도 표기가 살아남게 하려는 목적이다.
   */
  readonly minPaddingRatioOfShortEdge: number;
}

/** [WCAG 2.2 SC 1.4.3] 일반 텍스트 최소 명암비. */
const VISIBLE_MARK_MIN_CONTRAST_RATIO = 4.5;
/** UNVERIFIED — 저장소 정책값(§4 주석 참고). */
const VISIBLE_MARK_MIN_HEIGHT_RATIO = 0.016;
/** UNVERIFIED — 저장소 정책값(§4 주석 참고). */
const VISIBLE_MARK_MIN_PADDING_RATIO = 0.012;

function visibleMarkSpec(text: string): StudioAiGenerationVisibleMarkSpec {
  return Object.freeze({
    enabledByDefault: false as const,
    text,
    minContrastRatio: VISIBLE_MARK_MIN_CONTRAST_RATIO,
    minHeightRatioOfShortEdge: VISIBLE_MARK_MIN_HEIGHT_RATIO,
    minPaddingRatioOfShortEdge: VISIBLE_MARK_MIN_PADDING_RATIO,
  });
}

// ── §5. 플래너 ───────────────────────────────────────────────────────────────

export interface StudioAiGenerationLabelPlan {
  readonly version: typeof STUDIO_AI_GENERATION_LABEL_RULESET_VERSION;
  readonly usage: StudioAiGenerationUsage;
  /** 판정에 실제로 쓰인 정규화 로케일. 입력이 비었으면 기본값이 들어간다. */
  readonly locale: string;
  readonly jurisdiction: StudioAiGenerationLabelJurisdiction;
  readonly obligation: StudioAiGenerationLabelObligation;
  readonly key: StudioAiGenerationLabelKey;
  /** 결과물에 그대로 넣을 문구. `obligation`이 `"not-required"`면 빈 문자열이다. */
  readonly labelText: string;
  /** 왜 이 등급인지. 근거가 있으면 조문을, 없으면 없다는 사실을 문장으로 말한다. */
  readonly rationale: string;
  /** 인용한 조문. 근거 없는 판정에서는 비어 있다. */
  readonly citations: readonly StudioAiGenerationLabelStatute[];
  /**
   * 이 판정이 기대고 있는 **확인되지 않은** 전제. 비어 있지 않으면 판정을 법적 충족으로 읽으면 안
   * 된다. 비어 있어도 §5의 면책은 그대로 유효하다.
   */
  readonly unverified: readonly string[];
  /** 눈에 보이는 표기를 그릴 렌더러가 읽을 사양. 표기할 대상이 없으면 `null`. */
  readonly visibleMark: StudioAiGenerationVisibleMarkSpec | null;
  readonly disclaimer: typeof STUDIO_AI_GENERATION_LABEL_DISCLAIMER;
}

export interface StudioAiGenerationLabelInput {
  readonly usage?: unknown;
  /** BCP-47 태그. 생략하면 `STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE`. */
  readonly locale?: unknown;
}

function normalizeUsage(value: unknown): StudioAiGenerationUsage {
  return value === "assisted" || value === "generated" ? value : "none";
}

const UNVERIFIED_KR_ASSISTED =
  "[AI기본법] 제31조 제2항은 생성형 AI로 '만든 결과물'을 대상으로 합니다. AI를 보조로만 쓴 작업이 이 대상에 들어가는지는 이 저장소가 확인하지 못했습니다.";

const UNVERIFIED_OTHER_JURISDICTION =
  "이 로케일의 표기 의무는 이 저장소가 확인한 근거가 없습니다. 근거가 없다는 뜻이지 의무가 없다는 뜻이 아니므로, 배포 대상 국가의 법령을 직접 확인하세요.";

/**
 * 사용 방식과 로케일로부터 표기 의무를 판정한다.
 *
 * 판정은 결정적이다 — 같은 입력이면 항상 같은 키가 나온다. 문구는 로케일에 따라 달라지지만 키는
 * 달라지지 않으므로, 저장이나 비교에는 `key`를 쓰고 `labelText`는 표시에만 쓴다.
 */
export function planStudioAiGenerationLabel(
  input: StudioAiGenerationLabelInput = {}
): StudioAiGenerationLabelPlan {
  const usage = normalizeUsage(input.usage);
  const locale = normalizeLocale(input.locale);
  const jurisdiction = jurisdictionFor(locale);
  const copy = locale.language === "ko" ? LABEL_COPY_KO : LABEL_COPY_EN;

  if (usage === "none") {
    return Object.freeze({
      version: STUDIO_AI_GENERATION_LABEL_RULESET_VERSION,
      usage,
      locale: locale.tag,
      jurisdiction,
      obligation: "not-required" as const,
      key: "ai-label/none/v1" as const,
      labelText: "",
      rationale:
        "생성형 AI를 사용하지 않았다고 선언했으므로 결과물에 표기할 AI 사용 사실이 없습니다.",
      citations: Object.freeze([]),
      unverified: Object.freeze([]),
      visibleMark: null,
      disclaimer: STUDIO_AI_GENERATION_LABEL_DISCLAIMER,
    });
  }

  if (jurisdiction === "kr" && usage === "generated") {
    return Object.freeze({
      version: STUDIO_AI_GENERATION_LABEL_RULESET_VERSION,
      usage,
      locale: locale.tag,
      jurisdiction,
      obligation: "required-on-result" as const,
      key: "ai-label/kr/generated/on-result/v1" as const,
      labelText: copy.generated,
      rationale: `${STUDIO_AI_GENERATION_LABEL_STATUTE.shortName} ${STUDIO_AI_GENERATION_LABEL_STATUTE.provision} 및 ${STUDIO_AI_GENERATION_LABEL_STATUTE.decree}(시행 ${STUDIO_AI_GENERATION_LABEL_STATUTE.inForce})는 ${STUDIO_AI_GENERATION_LABEL_STATUTE.requirement} 별도 파일에 적어 둔 고지는 이미지를 받아 보는 독자에게 닿지 않습니다.`,
      citations: Object.freeze([STUDIO_AI_GENERATION_LABEL_STATUTE]),
      unverified: Object.freeze([]),
      visibleMark: visibleMarkSpec(copy.generated),
      disclaimer: STUDIO_AI_GENERATION_LABEL_DISCLAIMER,
    });
  }

  if (jurisdiction === "kr") {
    return Object.freeze({
      version: STUDIO_AI_GENERATION_LABEL_RULESET_VERSION,
      usage,
      locale: locale.tag,
      jurisdiction,
      obligation: "advisory" as const,
      key: "ai-label/kr/assisted/advisory/v1" as const,
      labelText: copy.assisted,
      rationale: `${STUDIO_AI_GENERATION_LABEL_STATUTE.shortName} ${STUDIO_AI_GENERATION_LABEL_STATUTE.provision}은 생성형 AI로 만든 결과물을 대상으로 합니다. AI 보조 작업이 그 대상인지는 확인하지 못했으므로, 표기를 강제로 요구하지 않고 권장만 합니다.`,
      citations: Object.freeze([STUDIO_AI_GENERATION_LABEL_STATUTE]),
      unverified: Object.freeze([UNVERIFIED_KR_ASSISTED]),
      visibleMark: visibleMarkSpec(copy.assisted),
      disclaimer: STUDIO_AI_GENERATION_LABEL_DISCLAIMER,
    });
  }

  const labelText = usage === "generated" ? copy.generated : copy.assisted;
  return Object.freeze({
    version: STUDIO_AI_GENERATION_LABEL_RULESET_VERSION,
    usage,
    locale: locale.tag,
    jurisdiction,
    obligation: "advisory" as const,
    key: (usage === "generated"
      ? "ai-label/unverified/generated/advisory/v1"
      : "ai-label/unverified/assisted/advisory/v1") as StudioAiGenerationLabelKey,
    labelText,
    rationale:
      "이 로케일에 적용되는 표기 의무를 이 저장소가 확인하지 못했습니다. 독자가 AI 사용 사실을 알 수 있도록 표기를 권장하지만, 인용할 근거가 없으므로 요구로 단정하지 않습니다.",
    citations: Object.freeze([]),
    unverified: Object.freeze([UNVERIFIED_OTHER_JURISDICTION]),
    visibleMark: visibleMarkSpec(labelText),
    disclaimer: STUDIO_AI_GENERATION_LABEL_DISCLAIMER,
  });
}
