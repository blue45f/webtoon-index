/**
 * 파라미터 → **실제 인체 형태의 스킨드 메시**. 생성형 VRM 캐릭터의 몸이 여기서 만들어진다.
 *
 * 이전 생성기는 관절마다 육면체 하나씩, 총 15개 박스를 붙인 마네킹이었다. 이 모듈은 같은
 * {@link AvatarForgeState} 를 받아 단면 스윕(로프트)으로 몸통·팔·다리를, 변형 타원체로 두상을,
 * 두개골 표면에 붙는 패치로 눈·눈썹·입을 만들고, 아바타 조형 패널이 이미 쓰고 있는
 * {@link buildAvatarForgeHairParts} 헤어 계획을 그대로 구워 넣는다.
 *
 * 설계 규칙
 *  - **순수·결정론적**: three.js 도 캔버스도 쓰지 않는다. 같은 상태면 같은 정점이 나온다.
 *  - **월드 rest 좌표계 저작**: studio-vrm-humanoid-rig 의 rest 월드 좌표를 그대로 쓴다.
 *    IBM 이 이동만 담으므로(리그 파일 상단 참고) 저작 좌표 = 바인드 좌표다.
 *  - **파트별 노드 분리**: Body/Face/Hair/Tops/Bottoms/Shoes 를 각각 별도 노드·메시로 낸다.
 *    스튜디오의 워드로브·헤어 교체 시스템이 **이름 휴리스틱**(studio-vrm-costume 의
 *    `classifyMeshName`)으로 대상을 찾기 때문에, 이름이 분류에 걸리도록 나눠 두어야
 *    생성 캐릭터도 의상 토글·리컬러·헤어 교체를 그대로 받는다.
 *  - **표정은 모프 타깃**: 익스포터의 표정 바인딩은 morphTarget 만 지원한다. 그래서 얼굴을
 *    텍스처가 아니라 지오메트리로 만들고, 눈/눈썹/입 패치의 파라미터를 바꿔 델타를 굽는다.
 *    덕분에 생성 캐릭터가 눈 깜빡임 안정화·웹캠 트래킹·표정 적용 경로에 그대로 올라탄다.
 */

import {
  buildAvatarForgeHairParts,
  type AvatarForgeHairPart,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { hexToRgb, hslToRgb, rgbToHsl } from "./studio-vrm-costume";
import {
  buildStudioVrmHairRig,
  shapeStudioVrmHairRig,
  STUDIO_VRM_HAIR_ANCHOR_JOINT,
  studioVrmHairStrandSpine,
  type StudioVrmHairChain,
  type StudioVrmHairRig,
} from "./studio-vrm-hair-rig";
import {
  addLoft,
  applyTrs,
  eulerXyzMatrix,
  forwardRing,
  lateralRing,
  meshClamp,
  meshLerp,
  SurfaceBuilder,
  verticalRing,
  type LoftRing,
  type MeshSkinBinding,
  type MeshUvRect,
  type MeshVec2,
  type MeshVec3,
} from "./studio-vrm-humanoid-mesh-geometry";
import {
  buildStudioVrmRig,
  STUDIO_VRM_RIG_NEUTRAL_HEIGHT,
  type StudioVrmRig,
  type StudioVrmRigBone,
  type StudioVrmRigHeadFit,
} from "./studio-vrm-humanoid-rig";

import type {
  StudioVrmExportMaterial,
  StudioVrmExportMorphTarget,
  StudioVrmExportPrimitive,
} from "./studio-vrm-export-plan";

export const STUDIO_VRM_HUMANOID_MESH_VERSION = 1 as const;

/* -------------------------------------------------------------------------- */
/* 머티리얼                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 머티리얼 인덱스. 이름은 studio-vrm-costume 의 분류 휴리스틱에 걸리도록 지었다
 * (Skin·Face_EyeWhite·Face_Iris·Face_Brow·Face_Mouth·Hair 는 보호,
 * Tops/Bottoms/Shoes 는 의상 슬롯).
 */
export const STUDIO_VRM_HUMANOID_MATERIALS = Object.freeze({
  skin: 0,
  eyeWhite: 1,
  iris: 2,
  brow: 3,
  mouth: 4,
  hair: 5,
  tops: 6,
  bottoms: 7,
  shoes: 8,
});

/** 피부 톤은 조형 상태에 파라미터가 없다. 중립적인 한 가지 톤으로 고정한다. */
const SKIN_BASE = "#f4d5c4";
const SKIN_SHADE = "#dcae9b";
const EYE_WHITE = "#fbfbfd";
const EYE_WHITE_SHADE = "#d8dce8";
const MOUTH_COLOR = "#b4525a";

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const { r, g, b } = hexToRgb(hex);
  return [r, g, b];
}

/** 색조를 돌려 결정론적인 보조 색을 만든다(의상 팔레트용). */
function shiftHue(hex: string, degrees: number, saturation: number, lightness: number): Rgb {
  const hsl = rgbToHsl(hexToRgb(hex));
  const shifted = hslToRgb({
    h: hsl.h + degrees,
    s: meshClamp(saturation, 0, 1),
    l: meshClamp(lightness, 0, 1),
  });
  return [shifted.r, shifted.g, shifted.b];
}

function darken(color: Rgb, amount: number): Rgb {
  return [color[0] * amount, color[1] * amount, color[2] * amount];
}

function toonMaterial(
  name: string,
  base: Rgb,
  shade: Rgb,
  options: {
    readonly outline?: number;
    readonly doubleSided?: boolean;
    readonly toony?: number;
    readonly roughness?: number;
  } = {},
): StudioVrmExportMaterial {
  return {
    name,
    baseColorFactor: [base[0], base[1], base[2], 1],
    metallicFactor: 0,
    roughnessFactor: options.roughness ?? 0.85,
    doubleSided: options.doubleSided,
    mtoon: {
      shadeColorFactor: [shade[0], shade[1], shade[2]],
      shadingToonyFactor: options.toony ?? 0.9,
      outlineWidthMode: "worldCoordinates",
      outlineWidthFactor: options.outline ?? 0.0016,
    },
  };
}

function buildMaterials(state: AvatarForgeState): StudioVrmExportMaterial[] {
  const hairBase = rgb(state.hair.baseColor);
  const hairShade = darken(rgb(state.hair.tipColor), 0.72);
  // 의상 색은 헤어 색조에서 결정론적으로 파생한다 — 프리셋마다 다른 옷을 입되 조화롭게.
  const tops = shiftHue(state.hair.baseColor, 168, 0.34, 0.62);
  const bottoms = shiftHue(state.hair.baseColor, 196, 0.28, 0.34);
  const shoes = shiftHue(state.hair.tipColor, 12, 0.22, 0.26);

  return [
    toonMaterial("Skin", rgb(SKIN_BASE), rgb(SKIN_SHADE), { outline: 0.0012, toony: 0.85 }),
    toonMaterial("Face_EyeWhite", rgb(EYE_WHITE), rgb(EYE_WHITE_SHADE), { outline: 0, toony: 1 }),
    toonMaterial("Face_Iris", rgb(state.hair.tipColor), darken(rgb(state.hair.baseColor), 0.6), {
      outline: 0,
      toony: 1,
    }),
    toonMaterial("Face_Brow", hairBase, hairShade, { outline: 0, toony: 1 }),
    toonMaterial("Face_Mouth", rgb(MOUTH_COLOR), darken(rgb(MOUTH_COLOR), 0.7), {
      outline: 0,
      toony: 1,
    }),
    toonMaterial("Hair", hairBase, hairShade, {
      outline: 0.0022,
      doubleSided: true,
      toony: 0.94,
      // 조형 패널의 광택 슬라이더가 내보낸 VRM 에 실제로 반영되게 한다.
      roughness: meshClamp(1 - state.hair.shine, 0.2, 1),
    }),
    toonMaterial("Tops", tops, darken(tops, 0.68), { outline: 0.002 }),
    toonMaterial("Bottoms", bottoms, darken(bottoms, 0.68), { outline: 0.002 }),
    toonMaterial("Shoes", shoes, darken(shoes, 0.66), { outline: 0.002 }),
  ];
}

/* -------------------------------------------------------------------------- */
/* 스킨 바인딩                                                                 */
/* -------------------------------------------------------------------------- */

function only(rig: StudioVrmRig, bone: StudioVrmRigBone): MeshSkinBinding {
  return [[rig.jointIndex[bone], 1]];
}

function mix(
  rig: StudioVrmRig,
  from: StudioVrmRigBone,
  to: StudioVrmRigBone,
  t: number,
): MeshSkinBinding {
  const weight = meshClamp(t, 0, 1);
  return [
    [rig.jointIndex[from], 1 - weight],
    [rig.jointIndex[to], weight],
  ];
}

/** 0→1 로 부드럽게 오르는 전이 곡선. 관절 주변 가중치가 각지지 않게 한다. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = meshClamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 몸통 높이 y 에 대한 hips→spine→head 가중치.
 * 허리는 넉넉한 구간에서 섞어야 척추를 숙일 때 배가 접히지 않는다.
 */
function torsoSkin(rig: StudioVrmRig, y: number, h: number): MeshSkinBinding {
  const hipsY = rig.worldRest.hips[1];
  const spineY = rig.worldRest.spine[1];
  const { neckBaseY, neckTopY } = torsoAnchors(rig);

  if (y >= neckBaseY) {
    return mix(rig, "spine", "head", smoothstep(neckBaseY, neckTopY, y));
  }
  return mix(rig, "hips", "spine", smoothstep(hipsY - 0.03 * h, spineY + 0.11 * h, y));
}

/* -------------------------------------------------------------------------- */
/* UV 아틀라스                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Body 메시는 머티리얼이 하나뿐이라 파트끼리 UV 가 겹치면 안 된다(표면 페인팅·텍스처 채우기가
 * 같은 텍스처를 공유하므로). 파트마다 서로 겹치지 않는 사각형을 할당한다.
 *
 * 손가락 블록은 손 하나당 다섯 레인으로 다시 쪼개진다 — {@link fingerLane} 참고.
 */
/** 손가락 레인 사이 거터. 필터링으로 이웃 손가락 텍셀이 새어 들어오는 것을 막는다. */
const UV_FINGER_GUTTER = 0.002;

