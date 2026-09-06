/**
 * 툰 스튜디오 연속성 린트의 순수 코어.
 *
 * 자유문장을 추론하지 않고, 캐릭터 바이블과 장면 비트에 명시된 구조화 값만
 * NFKC/공백/대소문자 정규화 후 정확히 비교한다. 배열 순서가 곧 장면 순서다.
 */

export type StudioContinuitySeverity = "error" | "warning";

export type StudioContinuityIssueCode =
  | "DUPLICATE_CHARACTER_NAME"
  | "MISSING_CHARACTER_APPEARANCE"
  | "MISSING_CHARACTER_VOICE"
  | "MISSING_CHARACTER_GOAL"
  | "UNKNOWN_CHARACTER"
  | "LOCATION_CONTINUITY_CONTRADICTION"
  | "TIME_CONTINUITY_CONTRADICTION"
  | "COSTUME_CONTINUITY_CONTRADICTION"
  | "PROP_CONTINUITY_CONTRADICTION";

export interface StudioContinuityIssue {
  severity: StudioContinuitySeverity;
  code: StudioContinuityIssueCode;
  message: string;
  /** 관련 장면 id. 바이블 자체 문제에는 빈 배열을 반환한다. */
  sceneRefs: string[];
}

export interface StudioCharacterBibleFact {
  name: string;
  appearance?: string | null;
  voice?: string | null;
  goal?: string | null;
}

export type StudioContinuityNamedValues = Readonly<
  Record<string, string | null | undefined>
>;

export interface StudioContinuityTransitionExplanations {
  /** 장소가 직전 명시 값과 달라지는 이유. */
  location?: string | null;
  /** 시간이 직전 명시 값과 달라지는 이유. */
  time?: string | null;
  /** 캐릭터 이름별 의상 변경 이유. */
  costumes?: StudioContinuityNamedValues;
  /** 소품 이름별 상태 변경 이유. */
  props?: StudioContinuityNamedValues;
}

export interface StudioStoryBeat {
  sceneId: string;
  /** 이 장면에 명시적으로 등장하거나 언급되는 캐릭터 이름. */
  characterNames?: readonly string[];
  location?: string | null;
  time?: string | null;
  /** 캐릭터 이름 → 의상 상태. */
  costumes?: StudioContinuityNamedValues;
  /** 소품 이름 → 소품 상태/소유/위치. */
  props?: StudioContinuityNamedValues;
  /** 현재 장면에서 발생한 변경을 설명하는 구조화 필드. */
  transitionExplanations?: StudioContinuityTransitionExplanations;
}

export interface StudioContinuityLintInput {
  characters: readonly StudioCharacterBibleFact[];
  /** 배열 순서가 이야기 순서다. */
  beats: readonly StudioStoryBeat[];
}

type PreviousValue = {
  sceneId: string;
  display: string;
  normalized: string;
};

type NormalizedNamedValue = {
  key: string;
  displayKey: string;
  displayValue: string;
  normalizedValue: string;
};

function displayText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** 정규화된 정확 일치를 위한 키. 의미·동의어·자연어 추론은 하지 않는다. */
export function normalizeStudioContinuityValue(value: string): string {
  return displayText(value).toLowerCase();
}

