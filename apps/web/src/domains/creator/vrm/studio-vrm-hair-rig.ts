/**
 * 생성형 캐릭터의 **헤어 체인 리그 + 스프링본 계획**.
 *
 * 왜 필요한가. 헤어 메시는 전 정점이 `head` 에 100% 묶여 있었다. 짧은 머리는 그래도 되지만
 * 긴 머리는 머리 관절 아래로 최대 0.43 m(`hime-noble` 뒷머리) 내려가므로, 고개를 돌리면 그
 * 길이가 통째로 머리 관절을 중심으로 강체 회전한다 — 머리카락이 어깨를 뚫고 지나가고,
 * 무엇보다 **흔들리지 않는다**. 익스포트한 리그에 헤어 조인트가 없으니 스프링본이 물릴 곳도
 * 없었다.
 *
 * 이 모듈은 **매달린 파츠 전부**에 조인트를 심고 `VRMC_springBone` 스프링으로 낼 계획을
 * 만든다. 스튜디오 런타임은 이미 스프링본을 돌리므로(studio-vrm-physics ·
 * studio-vrm-springbone-bridge 가 `vrm.update(dt)` 를 친다) 생성 캐릭터도 임포트한 VRM 과
 * 똑같이 머리카락이 흔들린다.
 *
 * ---------------------------------------------------------------------------
 * 파츠 모양이 세 가지라 체인 만드는 법도 세 가지다
 * ---------------------------------------------------------------------------
 *  - **가닥**(`tapered-capsule`) — 곡선 중심선을 따라 조인트를 심고, 정점은 축 방향
 *    파라미터로 이웃한 두 마디에 나눠 싣는다.
 *  - **덩어리**(매달린 `ellipsoid`/`sphere`, 주로 뒷머리 시트) — 파츠 로컬 Y 를 따라
 *    위에서 아래로 조인트를 심는다. 정점 배분은 가닥과 같은 식이다.
 *  - **땋은 머리**(`<prefix>-seg-<n>` 스피어 열) — 세그먼트가 이미 순서 있는 사슬이므로
 *    세그먼트 하나에 조인트 하나를 주고 **통째로 강체**로 묶는다(구슬 사슬과 같다).
 *    사슬의 뿌리는 매듭(`<prefix>-tie`)이고 흔들리지 않는다.
 *
 * 규약
 *  - 조인트는 전부 **비휴머노이드 노드**다. 휴머노이드 본 맵은 15본 그대로다.
 *  - 체인의 첫 조인트는 `head` 의 자식이고 **흔들리지 않는다**(VRM 스프링의 루트 규약).
 *  - IBM 은 휴머노이드 리그와 같은 규약 — rest 월드 위치의 **역이동만** 담는다.
 */

import {
  applyTrs,
  meshClamp,
  type MeshMat3,
  type MeshVec3,
} from "./studio-vrm-humanoid-mesh-geometry";

import type { AvatarForgeHairPart } from "./studio-vrm-avatar-forge";

export const STUDIO_VRM_HAIR_RIG_VERSION = 2 as const;

/**
 * 가닥·덩어리 하나에 심는 체인 조인트 수(뿌리 포함).
 *
 * 4개 = 뿌리 1 + 흔들리는 마디 3. 땋은 머리는 세그먼트 수가 곧 마디 수라 이 값을 쓰지 않는다.
 */
export const STUDIO_VRM_HAIR_CHAIN_JOINTS = 4;

/**
 * 이 높이보다 덜 내려온 덩어리 파츠는 리그를 달지 않는다(머리 관절 기준, 신장 배율 곱하기 전).
 *
 * 정수리에 얹힌 번·삐침머리는 흔들릴 이유가 없고, 흔들리면 오히려 두피에서 떠 보인다.
 * 실측하면 번은 머리 관절보다 **위**(−0.10 m)에 있고 뒷머리 시트는 0.14~0.43 m 아래다.
 */
const HAIR_RIG_MIN_DROP = 0.06;

/** 매달린 것으로 볼 수 있는 덩어리 역할. `cap` 은 두피 껍질, `bang` 은 이마에 붙는다. */
const HANGING_BLOB_ROLES = new Set<AvatarForgeHairPart["role"]>([
  "back",
  "side",
  "tail",
  "bun",
  "ahoge",
]);