const UV = Object.freeze({
  torso: [0.0, 0.0, 0.5, 0.36] as MeshUvRect,
  armLeft: [0.5, 0.0, 0.74, 0.18] as MeshUvRect,
  armRight: [0.75, 0.0, 0.99, 0.18] as MeshUvRect,
  handLeft: [0.5, 0.19, 0.61, 0.29] as MeshUvRect,
  handRight: [0.62, 0.19, 0.73, 0.29] as MeshUvRect,
  // 손가락은 다섯 개가 **각자** 레인을 갖는다. 엄지 하나만 있던 시절의 사각형 하나를 그대로
  // 물려주면 다섯 손가락이 같은 좌표에 겹쳐, 검지에 칠한 획이 나머지 넷에 그대로 복제된다.
  fingersLeft: [0.5, 0.41, 0.74, 0.69] as MeshUvRect,
  fingersRight: [0.75, 0.41, 0.99, 0.69] as MeshUvRect,
  legLeft: [0.0, 0.37, 0.24, 0.69] as MeshUvRect,
  legRight: [0.25, 0.37, 0.49, 0.69] as MeshUvRect,
  footLeft: [0.5, 0.3, 0.63, 0.4] as MeshUvRect,
  footRight: [0.64, 0.3, 0.77, 0.4] as MeshUvRect,
  head: [0.0, 0.7, 0.55, 1.0] as MeshUvRect,
});

/* -------------------------------------------------------------------------- */
/* 몸통·팔다리                                                                 */
/* -------------------------------------------------------------------------- */

const TORSO_SEGMENTS = 24;
const LIMB_SEGMENTS = 14;

/**
 * 실루엣 상수는 전부 **중립 신장에 대한 비율**이다(중립 신장 = 1).
 *
 * 값은 상용 VRM 아바타를 실측해 캘리브레이션했다 — 겨드랑이 아래 구간의 몸통 단면과 무릎
 * 아래 다리 단면처럼 T 포즈 팔에 오염되지 않는 구간만 골라 잰 실루엣 프로파일이다.
 * (첫 구현은 몸통이 30~45% 좁고 종아리가 50% 굵어 "빨대 몸통에 통다리"로 보였다.)
 *
 * 비율로 적어 두면 `overallHeight` 로 키를 바꿔도 굵기가 함께 따라오고, 상수만 읽어도
 * 어떤 체형을 노린 것인지 바로 보인다.
 */
function bodyUnit(rig: StudioVrmRig): number {
  return heightScale(rig) * STUDIO_VRM_RIG_NEUTRAL_HEIGHT;
}

/**
 * 중립 대비 선형 배율(중립에서 정확히 1). 세로 오프셋도 이 값을 쓴다.
 *
 * 리그가 직접 주는 값을 쓴다. 골반 높이에서 유추하면 안 된다 — 다리를 늘려도 발바닥이
 * 지면에 남도록 골반이 보정되므로 `legLength` 가 배율에 새어 든다.
 */
function heightScale(rig: StudioVrmRig): number {
  return rig.heightScale;
}

/** 몸통 단면 계획 — [높이, 좌우 반지름 비율, 앞뒤 반지름 비율, 초타원 지수]. */
type TorsoProfile = readonly [y: number, radiusX: number, radiusZ: number, exponent: number];

/**
 * 몸통·상의가 공유하는 높이 앵커.
 *
 * 목 구간은 어깨(사다리꼴근 꼭대기)에서 **위로만** 쌓는다. 예전에는 목 단면을 머리 관절
 * 기준 고정 오프셋(`headY − 0.085h` …)으로 잡았는데, 머리 관절과 어깨 관절의 간격이
 * `0.1088·neckLength − 0.0188·torsoLength` 배(키 기준)라서 목을 짧게 잡으면 그 높이가
 * 어깨 위 단면보다 **아래로** 내려갔다(중립에서도 1.315 < 1.34, 몸통 1.35·목 0.3 에서는
 * 1.358 < 1.466). 로프트 단면이 역행하면 표면이 가슴 쪽으로 되접혀 목 밑동에 뒤집힌 깔때기가
 * 생긴다. 여기서 단조 증가를 구조적으로 보장한다.
 */
function torsoAnchors(rig: StudioVrmRig) {
  const h = heightScale(rig);
  const hipsY = rig.worldRest.hips[1];
  const shoulderY = rig.worldRest.leftUpperArm[1];
  const headY = rig.worldRest.head[1];
  /** 사다리꼴근 꼭대기 — 몸통 로프트의 마지막 "어깨" 단면. */
  const trapY = shoulderY + 0.03 * h;
  /**
   * 목 단면의 위 끝. 두개골(중심 `headY + 0.088h`, 세로 반경 `0.115h`) 안쪽에 묻히므로
   * 최소 구간을 확보하려고 위로 밀어도 실루엣에는 나타나지 않는다.
   */
  const neckTopY = Math.max(headY + 0.03 * h, trapY + 0.05 * h);
  const neckSpan = neckTopY - trapY;
  return {
    h,
    hipsY,
    shoulderY,
    headY,
    trapY,
    neckTopY,
    /** 목 밑동 — 어깨 단면 바로 위. */
    neckBaseY: trapY + 0.12 * neckSpan,
    neckMidY: trapY + 0.55 * neckSpan,
    crotchY: hipsY - 0.075 * h,
    waistY: hipsY + 0.13 * h,
    chestY: shoulderY - 0.06 * h,
  };
}

/**
 * 몸통 단면의 **모양** 계획 — [좌우 반지름 비율, 앞뒤 반지름 비율, 초타원 지수].
 * 높이는 {@link studioVrmTorsoSectionHeights} 가 준다. 두 배열의 길이는 같아야 한다.
 */
const TORSO_SECTION_SHAPES: readonly (readonly [rx: number, rz: number, exponent: number])[] =
  Object.freeze([
    [0.085, 0.068, 2.2],
    [0.094, 0.076, 2.3],
    [0.096, 0.077, 2.3],
    [0.078, 0.066, 2.3],
    [0.09, 0.07, 2.3],
    [0.106, 0.076, 2.4],
    [0.116, 0.073, 2.5],
    [0.098, 0.062, 2.4],
    [0.036, 0.034, 2.1],
    [0.03, 0.03, 2],
    [0.029, 0.029, 2],
  ] as const);

/**
 * 몸통 로프트가 실제로 쓰는 단면 높이(아래 → 위).
 *
 * **반드시 순증가한다.** 역행하면 로프트가 같은 구간을 두 번 지나 표면이 되접히고, 목 밑동에
 * 아래를 보는 깔때기가 생긴다. 체형 파라미터 전 구간에서 이 불변식이 유지되는지 회귀
 * 테스트가 이 배열을 직접 본다.
 */
export function studioVrmTorsoSectionHeights(rig: StudioVrmRig): readonly number[] {
  const { h, hipsY, shoulderY, crotchY, waistY, chestY, trapY, neckBaseY, neckMidY, neckTopY } =
    torsoAnchors(rig);
  return [
    crotchY,
    hipsY - 0.035 * h,
    hipsY + 0.025 * h,
    waistY,
    meshLerp(waistY, chestY, 0.55),
    chestY,
    shoulderY - 0.012 * h,
    trapY,
    neckBaseY,
    neckMidY,
    neckTopY,
  ];
}

function buildTorso(builder: SurfaceBuilder, rig: StudioVrmRig, state: AvatarForgeState): void {
  const { h, waistY, shoulderY } = torsoAnchors(rig);
  const unit = bodyUnit(rig);
  const shoulder = meshClamp(state.proportions.shoulderWidth, 0.7, 1.4);

  const profiles: readonly TorsoProfile[] = studioVrmTorsoSectionHeights(rig).map((y, index) => {
    const [rx, rz, exponent] = TORSO_SECTION_SHAPES[index];
    return [y, rx, rz, exponent] as const;
  });

  // 어깨 너비는 위쪽 단면에만 실린다 — 골반까지 같이 넓어지면 체형이 무너진다.
  const rings: LoftRing[] = profiles.map(([y, rx, rz, exponent], index) => {
    const lateral = meshLerp(1, shoulder, smoothstep(waistY, shoulderY, y));
    return verticalRing(
      [0, y, 0],
      rx * unit * lateral,
      rz * unit,
      torsoSkin(rig, y, h),
      index / (profiles.length - 1),
      exponent,
    );
  });

  addLoft(builder, rings, {
    segments: TORSO_SEGMENTS,
    uvRect: UV.torso,
    capStart: true,
    capEnd: true,
  });
}

/** 팔 한 쪽 — 어깨 안쪽에서 시작해 손목까지. `side` 는 +1(왼쪽) / −1(오른쪽). */
function buildArm(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  side: 1 | -1,
  uvRect: MeshUvRect,
): void {
  const unit = bodyUnit(rig);
  const upper = side > 0 ? "leftUpperArm" : "rightUpperArm";
  const lower = side > 0 ? "leftLowerArm" : "rightLowerArm";
  const hand = side > 0 ? "leftHand" : "rightHand";
  const shoulderX = rig.worldRest[upper][0];
  const elbowX = rig.worldRest[lower][0];
  const wristX = rig.worldRest[hand][0];
  const y = rig.worldRest[upper][1];

  // 어깨 안쪽에서 출발해 몸통 실루엣에 파묻히게 한다(겨드랑이 틈 방지).
  const rootX = meshLerp(0, shoulderX, 0.42);
  const stops: readonly (readonly [x: number, radius: number, skin: MeshSkinBinding])[] = [
    [rootX, 0.038, mix(rig, "spine", upper, 0.25)],
    [shoulderX, 0.036, mix(rig, "spine", upper, 0.82)],
    [meshLerp(shoulderX, elbowX, 0.45), 0.031, only(rig, upper)],
    [elbowX, 0.027, mix(rig, upper, lower, 0.5)],
    [meshLerp(elbowX, wristX, 0.55), 0.024, only(rig, lower)],
    [wristX, 0.019, mix(rig, lower, hand, 0.45)],
  ];

  const rings = stops.map(([x, radius, skin], index) =>
    lateralRing(
      [x, y, 0],
      radius * unit,
      radius * unit * 0.94,
      skin,
      index / (stops.length - 1),
    ),
  );
  addLoft(builder, rings, { segments: LIMB_SEGMENTS, uvRect, capStart: true });
}

/**
 * 방향에 수직인 고리. 손가락처럼 비스듬히 뻗는 마디도 단면이 찌그러지지 않는다.
 *
 * `flatten` 은 **손바닥 법선** 방향에 걸린다 — 손가락은 위아래로 납작하지 좌우로 좁지 않다.
 */
function tubeRing(
  center: MeshVec3,
  direction: MeshVec3,
  radius: number,
  flatten: number,
  skin: MeshSkinBinding,
  texV: number,
): LoftRing {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const axis: MeshVec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  // 손바닥 법선(+Y)을 기준으로 기저를 세운다. 축과 나란해지면 외적이 0 으로 무너지므로 그때만
  // 다른 축을 쓴다.
  const up: MeshVec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  // `side` = axis × up — 손가락이 서로 이웃하는 방향.
  const side: MeshVec3 = [
    axis[1] * up[2] - axis[2] * up[1],
    axis[2] * up[0] - axis[0] * up[2],
    axis[0] * up[1] - axis[1] * up[0],
  ];
  const sideLength = Math.hypot(side[0], side[1], side[2]) || 1;
  const unitSide: MeshVec3 = [side[0] / sideLength, side[1] / sideLength, side[2] / sideLength];
  // `normal` = side × axis — 손바닥 법선. 납작함은 **이쪽**에 준다. 이웃 방향(`side`)을 눌러
  // 버리면 손가락이 가늘어져 너클 간격만큼 벌어진 채 서로 닿지 않는다.
  const normal: MeshVec3 = [
    unitSide[1] * axis[2] - unitSide[2] * axis[1],
    unitSide[2] * axis[0] - unitSide[0] * axis[2],
    unitSide[0] * axis[1] - unitSide[1] * axis[0],
  ];
  return {
    center,
    u: [
      normal[0] * radius * flatten,
      normal[1] * radius * flatten,
      normal[2] * radius * flatten,
    ],
    v: [unitSide[0] * radius, unitSide[1] * radius, unitSide[2] * radius],
    skin,
    texV,
  };
}

