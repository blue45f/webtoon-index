// VRM 스프링본 오써링 모델 — 사용자가 스튜디오에서 조작하고 문서에 저장되는 직렬화 가능한 설정.
//
// 이 파일은 "숫자와 문자열"만 다룬다(three 의존 없음). 시뮬레이션은 studio-vrm-springbone-core 가,
// 실제 VRM 조인트 배선은 studio-vrm-springbone-bridge 가 담당한다.
//
// 결정성 원칙:
//  - 바람은 시계가 아니라 (seed, phase, phaseStep) 로만 정의된다. phaseStep = 0 이 기본값이라
//    기본 설정에서는 캡처가 항상 같은 프레임으로 정착한다.
//  - parse 는 어떤 쓰레기 입력이 와도 반드시 정규화된 설정을 돌려준다(throw 하지 않는다).

import {
  SPRING_SETTLE_DT,
  SPRING_SETTLE_EPSILON,
  SPRING_SETTLE_MAX_STEPS,
  SPRING_SETTLE_STEPS,
  createStudioVrmSpringBoneState,
  springNormalize,
  springVec3FromTuple,
  type SpringChainDef,
  type SpringCollider,
  type SpringQuat,
  type SpringVec3,
  type SpringVec3Tuple,
  type SpringWind,
  type StudioVrmSpringBoneState,
} from "./studio-vrm-springbone-core";

export const STUDIO_VRM_SPRINGBONE_VERSION = 1 as const;

/* ── 프리셋 ─────────────────────────────────────────────────────────── */

export type SpringBonePresetId = "longHair" | "shortHair" | "skirt" | "ribbon" | "cape" | "tail";

export interface SpringBonePresetTuning {
  /** rest 복원력. 낮을수록 오래 늘어지고, 높을수록 곧게 선다. */
  stiffness: number;
  /** 관성 감쇠(0~1). 높을수록 빨리 멈춘다 = 정지 컷에서 흔들림 잔상이 적다. */
  drag: number;
  /** 중력 세기. */
  gravityPower: number;
  /** 충돌 반지름(모델 단위, 대략 1.0 = 캐릭터 키의 1/1.6). */
  hitRadius: number;
  /** 바람 민감도 배율(체인별 바람 가중). */
  windScale: number;
}

export interface SpringBonePreset {
  id: SpringBonePresetId;
  /** 한글 라벨(UI 표기). */
  label: string;
  /** 숫자 근거 요약. */
  note: string;
  tuning: SpringBonePresetTuning;
  /** 본 이름 매칭 키워드(소문자 부분일치). VRoid/VRM 표준 명명 + 한글 표기. */
  bonePatterns: readonly string[];
}

/**
 * 프리셋 수치 근거 — VRoid Studio 기본 흔들림 설정(stiffness 0.5~2.0, drag 0.3~0.7,
 * gravityPower 0.0~0.4)의 실측 범위 안에서, "정지 컷 1초 정착"을 기준으로 잡았다.
 * drag 가 높을수록 settle 스텝이 적게 든다(60스텝 = 1초 안에 수렴하도록 0.35 이상 유지).
 */
