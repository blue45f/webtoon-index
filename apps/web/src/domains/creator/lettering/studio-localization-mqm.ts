/**
 * Studio Localization MQM — 번역된 회차를 **MQM-Core 오류 유형론으로 채점**하는 순수 엔진.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 이 저장소에는 번역 "결함"을 분류하는 수단이 하나도 없었다. 번역 쪽 숫자는 두 개뿐이고
 * 둘 다 품질 판단이 아니다:
 *  · `studio-dialogue-translate.dialogueTranslationCoverage` → {total, translated}. **존재 여부**만
 *    센다. 전 대사가 오역이어도 100%가 나온다.
 *  · `studio-translation-memory.StudioTranslationMemoryFuzzySuggestion.score` → 재사용 랭킹용
 *    **원문 유사도**(임계 0.86). 번역문이 맞았는지와는 무관하다.
 * 번역 쪽 이슈 코드도 용어집 충돌 두 개(`ambiguous-rule`, `missing-target`)가 전부이고, 그나마
 * 한 번에 한 항목씩만 본다. 즉 **심각도 사다리도, 회차 단위 집계도, 점수도 없었다.**
 *
 * 그래서 이 모듈은 업계 표준인 MQM-Core를 그대로 옮긴다. 형태(결과 객체·심각도 정렬·frozen 반환)는
 * 이미 있는 세 린터(`studio-project-health-linter` / `studio-publish-preflight` /
 * `studio-continuity`)의 관례를 따르고, **주제만 번역 품질로 바꾼다** — 네 번째 규약을 만들지 않는다.
 *
 * 이 모듈이 하지 않는 것
 * ---------------------
 *  · **등급(A/B/C/D)을 매기지 않는다.** `studio-scroll-rhythm.gradeForScore`의 88/74/58 구간은
 *    다른 주제에 맞춰 조정된 값이라 MQM에 그대로 쓰면 틀린다 — MQM에서 74점은 재앙이다. MQM이
 *    출처와 함께 제시하는 컷 포인트는 **99 하나뿐**이라, 이 모듈도 그 하나만 쓴다.
 *  · **오류를 스스로 찾지 않는다** — §5의 절단/팽창 하나만 예외다. 나머지 37개 서브타입은 사람이나
 *    상위 검사기가 판정해 넣는 입력이다. 이 모듈은 유형론 + 계산 + 판정만 책임진다.
 *
 * 출처 (이 파일의 모든 상수는 아래 중 하나에서 온다. 인용되지 않은 값은 넣지 않았다)
 * ---------------------------------------------------------------------------------
 *  [MQM]  themqm.org — MQM-Core typology / MQM scoring models.
 *         7 차원 38 서브타입, 심각도 배수(Neutral 0 / Minor 1 / Major 5 / Critical 25),
 *         APT·PWPT·NPT·QS, raw passing threshold 99, Critical 1건 = 자동 Fail,
 *         표본 500~20,000 단어.
 *  [ISO]  ISO 5060:2024 — 분모를 단어 대신 **문자 또는 행**으로 잡는 것을 허용. 웹툰에 반드시
 *         필요한 조항이다(말풍선은 문단이 아니다). 다만 이 규격의 **수치 배수는 유료라 미확인**
 *         이므로, 이 모듈은 "분모를 바꿀 수 있다"는 것만 가져오고 임계값은 가져오지 않는다.
 *  [WMT]  Freitag et al., TACL 2021, Table 4 — 운영 변형(§6).
 *  [정책] 위 어느 출처에도 없는, 이 저장소가 정한 값. §5의 임계값이 전부이며 그 자리에 명시했다.
 *
 * §1. 심각도와 가중치 — Neutral 0 / Minor 1 / Major 5 / Critical 25. [MQM]
 * §2. 7 차원 · 서브타입 카탈로그 — 인용된 것만 싣고, 못 실은 자리는 숫자로 드러낸다.
 * §3. 오류 레코드 정규화 — 서브타입이 차원의 단일 소스.
 * §4. 채점 분모 — 단어/문자/행. 어느 것을 썼는지 결과에 **명시**한다. [ISO]
 * §5. APT / PWPT / NPT / QS 와 판정 — Critical 1건이면 점수와 무관하게 Fail. [MQM]
 * §6. Design and markup > Truncation/text expansion — 렌더러가 혼자 잡아낼 수 있는
 *     **유일한** MQM 오류 클래스. 넘침 게이트가 여기로 관측치를 흘려보낸다.
 * §7. WMT 2021 운영 변형 — 세그먼트당 오류 상한. [WMT]
 *
 * 전부 순수·결정적이며 브라우저 API에 의존하지 않는다(`Intl`은 ECMA-402라 Node에서도 동작하며,
 * `studio-kinsoku-line-break.segmentGraphemes`와 같은 폴백 관례를 쓴다). 입력은 절대 변형하지
 * 않고, 반환값은 전부 freeze 한다.
 */

export const STUDIO_LOCALIZATION_MQM_RULESET_VERSION = 1 as const;