function subtractVec(a: MeshVec3, b: MeshVec3): MeshVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * 손가락 하나 — 마디 관절을 그대로 훑어 끝까지 테이퍼되는 튜브.
 *
 * 고리는 각 관절에서 **두 마디에 반씩 실어** 굽힐 때 관절이 끊기지 않게 한다. 끝마디는 리그에
 * 자식이 없으므로 마지막 마디 방향으로 조금 더 뻗어 손톱 쪽을 만든다.
 */
function buildFinger(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  hand: StudioVrmRigBone,
  chain: readonly [StudioVrmRigBone, StudioVrmRigBone, StudioVrmRigBone],
  radius: number,
  uvRect: MeshUvRect,
): void {
  const [proximal, intermediate, distal] = chain;
  const knuckle = rig.worldRest[proximal];
  const middle = rig.worldRest[intermediate];
  const tipJoint = rig.worldRest[distal];
  const lastSegment = subtractVec(tipJoint, middle);
  const tip: MeshVec3 = [
    tipJoint[0] + lastSegment[0] * 0.8,
    tipJoint[1] + lastSegment[1] * 0.8,
    tipJoint[2] + lastSegment[2] * 0.8,
  ];
  // 손가락은 손바닥 방향으로 살짝 납작하다.
  const flatten = 0.82;
  const stops: readonly (readonly [
    center: MeshVec3,
    direction: MeshVec3,
    scale: number,
    skin: MeshSkinBinding,
  ])[] = [
    [knuckle, subtractVec(middle, knuckle), 1, mix(rig, hand, proximal, 0.55)],
    [middle, subtractVec(tipJoint, knuckle), 0.88, mix(rig, proximal, intermediate, 0.55)],
    [tipJoint, subtractVec(tip, middle), 0.76, mix(rig, intermediate, distal, 0.55)],
    [tip, lastSegment, 0.42, only(rig, distal)],
  ];
  addLoft(
    builder,
    stops.map(([center, direction, scale, skin], index) =>
      tubeRing(center, direction, radius * scale, flatten, skin, index / (stops.length - 1)),
    ),
    { segments: 8, uvRect, capEnd: true },
  );
}

/**
 * 손 — 손바닥이 아래를 보는 T 포즈 기준으로 Y 로 얇고 Z 로 넓다.
 *
 * 손바닥은 손목에서 너클까지만 덮고, 그 앞은 손가락 다섯 개가 자기 본을 달고 뻗는다. 예전에는
 * 손 전체가 벙어리장갑 하나에 엄지 돌기를 붙인 형태였고 손가락 본이 아예 없어서, 포즈 라이브러리나
 * 리타게팅이 손가락을 굽힐 대상 자체가 없었다.
 */
/**
 * 손가락 블록의 `index` 번째 세로 레인.
 *
 * 양쪽에 거터를 둬서 이웃 레인의 텍셀이 바이리니어 필터로 새어 들어오지 않게 한다.
 */
function fingerLane(block: MeshUvRect, index: number, count: number): MeshUvRect {
  const [u0, v0, u1, v1] = block;
  const width = (u1 - u0) / count;
  const start = u0 + width * index;
  return [start + UV_FINGER_GUTTER, v0, start + width - UV_FINGER_GUTTER, v1];
}

function buildHand(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  side: 1 | -1,
  palmRect: MeshUvRect,
  fingersRect: MeshUvRect,
): void {
  // 손 굵기는 관절 간격과 같은 배율로 굽는다 — 노드 스케일이 아니라 기하에 들어가야
  // 손가락이 바인드에서 한 번 더 스케일되지 않는다.
  const unit = bodyUnit(rig) * rig.handScale;
  const hand = side > 0 ? "leftHand" : "rightHand";
  const lower = side > 0 ? "leftLowerArm" : "rightLowerArm";
  const prefix = side > 0 ? "left" : "right";
  const [wristX, y, z] = rig.worldRest[hand];
  // 손바닥은 너클까지. 손가락은 그 앞을 자기 본으로 잇는다.
  const knuckleX = rig.worldRest[`${prefix}MiddleProximal` as StudioVrmRigBone][0];
  const palmReach = knuckleX - wristX;

  const stops: readonly (readonly [t: number, ry: number, rz: number, skin: MeshSkinBinding])[] = [
    [0, 0.0165 / rig.handScale, 0.018 / rig.handScale, mix(rig, lower, hand, 0.6)],
    [0.34, 0.015, 0.024, only(rig, hand)],
    [0.78, 0.0135, 0.025, only(rig, hand)],
    [1, 0.0125, 0.024, only(rig, hand)],
  ];
  addLoft(
    builder,
    stops.map(([t, ry, rz, skin], index) =>
      lateralRing(
        [wristX + palmReach * t, y, z],
        ry * unit,
        rz * unit,
        skin,
        index / (stops.length - 1),
        2.4,
      ),
    ),
    { segments: LIMB_SEGMENTS, uvRect: palmRect, capEnd: true },
  );

  // 반경은 너클 간격(`fingerSpread`)의 절반을 넘지 않아야 이웃 손가락과 겹치지 않는다.
  const fingers: readonly (readonly [name: string, radius: number])[] = [
    ["Index", 0.0062],
    ["Middle", 0.0065],
    ["Ring", 0.006],
    ["Little", 0.0052],
  ];
  const laneCount = fingers.length + 1;
  fingers.forEach(([name, radius], index) => {
    buildFinger(
      builder,
      rig,
      hand,
      [
        `${prefix}${name}Proximal` as StudioVrmRigBone,
        `${prefix}${name}Intermediate` as StudioVrmRigBone,
        `${prefix}${name}Distal` as StudioVrmRigBone,
      ],
      radius * unit,
      fingerLane(fingersRect, index, laneCount),
    );
  });
  buildFinger(
    builder,
    rig,
    hand,
    [
      `${prefix}ThumbMetacarpal` as StudioVrmRigBone,
      `${prefix}ThumbProximal` as StudioVrmRigBone,
      `${prefix}ThumbDistal` as StudioVrmRigBone,
    ],
    0.008 * unit,
    fingerLane(fingersRect, fingers.length, laneCount),
  );
}

function buildLeg(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  side: 1 | -1,
  uvRect: MeshUvRect,
): void {
  const h = heightScale(rig);
  const unit = bodyUnit(rig);
  const upper = side > 0 ? "leftUpperLeg" : "rightUpperLeg";
  const lower = side > 0 ? "leftLowerLeg" : "rightLowerLeg";
  const foot = side > 0 ? "leftFoot" : "rightFoot";
  const [x, hipY] = rig.worldRest[upper];
  const kneeY = rig.worldRest[lower][1];
  const ankleY = rig.worldRest[foot][1];

  const stops: readonly (readonly [y: number, rx: number, rz: number, skin: MeshSkinBinding])[] = [
    [hipY + 0.05 * h, 0.045, 0.05, mix(rig, "hips", upper, 0.35)],
    [hipY - 0.04 * h, 0.043, 0.048, mix(rig, "hips", upper, 0.85)],
    [meshLerp(hipY, kneeY, 0.5), 0.036, 0.041, only(rig, upper)],
    [kneeY + 0.03 * h, 0.026, 0.031, mix(rig, upper, lower, 0.35)],
    [kneeY, 0.023, 0.029, mix(rig, upper, lower, 0.55)],
    [meshLerp(kneeY, ankleY, 0.32), 0.026, 0.032, only(rig, lower)],
    [meshLerp(kneeY, ankleY, 0.72), 0.018, 0.023, only(rig, lower)],
    [ankleY, 0.0145, 0.019, mix(rig, lower, foot, 0.4)],
  ];

  addLoft(
    builder,
    stops.map(([y, rx, rz, skin], index) =>
      verticalRing([x, y, 0], rx * unit, rz * unit, skin, index / (stops.length - 1), 2.1),
    ),
    { segments: 16, uvRect, capStart: true },
  );
}

/** 발 — 발목에서 앞(+Z)으로 스윕하고 바닥이 지면(y = groundY)에 닿는다. */
function buildFoot(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  side: 1 | -1,
  uvRect: MeshUvRect,
  outset = 0,
): void {
  const unit = bodyUnit(rig);
  const foot = side > 0 ? "leftFoot" : "rightFoot";
  const [x, ankleY] = rig.worldRest[foot];
  // 발 노드의 균등 스케일은 **발목을 원점으로** 걸린다. 밑창을 지면에 그대로 저작하면
  // footScale>1 은 발을 바닥 아래로 밀고 <1 은 띄운다(1.6 에서 5.4cm 관통). 스케일 후
  // 밑창이 지면에 앉도록 저작 높이를 미리 되돌려 둔다: A + (s·(y−A)) = groundY 를 y 로 푼 값.
  const footScale = rig.nodeScale[foot]?.[1] ?? 1;
  const soleY = ankleY - (ankleY - rig.groundY) / (footScale === 0 ? 1 : footScale);
  const halfHeight = (ankleY - soleY) / 2 + outset;
  const centerY = soleY + halfHeight;

  const stops: readonly (readonly [z: number, rx: number, ryScale: number])[] = [
    [-0.028, 0.017, 0.7],
    [-0.013, 0.021, 0.98],
    [0.016, 0.023, 1],
    [0.046, 0.022, 0.86],
    [0.068, 0.017, 0.56],
    [0.078, 0.01, 0.3],
  ];

  addLoft(
    builder,
    stops.map(([z, rx, ryScale], index) =>
      forwardRing(
        [x, centerY, z * unit],
        rx * unit + outset,
        halfHeight * ryScale,
        only(rig, foot),
        index / (stops.length - 1),
        2.4,
      ),
    ),
    // 4의 배수여야 단면의 최저점에 정점이 놓여 밑창이 지면에 정확히 닿는다.
    // 14각형이면 최저 샘플이 0.979 지점이라 발이 1mm 가량 떠 보인다.
    { segments: 16, uvRect, capStart: true, capEnd: true },
  );
}

/* -------------------------------------------------------------------------- */
/* 두상                                                                        */
/* -------------------------------------------------------------------------- */

const HEAD_COLUMNS = 30;
const HEAD_ROWS = 22;