export const STUDIO_VRM_SPRINGBONE_PRESETS: readonly SpringBonePreset[] = Object.freeze([
  Object.freeze({
    id: "longHair",
    label: "긴 머리",
    note: "허리까지 오는 긴 머리. 복원력을 낮추고(0.70) 중력을 키워(0.28) 아래로 무겁게 늘어뜨린다.",
    tuning: { stiffness: 0.7, drag: 0.45, gravityPower: 0.28, hitRadius: 0.02, windScale: 1 },
    bonePatterns: Object.freeze(["hair", "kami", "머리", "髪"]),
  }),
  Object.freeze({
    id: "shortHair",
    label: "짧은 머리",
    note: "단발/앞머리. 복원력을 높여(1.60) 실루엣을 유지하고 중력은 최소(0.12)로 눌러둔다.",
    tuning: { stiffness: 1.6, drag: 0.65, gravityPower: 0.12, hitRadius: 0.015, windScale: 0.6 },
    // "front" 같은 일반 단어는 쓰지 않는다 — "Skirt_Front" 를 앞머리로 오인한다(체인 순서상 치마보다 먼저 걸린다).
    bonePatterns: Object.freeze(["bang", "maegami", "앞머리", "前髪"]),
  }),
  Object.freeze({
    id: "skirt",
    label: "치마",
    note: "다리 콜라이더에 부딪히는 천. 중력(0.35)이 가장 크고 hitRadius(0.03)도 가장 넓다.",
    tuning: { stiffness: 0.9, drag: 0.55, gravityPower: 0.35, hitRadius: 0.03, windScale: 0.8 },
    bonePatterns: Object.freeze(["skirt", "스커트", "치마", "スカート"]),
  }),
  Object.freeze({
    id: "ribbon",
    label: "리본",
    note: "가볍고 잘 날리는 장식. 복원력(0.45)·감쇠(0.35) 모두 최저라 바람에 가장 크게 반응한다.",
    tuning: { stiffness: 0.45, drag: 0.35, gravityPower: 0.18, hitRadius: 0.01, windScale: 1.6 },
    bonePatterns: Object.freeze(["ribbon", "bow", "리본"]),
  }),
  Object.freeze({
    id: "cape",
    label: "망토",
    note: "면적이 큰 겉옷. 무겁게(중력 0.32) 처지되 감쇠(0.60)를 높여 컷에서 펄럭임이 남지 않게 한다.",
    tuning: { stiffness: 1.1, drag: 0.6, gravityPower: 0.32, hitRadius: 0.035, windScale: 1.2 },
    bonePatterns: Object.freeze(["cape", "mant", "coat", "망토"]),
  }),
  Object.freeze({
    id: "tail",
    label: "꼬리",
    note: "수인/동물 캐릭터 꼬리. 자체 탄성이 커야(1.30) 축 늘어지지 않고 곡선을 유지한다.",
    tuning: { stiffness: 1.3, drag: 0.5, gravityPower: 0.14, hitRadius: 0.03, windScale: 0.5 },
    bonePatterns: Object.freeze(["tail", "shippo", "꼬리", "尻尾"]),
  }),
]);

export function findStudioVrmSpringBonePreset(id: string): SpringBonePreset | null {
  return STUDIO_VRM_SPRINGBONE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/* ── 오써링 타입 ────────────────────────────────────────────────────── */

export interface StudioVrmSpringBoneChainSettings {
  id: string;
  /** 한글 라벨(UI). */
  label: string;
  enabled: boolean;
  /** 파생 프리셋(수치를 직접 만졌으면 "custom"). */
  presetId: SpringBonePresetId | "custom";
  stiffness: number;
  drag: number;
  gravityPower: number;
  gravityDir: SpringVec3Tuple;
  hitRadius: number;
  windScale: number;
  /** 이 체인에 묶을 본 이름 키워드(소문자 부분일치). */
  bonePatterns: string[];
}

export type SpringColliderKind = "sphere" | "capsule";

export interface StudioVrmSpringBoneColliderSettings {
  id: string;
  label: string;
  enabled: boolean;
  kind: SpringColliderKind;
  /** 구 중심 / 캡슐 머리(월드 공간). */
  offset: SpringVec3Tuple;
  /** 캡슐 꼬리(월드 공간). sphere 일 때는 무시된다. */
  tail: SpringVec3Tuple;
  radius: number;
  /** true 면 안쪽에 가둔다. */
  inside: boolean;
}

export interface StudioVrmSpringBoneWindSettings {
  /** 수평 방위각(도). 0° = +X, 90° = +Z. */
  directionDeg: number;
  /** 고도각(도). +면 위로 부는 바람. */
  elevationDeg: number;
  strength: number;
  /** 돌풍 진폭 0~1. */
  turbulence: number;
  /** 정수 시드. */
  seed: number;
  phase: number;
  /** 스텝당 위상 증가. 0 = 정상풍(캡처 정착 가능). */
  phaseStep: number;
}

export interface StudioVrmSpringBoneSettleSettings {
  dt: number;
  steps: number;
  epsilon: number;
  maxSteps: number;
}

export interface StudioVrmSpringBoneAuthoring {
  version: typeof STUDIO_VRM_SPRINGBONE_VERSION;
  enabled: boolean;
  chains: StudioVrmSpringBoneChainSettings[];
  colliders: StudioVrmSpringBoneColliderSettings[];
  wind: StudioVrmSpringBoneWindSettings;
  settle: StudioVrmSpringBoneSettleSettings;
}

/* ── 정규화 유틸 ────────────────────────────────────────────────────── */

const LIMITS = {
  stiffness: [0, 4],
  drag: [0, 1],
  gravityPower: [0, 2],
  hitRadius: [0, 0.5],
  windScale: [0, 4],
  strength: [0, 2],
  turbulence: [0, 1],
  radius: [0.001, 2],
  dt: [1 / 480, 1 / 10],
  steps: [0, 2000],
  epsilon: [1e-9, 1],
  maxSteps: [1, 5000],
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampedNum(value: unknown, fallback: number, range: readonly [number, number]): number {
  return clamp(num(value, fallback), range[0], range[1]);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function tuple3(value: unknown, fallback: SpringVec3Tuple): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])];
  }
  return [fallback[0], fallback[1], fallback[2]];
}