function hasExplicitText(value: string | null | undefined): value is string {
  return typeof value === "string" && displayText(value).length > 0;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeNamedValues(values: StudioContinuityNamedValues | undefined): NormalizedNamedValue[] {
  if (!values) return [];
  const entries = Object.entries(values)
    .filter((entry): entry is [string, string] => hasExplicitText(entry[0]) && hasExplicitText(entry[1]))
    .map(([rawKey, rawValue]) => ({
      key: normalizeStudioContinuityValue(rawKey),
      displayKey: displayText(rawKey),
      displayValue: displayText(rawValue),
      normalizedValue: normalizeStudioContinuityValue(rawValue),
    }))
    .sort((a, b) => compareText(a.key, b.key) || compareText(a.displayKey, b.displayKey));

  // 정규화 뒤 같은 키가 된 중복 입력은 정렬상 첫 값을 사용해 결과를 결정적으로 유지한다.
  return entries.filter((entry, index) => index === 0 || entries[index - 1].key !== entry.key);
}

function normalizedExplanationKeys(values: StudioContinuityNamedValues | undefined): Set<string> {
  return new Set(normalizeNamedValues(values).map((entry) => entry.key));
}

function characterLabel(character: StudioCharacterBibleFact): string {
  return hasExplicitText(character.name) ? displayText(character.name) : "이름 없는 캐릭터";
}

function lintCharacterBible(
  characters: readonly StudioCharacterBibleFact[],
  issues: StudioContinuityIssue[]
): Set<string> {
  const knownNames = new Set<string>();
  const groups = new Map<string, { display: string; count: number }>();

  for (const character of characters) {
    if (!hasExplicitText(character.name)) continue;
    const key = normalizeStudioContinuityValue(character.name);
    knownNames.add(key);
    const previous = groups.get(key);
    if (previous) previous.count += 1;
    else groups.set(key, { display: displayText(character.name), count: 1 });
  }

  for (const group of groups.values()) {
    if (group.count < 2) continue;
    issues.push({
      severity: "error",
      code: "DUPLICATE_CHARACTER_NAME",
      message: `캐릭터 이름 "${group.display}"이(가) ${group.count}번 중복되었습니다.`,
      sceneRefs: [],
    });
  }

  const requiredFacts: ReadonlyArray<{
    field: "appearance" | "voice" | "goal";
    label: string;
    code:
      | "MISSING_CHARACTER_APPEARANCE"
      | "MISSING_CHARACTER_VOICE"
      | "MISSING_CHARACTER_GOAL";
  }> = [
    { field: "appearance", label: "외형", code: "MISSING_CHARACTER_APPEARANCE" },
    { field: "voice", label: "말투", code: "MISSING_CHARACTER_VOICE" },
    { field: "goal", label: "목표", code: "MISSING_CHARACTER_GOAL" },
  ];

  for (const character of characters) {
    for (const required of requiredFacts) {
      if (hasExplicitText(character[required.field])) continue;
      issues.push({
        severity: "warning",
        code: required.code,
        message: `${characterLabel(character)}의 필수 ${required.label} 정보가 없습니다.`,
        sceneRefs: [],
      });
    }
  }
  return knownNames;
}

function lintScalarContinuity(
  beat: StudioStoryBeat,
  field: "location" | "time",
  previous: PreviousValue | undefined,
  issues: StudioContinuityIssue[]
): PreviousValue | undefined {
  const raw = beat[field];
  if (!hasExplicitText(raw)) return previous;

  const current: PreviousValue = {
    sceneId: beat.sceneId,
    display: displayText(raw),
    normalized: normalizeStudioContinuityValue(raw),
  };
  const explanation = beat.transitionExplanations?.[field];
  if (previous && previous.normalized !== current.normalized && !hasExplicitText(explanation)) {
    const isLocation = field === "location";
    issues.push({
      severity: "warning",
      code: isLocation
        ? "LOCATION_CONTINUITY_CONTRADICTION"
        : "TIME_CONTINUITY_CONTRADICTION",
      message: `${isLocation ? "장소가" : "시간이"} "${previous.display}"에서 "${current.display}"(으)로 바뀌었지만 전환 설명이 없습니다.`,
      sceneRefs: [previous.sceneId, current.sceneId],
    });
  }
  return current;
}

function lintNamedContinuity(
  beat: StudioStoryBeat,
  kind: "costume" | "prop",
  previousByKey: Map<string, PreviousValue>,
  issues: StudioContinuityIssue[]
): void {
  const values = normalizeNamedValues(kind === "costume" ? beat.costumes : beat.props);
  const explanations = normalizedExplanationKeys(
    kind === "costume"
      ? beat.transitionExplanations?.costumes
      : beat.transitionExplanations?.props
  );

  for (const value of values) {
    const previous = previousByKey.get(value.key);
    const current: PreviousValue = {
      sceneId: beat.sceneId,
      display: value.displayValue,
      normalized: value.normalizedValue,
    };
    if (previous && previous.normalized !== current.normalized && !explanations.has(value.key)) {
      issues.push({
        severity: "warning",
        code:
          kind === "costume"
            ? "COSTUME_CONTINUITY_CONTRADICTION"
            : "PROP_CONTINUITY_CONTRADICTION",
        message: `${kind === "costume" ? "캐릭터" : "소품"} "${value.displayKey}"의 ${
          kind === "costume" ? "의상이" : "상태가"
        } "${previous.display}"에서 "${current.display}"(으)로 바뀌었지만 전환 설명이 없습니다.`,
        sceneRefs: [previous.sceneId, current.sceneId],
      });
    }
    previousByKey.set(value.key, current);
  }
}

/**
 * 구조화된 캐릭터 바이블과 이야기 비트를 검사한다.
 *
 * 문제 순서는 바이블 문제 → 각 장면의 미등록 캐릭터 → 장소 → 시간 → 의상 → 소품이며,
 * 의상·소품 키는 정렬한다. 같은 입력은 언제나 같은 결과 순서를 낸다.
 */
export function lintStudioContinuity(input: StudioContinuityLintInput): StudioContinuityIssue[] {
  const issues: StudioContinuityIssue[] = [];
  const knownNames = lintCharacterBible(input.characters, issues);
  let previousLocation: PreviousValue | undefined;
  let previousTime: PreviousValue | undefined;
  const previousCostumes = new Map<string, PreviousValue>();
  const previousProps = new Map<string, PreviousValue>();

  for (const beat of input.beats) {
    const mentioned = new Set<string>();
    for (const rawName of beat.characterNames ?? []) {
      if (!hasExplicitText(rawName)) continue;
      const key = normalizeStudioContinuityValue(rawName);
      if (mentioned.has(key)) continue;
      mentioned.add(key);
      if (!knownNames.has(key)) {
        issues.push({
          severity: "error",
          code: "UNKNOWN_CHARACTER",
          message: `장면 "${beat.sceneId}"에 바이블에 없는 캐릭터 "${displayText(rawName)}"이(가) 언급되었습니다.`,
          sceneRefs: [beat.sceneId],
        });
      }
    }

    previousLocation = lintScalarContinuity(
      beat,
      "location",
      previousLocation,
      issues
    );
    previousTime = lintScalarContinuity(beat, "time", previousTime, issues);
    lintNamedContinuity(beat, "costume", previousCostumes, issues);
    lintNamedContinuity(beat, "prop", previousProps, issues);
  }

  return issues;
}