/**
 * 두개골 표면의 **모양 파라미터**. 두상 격자({@link buildHead})와 이목구비 투영
 * ({@link facePatchPoint})이 반드시 같은 값을 공유해야 한다.
 */
export type StudioVrmHeadSurface = {
  readonly fit: StudioVrmRigHeadFit;
  /** 아래 절반 세로 신장(턱 길이). */
  readonly chin: number;
  /** 광대 볼륨 0~1. */
  readonly cheek: number;
};

function headSurface(rig: StudioVrmRig, state: AvatarForgeState): StudioVrmHeadSurface {
  return {
    fit: rig.head,
    chin: meshClamp(state.face.chinLength, 0.8, 1.25),
    cheek: meshClamp(state.face.cheekVolume, 0, 1),
  };
}

/**
 * 위도(구면 `cosθ`)에 대한 두개골 변형 계수.
 *
 *  - `narrow` — 아래 절반 좌우·앞뒤 공통 수축(턱).
 *  - `cheekGain` — 눈높이 살짝 아래에서 **좌우로만** 붙는 광대 볼륨.
 *  - `stretch` — 아래 절반 세로 신장.
 */
function headLatitudeShape(
  surface: StudioVrmHeadSurface,
  cosTheta: number,
): { narrow: number; cheekGain: number; stretch: number } {
  const lower = meshClamp(-cosTheta, 0, 1);
  const cheekFalloff = Math.exp(-(((cosTheta + 0.18) / 0.34) ** 2));
  return {
    narrow: 1 - 0.42 * lower ** 1.45,
    cheekGain: 1 + surface.cheek * 0.13 * cheekFalloff,
    stretch: cosTheta < 0 ? surface.chin : 1,
  };
}

/** 정면은 살짝 눌러 애니메 특유의 평평한 얼굴 면을 만든다. `zUnit` 은 단위 구면의 +Z 성분. */
function headFrontFlatten(zUnit: number): number {
  return zUnit > 0 ? 1 - 0.13 * zUnit : 1;
}

/**
 * 두개골 **정면 표면의 깊이**(+Z, 두개골 중심 기준) — 얼굴 평면 좌표 `(fx, fy)` 에서.
 * {@link buildHead} 가 격자를 찍는 식과 정확히 같다.
 *
 * 변형식이 위도·경도에 대해 단조라 역산이 닫힌 형태로 나온다: 세로 위치에서 위도를 얻고
 * (아래 절반은 턱 신장을 되돌린다), 가로 위치에서 `narrow · cheekGain` 을 나눠 경도를 얻은 뒤,
 * 정면 반구(+Z)를 골라 같은 식으로 깊이를 계산한다.
 */
function headSurfaceDepth(surface: StudioVrmHeadSurface, fx: number, fy: number): number {
  const head = surface.fit;
  // 두상은 `y = radiusY · cosθ · stretch` 이고 아래 절반에만 stretch(=chin)가 걸리므로,
  // 부호로 어느 절반인지 가른 뒤 그 배율만 되돌린다.
  const cosTheta = meshClamp(
    fy < 0 ? fy / (head.radiusY * surface.chin) : fy / head.radiusY,
    -1,
    1,
  );
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const { narrow, cheekGain } = headLatitudeShape(surface, cosTheta);
  // `x = radiusX · xUnit · narrow · cheekGain` 를 뒤집고, 단위 구면에서
  // `xUnit² + zUnit² = sin²θ` 로 정면 반구의 깊이를 얻는다.
  const xUnit = fx / (head.radiusX * narrow * cheekGain);
  // 0.05 하한은 피처가 두개골 옆면으로 넘어가 깊이가 0 에 붙는 것을 막는다.
  const zUnit = Math.sqrt(Math.max(0.0025, sinTheta * sinTheta - xUnit * xUnit));
  return head.radiusZ * zUnit * narrow * headFrontFlatten(zUnit);
}

/**
 * 조형 상태 하나에 대한 두개골 정면 표면의 깊이. 이목구비가 실제 살갗에 붙어 있는지
 * 검증할 때 쓴다(회귀 테스트의 기준면).
 */
export function studioVrmHeadSurfaceDepth(
  rig: StudioVrmRig,
  state: AvatarForgeState,
  planarX: number,
  planarY: number,
): number {
  return headSurfaceDepth(headSurface(rig, state), planarX, planarY);
}

/**
 * 두개골 — 타원체를 아래쪽에서 턱으로 좁히고 광대에 볼륨을 얹은 형태.
 * 얼굴 비율(headWidth/Height/Depth)은 여기서 굽지 않는다. 머리 **노드 스케일**로 들어가므로
 * 이중 적용이 된다(리그 파일의 바인드 규약 참고).
 */