function patterns(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...fallback];
}

/* ── 기본값 ─────────────────────────────────────────────────────────── */

export const DEFAULT_SPRING_GRAVITY_DIR: SpringVec3Tuple = Object.freeze([0, -1, 0]) as SpringVec3Tuple;

export function chainFromPreset(preset: SpringBonePreset): StudioVrmSpringBoneChainSettings {
  return {
    id: preset.id,
    label: preset.label,
    enabled: true,
    presetId: preset.id,
    stiffness: preset.tuning.stiffness,
    drag: preset.tuning.drag,
    gravityPower: preset.tuning.gravityPower,
    gravityDir: [DEFAULT_SPRING_GRAVITY_DIR[0], DEFAULT_SPRING_GRAVITY_DIR[1], DEFAULT_SPRING_GRAVITY_DIR[2]],
    hitRadius: preset.tuning.hitRadius,
    windScale: preset.tuning.windScale,
    bonePatterns: [...preset.bonePatterns],
  };
}

export const DEFAULT_SPRING_WIND: StudioVrmSpringBoneWindSettings = Object.freeze({
  directionDeg: 0,
  elevationDeg: 0,
  strength: 0,
  turbulence: 0,
  seed: 20260724,
  phase: 0,
  phaseStep: 0,
});

export const DEFAULT_SPRING_SETTLE: StudioVrmSpringBoneSettleSettings = Object.freeze({
  dt: SPRING_SETTLE_DT,
  steps: SPRING_SETTLE_STEPS,
  epsilon: SPRING_SETTLE_EPSILON,
  maxSteps: SPRING_SETTLE_MAX_STEPS,
});

export function defaultStudioVrmSpringBoneAuthoring(): StudioVrmSpringBoneAuthoring {
  return {
    version: STUDIO_VRM_SPRINGBONE_VERSION,
    enabled: true,
    chains: STUDIO_VRM_SPRINGBONE_PRESETS.map(chainFromPreset),
    colliders: [],
    wind: { ...DEFAULT_SPRING_WIND },
    settle: { ...DEFAULT_SPRING_SETTLE },
  };
}

/* ── 정규화 / 파싱 / 직렬화 ─────────────────────────────────────────── */