// ── §1. 심각도와 가중치 ───────────────────────────────────────────────────────

export type StudioMqmSeverity = "neutral" | "minor" | "major" | "critical";

/**
 * MQM-Core 심각도 배수. [MQM: MQM scoring models]
 *
 * Neutral 0 은 "기록은 하되 점수에는 넣지 않는다"는 뜻이다 — 삭제하면 감사 추적이 사라지므로
 * 0 가중치로 남긴다.
 */
export const STUDIO_MQM_SEVERITY_WEIGHTS: Readonly<Record<StudioMqmSeverity, number>> =
  Object.freeze({
    neutral: 0,
    minor: 1,
    major: 5,
    critical: 25,
  });

/** 심각한 것부터 정렬하기 위한 순서(표시/정렬 전용, 점수와 무관). */
const SEVERITY_ORDER: Readonly<Record<StudioMqmSeverity, number>> = Object.freeze({
  critical: 0,
  major: 1,
  minor: 2,
  neutral: 3,
});

/** Critical 1건이면 점수와 무관하게 자동 Fail. [MQM] */
export const STUDIO_MQM_CRITICAL_AUTO_FAIL = true as const;

/** raw passing threshold — 100점 만점에 99. 대략 "100단어당 1점"에 해당한다. [MQM] */
export const STUDIO_MQM_PASS_THRESHOLD = 99;

/** 유효한 MQM 표본 크기(단어). 이 밖이면 점수의 신뢰구간이 무의미하다. [MQM] */
export const STUDIO_MQM_SAMPLE_MIN_WORDS = 500;
export const STUDIO_MQM_SAMPLE_MAX_WORDS = 20_000;

// ── §2. MQM-Core 7 차원 · 서브타입 카탈로그 ──────────────────────────────────

export const STUDIO_MQM_DIMENSION_IDS = [
  "terminology",
  "accuracy",
  "linguistic-conventions",
  "style",
  "locale-conventions",
  "audience-appropriateness",
  "design-and-markup",
] as const;

export type StudioMqmDimensionId = (typeof STUDIO_MQM_DIMENSION_IDS)[number];

export interface StudioMqmDimension {
  readonly id: StudioMqmDimensionId;
  /** UI 표기(한국어). */
  readonly label: string;
  /** MQM-Core 원문 명칭. 번역팀·외부 벤더와 대조할 때 이 이름이 계약어다. */
  readonly mqmName: string;
  /** 출처가 명시한 이 차원의 서브타입 **개수**. 합 = 38. [MQM] */
  readonly declaredSubtypeCount: number;
  /**
   * 아래 서브타입 카탈로그가 이 차원을 **전부** 담고 있는가.
   *
   * 전부 담은 것은 Design and markup 하나뿐이다(5개 이름이 모두 인용됨). 나머지 차원은 개수만
   * 인용됐고 이름은 일부만 확인됐다 — 그래서 없는 이름을 지어내는 대신 `declaredSubtypeCount`와
   * 실제 카탈로그 길이의 차이를 이 플래그로 **드러낸다**. 상위 UI는 이걸 보고 "부분 카탈로그"임을
   * 표시할 수 있고, 나중에 원문을 더 확보하면 카탈로그만 채우면 된다.
   */
  readonly subtypeCatalogComplete: boolean;
}

export const STUDIO_MQM_DIMENSIONS: readonly StudioMqmDimension[] = Object.freeze([
  Object.freeze({
    id: "terminology",
    label: "용어",
    mqmName: "Terminology",
    declaredSubtypeCount: 3,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "accuracy",
    label: "정확성",
    mqmName: "Accuracy",
    declaredSubtypeCount: 7,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "linguistic-conventions",
    label: "언어 규범",
    mqmName: "Linguistic conventions",
    declaredSubtypeCount: 6,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "style",
    label: "문체",
    mqmName: "Style",
    declaredSubtypeCount: 7,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "locale-conventions",
    label: "로케일 규범",
    mqmName: "Locale conventions",
    declaredSubtypeCount: 8,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "audience-appropriateness",
    label: "독자 적합성",
    mqmName: "Audience appropriateness",
    declaredSubtypeCount: 2,
    subtypeCatalogComplete: false,
  }),
  Object.freeze({
    id: "design-and-markup",
    label: "디자인·마크업",
    mqmName: "Design and markup",
    declaredSubtypeCount: 5,
    subtypeCatalogComplete: true,
  }),
] satisfies readonly StudioMqmDimension[]);

/** 7 차원 서브타입 개수의 총합. [MQM: 38 subtypes] */
export const STUDIO_MQM_DECLARED_SUBTYPE_TOTAL = 38;