function buildHead(builder: SurfaceBuilder, rig: StudioVrmRig, surface: StudioVrmHeadSurface): void {
  const head = rig.head;
  const skin = only(rig, "head");
  const [u0, v0, u1, v1] = UV.head;

  const grid: number[][] = [];
  for (let row = 0; row <= HEAD_ROWS; row += 1) {
    const theta = (row / HEAD_ROWS) * Math.PI;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const { narrow, cheekGain, stretch } = headLatitudeShape(surface, cosTheta);
    const line: number[] = [];
    for (let column = 0; column <= HEAD_COLUMNS; column += 1) {
      const phi = (column / HEAD_COLUMNS) * Math.PI * 2;
      const x = -Math.cos(phi) * sinTheta;
      const z = Math.sin(phi) * sinTheta;

      line.push(
        builder.vertex(
          [
            head.center[0] + head.radiusX * x * narrow * cheekGain,
            head.center[1] + head.radiusY * cosTheta * stretch,
            head.center[2] + head.radiusZ * z * narrow * headFrontFlatten(z),
          ],
          [
            meshLerp(u0, u1, column / HEAD_COLUMNS),
            meshLerp(v0, v1, 1 - row / HEAD_ROWS),
          ] satisfies MeshVec2,
          skin,
        ),
      );
    }
    grid.push(line);
  }

  for (let row = 0; row < HEAD_ROWS; row += 1) {
    for (let column = 0; column < HEAD_COLUMNS; column += 1) {
      // (row, col) → (row+1, col) → (row+1, col+1) → (row, col+1) 순서가 바깥을 본다.
      builder.quad(
        grid[row][column],
        grid[row + 1][column],
        grid[row + 1][column + 1],
        grid[row][column + 1],
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 얼굴 — 두개골 표면 패치 + 표정 모프                                          */
/* -------------------------------------------------------------------------- */

/** `eyeline` 은 윗눈꺼풀 선. 이게 없으면 눈이 "고글"처럼 읽힌다(상용 아바타도 별도 재질로 둔다). */
type FacePatchId = "eye" | "iris" | "glint" | "eyeline" | "brow" | "mouth";
type FaceGroup = "eyeWhite" | "iris" | "brow" | "mouth";

/**
 * 얼굴 피처 하나의 모양. 전부 **두개골 중심 기준 얼굴 평면 좌표**(m)이며,
 * 실제 정점은 이 평면 좌표를 두개골 타원체 위로 올려서 만든다.
 */
type FacePatchParams = {
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** 초타원 지수. 2 = 정타원, 크면 사각형에 가까워진다(애니메 눈매). */
  readonly exponent: number;
  /** 두개골 표면에서 띄우는 거리. 겹치는 피처의 앞뒤 순서를 정한다. */
  readonly outset: number;
  /** 라디안. 눈썹 안쪽 끝의 상하 기울기. */
  readonly tilt: number;
  /** 가운데를 위(+)/아래(−)로 휘게 하는 포물선 성분 — 눈썹 아치·입꼬리. */
  readonly bow: number;
  /** 미러링 **이후** 월드 X 이동. 두 눈동자가 같은 방향을 보게 하는 시선 모프용. */
  readonly worldOffsetX: number;
};

type PatchMorphOp = {
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly worldOffsetX?: number;
  /** 두개골 세로 반경의 배수로 주는 이동. 피처 자기 크기와 무관하게 얼굴 전체를 기준으로 움직인다. */
  readonly offsetHeadY?: number;
  readonly tilt?: number;
  readonly bow?: number;
  /** 세로로 줄일 때 위/아래 어느 가장자리를 고정할지. 눈꺼풀이 닫히는 방향을 정한다. */
  readonly collapse?: "top" | "bottom";
};

type FaceMorph = {
  readonly name: string;
  readonly ops: Partial<Record<FacePatchId, PatchMorphOp>>;
  /** 지정하면 그쪽 패치에만 적용된다(한쪽 눈 깜빡임). */
  readonly side?: "left" | "right";
};

const FACE_PATCH_RINGS = 3;
const FACE_PATCH_SEGMENTS = 16;

/** 눈 감김 — 아래 눈꺼풀 선까지 눌러 붙인다. */
const CLOSE_EYE: PatchMorphOp = { collapse: "bottom", scaleY: 0.06 };
/** 눈이 닫히면 윗눈꺼풀 선도 아래 눈꺼풀까지 함께 내려와야 한 줄로 읽힌다. */
const CLOSE_EYELINE: PatchMorphOp = { offsetHeadY: -0.36 };

/**
 * VRM 1.0 표정 프리셋과 **이름이 1:1로 같은** 모프 타깃들. 표정 바인딩이
 * `가중치 1로 같은 이름의 타깃 하나`가 되어 익스포터·로더 양쪽에서 읽기 쉽다.
 */
const FACE_MORPHS: readonly FaceMorph[] = [
  { name: "blink", ops: { eye: CLOSE_EYE, iris: CLOSE_EYE, glint: CLOSE_EYE, eyeline: CLOSE_EYELINE } },
  {
    name: "blinkLeft",
    side: "left",
    ops: { eye: CLOSE_EYE, iris: CLOSE_EYE, glint: CLOSE_EYE, eyeline: CLOSE_EYELINE },
  },
  {
    name: "blinkRight",
    side: "right",
    ops: { eye: CLOSE_EYE, iris: CLOSE_EYE, glint: CLOSE_EYE, eyeline: CLOSE_EYELINE },
  },
  {
    name: "happy",
    ops: {
      eye: { collapse: "bottom", scaleY: 0.3, bow: 0.009 },
      iris: { collapse: "bottom", scaleY: 0.3, bow: 0.009 },
      glint: { collapse: "bottom", scaleY: 0.3, bow: 0.009 },
      eyeline: { offsetHeadY: -0.26, bow: 0.009 },
      brow: { offsetY: 0.004 },
      mouth: { scaleX: 1.5, scaleY: 1.5, bow: -0.006 },
    },
  },
  {
    name: "angry",
    ops: {
      brow: { tilt: 0.34, offsetY: -0.008 },
      eye: { scaleY: 0.82, offsetY: -0.002 },
      eyeline: { offsetHeadY: -0.03, tilt: 0.1 },
      mouth: { scaleX: 0.86, bow: 0.004 },
    },
  },
  {
    name: "sad",
    ops: {
      brow: { tilt: -0.3, offsetY: 0.004 },
      eye: { scaleY: 0.86, offsetY: -0.003 },
      mouth: { scaleX: 0.9, bow: 0.005 },
    },
  },
  {
    name: "relaxed",
    ops: {
      eye: { collapse: "bottom", scaleY: 0.58 },
      iris: { collapse: "bottom", scaleY: 0.58 },
      glint: { collapse: "bottom", scaleY: 0.58 },
      eyeline: { offsetHeadY: -0.15 },
      mouth: { scaleX: 1.2, bow: -0.004 },
    },
  },
  {
    name: "surprised",
    ops: {
      eye: { scaleX: 1.1, scaleY: 1.28 },
      iris: { scaleX: 1.1, scaleY: 1.2 },
      eyeline: { offsetHeadY: 0.02 },
      brow: { offsetY: 0.01 },
      mouth: { scaleX: 0.86, scaleY: 2.4 },
    },
  },
  { name: "aa", ops: { mouth: { scaleX: 0.92, scaleY: 3 } } },
  { name: "ih", ops: { mouth: { scaleX: 1.4, scaleY: 0.85 } } },
  { name: "ou", ops: { mouth: { scaleX: 0.62, scaleY: 2 } } },
  { name: "ee", ops: { mouth: { scaleX: 1.45, scaleY: 1.25 } } },
  { name: "oh", ops: { mouth: { scaleX: 0.85, scaleY: 2.6 } } },
  { name: "lookUp", ops: { iris: { offsetY: 0.006 }, glint: { offsetY: 0.006 } } },
  { name: "lookDown", ops: { iris: { offsetY: -0.006 }, glint: { offsetY: -0.006 } } },
  { name: "lookLeft", ops: { iris: { worldOffsetX: 0.007 }, glint: { worldOffsetX: 0.007 } } },
  { name: "lookRight", ops: { iris: { worldOffsetX: -0.007 }, glint: { worldOffsetX: -0.007 } } },
];

export const STUDIO_VRM_HUMANOID_MORPH_TARGET_NAMES: readonly string[] = Object.freeze(
  FACE_MORPHS.map((morph) => morph.name),
);

type FacePatchInstance = {
  readonly id: FacePatchId;
  readonly side: "left" | "right" | "center";
  readonly group: FaceGroup;
  readonly base: FacePatchParams;
  readonly mirrored: boolean;
  readonly vertices: readonly (readonly [index: number, lx: number, ly: number])[];
};

/**
 * 얼굴 평면 좌표 → 두개골 표면 위의 월드 좌표.
 *
 * 깊이는 {@link headSurfaceDepth} 가 준다 — 즉 **{@link buildHead} 가 실제로 찍는 변형된
 * 표면** 위다. 예전에는 변형 전 타원체에 투영했는데, 두상은 아래 절반을 최대 42% 좁히고(턱)
 * 정면을 13% 누르므로(애니메 평면) 이목구비가 살갗보다 앞에 떠 버렸다 — 기본 조형에서
 * 입이 1.82cm, 눈이 1.32cm 공중부양했다.
 */
function facePatchPoint(
  surface: StudioVrmHeadSurface,
  params: FacePatchParams,
  mirrored: boolean,
  lx: number,
  ly: number,
): MeshVec3 {
  const head = surface.fit;
  const sx = lx * params.radiusX;
  const sy = ly * params.radiusY + params.bow * (1 - lx * lx);
  const cos = Math.cos(params.tilt);
  const sin = Math.sin(params.tilt);
  const planarX = params.centerX + sx * cos - sy * sin;
  const planarY = params.centerY + sx * sin + sy * cos;
  const fx = (mirrored ? -planarX : planarX) + params.worldOffsetX;

  return [
    head.center[0] + fx,
    head.center[1] + planarY,
    head.center[2] + headSurfaceDepth(surface, fx, planarY) + params.outset,
  ];
}

function morphedParams(
  base: FacePatchParams,
  op: PatchMorphOp,
  head: StudioVrmRigHeadFit,
): FacePatchParams {
  const radiusX = base.radiusX * (op.scaleX ?? 1);
  const radiusY = base.radiusY * (op.scaleY ?? 1);
  const anchoredY =
    op.collapse === "top"
      ? base.centerY + base.radiusY - radiusY
      : op.collapse === "bottom"
        ? base.centerY - base.radiusY + radiusY
        : base.centerY;
  return {
    ...base,
    radiusX,
    radiusY,
    centerX: base.centerX + (op.offsetX ?? 0),
    centerY: anchoredY + (op.offsetY ?? 0) + (op.offsetHeadY ?? 0) * head.radiusY,
    tilt: base.tilt + (op.tilt ?? 0),
    bow: base.bow + (op.bow ?? 0),
    worldOffsetX: base.worldOffsetX + (op.worldOffsetX ?? 0),
  };
}

/** 초타원 단위 원반 위의 표본점. `t` 는 중심(0)에서 가장자리(1)까지의 거리. */
function facePatchSample(exponent: number, t: number, angle: number): MeshVec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const power = 2 / exponent;
  return [
    t * Math.sign(cos) * Math.abs(cos) ** power,
    t * Math.sign(sin) * Math.abs(sin) ** power,
  ];
}

function addFacePatch(
  builder: SurfaceBuilder,
  rig: StudioVrmRig,
  surface: StudioVrmHeadSurface,
  patch: Omit<FacePatchInstance, "vertices">,
  uvRect: MeshUvRect,
): FacePatchInstance {
  const skin = only(rig, "head");
  const [u0, v0, u1, v1] = uvRect;
  const vertices: (readonly [number, number, number])[] = [];

  const push = (lx: number, ly: number): number => {
    const index = builder.vertex(
      facePatchPoint(surface, patch.base, patch.mirrored, lx, ly),
      [meshLerp(u0, u1, (lx + 1) / 2), meshLerp(v0, v1, (ly + 1) / 2)],
      skin,
    );
    vertices.push([index, lx, ly]);
    return index;
  };

  const indexStart = builder.indexCursor;
  const center = push(0, 0);
  const rings: number[][] = [];
  for (let ring = 1; ring <= FACE_PATCH_RINGS; ring += 1) {
    const t = ring / FACE_PATCH_RINGS;
    const row: number[] = [];
    for (let column = 0; column < FACE_PATCH_SEGMENTS; column += 1) {
      const angle = (column / FACE_PATCH_SEGMENTS) * Math.PI * 2;
      const [lx, ly] = facePatchSample(patch.base.exponent, t, angle);
      row.push(push(lx, ly));
    }
    rings.push(row);
  }

  for (let column = 0; column < FACE_PATCH_SEGMENTS; column += 1) {
    const next = (column + 1) % FACE_PATCH_SEGMENTS;
    builder.triangle(center, rings[0][column], rings[0][next]);
  }
  for (let ring = 0; ring + 1 < rings.length; ring += 1) {
    for (let column = 0; column < FACE_PATCH_SEGMENTS; column += 1) {
      const next = (column + 1) % FACE_PATCH_SEGMENTS;
      builder.quad(
        rings[ring][column],
        rings[ring + 1][column],
        rings[ring + 1][next],
        rings[ring][next],
      );
    }
  }

  // X 를 뒤집으면 손잡이가 바뀐다 — 오른쪽 패치는 감김을 되돌려야 정면을 본다.
  if (patch.mirrored) builder.flipWindingFrom(indexStart);

  return { ...patch, vertices };
}

function facePatchParams(overrides: Partial<FacePatchParams>): FacePatchParams {
  return {
    centerX: 0,
    centerY: 0,
    radiusX: 0.01,
    radiusY: 0.01,
    exponent: 2,
    outset: 0.002,
    tilt: 0,
    bow: 0,
    worldOffsetX: 0,
    ...overrides,
  };
}

/**
 * 얼굴 피처 배치. 좌표는 전부 **두개골 반경의 비율**이라 얼굴 비율 파라미터나 키가 바뀌어도
 * 이목구비가 같은 자리에 남는다.
 *
 * 구성은 상용 VRM 아바타의 얼굴 재질 구성(EyeWhite / EyeIris / EyeHighlight / FaceEyeline /
 * FaceBrow / FaceMouth)을 실측해 맞췄다. 특히 `eyeline`(윗눈꺼풀 선)이 빠지면 흰자와 홍채만
 * 남아 눈이 고글처럼 보인다 — 애니메 눈매를 만드는 것은 사실상 이 선이다.
 */
function buildFacePatches(
  rig: StudioVrmRig,
  surface: StudioVrmHeadSurface,
): {
  readonly builders: Record<FaceGroup, SurfaceBuilder>;
  readonly patches: readonly FacePatchInstance[];
} {
  const { radiusX: rx, radiusY: ry } = rig.head;

  const builders: Record<FaceGroup, SurfaceBuilder> = {
    eyeWhite: new SurfaceBuilder(),
    iris: new SurfaceBuilder(),
    brow: new SurfaceBuilder(),
    mouth: new SurfaceBuilder(),
  };

  const patch = (
    id: FacePatchId,
    group: FaceGroup,
    side: "left" | "right",
    base: Partial<FacePatchParams>,
  ): Omit<FacePatchInstance, "vertices"> => ({
    id,
    side,
    group,
    mirrored: side === "right",
    base: facePatchParams(base),
  });

  const eye = (side: "left" | "right") =>
    patch("eye", "eyeWhite", side, {
      centerX: 0.46 * rx,
      centerY: -0.205 * ry,
      radiusX: 0.29 * rx,
      radiusY: 0.215 * ry,
      exponent: 2.7,
      outset: 0.015 * rx,
    });

  const iris = (side: "left" | "right") =>
    patch("iris", "iris", side, {
      centerX: 0.46 * rx,
      centerY: -0.235 * ry,
      radiusX: 0.15 * rx,
      radiusY: 0.165 * ry,
      exponent: 2.2,
      outset: 0.034 * rx,
    });

  const glint = (side: "left" | "right") =>
    patch("glint", "eyeWhite", side, {
      centerX: 0.53 * rx,
      centerY: -0.145 * ry,
      radiusX: 0.055 * rx,
      radiusY: 0.05 * ry,
      outset: 0.05 * rx,
    });

  // 눈 위 가장자리를 덮는 굵은 선. 바깥쪽(관자놀이 쪽)이 살짝 두꺼워지도록 기울인다.
  const eyeline = (side: "left" | "right") =>
    patch("eyeline", "brow", side, {
      centerX: 0.47 * rx,
      centerY: 0.012 * ry,
      radiusX: 0.315 * rx,
      radiusY: 0.036 * ry,
      exponent: 3,
      outset: 0.028 * rx,
      tilt: -0.06,
      bow: 0.028 * ry,
    });

  const brow = (side: "left" | "right") =>
    patch("brow", "brow", side, {
      centerX: 0.44 * rx,
      centerY: 0.245 * ry,
      radiusX: 0.29 * rx,
      radiusY: 0.032 * ry,
      exponent: 3.2,
      outset: 0.024 * rx,
      bow: 0.032 * ry,
    });

  const mouth: Omit<FacePatchInstance, "vertices"> = {
    id: "mouth",
    side: "center",
    group: "mouth",
    mirrored: false,
    base: facePatchParams({
      centerX: 0,
      centerY: -0.55 * ry,
      radiusX: 0.15 * rx,
      radiusY: 0.045 * ry,
      exponent: 2.6,
      outset: 0.022 * rx,
      bow: -0.023 * ry,
    }),
  };

  const patches: FacePatchInstance[] = [
    addFacePatch(builders.eyeWhite, rig, surface, eye("left"), [0.02, 0.52, 0.46, 0.98]),
    addFacePatch(builders.eyeWhite, rig, surface, eye("right"), [0.52, 0.52, 0.96, 0.98]),
    addFacePatch(builders.eyeWhite, rig, surface, glint("left"), [0.04, 0.06, 0.22, 0.24]),
    addFacePatch(builders.eyeWhite, rig, surface, glint("right"), [0.54, 0.06, 0.72, 0.24]),
    addFacePatch(builders.iris, rig, surface, iris("left"), [0.02, 0.02, 0.48, 0.98]),
    addFacePatch(builders.iris, rig, surface, iris("right"), [0.52, 0.02, 0.98, 0.98]),
    addFacePatch(builders.brow, rig, surface, brow("left"), [0.02, 0.52, 0.48, 0.98]),
    addFacePatch(builders.brow, rig, surface, brow("right"), [0.52, 0.52, 0.98, 0.98]),
    addFacePatch(builders.brow, rig, surface, eyeline("left"), [0.02, 0.02, 0.48, 0.48]),
    addFacePatch(builders.brow, rig, surface, eyeline("right"), [0.52, 0.02, 0.98, 0.48]),
    addFacePatch(builders.mouth, rig, surface, mouth, [0.02, 0.02, 0.98, 0.98]),
  ];

  return { builders, patches };
}

/** 한 얼굴 그룹의 모프 타깃 배열. 적용 대상이 없는 타깃도 0 델타로 반드시 채운다. */
function buildFaceMorphTargets(
  surface: StudioVrmHeadSurface,
  group: FaceGroup,
  builder: SurfaceBuilder,
  patches: readonly FacePatchInstance[],
): StudioVrmExportMorphTarget[] {
  const vertexCount = builder.vertexCount;
  return FACE_MORPHS.map((morph) => {
    const positions = new Array<number>(vertexCount * 3).fill(0);
    for (const patch of patches) {
      if (patch.group !== group) continue;
      if (morph.side !== undefined && patch.side !== morph.side) continue;
      const op = morph.ops[patch.id];
      if (!op) continue;
      const params = morphedParams(patch.base, op, surface.fit);
      for (const [index, lx, ly] of patch.vertices) {
        const target = facePatchPoint(surface, params, patch.mirrored, lx, ly);
        const base = builder.positionAt(index);
        positions[index * 3] = target[0] - base[0];
        positions[index * 3 + 1] = target[1] - base[1];
        positions[index * 3 + 2] = target[2] - base[2];
      }
    }
    return { name: morph.name, positions };
  });
}

/* -------------------------------------------------------------------------- */
/* 헤어 — 아바타 조형 파츠 계획을 그대로 굽는다                                 */
/* -------------------------------------------------------------------------- */

const HAIR_STRAND_RADIAL = 10;
const HAIR_STRAND_LENGTH = 14;
const HAIR_CAP_COLUMNS = 24;
const HAIR_CAP_ROWS = 14;
const HAIR_SPHERE_COLUMNS = 20;
const HAIR_SPHERE_ROWS = 12;

type HairTransform = {
  readonly translation: MeshVec3;
  readonly rotation: ReturnType<typeof eulerXyzMatrix>;
  readonly scale: MeshVec3;
};

/**
 * 파츠 계획(머리 로컬·단위 스케일)을 두개골 실측에 맞춰 월드로 옮긴다.
 *
 * 계수 0.56/0.46/0.54 와 기준점 (0, 0.18, 0.015) 은 아바타 조형 렌더러
 * (`StudioVrmAvatarForge.tsx` 의 `transformHairPart`) 와 **같은 값**이다. 화면 미리보기와
 * 구워 나간 VRM 이 같은 자리에 같은 머리를 갖도록 규약을 공유한다. 생성 캐릭터는 항상
 * +Z 를 보므로 렌더러의 `frontSign` 은 여기서 +1 로 고정된다.
 */
function hairPartTransform(part: AvatarForgeHairPart, head: StudioVrmRigHeadFit): HairTransform {
  const scaleX = head.radiusX / 0.56;
  const scaleY = head.radiusY / 0.46;
  const scaleZ = head.radiusZ / 0.54;
  return {
    translation: [
      head.center[0] + part.position[0] * scaleX,
      head.center[1] + (part.position[1] - 0.18) * scaleY,
      head.center[2] + (part.position[2] - 0.015) * scaleZ,
    ],
    rotation: eulerXyzMatrix(part.rotation[0], part.rotation[1], part.rotation[2]),
    scale: [part.scale[0] * scaleX, part.scale[1] * scaleY, part.scale[2] * scaleZ],
  };
}

/**
 * 단위 구를 파츠 변환에 태워 쌓는다.
 *
 * 캡(두상 덮개)은 방위각에 따라 **덮는 각도를 달리한다** — 앞은 헤어라인에서 끊고 뒤는
 * 목덜미까지 내린다. 대칭 캡(렌더러의 0.7π)은 앞뒤가 같은 높이에서 끊겨 눈·눈썹까지
 * 덮어 버린다. 오버레이 렌더러는 알 수 없는 VRM 의 두상을 추정할 뿐이지만, 여기서는
 * 두개골 실측을 알고 있으므로 실제 머리처럼 앞뒤를 다르게 덮을 수 있다.
 */
function addHairSphere(
  builder: SurfaceBuilder,
  transform: HairTransform,
  skin: (t: number) => MeshSkinBinding,
  uvRect: MeshUvRect,
  options: {
    readonly columns: number;
    readonly rows: number;
    /** 정면(+Z)에서 덮는 극각. */
    readonly thetaFront: number;
    /** 후두부(−Z)에서 덮는 극각. */
    readonly thetaBack: number;
  },
): void {
  const [u0, v0, u1, v1] = uvRect;
  const grid: number[][] = [];
  for (let row = 0; row <= options.rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column <= options.columns; column += 1) {
      const phi = (column / options.columns) * Math.PI * 2;
      // sin(phi) = +1 이 정면(+Z), −1 이 후두부(−Z).
      const frontness = (Math.sin(phi) + 1) / 2;
      const theta =
        (row / options.rows) * meshLerp(options.thetaBack, options.thetaFront, frontness);
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const unit: MeshVec3 = [-Math.cos(phi) * sinTheta, cosTheta, Math.sin(phi) * sinTheta];
      line.push(
        builder.vertex(
          applyTrs(unit, transform.translation, transform.rotation, transform.scale),
          [
            meshLerp(u0, u1, column / options.columns),
            meshLerp(v0, v1, 1 - row / options.rows),
          ],
          // 로컬 Y +1(위) → −1(아래) 을 체인 파라미터 0 → 1 로 옮긴다.
          skin((1 - cosTheta) / 2),
        ),
      );
    }
    grid.push(line);
  }
  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      builder.quad(
        grid[row][column],
        grid[row + 1][column],
        grid[row + 1][column + 1],
        grid[row][column + 1],
      );
    }
  }
}