export function normalizeSpringChainSettings(
  raw: unknown,
  fallback: StudioVrmSpringBoneChainSettings
): StudioVrmSpringBoneChainSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const presetId = typeof value.presetId === "string" && findStudioVrmSpringBonePreset(value.presetId)
    ? (value.presetId as SpringBonePresetId)
    : value.presetId === "custom"
      ? "custom"
      : fallback.presetId;
  return {
    id: str(value.id, fallback.id),
    label: str(value.label, fallback.label),
    enabled: bool(value.enabled, fallback.enabled),
    presetId,
    stiffness: clampedNum(value.stiffness, fallback.stiffness, LIMITS.stiffness),
    drag: clampedNum(value.drag, fallback.drag, LIMITS.drag),
    gravityPower: clampedNum(value.gravityPower, fallback.gravityPower, LIMITS.gravityPower),
    gravityDir: tuple3(value.gravityDir, fallback.gravityDir),
    hitRadius: clampedNum(value.hitRadius, fallback.hitRadius, LIMITS.hitRadius),
    windScale: clampedNum(value.windScale, fallback.windScale, LIMITS.windScale),
    bonePatterns: patterns(value.bonePatterns, fallback.bonePatterns),
  };
}

export function normalizeSpringColliderSettings(
  raw: unknown,
  index: number
): StudioVrmSpringBoneColliderSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind: SpringColliderKind = value.kind === "capsule" ? "capsule" : "sphere";
  return {
    id: str(value.id, `collider-${index + 1}`),
    label: str(value.label, kind === "capsule" ? "캡슐 콜라이더" : "구 콜라이더"),
    enabled: bool(value.enabled, true),
    kind,
    offset: tuple3(value.offset, [0, 0, 0]),
    tail: tuple3(value.tail, [0, -0.1, 0]),
    radius: clampedNum(value.radius, 0.05, LIMITS.radius),
    inside: bool(value.inside, false),
  };
}

export function normalizeSpringWindSettings(raw: unknown): StudioVrmSpringBoneWindSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seed = Math.trunc(num(value.seed, DEFAULT_SPRING_WIND.seed));
  return {
    directionDeg: clamp(num(value.directionDeg, DEFAULT_SPRING_WIND.directionDeg), -180, 180),
    elevationDeg: clamp(num(value.elevationDeg, DEFAULT_SPRING_WIND.elevationDeg), -90, 90),
    strength: clampedNum(value.strength, DEFAULT_SPRING_WIND.strength, LIMITS.strength),
    turbulence: clampedNum(value.turbulence, DEFAULT_SPRING_WIND.turbulence, LIMITS.turbulence),
    seed: Number.isFinite(seed) ? seed | 0 : DEFAULT_SPRING_WIND.seed,
    phase: num(value.phase, DEFAULT_SPRING_WIND.phase),
    phaseStep: clamp(num(value.phaseStep, DEFAULT_SPRING_WIND.phaseStep), 0, 1),
  };
}

export function normalizeSpringSettleSettings(raw: unknown): StudioVrmSpringBoneSettleSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    dt: clampedNum(value.dt, DEFAULT_SPRING_SETTLE.dt, LIMITS.dt),
    steps: Math.round(clampedNum(value.steps, DEFAULT_SPRING_SETTLE.steps, LIMITS.steps)),
    epsilon: clampedNum(value.epsilon, DEFAULT_SPRING_SETTLE.epsilon, LIMITS.epsilon),
    maxSteps: Math.round(clampedNum(value.maxSteps, DEFAULT_SPRING_SETTLE.maxSteps, LIMITS.maxSteps)),
  };
}