/** 파츠에 적용된 최종 TRS(두개골 적합까지 끝난 값). */
export type StudioVrmHairPartTransform = {
  readonly translation: MeshVec3;
  readonly rotation: MeshMat3;
  readonly scale: MeshVec3;
};

export type StudioVrmHairPartInput = {
  readonly part: AvatarForgeHairPart;
  readonly transform: StudioVrmHairPartTransform;
};

export type StudioVrmHairJoint = {
  readonly name: string;
  /** 부모 기준 로컬 이동. 부모는 체인의 앞 조인트이고, 첫 조인트의 부모는 `head` 다. */
  readonly localTranslation: MeshVec3;
  /** rest 월드 위치. 메시 저작 좌표계이자 IBM 의 기준. */
  readonly worldRest: MeshVec3;
  /** 이 마디가 차지하는 굵기. 스프링 충돌 반경으로 그대로 쓴다. */
  readonly hitRadius: number;
};

export type StudioVrmHairChain = {
  readonly id: string;
  /** 뿌리 → 끝 순서. 앞 조인트가 항상 부모다. */
  readonly joints: readonly StudioVrmHairJoint[];
  /** 펼친 조인트 목록에서 이 체인의 첫 조인트 위치. */
  readonly jointOffset: number;
  readonly stiffness: number;
  readonly gravityPower: number;
  readonly dragForce: number;
};

/**
 * 파츠 하나를 어떻게 스킨할지.
 *  - `blend` — 축 방향 파라미터로 이웃한 두 마디에 나눠 싣는다(가닥·덩어리).
 *  - `rigid` — 파츠 전체를 마디 하나에 싣는다(땋은 머리 세그먼트·매듭·흔들리지 않는 파츠).
 *
 * `jointOffset` 은 펼친 조인트 목록 기준 **절대** 인덱스다.
 */
export type StudioVrmHairBinding =
  | { readonly kind: "blend"; readonly chain: StudioVrmHairChain }
  | { readonly kind: "rigid"; readonly jointOffset: number };

/** 흔들리지 않는 고정 조인트의 위치. 항상 펼친 목록의 0번이다. */
export const STUDIO_VRM_HAIR_ANCHOR_JOINT = 0;

export type StudioVrmHairRig = {
  readonly version: typeof STUDIO_VRM_HAIR_RIG_VERSION;
  readonly chains: readonly StudioVrmHairChain[];
  /**
   * 체인들을 펼친 조인트 목록. 스킨 `joints` 확장 순서이자 조인트 인덱스 순서다.
   * 0번은 항상 고정 앵커이고 어떤 스프링에도 들어가지 않는다.
   */
  readonly joints: readonly StudioVrmHairJoint[];
  /**
   * 파츠 id → 스킨 방법. **모든 헤어 파츠가 여기 들어 있다** — 흔들리지 않는 캡·정수리
   * 파츠도 고정 앵커에 묶는다. 헤어가 통째로 역스케일 피벗 아래에 있어야 머리 조형
   * 스케일이 두 번 걸리지 않는다(리그 파일 상단 참고).
   */
  readonly bindings: ReadonlyMap<string, StudioVrmHairBinding>;
};

/**
 * 가닥의 **중심선**(파츠 로컬). `t` 0 = 뿌리, 1 = 끝.
 *
 * `addHairStrand` 가 정점을 찍는 축과 **같은 식**이어야 조인트가 가닥 한가운데를 지난다.
 * 어긋나면 흔들릴 때 가닥이 축을 중심으로 비틀린다.
 */
export function studioVrmHairStrandSpine(part: AvatarForgeHairPart, t: number): MeshVec3 {
  const waveAmount = part.wave ?? 0;
  const waveFrequency = part.waveFrequency ?? 2.4;
  const aspectX = meshClamp(part.scale[1] / Math.max(1e-4, Math.abs(part.scale[0])), 1, 10);
  const aspectZ = meshClamp(part.scale[1] / Math.max(1e-4, Math.abs(part.scale[2])), 1, 10);
  const spineCurveX = Math.sin(t * Math.PI * 2.15) * part.curl * 0.58 * t;
  const spineCurveZ = Math.sin(t * Math.PI) * part.curl * 0.34;
  const curveX =
    waveAmount > 0
      ? spineCurveX + Math.sin(t * Math.PI * waveFrequency) * waveAmount * 0.17 * aspectX * t
      : spineCurveX;
  const curveZ =
    waveAmount > 0
      ? spineCurveZ + Math.cos(t * Math.PI * waveFrequency) * waveAmount * 0.07 * aspectZ * t
      : spineCurveZ;
  return [curveX, 1 - t * 2, curveZ];
}