/**
 * 가닥(tapered-capsule). 곡률·웨이브 산식은 렌더러의 `createTaperedStrandGeometry` 와
 * 같다 — 미리보기와 결과물의 실루엣이 갈라지지 않게 하기 위한 것이다.
 * 감김만 바깥 방향으로 바로잡았다(렌더러는 DoubleSide 라 방향이 문제되지 않았다).
 */
function addHairStrand(
  builder: SurfaceBuilder,
  part: AvatarForgeHairPart,
  transform: HairTransform,
  skin: (t: number) => MeshSkinBinding,
  uvRect: MeshUvRect,
): void {
  const [u0, v0, u1, v1] = uvRect;

  const place = (unit: MeshVec3): MeshVec3 =>
    applyTrs(unit, transform.translation, transform.rotation, transform.scale);

  const grid: number[][] = [];
  for (let row = 0; row <= HAIR_STRAND_LENGTH; row += 1) {
    const t = row / HAIR_STRAND_LENGTH;
    // 중심선은 헤어 리그와 **같은 식**을 쓴다 — 어긋나면 흔들릴 때 가닥이 축을 중심으로 비틀린다.
    const [curveX, y, curveZ] = studioVrmHairStrandSpine(part, t);
    const radius = Math.max(0.08, 1 - part.taper * t ** 0.72);
    const rowSkin = skin(t);

    const line: number[] = [];
    for (let column = 0; column <= HAIR_STRAND_RADIAL; column += 1) {
      const angle = (column / HAIR_STRAND_RADIAL) * Math.PI * 2;
      line.push(
        builder.vertex(
          place([curveX + Math.cos(angle) * radius, y, curveZ + Math.sin(angle) * radius]),
          [meshLerp(u0, u1, column / HAIR_STRAND_RADIAL), meshLerp(v0, v1, 1 - t)],
          rowSkin,
        ),
      );
    }
    grid.push(line);
  }

  for (let row = 0; row < HAIR_STRAND_LENGTH; row += 1) {
    for (let column = 0; column < HAIR_STRAND_RADIAL; column += 1) {
      builder.quad(
        grid[row][column],
        grid[row][column + 1],
        grid[row + 1][column + 1],
        grid[row + 1][column],
      );
    }
  }

  const top = builder.vertex(place([0, 1, 0]), [meshLerp(u0, u1, 0.5), v1], skin(0));
  const bottom = builder.vertex(place([0, -1, 0]), [meshLerp(u0, u1, 0.5), v0], skin(1));
  for (let column = 0; column < HAIR_STRAND_RADIAL; column += 1) {
    builder.triangle(top, grid[0][column], grid[0][column + 1]);
    const last = HAIR_STRAND_LENGTH;
    builder.triangle(bottom, grid[last][column + 1], grid[last][column]);
  }
}

/**
 * 파츠 계획을 **실제 두상에 맞춰** 앉힌다.
 *
 * 조형 패널의 오버레이 렌더러는 알 수 없는 VRM 의 두상을 휴리스틱으로 **추정**하지만, 여기서는
 * 두개골을 직접 만들었으므로 실측을 안다. 그래서 계획을 그대로 두되(파츠 계획은 바이트 동일성
 * 계약이 걸린 공유 자산이다) 굽는 단계에서 두 가지를 바로잡는다:
 *
 *  1. **뿌리 앵커링** — 가닥·뒷머리가 정수리 위로 솟지 않게 내린다. 계획의 길이는 그대로라
 *     롱헤어는 여전히 길게 흐르고, 위로 튀어나온 부분만 사라진다.
 *  2. **앞머리 재적합** — 헤어라인에서 시작해 `fringe` 가 정하는 지점까지만 내려오게 한다.
 *     계획의 앞머리는 턱까지 닿아 얼굴을 덮어 버렸다.
 */