export function normalizeStudioVrmSpringBoneAuthoring(raw: unknown): StudioVrmSpringBoneAuthoring {
  const fallback = defaultStudioVrmSpringBoneAuthoring();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;

  const rawChains = Array.isArray(value.chains) ? value.chains : null;
  const chains = rawChains
    ? rawChains.map((chain, index) => {
        const candidate = (chain && typeof chain === "object" ? chain : {}) as Record<string, unknown>;
        const preset =
          (typeof candidate.presetId === "string" ? findStudioVrmSpringBonePreset(candidate.presetId) : null) ??
          (typeof candidate.id === "string" ? findStudioVrmSpringBonePreset(candidate.id) : null);
        const base = preset
          ? chainFromPreset(preset)
          : { ...fallback.chains[index % fallback.chains.length]!, id: `chain-${index + 1}`, presetId: "custom" as const };
        return normalizeSpringChainSettings(chain, base);
      })
    : fallback.chains;

  const rawColliders = Array.isArray(value.colliders) ? value.colliders : [];

  return {
    version: STUDIO_VRM_SPRINGBONE_VERSION,
    enabled: bool(value.enabled, fallback.enabled),
    chains: chains.length > 0 ? chains : fallback.chains,
    colliders: rawColliders.map(normalizeSpringColliderSettings),
    wind: normalizeSpringWindSettings(value.wind),
    settle: normalizeSpringSettleSettings(value.settle),
  };
}

/** 문자열(JSON) 이든 객체든 받아서 반드시 유효한 설정을 돌려준다. 절대 throw 하지 않는다. */
export function parseStudioVrmSpringBoneAuthoring(raw: unknown): StudioVrmSpringBoneAuthoring {
  if (typeof raw === "string") {
    try {
      return normalizeStudioVrmSpringBoneAuthoring(JSON.parse(raw));
    } catch {
      return defaultStudioVrmSpringBoneAuthoring();
    }
  }
  return normalizeStudioVrmSpringBoneAuthoring(raw);
}

export function serializeStudioVrmSpringBoneAuthoring(authoring: StudioVrmSpringBoneAuthoring): string {
  return JSON.stringify(normalizeStudioVrmSpringBoneAuthoring(authoring));
}

/** 체인 수치를 프리셋 값으로 되돌린다(라벨/패턴/활성 상태는 유지). */
export function applyStudioVrmSpringBonePreset(
  chain: StudioVrmSpringBoneChainSettings,
  presetId: SpringBonePresetId
): StudioVrmSpringBoneChainSettings {
  const preset = findStudioVrmSpringBonePreset(presetId);
  if (!preset) return { ...chain };
  return {
    ...chain,
    presetId,
    stiffness: preset.tuning.stiffness,
    drag: preset.tuning.drag,
    gravityPower: preset.tuning.gravityPower,
    hitRadius: preset.tuning.hitRadius,
    windScale: preset.tuning.windScale,
  };
}

/** 수치를 직접 만졌으면 presetId 를 "custom" 으로 떨어뜨린다. */
export function patchStudioVrmSpringBoneChain(
  chain: StudioVrmSpringBoneChainSettings,
  patch: Partial<StudioVrmSpringBoneChainSettings>
): StudioVrmSpringBoneChainSettings {
  const merged = normalizeSpringChainSettings({ ...chain, ...patch }, chain);
  const tuningKeys: (keyof StudioVrmSpringBoneChainSettings)[] = [
    "stiffness",
    "drag",
    "gravityPower",
    "hitRadius",
    "windScale",
  ];
  const preset = merged.presetId === "custom" ? null : findStudioVrmSpringBonePreset(merged.presetId);
  if (preset) {
    const drifted = tuningKeys.some((key) => merged[key] !== preset.tuning[key as keyof SpringBonePresetTuning]);
    if (drifted) merged.presetId = "custom";
  }
  return merged;
}

/* ── 오써링 → 시뮬레이션 입력 ──────────────────────────────────────── */