interface StudioMqmSubtypeRecord {
  readonly id: string;
  readonly label: string;
  readonly mqmName: string;
  readonly dimension: StudioMqmDimensionId;
  /**
   * 상위 서브타입. MQM 은 서브타입 안에 서브타입을 둔다 — False friend 등 셋은 Mistranslation 의
   * 자식이다. 이 셋이 Accuracy 의 7개 안에 포함되는지는 출처가 말하지 않으므로 **평탄화하지 않고**
   * 부모 관계를 그대로 보존한다(평탄화하면 개수를 잘못 주장하게 된다).
   */
  readonly parent: string | null;
  /**
   * 렌더러가 사람 판정 없이 **혼자** 검출할 수 있는가.
   *
   * 유일하게 true 인 것이 Truncation/text expansion 이다(§6). 나머지는 전부 원문·문맥·독자 판단이
   * 필요하다.
   */
  readonly machineCheckable: boolean;
}

/**
 * 인용으로 이름이 확인된 서브타입만 싣는다. 38개 중 11개다.
 *
 * Design and markup 5개는 출처가 이름을 모두 밝혀 완전하고(Layout, Markup tag,
 * Truncation/text expansion, Missing text, Link), Accuracy 는 Addition/Mistranslation/Omission 과
 * Mistranslation 의 자식 3개까지만 확인됐다. 나머지 다섯 차원은 개수만 확인됐다 — 이름을 추측해
 * 넣으면 그 순간 이 표는 표준이 아니라 창작물이 되므로 비워 둔다.
 */
export const STUDIO_MQM_SUBTYPES = [
  // Accuracy — 부분 카탈로그(7 중 6개 이름 확인). [MQM]
  {
    id: "addition",
    label: "추가",
    mqmName: "Addition",
    dimension: "accuracy",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "mistranslation",
    label: "오역",
    mqmName: "Mistranslation",
    dimension: "accuracy",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "omission",
    label: "누락",
    mqmName: "Omission",
    dimension: "accuracy",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "false-friend",
    label: "가짜 동족어",
    mqmName: "False friend",
    dimension: "accuracy",
    parent: "mistranslation",
    machineCheckable: false,
  },
  {
    id: "technical-relationship-misrepresentation",
    label: "기술적 관계 왜곡",
    mqmName: "Technical-relationship misrepresentation",
    dimension: "accuracy",
    parent: "mistranslation",
    machineCheckable: false,
  },
  {
    id: "mt-hallucination",
    label: "기계번역 환각",
    mqmName: "MT hallucination",
    dimension: "accuracy",
    parent: "mistranslation",
    machineCheckable: false,
  },
  // Design and markup — 완전 카탈로그(5/5). [MQM]
  {
    id: "layout",
    label: "레이아웃",
    mqmName: "Layout",
    dimension: "design-and-markup",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "markup-tag",
    label: "마크업 태그",
    mqmName: "Markup tag",
    dimension: "design-and-markup",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "truncation-text-expansion",
    label: "절단·텍스트 팽창",
    mqmName: "Truncation/text expansion",
    dimension: "design-and-markup",
    parent: null,
    machineCheckable: true,
  },
  {
    id: "missing-text",
    label: "텍스트 누락",
    mqmName: "Missing text",
    dimension: "design-and-markup",
    parent: null,
    machineCheckable: false,
  },
  {
    id: "link",
    label: "링크",
    mqmName: "Link",
    dimension: "design-and-markup",
    parent: null,
    machineCheckable: false,
  },
] as const satisfies readonly StudioMqmSubtypeRecord[];

export type StudioMqmSubtypeId = (typeof STUDIO_MQM_SUBTYPES)[number]["id"];
export type StudioMqmSubtype = (typeof STUDIO_MQM_SUBTYPES)[number];

const SUBTYPE_BY_ID: ReadonlyMap<StudioMqmSubtypeId, StudioMqmSubtype> = new Map(
  STUDIO_MQM_SUBTYPES.map((subtype) => [subtype.id, subtype]),
);

const DIMENSION_BY_ID: ReadonlyMap<StudioMqmDimensionId, StudioMqmDimension> = new Map(
  STUDIO_MQM_DIMENSIONS.map((dimension) => [dimension.id, dimension]),
);

const DIMENSION_ORDER: Readonly<Record<StudioMqmDimensionId, number>> = Object.freeze(
  Object.fromEntries(
    STUDIO_MQM_DIMENSION_IDS.map((id, index) => [id, index]),
  ) as Record<StudioMqmDimensionId, number>,
);

export function studioMqmSubtype(id: StudioMqmSubtypeId): StudioMqmSubtype {
  const found = SUBTYPE_BY_ID.get(id);
  // 유니온 타입에서 파생된 키라 런타임에 빠질 수 없다. 방어적으로만 남긴다.
  if (!found) throw new Error(`unknown MQM subtype: ${String(id)}`);
  return found;
}

export function studioMqmDimension(id: StudioMqmDimensionId): StudioMqmDimension {
  const found = DIMENSION_BY_ID.get(id);
  if (!found) throw new Error(`unknown MQM dimension: ${String(id)}`);
  return found;
}

/** 이 차원에서 **이름까지** 확인된 서브타입들. 개수는 `declaredSubtypeCount`와 다를 수 있다. */
export function studioMqmSubtypesOf(
  dimension: StudioMqmDimensionId,
): readonly StudioMqmSubtype[] {
  return STUDIO_MQM_SUBTYPES.filter((subtype) => subtype.dimension === dimension);
}