/** 가닥 굵기(파츠 로컬 반경). `addHairStrand` 의 테이퍼와 같은 식이다. */
function strandRadius(part: AvatarForgeHairPart, t: number): number {
  return Math.max(0.08, 1 - part.taper * t ** 0.72);
}

function subtract(a: MeshVec3, b: MeshVec3): MeshVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function place(input: StudioVrmHairPartInput, unit: MeshVec3): MeshVec3 {
  const { transform } = input;
  return applyTrs(unit, transform.translation, transform.rotation, transform.scale);
}

/** 파츠 아래 끝이 머리 관절보다 얼마나 내려와 있는가(m). 음수면 관절보다 위다. */
function partDrop(input: StudioVrmHairPartInput, headWorldRest: MeshVec3): number {
  return headWorldRest[1] - (input.transform.translation[1] - Math.abs(input.transform.scale[1]));
}

/** 땋은 머리 세그먼트 id — `<prefix>-seg-<n>`. 그룹 1 = prefix, 그룹 2 = index. */
const BRAID_SEGMENT_ID = /^(.+)-seg-(\d+)$/u;

type ChainDraft = {
  readonly id: string;
  readonly joints: readonly StudioVrmHairJoint[];
  readonly length: number;
  /** 이 체인에 강체로 묶일 파츠 id → 체인 안 마디 번호. */
  readonly rigid: ReadonlyMap<string, number>;
  /** 이 체인에 축 방향으로 배분될 파츠 id. */
  readonly blend: readonly string[];
};

/**
 * 체인 길이로 흔들림 세기를 정한다 — 0.10 m 안팎의 삐침머리는 거의 굳게, 0.45 m 롱헤어는
 * 느슨하게. 짧은 가닥이 롱헤어처럼 출렁이면 어색하다.
 *
 * **길이는 조형 스케일까지 반영된 값**이어야 한다. 두신비를 키우면 같은 가닥이 실제로
 * 길어지므로(두신비 3.6 에서 0.175 m → 0.630 m), 스케일 이전 길이로 굳혀 두면 60cm 짜리
 * 머리카락이 17cm 용 튜닝(거의 강체)으로 남는다.
 */
function springTuning(
  length: number,
  heightScale: number,
): { stiffness: number; gravityPower: number; dragForce: number } {
  const slack = meshClamp((length - 0.08 * heightScale) / (0.32 * heightScale), 0, 1);
  return {
    stiffness: 1.6 - 0.9 * slack,
    gravityPower: 0.06 + 0.14 * slack,
    dragForce: 0.72 - 0.3 * slack,
  };
}

function chainLength(joints: readonly StudioVrmHairJoint[]): number {
  let total = 0;
  for (let index = 1; index < joints.length; index += 1) {
    const [x, y, z] = subtract(joints[index].worldRest, joints[index - 1].worldRest);
    total += Math.hypot(x, y, z);
  }
  return total;
}

function jointsFrom(
  samples: readonly { readonly world: MeshVec3; readonly hitRadius: number }[],
  namePrefix: string,
  headWorldRest: MeshVec3,
): StudioVrmHairJoint[] {
  const joints: StudioVrmHairJoint[] = [];
  let previous = headWorldRest;
  samples.forEach((sample, index) => {
    joints.push({
      name: `HairJoint_${namePrefix}_${index}`,
      localTranslation: subtract(sample.world, previous),
      worldRest: sample.world,
      hitRadius: sample.hitRadius,
    });
    previous = sample.world;
  });
  return joints;
}