function fitHairPartToSkull(
  part: AvatarForgeHairPart,
  transform: HairTransform,
  head: StudioVrmRigHeadFit,
  fringe: number,
): HairTransform {
  if (part.role === "cap") return fitHairCapToSkull(transform, head);

  if (part.role === "bang") {
    const hairlineY = head.center[1] + 0.62 * head.radiusY;
    const tipY = head.center[1] + head.radiusY * (0.3 - 0.8 * meshClamp(fringe, 0, 1.4));
    const halfY = Math.max(0.04 * head.radiusY, (hairlineY - tipY) / 2);
    return {
      ...transform,
      translation: [transform.translation[0], (hairlineY + tipY) / 2, transform.translation[2]],
      scale: [transform.scale[0], halfY, transform.scale[2]],
    };
  }

  // 먼저 머리 밖으로 밀고, 그 자리에서 다시 뿌리를 내린다. 순서가 중요하다 — 미는 만큼
  // 두개골 표면이 낮아지므로 천장도 같이 내려가야 뿌리가 캡 밑으로 들어간다.
  const pushed = pushOutsideSkull(transform.translation, head);
  // 회전이 작은 파츠들이라 |scale.y| 를 세로 반경으로 봐도 오차가 실루엣에 드러나지 않는다.
  const topY = pushed[1] + Math.abs(transform.scale[1]);
  const ceiling = skullTuckCeiling(pushed, head);
  const translation: MeshVec3 =
    topY <= ceiling ? pushed : [pushed[0], pushed[1] - (topY - ceiling), pushed[2]];

  return { ...transform, translation };
}

/** 캡 껍질의 최소 두께(두개골 반경 대비). 0 이면 두개골 표면과 정확히 겹쳐 z-fighting 이 난다. */
const HAIR_CAP_MIN_SHELL = 0.05;

/**
 * 캡을 **두개골 바깥의 껍질**로 만든다.
 *
 * 계획의 캡 스케일은 두개골 반경의 배수(`volume × 스타일 계수`)로 들어오는데, 그대로 쓰면
 * 두께가 아니라 **포함 여부**가 바뀐다. 배포 프리셋 21개 중 5개(`pixie-sport` 0.826,
 * `hero-crop` 0.880, `androgynous-crop`·`silver-senior` 0.900, `elegant-bun` 0.950)는 캡이
 * 통째로 두개골 안으로 들어가 정수리가 민머리로 보였고, 배수가 정확히 1인 9개는 표면과
 * 완전히 겹쳐 z-fighting 이 났다.
 *
 * 그래서 두께는 **항상 바깥으로만** 준다. 1을 넘는 부피는 그대로 살리고, 1 이하는 최소
 * 두께 안에서만 얇아진다 — `volume` 의 대소 관계는 유지되면서 캡이 살갗 밑으로는 못 간다.
 * 중심이 어긋난 캡도 덮이도록 중심 오프셋만큼 반경을 더 준다.
 */
function fitHairCapToSkull(transform: HairTransform, head: StudioVrmRigHeadFit): HairTransform {
  const radii: MeshVec3 = [head.radiusX, head.radiusY, head.radiusZ];
  const fitted = radii.map((radius, axis) => {
    const planned = Math.abs(transform.scale[axis]) / radius;
    const shell =
      planned >= 1
        ? HAIR_CAP_MIN_SHELL + (planned - 1)
        : HAIR_CAP_MIN_SHELL * meshClamp(planned, 0.5, 1);
    const offset = Math.abs(transform.translation[axis] - head.center[axis]);
    return radius * (1 + shell) + offset;
  });
  return { ...transform, scale: [fitted[0], fitted[1], fitted[2]] };
}

/**
 * 파츠가 놓인 **가로 위치에서의 두개골 표면 높이**. 여기에 약간의 여유를 더한 값이 가닥 뿌리의
 * 천장이 된다.
 *
 * 머리 반경만큼 옆으로 민 가닥의 천장을 정수리 높이로 잡으면 두개골이 이미 좁아진 자리에
 * 뿌리가 떠서 **머리 옆에 붙은 기둥 두 개**로 보인다. 옆으로 밀수록 표면이 낮아진다는
 * 타원체 관계를 그대로 쓰면 뿌리가 캡 밑으로 들어가 자연스럽게 흘러내린다.
 */
function skullTuckCeiling(translation: MeshVec3, head: StudioVrmRigHeadFit): number {
  const dx = (translation[0] - head.center[0]) / head.radiusX;
  const dz = (translation[2] - head.center[2]) / head.radiusZ;
  const horizontal = Math.min(1, Math.hypot(dx, dz));
  const surfaceY = head.center[1] + head.radiusY * Math.sqrt(Math.max(0, 1 - horizontal ** 2));
  return surfaceY + 0.12 * head.radiusY;
}

/**
 * 옆·뒷머리를 두개골 표면 밖으로 밀어낸다.
 *
 * 계획의 가로 오프셋은 두개골보다 안쪽이라(옆머리 |x| 0.069 < 두개골 반경 0.092) 머리 속에
 * 파묻히고, 두개골이 좁아지는 정수리·턱 부근에서만 삐져나와 **얼굴 옆 판자 두 장**으로
 * 보인다. 타원체 기준 정규화 거리를 표면 근처까지 끌어올려 머리에 얹는다.
 * 세로(dy)는 건드리지 않는다 — 길이와 흐름은 계획이 정한 그대로 둔다.
 */
function pushOutsideSkull(
  translation: MeshVec3,
  head: StudioVrmRigHeadFit,
  minNormalized = 0.9,
): MeshVec3 {
  const dx = translation[0] - head.center[0];
  const dz = translation[2] - head.center[2];
  const normalized = Math.hypot(dx / head.radiusX, dz / head.radiusZ);
  // 정수리 한가운데 파츠(번·삐침머리)는 밀 방향이 없다 — 그대로 둔다.
  if (normalized >= minNormalized || normalized < 0.05) return translation;
  const gain = minNormalized / normalized;
  return [head.center[0] + dx * gain, translation[1], head.center[2] + dz * gain];
}

/**
 * 정점을 체인 조인트에 배분한다. `t` 0(뿌리·위) → 1(끝·아래). 이웃한 두 마디에만 실어
 * 선형 보간한다.
 *
 * **뿌리 쪽은 체인의 첫 조인트가 아니라 고정 앵커에 싣는다.** VRM 스프링에서 체인의 첫
 * 항목은 "움직이지 않는 루트"가 아니다 — three-vrm 은 (본, 자식) 쌍마다 조인트를 만들어
 * **첫 본의 회전도 시뮬레이션한다**. 거기에 부착 링을 100% 실으면 링이 축을 중심으로
 * 함께 돌아 두피에서 어긋난다. 앵커는 어떤 스프링에도 들어가지 않으므로 머리만 따라간다.
 */
function hairChainSkin(chain: StudioVrmHairChain, jointBase: number, t: number): MeshSkinBinding {
  const span = chain.joints.length - 1;
  const position = meshClamp(t, 0, 1) * span;
  const lower = Math.min(span - 1, Math.floor(position));
  const blend = position - lower;
  const stop = (index: number): number =>
    index === 0
      ? jointBase + STUDIO_VRM_HAIR_ANCHOR_JOINT
      : jointBase + chain.jointOffset + index;
  const first = stop(lower);
  if (blend <= 0) return [[first, 1]];
  return [
    [first, 1 - blend],
    [stop(lower + 1), blend],
  ];
}

function buildHair(
  rig: StudioVrmRig,
  state: AvatarForgeState,
): { readonly builder: SurfaceBuilder; readonly hairRig: StudioVrmHairRig | null } | null {
  const parts = buildAvatarForgeHairParts(state);
  if (parts.length === 0) return null;

  const builder = new SurfaceBuilder();
  const skin = only(rig, "head");

  // 가닥마다 두개골 적합까지 끝난 변환을 먼저 확정한다 — 체인 조인트가 그 변환 위에 놓인다.
  // 여기까지는 **조형 스케일 이전** 좌표다.
  const transforms = parts.map((part) =>
    fitHairPartToSkull(part, hairPartTransform(part, rig.head), rig.head, state.hair.fringe),
  );
  const hairRig = shapeStudioVrmHairRig(
    buildStudioVrmHairRig(
      parts.map((part, index) => ({ part, transform: transforms[index] })),
      rig.worldRest.head,
      rig.heightScale,
    ),
    rig.worldRest.head,
    rig.nodeScale.head ?? [1, 1, 1],
    rig.heightScale,
  );

  const jointBase = rig.bones.length;

  /**
   * 파츠 하나의 스킨을 축 방향 파라미터의 함수로 준다.
   *
   * **헤어는 전부 헤어 조인트에 묶는다** — 흔들리지 않는 캡·정수리 파츠도 고정 앵커에
   * 묶어 역스케일 피벗 아래에 둔다. `head` 에 직접 묶으면 그 노드의 조형 스케일이
   * 한 번 더 걸려, 이미 조형 좌표로 저작한 헤어가 두 배로 커진다.
   */
  const skinFor = (partId: string): ((t: number) => MeshSkinBinding) => {
    const binding = hairRig?.bindings.get(partId);
    if (binding === undefined) return () => skin;
    if (binding.kind === "rigid") {
      const joint: MeshSkinBinding = [[jointBase + binding.jointOffset, 1]];
      return () => joint;
    }
    return (t) => hairChainSkin(binding.chain, jointBase, t);
  };

  parts.forEach((part, index) => {
    // 파츠마다 세로 띠 하나씩 — 같은 머티리얼을 쓰므로 UV 가 겹치면 안 된다.
    const uvRect: MeshUvRect = [0, index / parts.length, 1, (index + 1) / parts.length];
    const transform = transforms[index];
    const partSkin = skinFor(part.id);
    if (part.primitive === "tapered-capsule") {
      addHairStrand(builder, part, transform, partSkin, uvRect);
      return;
    }
    if (part.role === "cap") {
      // 앞은 헤어라인에서 끊고 뒤는 목덜미까지 — 대칭 캡은 눈·눈썹까지 덮어 버린다.
      addHairSphere(builder, transform, partSkin, uvRect, {
        columns: HAIR_CAP_COLUMNS,
        rows: HAIR_CAP_ROWS,
        thetaFront: Math.PI * 0.4,
        thetaBack: Math.PI * 0.82,
      });
      return;
    }
    addHairSphere(builder, transform, partSkin, uvRect, {
      columns: HAIR_SPHERE_COLUMNS,
      rows: HAIR_SPHERE_ROWS,
      thetaFront: Math.PI,
      thetaBack: Math.PI,
    });
  });

  // 마지막에 **머리 조형 스케일**을 한 번에 얹는다.
  //
  // 두상 메시는 `head` 조인트에 묶여 런타임에 `T·S·T⁻¹` 로 커지지만, 헤어는 역스케일 피벗
  // 아래라 그 스케일을 받지 않는다 — 저작 단계에서 반영하지 않으면 두신비를 키웠을 때
  // 머리카락만 원래 크기로 남아 커진 두개골 속에 파묻힌다(두신비 2.5 에서 체인 묶임 정점의
  // 67~100%).
  //
  // 파츠 스케일에 미리 곱해 넣을 수는 없다. 파츠에 회전이 있으면 `R·S ≠ S·R` 이라
  // 파츠 로컬 TRS 로는 표현할 수 없는 변환이고, 실제로 배포 프리셋에서 0.2~1.9mm,
  // 얼굴 비율 극단에서 4.7mm 어긋났다. 저작이 끝난 정점에 직접 적용해야 정확하다.
  shapeAboutHead(builder, rig);
  return { builder, hairRig };
}