// ── §3. 오류 레코드 ───────────────────────────────────────────────────────────

/** 오류에 딸려 오는 수치 증거(넘침 비율·팽창률 등). 리포트에 그대로 실린다. */
export type StudioMqmEvidence = Readonly<Record<string, number | string | boolean>>;

interface StudioMqmErrorInputBase {
  readonly severity: StudioMqmSeverity;
  /**
   * Error Type Weight(ETW). 기본 1.
   *
   * 출처의 공식 `APT = sum(minor*1 + major*5 + critical*25) * ETW` 는 ETW 를 합 밖에 쓰지만,
   * MQM 의 ETW 는 본래 **오류 유형별** 가중치다. 오류마다 곱하는 쪽이 원 모델이고, 전부 같은 값을
   * 주면 합 밖에 곱한 것과 정확히 같아지므로 전역 케이스도 포함한다.
   */
  readonly typeWeight?: number;
  /** 안정적인 식별자. 없으면 결정적으로 파생한다. */
  readonly id?: string;
  /** 대사 큐 id — `studio-dialogue-interchange.StudioDialogueCue.id` 와 같은 공간. */
  readonly cueId?: string;
  /** 1-based 페이지 번호. */
  readonly page?: number;
  /** 1-based 컷 번호. */
  readonly panel?: number;
  /** 사람이 읽는 설명(한국어). */
  readonly note?: string;
  readonly evidence?: StudioMqmEvidence;
}

/**
 * 오류 입력. 서브타입을 주거나(차원은 카탈로그에서 유도) 차원만 준다(이름이 확인되지 않은
 * 서브타입인 경우). **둘 다 줄 수는 없다** — 둘이 어긋나면 어느 쪽이 참인지 정할 수 없고,
 * 조용히 한쪽으로 고치면 호출부의 버그가 숨는다. 타입으로 막는다.
 */
export type StudioMqmErrorInput =
  | (StudioMqmErrorInputBase & {
      readonly subtype: StudioMqmSubtypeId;
      readonly dimension?: never;
    })
  | (StudioMqmErrorInputBase & {
      readonly dimension: StudioMqmDimensionId;
      readonly subtype?: never;
    });

export interface StudioMqmError {
  readonly id: string;
  readonly dimension: StudioMqmDimensionId;
  readonly subtype: StudioMqmSubtypeId | null;
  readonly severity: StudioMqmSeverity;
  readonly typeWeight: number;
  /** severityWeight × typeWeight. 이 값들의 합이 APT 다. */
  readonly penalty: number;
  readonly cueId: string | null;
  readonly page: number | null;
  readonly panel: number | null;
  readonly note: string | null;
  readonly evidence: StudioMqmEvidence | null;
}

function normalizeTypeWeight(value: number | undefined): number {
  if (value === undefined) return 1;
  // 음수 가중치는 오류를 **점수 상승**으로 만들어 버린다. 비유한·음수는 기본값으로 되돌린다.
  if (!Number.isFinite(value) || value < 0) return 1;
  return value;
}

function normalizePositiveInt(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored > 0 ? floored : null;
}

function normalizeText(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 오류 하나를 정규화한다. 서브타입이 있으면 **카탈로그가 차원의 단일 소스**다. */
export function normalizeStudioMqmError(
  input: StudioMqmErrorInput,
  index: number,
): StudioMqmError {
  // `input.subtype` 위에서 좁혀야 `input` 유니온의 어느 갈래인지가 함께 좁혀진다.
  // 지역 변수(`subtype`)로 옮겨 놓고 검사하면 그 연결이 끊겨 `input.dimension`이 optional 로 남는다.
  const subtype: StudioMqmSubtypeId | null = input.subtype ?? null;
  const dimension: StudioMqmDimensionId =
    input.subtype !== undefined ? studioMqmSubtype(input.subtype).dimension : input.dimension;
  const typeWeight = normalizeTypeWeight(input.typeWeight);
  const cueId = normalizeText(input.cueId);
  const id =
    normalizeText(input.id) ??
    `${dimension}:${subtype ?? "-"}:${cueId ?? "-"}:${index}`;

  return Object.freeze({
    id,
    dimension,
    subtype,
    severity: input.severity,
    typeWeight,
    penalty: STUDIO_MQM_SEVERITY_WEIGHTS[input.severity] * typeWeight,
    cueId,
    page: normalizePositiveInt(input.page),
    panel: normalizePositiveInt(input.panel),
    note: normalizeText(input.note),
    evidence: input.evidence ? Object.freeze({ ...input.evidence }) : null,
  });
}

function compareErrors(left: StudioMqmError, right: StudioMqmError): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    DIMENSION_ORDER[left.dimension] - DIMENSION_ORDER[right.dimension] ||
    (left.subtype ?? "").localeCompare(right.subtype ?? "") ||
    (left.page ?? 0) - (right.page ?? 0) ||
    (left.panel ?? 0) - (right.panel ?? 0) ||
    (left.cueId ?? "").localeCompare(right.cueId ?? "") ||
    left.id.localeCompare(right.id)
  );
}