/** 가닥 — 곡선 중심선을 따라 균등하게. */
function draftStrandChain(input: StudioVrmHairPartInput, headWorldRest: MeshVec3): ChainDraft {
  const { part, transform } = input;
  // 충돌 반경은 스칼라 하나뿐인데 가닥 단면은 납작하다(앞머리는 폭 0.16 · 두께 0.09). 콜라이더를
  // 마주 보는 쪽은 **두께**이므로 평균값은 이미 두께를 39% 넘겨 잡고 있다. 여기서 최대축까지
  // 가면 가닥 전체가 이마에서 3mm 더 떠오르고 콜라이더도 그만큼 더 줄어든다 —
  // `skullColliderFit` 이 정지 헤어에 맞춰 콜라이더를 넣기 때문이다. 넓은 축은 두피에 **접하는**
  // 방향이라 파고들지 않으므로, 두께와 폭 사이의 평균을 절충값으로 쓴다.
  const girth = (Math.abs(transform.scale[0]) + Math.abs(transform.scale[2])) / 2;
  const samples = Array.from({ length: STUDIO_VRM_HAIR_CHAIN_JOINTS }, (_unused, index) => {
    const t = index / (STUDIO_VRM_HAIR_CHAIN_JOINTS - 1);
    return {
      world: place(input, studioVrmHairStrandSpine(part, t)),
      hitRadius: Math.max(0.004, strandRadius(part, t) * girth),
    };
  });
  const joints = jointsFrom(samples, part.id, headWorldRest);
  return {
    id: part.id,
    joints,
    length: chainLength(joints),
    rigid: new Map(),
    blend: [part.id],
  };
}

/** 덩어리 — 파츠 로컬 Y 를 따라 위에서 아래로. 뒷머리 시트가 여기 해당한다. */
function draftBlobChain(input: StudioVrmHairPartInput, headWorldRest: MeshVec3): ChainDraft {
  const { part, transform } = input;
  // 충돌 반경은 **앞뒤 두께**로 잡는다. 좌우로 넓은 시트에서 좌우 폭을 쓰면 등에서 크게 떠 버린다.
  const hitRadius = meshClamp(Math.abs(transform.scale[2]), 0.004, 0.06);
  const samples = Array.from({ length: STUDIO_VRM_HAIR_CHAIN_JOINTS }, (_unused, index) => {
    const t = index / (STUDIO_VRM_HAIR_CHAIN_JOINTS - 1);
    return { world: place(input, [0, 1 - t * 2, 0]), hitRadius };
  });
  const joints = jointsFrom(samples, part.id, headWorldRest);
  return {
    id: part.id,
    joints,
    length: chainLength(joints),
    rigid: new Map(),
    blend: [part.id],
  };
}

/** 땋은 머리 — 세그먼트가 곧 마디다. 매듭이 있으면 그게 흔들리지 않는 뿌리가 된다. */
function draftBraidChain(
  prefix: string,
  tie: StudioVrmHairPartInput | undefined,
  segments: readonly StudioVrmHairPartInput[],
  headWorldRest: MeshVec3,
): ChainDraft {
  const members = tie ? [tie, ...segments] : segments;
  const samples = members.map((member) => ({
    world: member.transform.translation,
    hitRadius: Math.max(
      0.004,
      (Math.abs(member.transform.scale[0]) + Math.abs(member.transform.scale[2])) / 2,
    ),
  }));
  const joints = jointsFrom(samples, prefix, headWorldRest);
  const rigid = new Map<string, number>();
  // 매듭은 체인의 **위상상** 뿌리지만 정점은 싣지 않는다. VRM 스프링에서 첫 조인트도
  // 회전이 시뮬레이션되므로(three-vrm 은 (본, 자식) 쌍마다 조인트를 만든다) 여기 매듭을
  // 실으면 납작한 매듭 타원체가 땋은 머리를 따라 기울고 흔들린다. 바인딩을 비워 두면
  // 아래 기본 경로가 고정 앵커에 묶는다.
  members.forEach((member, index) => {
    if (tie !== undefined && index === 0) return;
    rigid.set(member.part.id, index);
  });
  return { id: prefix, joints, length: chainLength(joints), rigid, blend: [] };
}

/**
 * 매달린 헤어 파츠에 체인 조인트를 심는다.
 *
 * 흔들림 세기는 체인 길이에서 뽑는다 — 짧은 삐침머리가 롱헤어처럼 출렁이면 어색하다.
 * `dragForce` 는 짧을수록 크게(빨리 멎게), `stiffness` 는 짧을수록 크게(덜 휘게) 잡는다.
 */