/** 저작이 끝난 헤어 정점에 머리 조형 스케일(`T·S·T⁻¹`)을 얹는다. */
function shapeAboutHead(builder: SurfaceBuilder, rig: StudioVrmRig): void {
  const scale = rig.nodeScale.head ?? [1, 1, 1];
  if (scale[0] === 1 && scale[1] === 1 && scale[2] === 1) return;
  const joint = rig.worldRest.head;
  builder.transformPositions(([x, y, z]) => [
    joint[0] + (x - joint[0]) * scale[0],
    joint[1] + (y - joint[1]) * scale[1],
    joint[2] + (z - joint[2]) * scale[2],
  ]);
}

/* -------------------------------------------------------------------------- */
/* 의상                                                                        */
/* -------------------------------------------------------------------------- */

/** 상의 — 몸통 실루엣에서 살짝 띄운 셸 + 반소매. */
function buildTops(rig: StudioVrmRig, state: AvatarForgeState): SurfaceBuilder {
  const builder = new SurfaceBuilder();
  const { h, hipsY, shoulderY, waistY, chestY } = torsoAnchors(rig);
  const unit = bodyUnit(rig);
  const shoulder = meshClamp(state.proportions.shoulderWidth, 0.7, 1.4);
  const thickness = 0.007 * unit;

  const profiles: readonly TorsoProfile[] = [
    [hipsY + 0.005 * h, 0.096, 0.077, 2.3],
    [waistY, 0.079, 0.067, 2.3],
    [meshLerp(waistY, chestY, 0.55), 0.091, 0.071, 2.3],
    [chestY, 0.107, 0.077, 2.4],
    [shoulderY - 0.012 * h, 0.117, 0.074, 2.5],
    [shoulderY + 0.028 * h, 0.097, 0.062, 2.4],
    [shoulderY + 0.048 * h, 0.06, 0.05, 2.2],
  ];

  addLoft(
    builder,
    profiles.map(([y, rx, rz, exponent], index) => {
      const lateral = meshLerp(1, shoulder, smoothstep(waistY, shoulderY, y));
      return verticalRing(
        [0, y, 0],
        rx * unit * lateral + thickness,
        rz * unit + thickness,
        torsoSkin(rig, y, h),
        index / (profiles.length - 1),
        exponent,
      );
    }),
    { segments: TORSO_SEGMENTS },
  );

  for (const side of [1, -1] as const) {
    const upper = side > 0 ? "leftUpperArm" : "rightUpperArm";
    const lower = side > 0 ? "leftLowerArm" : "rightLowerArm";
    const shoulderX = rig.worldRest[upper][0];
    const elbowX = rig.worldRest[lower][0];
    const y = rig.worldRest[upper][1];
    const stops: readonly (readonly [x: number, radius: number, skin: MeshSkinBinding])[] = [
      [meshLerp(0, shoulderX, 0.5), 0.036, mix(rig, "spine", upper, 0.3)],
      [shoulderX, 0.035, mix(rig, "spine", upper, 0.82)],
      [meshLerp(shoulderX, elbowX, 0.4), 0.031, only(rig, upper)],
    ];
    addLoft(
      builder,
      stops.map(([x, radius, skin], index) =>
        lateralRing(
          [x, y, 0],
          radius * unit,
          radius * unit * 0.94,
          skin,
          index / (stops.length - 1),
        ),
      ),
      { segments: LIMB_SEGMENTS, uvRect: side > 0 ? UV.armLeft : UV.armRight },
    );
  }

  return builder;
}

/** 하의 — 허리에서 허벅지 중간까지 퍼지는 스커트 셸. 가랑이 위상 없이 실루엣만 만든다. */
function buildBottoms(rig: StudioVrmRig): SurfaceBuilder {
  const builder = new SurfaceBuilder();
  const { h, hipsY, waistY } = torsoAnchors(rig);
  const unit = bodyUnit(rig);
  const thickness = 0.008 * unit;

  const profiles: readonly TorsoProfile[] = [
    [waistY + 0.012 * h, 0.082, 0.07, 2.3],
    [hipsY + 0.025 * h, 0.099, 0.08, 2.3],
    [hipsY - 0.045 * h, 0.108, 0.09, 2.2],
    [hipsY - 0.115 * h, 0.115, 0.099, 2.1],
  ];

  addLoft(
    builder,
    profiles.map(([y, rx, rz, exponent], index) =>
      verticalRing(
        [0, y, 0],
        rx * unit + thickness,
        rz * unit + thickness,
        torsoSkin(rig, y, h),
        index / (profiles.length - 1),
        exponent,
      ),
    ),
    { segments: TORSO_SEGMENTS },
  );
  return builder;
}

function buildShoes(rig: StudioVrmRig): SurfaceBuilder {
  const builder = new SurfaceBuilder();
  const outset = 0.004 * bodyUnit(rig);
  buildFoot(builder, rig, 1, UV.footLeft, outset);
  buildFoot(builder, rig, -1, UV.footRight, outset);
  return builder;
}

/* -------------------------------------------------------------------------- */
/* 조립                                                                        */
/* -------------------------------------------------------------------------- */

export type StudioVrmHumanoidMeshPart = {
  readonly nodeName: string;
  readonly meshName: string;
  readonly primitives: readonly StudioVrmExportPrimitive[];
};

export type StudioVrmHumanoidMesh = {
  readonly version: typeof STUDIO_VRM_HUMANOID_MESH_VERSION;
  readonly rig: StudioVrmRig;
  readonly materials: readonly StudioVrmExportMaterial[];
  readonly parts: readonly StudioVrmHumanoidMeshPart[];
  /** `parts` 안에서 표정 모프를 들고 있는 파트의 인덱스. */
  readonly facePartIndex: number;
  readonly morphTargetNames: readonly string[];
  /**
   * 헤어 가닥이 매달린 체인 조인트. 가닥이 없으면(짧은 머리·헤어 없음) `null`.
   * 스킨 `joints` 는 휴머노이드 본(`STUDIO_VRM_RIG_BONES`) **뒤에** 이 순서대로 이어 붙는다.
   */
  readonly hairRig: StudioVrmHairRig | null;
};

function primitiveOf(
  builder: SurfaceBuilder,
  material: number,
  targets?: readonly StudioVrmExportMorphTarget[],
): StudioVrmExportPrimitive {
  const built = builder.build();
  return {
    positions: built.positions,
    normals: built.normals,
    uvs: built.uvs,
    joints: built.joints,
    weights: built.weights,
    indices: built.indices,
    material,
    targets,
  };
}

/** 조형 상태 하나를 파트별 스킨드 메시 묶음으로 굽는다. */
export function buildStudioVrmHumanoidMesh(state: AvatarForgeState): StudioVrmHumanoidMesh {
  const rig = buildStudioVrmRig({ proportions: state.proportions, face: state.face });

  const surface = headSurface(rig, state);

  const body = new SurfaceBuilder();
  buildTorso(body, rig, state);
  buildHead(body, rig, surface);
  buildArm(body, rig, 1, UV.armLeft);
  buildArm(body, rig, -1, UV.armRight);
  buildHand(body, rig, 1, UV.handLeft, UV.fingersLeft);
  buildHand(body, rig, -1, UV.handRight, UV.fingersRight);
  buildLeg(body, rig, 1, UV.legLeft);
  buildLeg(body, rig, -1, UV.legRight);
  buildFoot(body, rig, 1, UV.footLeft);
  buildFoot(body, rig, -1, UV.footRight);

  const face = buildFacePatches(rig, surface);
  const faceGroups: readonly (readonly [FaceGroup, number])[] = [
    ["eyeWhite", STUDIO_VRM_HUMANOID_MATERIALS.eyeWhite],
    ["iris", STUDIO_VRM_HUMANOID_MATERIALS.iris],
    ["brow", STUDIO_VRM_HUMANOID_MATERIALS.brow],
    ["mouth", STUDIO_VRM_HUMANOID_MATERIALS.mouth],
  ];

  const parts: StudioVrmHumanoidMeshPart[] = [
    {
      nodeName: "Body",
      meshName: "Body_Skin",
      primitives: [primitiveOf(body, STUDIO_VRM_HUMANOID_MATERIALS.skin)],
    },
    {
      nodeName: "Face",
      meshName: "Face",
      primitives: faceGroups.map(([group, material]) =>
        primitiveOf(
          face.builders[group],
          material,
          buildFaceMorphTargets(surface, group, face.builders[group], face.patches),
        ),
      ),
    },
  ];
  const facePartIndex = 1;

  const hair = buildHair(rig, state);
  if (hair) {
    parts.push({
      nodeName: "Hair",
      meshName: "Hair",
      primitives: [primitiveOf(hair.builder, STUDIO_VRM_HUMANOID_MATERIALS.hair)],
    });
  }

  parts.push(
    {
      nodeName: "Tops",
      meshName: "Tops",
      primitives: [primitiveOf(buildTops(rig, state), STUDIO_VRM_HUMANOID_MATERIALS.tops)],
    },
    {
      nodeName: "Bottoms",
      meshName: "Bottoms",
      primitives: [primitiveOf(buildBottoms(rig), STUDIO_VRM_HUMANOID_MATERIALS.bottoms)],
    },
    {
      nodeName: "Shoes",
      meshName: "Shoes",
      primitives: [primitiveOf(buildShoes(rig), STUDIO_VRM_HUMANOID_MATERIALS.shoes)],
    },
  );

  return {
    version: STUDIO_VRM_HUMANOID_MESH_VERSION,
    rig,
    materials: buildMaterials(state),
    parts,
    facePartIndex,
    morphTargetNames: STUDIO_VRM_HUMANOID_MORPH_TARGET_NAMES,
    hairRig: hair?.hairRig ?? null,
  };
}