// ── §4. 채점 분모 ─────────────────────────────────────────────────────────────

/**
 * 분모 단위.
 *
 * MQM 원문은 단어를 쓰지만, **웹툰에서 단어 분모는 성립하지 않는다** — 말풍선은 문단이 아니고,
 * 한국어·일본어·중국어는 공백 분절이 단어 수를 크게 왜곡한다(중국어는 공백이 아예 없다).
 * ISO 5060:2024 가 문자 또는 행 분모를 허용하는 이유가 정확히 이것이다. [ISO]
 */
export type StudioMqmDenominatorUnit = "words" | "characters" | "lines";

export interface StudioMqmDenominator {
  readonly unit: StudioMqmDenominatorUnit;
  readonly count: number;
  /**
   * 이 단위에서 `STUDIO_MQM_PASS_THRESHOLD`(99)가 **출처로 보정된 값인가**.
   *
   * true 는 `words` 뿐이다. 문자/행 분모는 ISO 5060 이 허용하지만 그 **수치 배수는 유료라
   * 미확인**이므로, 99를 그대로 쓰는 것은 유추일 뿐이다. 문자 분모는 같은 원고에서 분모가 훨씬
   * 커져 PWPT 가 작아지고 **거의 전부 통과**하게 된다 — 이 플래그를 보지 않고 verdict 만 읽으면
   * 정확히 그 함정에 빠진다. 그래서 결과에 분모를 **명시**하고 이 플래그를 함께 싣는다.
   */
  readonly thresholdCalibrated: boolean;
}

const WHITESPACE_RUN = /\s+/u;

function countGraphemesExcludingWhitespace(text: string): number {
  // `studio-kinsoku-line-break.segmentGraphemes` 와 같은 폴백 관례. 여기서는 개수만 필요해서
  // 배열을 만들지 않고 세기만 한다(그 모듈을 import 하지 않는 이유이기도 하다 — 분모 계산이
  // 조판 엔진의 변경에 끌려다닐 이유가 없다).
  if (text.length === 0) return 0;
  let count = 0;
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of segmenter.segment(text)) {
      if (!WHITESPACE_RUN.test(segment)) count += 1;
    }
    return count;
  }
  for (const codePoint of text) {
    if (!WHITESPACE_RUN.test(codePoint)) count += 1;
  }
  return count;
}

/**
 * 번역문 묶음에서 분모를 센다.
 *
 *  · `words`      — 공백 분절. 한국어 어절은 세지만 **중국어·일본어는 크게 과소계상**한다.
 *                   이 왜곡이 §4 도입부에서 말한, 문자 분모가 필요한 바로 그 이유다.
 *  · `characters` — 공백을 뺀 자소 군집 수. 공백 관행이 언어마다 달라서(중국어는 0, 독일어는
 *                   합성어로 적음) 공백을 포함하면 분모가 언어에 따라 흔들린다.
 *  · `lines`      — 개행으로 나뉜 비어 있지 않은 줄 수. **[정책]** ISO 의 "line" 정의(번역업계의
 *                   고정 문자 수 기준 행)는 확인하지 못했으므로, 이 저장소는 "저자가 친 줄"로
 *                   정의한다. 말풍선 한 개가 보통 1~3줄이다.
 */
export function countStudioMqmScoringUnits(
  texts: readonly string[],
  unit: StudioMqmDenominatorUnit,
): number {
  let total = 0;
  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) continue;
    if (unit === "words") {
      total += text.split(WHITESPACE_RUN).filter((word) => word.length > 0).length;
    } else if (unit === "characters") {
      total += countGraphemesExcludingWhitespace(text);
    } else {
      total += text.split("\n").filter((line) => line.trim().length > 0).length;
    }
  }
  return total;
}

export function studioMqmDenominator(
  texts: readonly string[],
  unit: StudioMqmDenominatorUnit,
): StudioMqmDenominator {
  return Object.freeze({
    unit,
    count: countStudioMqmScoringUnits(texts, unit),
    thresholdCalibrated: unit === "words",
  });
}

// ── §5. APT / PWPT / NPT / QS 와 판정 ────────────────────────────────────────

export type StudioMqmVerdict = "pass" | "fail" | "unscorable";

export type StudioMqmFailReason =
  | "critical-error"
  | "below-threshold"
  | "empty-denominator";

export interface StudioMqmDimensionRollup {
  readonly dimension: StudioMqmDimensionId;
  readonly label: string;
  readonly errorCount: number;
  /** 이 차원이 APT 에 기여한 몫. 어디를 고쳐야 점수가 가장 많이 오르는지가 여기서 보인다. */
  readonly penalty: number;
  readonly counts: Readonly<Record<StudioMqmSeverity, number>>;
}