export function buildStudioVrmHairRig(
  parts: readonly StudioVrmHairPartInput[],
  headWorldRest: MeshVec3,
  heightScale = 1,
): StudioVrmHairRig | null {
  const minDrop = HAIR_RIG_MIN_DROP * heightScale;

  // 1. 땋은 머리 묶기 — `<prefix>-seg-<n>` 은 이미 순서 있는 사슬이다.
  const braidSegments = new Map<string, StudioVrmHairPartInput[]>();
  const ties = new Map<string, StudioVrmHairPartInput>();
  const singles: StudioVrmHairPartInput[] = [];
  /** 체인을 만들지 않고 고정 앵커에 묶을 파츠. */
  const anchoredParts: StudioVrmHairPartInput[] = [];
  for (const input of parts) {
    const match = BRAID_SEGMENT_ID.exec(input.part.id);
    if (match !== null && input.part.role === "braid") {
      const group = braidSegments.get(match[1]) ?? [];
      group.push(input);
      braidSegments.set(match[1], group);
      continue;
    }
    if (input.part.id.endsWith("-tie")) {
      ties.set(input.part.id.slice(0, -"-tie".length), input);
      continue;
    }
    // 묶음 부착부(`<prefix>-root`)는 매듭이다 — 아래 가닥이 자기 체인을 갖고, 이 구는
    // 그 뿌리를 두피에 고정하는 역할이다. 낙차만 보고 덩어리 체인으로 만들면 매듭이
    // 시트처럼 늘어지고 흔들린다(포니테일 `tailHeight 0` · `volume 1.45` 에서 낙차
    // 0.063m 로 문턱 0.06m 를 겨우 넘겨 걸렸다).
    if (input.part.id.endsWith("-root")) {
      anchoredParts.push(input);
      continue;
    }
    singles.push(input);
  }

  const drafts: ChainDraft[] = [];

  for (const [prefix, group] of braidSegments) {
    const ordered = [...group].sort(
      (left, right) =>
        Number(BRAID_SEGMENT_ID.exec(left.part.id)?.[2] ?? 0)
        - Number(BRAID_SEGMENT_ID.exec(right.part.id)?.[2] ?? 0),
    );
    const deepest = Math.max(...ordered.map((entry) => partDrop(entry, headWorldRest)));
    if (deepest <= minDrop) continue;
    drafts.push(draftBraidChain(prefix, ties.get(prefix), ordered, headWorldRest));
  }
  // 사슬이 만들어지지 않은 매듭은 정수리 장식이므로 머리에 그대로 둔다.
  for (const [prefix, tie] of ties) {
    if (!drafts.some((draft) => draft.id === prefix)) singles.push(tie);
  }

  for (const input of singles) {
    // 가닥은 길이와 무관하게 전부 흔들린다. 앞머리도 뿌리가 헤어라인에 고정된 채 끝만
    // 움직이므로 자연스럽다 — 실제 아바타의 앞머리도 스프링본을 단다.
    if (input.part.primitive === "tapered-capsule") {
      drafts.push(draftStrandChain(input, headWorldRest));
      continue;
    }
    // 덩어리는 **매달린 것만** 흔든다. 정수리에 얹힌 번·삐침머리가 흔들리면 두피에서 떠 보인다.
    if (!HANGING_BLOB_ROLES.has(input.part.role)) continue;
    if (partDrop(input, headWorldRest) <= minDrop) continue;
    drafts.push(draftBlobChain(input, headWorldRest));
  }

  if (parts.length === 0) return null;

  const chains: StudioVrmHairChain[] = [];
  // 0번은 고정 앵커 — 머리 관절에 놓이고 절대 움직이지 않는다. 흔들리지 않는 파츠가 여기
  // 묶여야 헤어 전체가 역스케일 피벗 아래에 모인다.
  const joints: StudioVrmHairJoint[] = [
    {
      name: "HairAnchor",
      localTranslation: [0, 0, 0],
      worldRest: headWorldRest,
      hitRadius: 0.01,
    },
  ];
  const bindings = new Map<string, StudioVrmHairBinding>();

  for (const draft of drafts) {
    const chain: StudioVrmHairChain = {
      id: draft.id,
      joints: draft.joints,
      jointOffset: joints.length,
      ...springTuning(draft.length, heightScale),
    };
    chains.push(chain);
    joints.push(...draft.joints);
    for (const partId of draft.blend) bindings.set(partId, { kind: "blend", chain });
    for (const [partId, jointInChain] of draft.rigid) {
      bindings.set(partId, { kind: "rigid", jointOffset: chain.jointOffset + jointInChain });
    }
  }

  // 체인에 들어가지 않은 파츠(캡·정수리 번·짧은 덩어리·묶음 부착부)는 고정 앵커에 묶는다.
  for (const input of parts) {
    if (!bindings.has(input.part.id)) {
      bindings.set(input.part.id, { kind: "rigid", jointOffset: STUDIO_VRM_HAIR_ANCHOR_JOINT });
    }
  }

  return { version: STUDIO_VRM_HAIR_RIG_VERSION, chains, joints, bindings };
}

