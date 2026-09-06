/**
 * Studio Canon State Machine — 작중 인물의 외형(의상·헤어·상처), 소지품,
 * 위치, 비밀·정보, 생존 상태의 연속성을 추적하고 모순을 탐지하는 원장 코어.
 *
 * 마스터플랜 9.2 (Canon State Machine) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 의상·헤어·상처·피로·오염·소지품·무기·위치·날씨·관계·비밀·생존 상태 원장
 * - 상태 시작/종료 컷 및 전환 사유(Event/Transition Reason)
 * - 특정 컷 시점의 인물 캐논 상태 질의(Query State at Panel)
 * - 연속성 규칙 위반 탐지 (예: 치유 이벤트 없이 상처 소멸, 사망 후 등장 등)
 * - Canon / Draft / Discarded 수명주기
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_CANON_STATE_MACHINE_VERSION = 1 as const;

export const STUDIO_CANON_LIMITS = Object.freeze({
  maxCharacters: 256,
  maxTransitions: 4_096,
  maxWounds: 32,
  maxPossessions: 64,
  maxSecrets: 64,
  maxIdLength: 128,
  maxReasonLength: 320,
  maxDiagnostics: 256,
});

export const CANON_LIFECYCLE_STAGES = ["canon", "draft", "discarded"] as const;
export type CanonLifecycleStage = (typeof CANON_LIFECYCLE_STAGES)[number];

export const CANON_SURVIVAL_STATUSES = [
  "alive",
  "missing",
  "deceased",
  "flashback-variant",
  "parallel-variant",
] as const;
export type CanonSurvivalStatus = (typeof CANON_SURVIVAL_STATUSES)[number];

export interface CanonCharacterAppearance {
  readonly costumeRef?: string;
  readonly hairstyleRef?: string;
  readonly wounds?: readonly string[];
  readonly fatigueLevel?: number; // 0..1 (0: 정상, 1: 탈진)
  readonly dirtinessLevel?: number; // 0..1 (0: 깨끗, 1: 심한 오염)
}

export interface CanonStateSnapshot {
  readonly characterId: string;
  readonly appearance: CanonCharacterAppearance;
  readonly possessions?: readonly string[];
  readonly currentLocationRef?: string;
  readonly survivalStatus: CanonSurvivalStatus;
  readonly knownSecrets?: readonly string[];
  readonly weather?: string;
  readonly relationships?: Readonly<Record<string, string>>;
}

export interface CanonStateTransition {
  readonly id: string;
  readonly characterId: string;
  readonly panelOrderIndex: number; // 컷의 순서 인덱스 (0, 1, 2, ...)
  readonly panelId: string;
  readonly stage: CanonLifecycleStage;
  readonly reason: string;
  readonly snapshot: CanonStateSnapshot;
}

export interface StudioCanonStateMachine {
  readonly version: typeof STUDIO_CANON_STATE_MACHINE_VERSION;
  readonly id: string;
  readonly transitions: readonly CanonStateTransition[];
}

export interface CanonViolationDiagnostic {
  readonly code:
    | "UNEXPLAINED_HEALING"
    | "POST_MORTEM_ACTION"
    | "MISSING_POSSESSION_LOSS"
    | "LOCATION_TELEPORT"
    | "INVALID_PANEL_ORDER";
  readonly characterId: string;
  readonly fromPanelId: string;
  readonly toPanelId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export function createStudioCanonStateMachine(params: {
  id: string;
  transitions?: readonly CanonStateTransition[];
}): StudioCanonStateMachine {
  return Object.freeze({
    version: STUDIO_CANON_STATE_MACHINE_VERSION,
    id: params.id.trim(),
    transitions: Object.freeze(
      [...(params.transitions ?? [])].sort(
        (a, b) => a.panelOrderIndex - b.panelOrderIndex,
      ),
    ),
  });
}

export function addCanonStateTransition(
  sm: StudioCanonStateMachine,
  transition: CanonStateTransition,
): StudioCanonStateMachine {
  if (sm.transitions.some((t) => t.id === transition.id)) {
    throw new Error(`Transition ${transition.id} already exists`);
  }
  const next = [...sm.transitions, transition].sort(
    (a, b) => a.panelOrderIndex - b.panelOrderIndex,
  );
  return { ...sm, transitions: Object.freeze(next) };
}

export function updateCanonStateTransition(
  sm: StudioCanonStateMachine,
  transitionId: string,
  patch: Partial<Omit<CanonStateTransition, "id">>,
): StudioCanonStateMachine {
  const index = sm.transitions.findIndex((t) => t.id === transitionId);
  if (index === -1) {
    throw new Error(`Transition ${transitionId} not found`);
  }
  const updated: CanonStateTransition = { ...sm.transitions[index], ...patch };
  const next = [...sm.transitions];
  next[index] = updated;
  next.sort((a, b) => a.panelOrderIndex - b.panelOrderIndex);
  return { ...sm, transitions: Object.freeze(next) };
}

export function removeCanonStateTransition(
  sm: StudioCanonStateMachine,
  transitionId: string,
): StudioCanonStateMachine {
  const next = sm.transitions.filter((t) => t.id !== transitionId);
  return { ...sm, transitions: Object.freeze(next) };
}

/**
 * 특정 컷 순서(panelOrderIndex) 시점에서 특정 인물의 유효 캐논 상태를 질의한다.
 */