export interface StudioMqmSampleSize {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  /**
   * 표본이 MQM 이 요구하는 500~20,000 구간 안인가. `words` 분모일 때만 판단한다 — 문자/행
   * 분모의 유효 표본 크기는 출처가 없어 **null**(판단 불가)로 둔다.
   */
  readonly inRange: boolean | null;
}

export interface StudioMqmScoreResult {
  readonly basis: "mqm-core";
  readonly rulesetVersion: typeof STUDIO_LOCALIZATION_MQM_RULESET_VERSION;
  /** 어떤 분모로 쟀는지. **암묵이 아니라 명시**다. [ISO] */
  readonly denominator: StudioMqmDenominator;
  /** Absolute Penalty Total = Σ(심각도 배수 × ETW). */
  readonly apt: number;
  /** Per-Word Penalty Total = APT / 분모. (분모가 단어가 아니면 "per-unit"으로 읽는다.) */
  readonly pwpt: number | null;
  /** Normalized Penalty Total = PWPT × 1000. */
  readonly npt: number | null;
  /** Quality Score = 100 − PWPT × 100. */
  readonly qualityScore: number | null;
  readonly passThreshold: number;
  readonly verdict: StudioMqmVerdict;
  readonly failReason: StudioMqmFailReason | null;
  readonly counts: Readonly<Record<StudioMqmSeverity, number>>;
  readonly sampleSize: StudioMqmSampleSize;
  readonly byDimension: readonly StudioMqmDimensionRollup[];
  readonly errors: readonly StudioMqmError[];
}

/**
 * 부동소수 표현 오차를 제거한 결정적 반올림.
 *
 * `98.7` 같은 값이 `98.69999999999999` 로 나오는 것을 그대로 임계값과 비교하면 경계에서 판정이
 * 흔들린다. `toFixed` 는 double 의 정확한 값을 십진으로 반올림하므로 이 용도에 맞다.
 */
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimals));
}

const APT_DECIMALS = 4;
const PWPT_DECIMALS = 6;
const NPT_DECIMALS = 4;
const QUALITY_SCORE_DECIMALS = 4;

/**
 * QS 의 곱수 100.
 *
 * 출처는 `QS = 100 - defect portion` 이라고만 쓰고 defect portion 의 식을 따로 인쇄하지 않았다.
 * 다만 같은 출처가 기준점을 함께 준다: "raw passing threshold 99 (about 1 point per 100 words)".
 * 100단어에 minor 1건이면 APT=1, PWPT=0.01 이고 여기서 QS 가 정확히 99가 되려면 곱수는 100뿐이다.
 * 즉 이 상수는 **인용된 두 값에서 역산한 파생값**이며, 별도로 출판된 수치가 아니다.
 */
const QUALITY_SCORE_MULTIPLIER = 100;

function emptyCounts(): Record<StudioMqmSeverity, number> {
  return { neutral: 0, minor: 0, major: 0, critical: 0 };
}

/**
 * 정규화된 오류 목록과 분모로 MQM 점수를 낸다.
 *
 * 판정 순서가 중요하다:
 *  1. 분모가 0 이면 **점수 자체가 정의되지 않는다** → `unscorable`. 0으로 나눠 Infinity 를 내거나
 *     "오류가 없으니 100점"이라고 말하는 쪽이 훨씬 나쁘다(빈 회차가 만점으로 통과한다).
 *  2. Critical 이 1건이라도 있으면 점수와 무관하게 Fail. [MQM]
 *  3. 그다음에 QS < 99 판정.
 */