/** 헤어 조인트의 `inverseBindMatrices` — 휴머노이드 리그와 같은 규약(역이동만, 열 우선). */
export function studioVrmHairRigInverseBindMatrices(rig: StudioVrmHairRig): number[] {
  const matrices: number[] = [];
  for (const joint of rig.joints) {
    const [x, y, z] = joint.worldRest;
    matrices.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1);
  }
  return matrices;
}

/**
 * 리그를 **머리 조형 스케일이 적용된** 좌표로 옮긴다.
 *
 * 리그 계산(낙차 문턱·체인 길이)은 스케일 이전 좌표에서 하는 것이 안정적이다 — 문턱이
 * `heightScale` 기준이라 두신비가 끼어들면 어떤 파츠가 "매달렸는지"의 판정이 흔들린다.
 * 그래서 판정이 끝난 뒤 위치만 옮긴다.
 *
 * 사상은 머리 관절을 원점으로 하는 축별 스케일이므로(`p ↦ j + S⊙(p−j)`), 부모-자식 차이는
 * 그냥 `S⊙d` 가 된다 — 체인을 다시 걸을 필요가 없다. 체인 뿌리의 부모는 머리 관절이고
 * 그 점은 사상의 고정점이다.
 *
 * 충돌 반경만은 스칼라라 정확히 옮길 수 없다. 축 평균을 쓴다.
 */
export function shapeStudioVrmHairRig(
  rig: StudioVrmHairRig | null,
  headWorldRest: MeshVec3,
  scale: MeshVec3,
  heightScale = 1,
): StudioVrmHairRig | null {
  if (rig === null) return null;
  if (scale[0] === 1 && scale[1] === 1 && scale[2] === 1) return rig;
  // 충돌 반경은 스칼라라 축별 스케일을 정확히 담을 수 없다. 체인의 **가로 단면**(X·Z)에서
  // 가장 큰 축을 쓴다 — 이 리그의 체인은 가닥·덩어리·구슬 모두 로컬 Y 를 축으로 하므로
  // 굵기는 X·Z 평면에서 정해진다.
  //
  // 세 축 전체의 최대를 쓰면 무관한 축이 새어 든다(머리 높이만 1.6 배로 키우면 단면은
  // 그대로인데 반경만 1.6 배가 돼 머리카락이 두피에서 밀려난다). 평균을 쓰면 반대로 가장
  // 두꺼워진 축을 감싸지 못한다(깊이를 키우면 Z 두께가 커지는데 반경은 덜 커져 뚫린다).
  const radial = Math.max(scale[0], scale[2]);
  const moved = new Map<StudioVrmHairJoint, StudioVrmHairJoint>();
  const shapeJoint = (joint: StudioVrmHairJoint): StudioVrmHairJoint => {
    const existing = moved.get(joint);
    if (existing) return existing;
    const next: StudioVrmHairJoint = {
      name: joint.name,
      localTranslation: [
        joint.localTranslation[0] * scale[0],
        joint.localTranslation[1] * scale[1],
        joint.localTranslation[2] * scale[2],
      ],
      worldRest: [
        headWorldRest[0] + (joint.worldRest[0] - headWorldRest[0]) * scale[0],
        headWorldRest[1] + (joint.worldRest[1] - headWorldRest[1]) * scale[1],
        headWorldRest[2] + (joint.worldRest[2] - headWorldRest[2]) * scale[2],
      ],
      hitRadius: joint.hitRadius * radial,
    };
    moved.set(joint, next);
    return next;
  };

  const joints = rig.joints.map(shapeJoint);
  const chains = rig.chains.map((chain) => {
    const shapedJoints = chain.joints.map(shapeJoint);
    // 길이가 달라졌으므로 흔들림 세기를 다시 뽑는다.
    return { ...chain, joints: shapedJoints, ...springTuning(chainLength(shapedJoints), heightScale) };
  });
  const chainById = new Map(chains.map((chain) => [chain.id, chain]));
  const bindings = new Map<string, StudioVrmHairBinding>();
  for (const [partId, binding] of rig.bindings) {
    bindings.set(
      partId,
      binding.kind === "blend"
        ? { kind: "blend", chain: chainById.get(binding.chain.id) ?? binding.chain }
        : binding,
    );
  }
  return { version: rig.version, chains, joints, bindings };
}