/** 바람 설정(각도)을 단위 방향 벡터로 변환한다. */
export function studioVrmSpringBoneWindDir(wind: StudioVrmSpringBoneWindSettings): SpringVec3 {
  const az = (wind.directionDeg * Math.PI) / 180;
  const el = (wind.elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return springNormalize({ x: Math.cos(az) * cosEl, y: Math.sin(el), z: Math.sin(az) * cosEl }, { x: 1, y: 0, z: 0 });
}

/** 체인별 windScale 을 반영한 코어 바람 입력을 만든다. */
export function studioVrmSpringBoneWind(
  wind: StudioVrmSpringBoneWindSettings,
  windScale = 1
): SpringWind {
  return {
    dir: studioVrmSpringBoneWindDir(wind),
    strength: wind.strength * windScale,
    turbulence: wind.turbulence,
    seed: wind.seed,
    phase: wind.phase,
    phaseStep: wind.phaseStep,
  };
}

export function resolveStudioVrmSpringBoneColliders(
  authoring: StudioVrmSpringBoneAuthoring
): SpringCollider[] {
  return authoring.colliders
    .filter((collider) => collider.enabled)
    .map((collider) =>
      collider.kind === "capsule"
        ? {
            kind: "capsule" as const,
            head: springVec3FromTuple(collider.offset),
            tail: springVec3FromTuple(collider.tail),
            radius: collider.radius,
            inside: collider.inside,
          }
        : {
            kind: "sphere" as const,
            center: springVec3FromTuple(collider.offset),
            radius: collider.radius,
            inside: collider.inside,
          }
    );
}

/** 모델에서 측정한 체인 기하(본 이름·rest 방향·길이). 브리지가 채워 넣는다. */
export interface StudioVrmSpringBoneRigJoint {
  name: string;
  restDir: SpringVec3Tuple;
  length: number;
}

export interface StudioVrmSpringBoneRigChain {
  /** 오써링 체인 id 와 매칭되는 값(브리지가 본 이름으로 결정). */
  chainId: string;
  origin: SpringVec3Tuple;
  rootRotation?: SpringQuat;
  joints: StudioVrmSpringBoneRigJoint[];
}

export interface StudioVrmSpringBoneRig {
  chains: StudioVrmSpringBoneRigChain[];
}

/**
 * 오써링 + 측정된 리그 → 코어 시뮬레이션 상태.
 * 비활성 체인/매칭 실패 체인은 제외된다. 바람은 체인별 windScale 을 조인트 stiffness 와 함께
 * 반영하기 위해 "가장 큰 windScale" 기준의 전역 바람을 쓰고, 체인 스케일은 조인트 설정에 곱해 넣는다.
 */
export function buildStudioVrmSpringBoneState(
  authoring: StudioVrmSpringBoneAuthoring,
  rig: StudioVrmSpringBoneRig
): StudioVrmSpringBoneState {
  const normalized = normalizeStudioVrmSpringBoneAuthoring(authoring);
  const byId = new Map(normalized.chains.map((chain) => [chain.id, chain]));

  const defs: SpringChainDef[] = [];
  for (const rigChain of rig.chains) {
    const settings = byId.get(rigChain.chainId);
    if (!settings || !settings.enabled) continue;
    if (rigChain.joints.length === 0) continue;
    defs.push({
      id: rigChain.chainId,
      origin: springVec3FromTuple(rigChain.origin),
      rootRotation: rigChain.rootRotation ?? { x: 0, y: 0, z: 0, w: 1 },
      joints: rigChain.joints.map((joint) => ({
        name: joint.name,
        restDir: springVec3FromTuple(joint.restDir),
        length: joint.length,
        settings: {
          stiffness: settings.stiffness,
          drag: settings.drag,
          gravityPower: settings.gravityPower,
          gravityDir: springVec3FromTuple(settings.gravityDir),
          hitRadius: settings.hitRadius,
        },
      })),
    });
  }

  // 체인별 windScale 차이는 체인 단위 바람을 하나만 둘 수 없으므로, 전역 바람 세기에
  // "활성 체인 windScale 평균"을 곱해 근사한다(체인이 하나면 정확히 일치).
  const activeScales = defs
    .map((def) => byId.get(def.id)?.windScale ?? 1)
    .filter((scale) => Number.isFinite(scale));
  const meanScale = activeScales.length > 0
    ? activeScales.reduce((sum, scale) => sum + scale, 0) / activeScales.length
    : 1;

  return createStudioVrmSpringBoneState({
    chains: defs,
    colliders: resolveStudioVrmSpringBoneColliders(normalized),
    wind: studioVrmSpringBoneWind(normalized.wind, normalized.enabled ? meanScale : 0),
  });
}