export function scoreStudioMqmErrors(
  errorInputs: readonly StudioMqmErrorInput[],
  denominator: StudioMqmDenominator,
): StudioMqmScoreResult {
  const errors = errorInputs
    .map((input, index) => normalizeStudioMqmError(input, index))
    .sort(compareErrors);

  const counts = emptyCounts();
  let aptRaw = 0;
  for (const error of errors) {
    counts[error.severity] += 1;
    aptRaw += error.penalty;
  }
  const apt = roundTo(aptRaw, APT_DECIMALS);

  const byDimension = STUDIO_MQM_DIMENSIONS.flatMap((dimension) => {
    const scoped = errors.filter((error) => error.dimension === dimension.id);
    if (scoped.length === 0) return [];
    const dimensionCounts = emptyCounts();
    let penalty = 0;
    for (const error of scoped) {
      dimensionCounts[error.severity] += 1;
      penalty += error.penalty;
    }
    return [
      Object.freeze({
        dimension: dimension.id,
        label: dimension.label,
        errorCount: scoped.length,
        penalty: roundTo(penalty, APT_DECIMALS),
        counts: Object.freeze(dimensionCounts),
      }),
    ];
  });

  const sampleSize: StudioMqmSampleSize = Object.freeze({
    count: denominator.count,
    min: STUDIO_MQM_SAMPLE_MIN_WORDS,
    max: STUDIO_MQM_SAMPLE_MAX_WORDS,
    inRange:
      denominator.unit === "words"
        ? denominator.count >= STUDIO_MQM_SAMPLE_MIN_WORDS &&
          denominator.count <= STUDIO_MQM_SAMPLE_MAX_WORDS
        : null,
  });

  const shared = {
    basis: "mqm-core",
    rulesetVersion: STUDIO_LOCALIZATION_MQM_RULESET_VERSION,
    denominator,
    apt,
    passThreshold: STUDIO_MQM_PASS_THRESHOLD,
    counts: Object.freeze(counts),
    sampleSize,
    byDimension: Object.freeze(byDimension),
    errors: Object.freeze(errors),
  } as const;

  if (denominator.count <= 0) {
    return Object.freeze({
      ...shared,
      pwpt: null,
      npt: null,
      qualityScore: null,
      verdict: "unscorable",
      failReason: "empty-denominator",
    });
  }

  const pwptRaw = aptRaw / denominator.count;
  const qualityScore = roundTo(
    100 - pwptRaw * QUALITY_SCORE_MULTIPLIER,
    QUALITY_SCORE_DECIMALS,
  );

  const failReason: StudioMqmFailReason | null =
    STUDIO_MQM_CRITICAL_AUTO_FAIL && counts.critical > 0
      ? "critical-error"
      : qualityScore < STUDIO_MQM_PASS_THRESHOLD
        ? "below-threshold"
        : null;

  return Object.freeze({
    ...shared,
    pwpt: roundTo(pwptRaw, PWPT_DECIMALS),
    npt: roundTo(pwptRaw * 1000, NPT_DECIMALS),
    qualityScore,
    verdict: failReason === null ? "pass" : "fail",
    failReason,
  });
}

// ── §6. Design and markup > Truncation/text expansion ────────────────────────
//
// MQM 38개 서브타입 중 **렌더러가 사람 없이 혼자 판정할 수 있는 유일한 클래스**다. 나머지는 원문
// 대조나 독자 판단이 필요하지만, "번역문이 말풍선을 넘쳤는가"는 조판 산술만으로 결정된다.
// 넘침 게이트(`bubbleTextFitsInBox` 계열)가 여기로 관측치를 흘려보내면 MQM 오류가 되어 나온다.

export interface StudioMqmTruncationObservation {
  readonly cueId: string;
  readonly page?: number;
  readonly panel?: number;
  /** 상자 안에 들어가는가. 넘침 게이트의 최종 판정. */
  readonly fits: boolean;
  /**
   * 렌더가 실제로 글자를 **버렸는가**. Konva.Text 는 height 가 고정이면 남는 줄을 경고 없이
   * 버린다(`_setTextData`: `if (fixedHeight && currentHeightPx + lineHeightPx > maxHeightPx) break;`)
   * — `studio-bubble-text-fit.ts` 헤더가 기록한, 대사가 조용히 사라진 실제 결함이다.
   */
  readonly textLost?: boolean;
  /** 자동 축소 후 폰트비 = 최종 / 저자 지정. 1 = 축소 없음. */
  readonly shrinkRatio?: number;
  /** 원문 대비 번역문 길이비(em 폭 기준 권장). 1.4 = 40% 팽창. 증거로만 싣는다. */
  readonly expansionRatio?: number;
}

/**
 * **[정책]** 가독 하한 — 저자 지정 폰트의 80%.
 *
 * MQM 도 ISO 도 "몇 % 축소부터 결함인가"를 규정하지 않는다. 이 값은 이 저장소가 정한 것이며,
 * 상자에는 들어가지만 글자를 이만큼 줄여야 했다면 그 말풍선은 다른 말풍선과 조판이 어긋난다는
 * 판단이다. `options.legibleShrinkRatio` 로 갈아끼울 수 있다.
 */
export const STUDIO_MQM_LEGIBLE_SHRINK_RATIO = 0.8;

export interface StudioMqmTruncationOptions {
  readonly legibleShrinkRatio?: number;
}

/**
 * 넘침 관측치를 MQM 오류로 옮긴다. 심각도 사다리는 **[정책]**이며 근거는 다음과 같다:
 *
 *  · `textLost` → **Critical**. 독자가 저자가 쓴 문장을 볼 수 없다 = 콘텐츠가 사용 불가.
 *    Critical 1건은 자동 Fail 이고(§5), 대사가 실제로 사라진 회차는 나가면 안 되므로 의도한 결과다.
 *  · `fits === false` → **Major**. 말풍선 밖으로 삐져나온다. 눈에 띄게 망가지지만 글자는 남아 있다.
 *  · 들어가되 `shrinkRatio < 0.8` → **Minor**. 읽히지만 조판이 어긋난다.
 *  · 그 외 → 오류 없음.
 *
 * `expansionRatio` 단독으로는 오류를 만들지 않는다. 팽창률만으로는 넘칠지 알 수 없고(상자가 크면
 * 40% 팽창해도 멀쩡하다) 레이아웃 정보 없이 판정하면 오탐이 된다 — 증거 필드로만 싣는다.
 */