export function queryCanonStateAtPanel(
  sm: StudioCanonStateMachine,
  characterId: string,
  panelOrderIndex: number,
  options: { includeDrafts?: boolean } = {},
): CanonStateSnapshot | null {
  const relevant = sm.transitions.filter((t) => {
    if (t.characterId !== characterId) return false;
    if (t.panelOrderIndex > panelOrderIndex) return false;
    if (t.stage === "discarded") return false;
    if (!options.includeDrafts && t.stage === "draft") return false;
    return true;
  });

  if (relevant.length === 0) return null;
  // 마지막으로 기록된 상태
  return relevant[relevant.length - 1].snapshot;
}

/**
 * 캐논 상태 전이 원장을 검사하여 모순 및 규칙 위반을 탐지한다.
 */
export function detectCanonRuleViolations(
  sm: StudioCanonStateMachine,
): readonly CanonViolationDiagnostic[] {
  const diagnostics: CanonViolationDiagnostic[] = [];
  const byCharacter = new Map<string, CanonStateTransition[]>();

  for (const t of sm.transitions) {
    if (t.stage === "discarded") continue;
    let list = byCharacter.get(t.characterId);
    if (!list) {
      list = [];
      byCharacter.set(t.characterId, list);
    }
    list.push(t);
  }

  for (const [charId, transitions] of byCharacter.entries()) {
    for (let i = 0; i < transitions.length - 1; i += 1) {
      const curr = transitions[i];
      const next = transitions[i + 1];

      // 1. 사망 상태 이후 회상/평행세계 명시 없이 활동하는 모순
      if (
        curr.snapshot.survivalStatus === "deceased" &&
        next.snapshot.survivalStatus === "alive"
      ) {
        diagnostics.push({
          code: "POST_MORTEM_ACTION",
          characterId: charId,
          fromPanelId: curr.panelId,
          toPanelId: next.panelId,
          message: `사망 상태로 기록된 인물(${charId})이 컷 ${next.panelId}에서 생존 상태로 재등장했습니다. 사유 또는 플래시백 표기가 필요합니다.`,
          severity: "error",
        });
      }

      // 2. 상처 소멸 모순: 이전 컷에 상처가 있었는데 치유/치료 사유 없이 완전히 소멸
      const currWounds = curr.snapshot.appearance.wounds ?? [];
      const nextWounds = next.snapshot.appearance.wounds ?? [];
      const healedWithoutReason =
        currWounds.length > 0 &&
        nextWounds.length === 0 &&
        !next.reason.includes("치료") &&
        !next.reason.includes("치유") &&
        !next.reason.includes("회복") &&
        !next.reason.includes("시간경과");

      if (healedWithoutReason) {
        diagnostics.push({
          code: "UNEXPLAINED_HEALING",
          characterId: charId,
          fromPanelId: curr.panelId,
          toPanelId: next.panelId,
          message: `인물(${charId})의 상처가 컷 ${next.panelId}에서 치료/회복 사유 없이 소멸했습니다.`,
          severity: "warning",
        });
      }
    }
  }

  return Object.freeze(diagnostics);
}