export function detectStudioMqmTruncationErrors(
  observations: readonly StudioMqmTruncationObservation[],
  options?: StudioMqmTruncationOptions,
): readonly StudioMqmErrorInput[] {
  const rawFloor = options?.legibleShrinkRatio;
  const legibleFloor =
    typeof rawFloor === "number" && Number.isFinite(rawFloor) && rawFloor > 0
      ? rawFloor
      : STUDIO_MQM_LEGIBLE_SHRINK_RATIO;

  const out: StudioMqmErrorInput[] = [];
  for (const observation of observations) {
    const shrinkRatio = observation.shrinkRatio;
    const shrunkBelowFloor =
      typeof shrinkRatio === "number" &&
      Number.isFinite(shrinkRatio) &&
      shrinkRatio < legibleFloor;

    let severity: StudioMqmSeverity | null = null;
    let note = "";
    if (observation.textLost === true) {
      severity = "critical";
      note = "말풍선 높이에 맞지 않아 렌더가 대사 일부를 버렸습니다.";
    } else if (!observation.fits) {
      severity = "major";
      note = "번역문이 말풍선을 넘칩니다.";
    } else if (shrunkBelowFloor) {
      severity = "minor";
      note = `글자를 ${Math.round((shrinkRatio as number) * 100)}%까지 줄여야 들어갑니다.`;
    }
    if (severity === null) continue;

    const evidence: Record<string, number | string | boolean> = { fits: observation.fits };
    if (observation.textLost !== undefined) evidence.textLost = observation.textLost;
    if (typeof shrinkRatio === "number" && Number.isFinite(shrinkRatio)) {
      evidence.shrinkRatio = shrinkRatio;
    }
    if (
      typeof observation.expansionRatio === "number" &&
      Number.isFinite(observation.expansionRatio)
    ) {
      evidence.expansionRatio = observation.expansionRatio;
    }

    out.push({
      id: `truncation:${observation.cueId}`,
      subtype: "truncation-text-expansion",
      severity,
      cueId: observation.cueId,
      ...(observation.page === undefined ? {} : { page: observation.page }),
      ...(observation.panel === undefined ? {} : { panel: observation.panel }),
      note,
      evidence: Object.freeze(evidence),
    });
  }
  return Object.freeze(out);
}

// ── §7. WMT 2021 운영 변형 ───────────────────────────────────────────────────

/**
 * WMT 계열 MT 평가에서 쓰는 운영 변형. [WMT: Freitag et al., TACL 2021, Table 4]
 *
 * 심각도 배수 자체는 MQM-Core 와 같지만(Major/Non-translation 25 = Critical, Major 5, Minor 1,
 * Neutral 0) 두 가지가 다르다:
 *  · Minor Fluency/Punctuation 만 0.1 — 심각도가 아니라 **오류 유형별 가중치(ETW)** 다. 그래서
 *    심각도 표를 건드리지 않고 ETW 값으로 싣는다. 해당 서브타입 이름은 이 저장소의 카탈로그에
 *    아직 없으므로(§2), 호출부가 `typeWeight` 로 직접 적용한다.
 *  · **세그먼트당 최대 5건** — 한 문장에 오류가 몰렸을 때 점수가 무한히 깎이는 것을 막는다.
 */
export const STUDIO_MQM_WMT_2021 = Object.freeze({
  minorFluencyPunctuationTypeWeight: 0.1,
  maxErrorsPerSegment: 5,
});

/**
 * 세그먼트(= 대사 큐)당 오류 개수를 상한으로 자른다. [WMT]
 *
 * 심각한 것부터 남기므로, 잘려 나가는 것은 항상 그 세그먼트에서 **가장 가벼운** 오류다. cueId 가
 * 없는 오류는 세그먼트에 속하지 않는 것으로 보고 상한을 적용하지 않는다.
 */
export function capStudioMqmErrorsPerSegment(
  errorInputs: readonly StudioMqmErrorInput[],
  maxErrorsPerSegment: number = STUDIO_MQM_WMT_2021.maxErrorsPerSegment,
): readonly StudioMqmErrorInput[] {
  if (!Number.isFinite(maxErrorsPerSegment) || maxErrorsPerSegment < 0) return errorInputs;
  const cap = Math.floor(maxErrorsPerSegment);

  const ranked = errorInputs
    .map((input, index) => ({ input, index, normalized: normalizeStudioMqmError(input, index) }))
    .sort(
      (left, right) =>
        compareErrors(left.normalized, right.normalized) || left.index - right.index,
    );

  const perSegment = new Map<string, number>();
  const kept = new Set<number>();
  for (const entry of ranked) {
    const cueId = entry.normalized.cueId;
    if (cueId === null) {
      kept.add(entry.index);
      continue;
    }
    const used = perSegment.get(cueId) ?? 0;
    if (used >= cap) continue;
    perSegment.set(cueId, used + 1);
    kept.add(entry.index);
  }

  // 입력 순서를 보존해 돌려준다 — 정렬은 §5 의 채점기가 다시 한다.
  return Object.freeze(errorInputs.filter((_, index) => kept.has(index)));
}
