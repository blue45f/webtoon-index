// VRM 본 부착 소품(아이템) 시스템 — 캐릭터 손/머리/몸에 프로시저럴/GLB 소품을 자유롭게 부착한다.
// 코미Po!의 "소품 배치"를 넘어, 부착 본·오프셋·회전·스케일·색상을 모두 사용자가 제어하고 직렬화한다.
//
// 설계 원칙:
//  - 기본 소품은 three 프리미티브 조합으로 생성하고, Blender 원본은 번들된 first-party GLB만 사용한다.
//  - 부착 본은 VRM humanoid 표준 본 이름만 사용(StudioVrmPoser의 본 집합과 호환).
//  - 직렬화는 옵셔널·버전 필드 → 기존 스튜디오 문서 하위호환.

export const VRM_PROPS_VERSION = 2 as const;
export const VRM_PROP_GRIP_FIT_MIN = 0.7;
export const VRM_PROP_GRIP_FIT_MAX = 1.3;

/** 부착 가능한 humanoid 본(three-vrm humanoid 표준 이름). */
export type PropAttachBone =
  | "rightHand"
  | "leftHand"
  | "head"
  | "chest"
  | "spine"
  | "hips"
  | "neck";

export const PROP_ATTACH_BONES: readonly PropAttachBone[] = [
  "rightHand",
  "leftHand",
  "head",
  "neck",
  "chest",
  "spine",
  "hips",
] as const;

export const PROP_BONE_LABELS: Record<PropAttachBone, string> = {
  rightHand: "오른손",
  leftHand: "왼손",
  head: "머리",
  neck: "목",
  chest: "가슴",
  spine: "허리",
  hips: "골반",
};

export type PropCategory = "hand" | "head" | "body";

export const PROP_CATEGORY_LABELS: Record<PropCategory, string> = {
  hand: "손 소품",
  head: "머리 소품",
  body: "몸 소품",
};

export type Vec3 = readonly [number, number, number];

export type PropAnchorRole = "primary" | "secondary" | "support" | "surface";

/**
 * 소품 geometry의 의미 있는 접촉점. position/forward/up은 소품 로컬 공간 기준이다.
 * renderer는 이 basis를 캐릭터 소켓 basis에 맞춰 geometry 원점과 무관하게 정렬한다.
 */
export interface PropAnchorDef {
  id: string;
  role: PropAnchorRole;
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  gripRadius?: number;
}

export type PropGripKind = "cylinder" | "handle" | "flat" | "pinch" | "support" | "wear";

/** 손가락 자동 그립을 만들 때 사용하는 소품 접촉 단면. */
export interface PropGripProfile {
  kind: PropGripKind;
  /** 손이 감싸는 반경(미터). flat/pinch는 두께의 절반에 해당한다. */
  radius: number;
  fingerCurlDeg: number;
  thumbOppositionDeg: number;
}

export type PropFitReference = "hand" | "avatarHeight" | "head" | "eyeDistance" | "shoulder" | "hip" | "none";
export type PropWearSocket = "bone" | "face";

/** 모델 실측값 대비 소품 자동 배율을 계산하기 위한 제작 기준 치수. */
export interface PropFitProfile {
  reference: PropFitReference;
  designReference: number;
  minScale: number;
  maxScale: number;
}

export interface PropProceduralGeometrySource {
  readonly kind: "procedural";
}

export type PropGltfAssetUrl = `/assets/3d/${string}.glb`;

export interface PropGltfGeometrySource {
  readonly kind: "gltf";
  /** Vite public 디렉터리에 포함되는 동일 출처(first-party) 정적 GLB 경로. */
  readonly url: PropGltfAssetUrl;
}

export type PropGeometrySource = PropProceduralGeometrySource | PropGltfGeometrySource;

export interface PropDef {
  id: string;
  label: string;
  category: PropCategory;
  /** 렌더 geometry의 단일 권위 출처. GLTF 항목은 절차형 fallback으로 대체하지 않는다. */
  geometrySource: PropGeometrySource;
  /** 기본 부착 본. */
  defaultBone: PropAttachBone;
  /** 기본 오프셋(부착 본 로컬, 미터). */
  defaultPosition: Vec3;
  /** 기본 회전(오일러, 도). */
  defaultRotationDeg: Vec3;
  /** V2 palm socket 기준 기본 회전. 없으면 legacy 기본 회전을 그대로 사용한다. */
  smartRotationDeg?: Vec3;
  /** 보조 손 IK를 처음 켤 때의 소품별 안전 영향도. */
  secondaryGripInfluence?: number;
  /** 기본 스케일(배율). */
  defaultScale: number;
  /** 기본 색상(hex). 색상 변경 비대상 소품은 null. */
  defaultColor: string | null;
  /** 짧은 사용 설명. */
  hint: string;
  /** geometry 원점 대신 실제 접촉점을 표현하는 V2 소켓. */
  anchors: readonly PropAnchorDef[];
  /** 손 소품의 자동 손가락 포즈 프로필. */
  grip?: PropGripProfile;
  /** 모델별 자동 맞춤 프로필. */
  fit: PropFitProfile;
  /** 비직렬화 definition 의미: 얼굴 표면 소켓 또는 부착 본의 카탈로그 기본점. */
  wearSocket: PropWearSocket;
}

type LegacyPropDef = Omit<PropDef, "anchors" | "geometrySource" | "grip" | "fit" | "wearSocket">;

/** Blender로 제작해 public 번들에 포함한 소품의 안정적인 직렬화 ID → GLB 경로 매핑. */
export const BLENDER_PROP_GLTF_URLS = Object.freeze({
  mic: "/assets/3d/atelier_microphone.glb",
  beret: "/assets/3d/atelier_beret.glb",
  sunglasses: "/assets/3d/atelier_sunglasses.glb",
  headphones: "/assets/3d/atelier_headphones.glb",
  ribbon: "/assets/3d/atelier_ribbon.glb",
  beanie: "/assets/3d/atelier_beanie.glb",
  camera: "/assets/3d/atelier_camera.glb",
  medicalBag: "/assets/3d/atelier_medical_bag.glb",
  shoulderbag: "/assets/3d/atelier_shoulder_bag.glb",
  // Recommended-row stable IDs. Existing documents keep their IDs and rig profiles while the
  // renderer upgrades only their geometry source. The legacy blender phone ID below remains
  // resolvable and deliberately shares the same decoded GLB cache entry.
  smartphone: "/assets/3d/modern_smartphone_prop.glb",
  mug: "/assets/3d/everyday_mug.glb",
  book: "/assets/3d/everyday_book.glb",
  cap: "/assets/3d/everyday_cap.glb",
  glasses: "/assets/3d/everyday_glasses.glb",
  backpack: "/assets/3d/everyday_backpack.glb",
  stethoscope: "/assets/3d/medical_stethoscope.glb",
  blender_cyber_katana: "/assets/3d/cyber_katana.glb",
  blender_magic_staff: "/assets/3d/magic_staff_crystal.glb",
  blender_scifi_drone: "/assets/3d/scifi_drone_bot.glb",
  blender_neon_bench: "/assets/3d/neom_bench_prop.glb",
  blender_cyber_visor: "/assets/3d/cyber_helmet_visor.glb",
  blender_holo_tablet: "/assets/3d/hologram_tablet.glb",
  blender_rune_shield: "/assets/3d/ancient_rune_shield.glb",
  blender_arcade_cabinet: "/assets/3d/arcade_game_cabinet.glb",
  blender_medieval_greatsword: "/assets/3d/medieval_greatsword.glb",
  blender_cyber_hoverbike: "/assets/3d/cyberpunk_hoverbike.glb",
  blender_magic_chest: "/assets/3d/fantasy_magic_chest.glb",
  blender_modern_smartphone: "/assets/3d/modern_smartphone_prop.glb",
  blender_cyber_sniper_rifle: "/assets/3d/cyber_sniper_rifle.glb",
  blender_magic_wand_staff: "/assets/3d/fantasy_magic_wand_staff.glb",
  blender_steampunk_airship: "/assets/3d/steampunk_airship.glb",
  blender_cyberpunk_motorcycle: "/assets/3d/cyberpunk_motorcycle.glb",
  blender_scifi_laser_gun: "/assets/3d/scifi_laser_gun.glb",
  blender_magic_grimoire: "/assets/3d/magic_grimoire.glb",
  blender_cyber_glasses: "/assets/3d/cyber_glasses.glb",
  blender_medieval_shield: "/assets/3d/medieval_shield.glb",
  blender_street_lamp: "/assets/3d/street_lamp.glb",
  blender_vending_machine: "/assets/3d/vending_machine.glb",
  blender_royal_throne: "/assets/3d/royal_throne.glb",
  blender_crystal_orb: "/assets/3d/crystal_orb.glb",
  blender_tactical_helmet: "/assets/3d/tactical_helmet.glb",
  blender_school_desk: "/assets/3d/school_desk.glb",
  blender_adaptive_power_wheelchair: "/assets/3d/adaptive_power_wheelchair.glb",
  blender_ramen_bowl: "/assets/3d/ramen_bowl.glb",
  blender_ice_cream_cone: "/assets/3d/ice_cream_cone.glb",
  blender_bubble_tea: "/assets/3d/bubble_tea.glb",
  blender_paper_lantern: "/assets/3d/paper_lantern.glb",
  blender_potted_monstera: "/assets/3d/potted_monstera.glb",
  blender_bonsai_tree: "/assets/3d/bonsai_tree.glb",
  blender_street_food_cart: "/assets/3d/street_food_cart.glb",
  blender_traffic_light: "/assets/3d/traffic_light.glb",
  blender_mailbox: "/assets/3d/mailbox.glb",
  blender_grandfather_clock: "/assets/3d/grandfather_clock.glb",
  blender_fireplace: "/assets/3d/fireplace.glb",
  blender_bathtub: "/assets/3d/bathtub.glb",
  blender_kitchen_stove: "/assets/3d/kitchen_stove.glb",
  blender_campfire: "/assets/3d/campfire.glb",
  blender_wishing_well: "/assets/3d/wishing_well.glb",
  blender_robot_pet: "/assets/3d/robot_pet.glb",
  blender_mech_turret: "/assets/3d/mech_turret.glb",
  blender_fox_mask: "/assets/3d/fox_mask.glb",
  blender_wizard_hat: "/assets/3d/wizard_hat.glb",
  blender_tea_set: "/assets/3d/tea_set.glb",
  blender_hanging_sign: "/assets/3d/hanging_sign.glb",
} as const satisfies Readonly<Record<string, PropGltfAssetUrl>>);

const PROCEDURAL_PROP_GEOMETRY_SOURCE = Object.freeze({ kind: "procedural" } as const);

function geometrySourceForPropId(id: string): PropGeometrySource {
  const url = (BLENDER_PROP_GLTF_URLS as Readonly<Record<string, PropGltfAssetUrl>>)[id];
  return url ? Object.freeze({ kind: "gltf" as const, url }) : PROCEDURAL_PROP_GEOMETRY_SOURCE;
}

/* ── 소품 카탈로그(현대·판타지·의료 직업 소품) ──────────────────────── */

const VRM_PROP_BASES = [
  // 손 소품
  { id: "smartphone", label: "스마트폰", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0, 0.03], defaultRotationDeg: [10, 0, 0], defaultScale: 1, defaultColor: "#1c1c22", hint: "셀카·통화 컷에. 회전으로 화면 각도를 잡으세요." },
  { id: "mug", label: "머그컵", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.01, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#e8e2d6", hint: "카페·일상 컷. 손 안쪽으로 당겨 쥐게 보정하세요." },
  { id: "sword", label: "검", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0, 0], defaultRotationDeg: [0, 0, -90], defaultScale: 1, defaultColor: "#c8ccd4", hint: "액션 컷. 손바닥 방향에 맞춰 자동 정렬되며 회전 보정으로 칼끝을 다듬을 수 있습니다." },
  { id: "staff", label: "지팡이", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0, 0], defaultRotationDeg: [0, 0, 5], defaultScale: 1, defaultColor: "#8a6a3c", hint: "판타지·마법사 컷에." },
  { id: "mic", label: "마이크", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.02], defaultRotationDeg: [25, 0, 0], defaultScale: 1, defaultColor: "#26262c", hint: "무대·노래 컷. 입 쪽으로 기울이세요." },
  { id: "book", label: "책", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0.01, 0.04], defaultRotationDeg: [60, 0, 0], defaultScale: 1, defaultColor: "#7a3b3b", hint: "학원물·독서 컷. 두 손에 각각 얹어도 좋아요." },
  { id: "fan", label: "부채", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.01], defaultRotationDeg: [0, 0, 20], defaultScale: 1, defaultColor: "#d8475e", hint: "사극·여름 컷. 펼친 각도를 회전으로." },
  { id: "bouquet", label: "꽃다발", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0.03, 0.02], defaultRotationDeg: [-15, 0, 0], defaultScale: 1, defaultColor: "#e86a9b", hint: "고백·축하 컷. 색상으로 꽃 색을 바꾸세요." },
  { id: "clipboard", label: "의료 차트", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0.02, 0.04], defaultRotationDeg: [70, 0, 5], defaultScale: 1, defaultColor: "#d6b37a", hint: "회진·진료 컷. 왼손 안쪽으로 붙여 차트를 받쳐 주세요." },
  { id: "syringe", label: "주사기", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.01, 0.02], defaultRotationDeg: [0, 0, -80], defaultScale: 0.9, defaultColor: "#dbeafe", hint: "처치·실험 컷. 손가락 사이에 오도록 위치와 크기를 조정하세요." },
  { id: "medicalBag", label: "응급 의료 가방", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, -0.06, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#dc2626", hint: "응급실·구급대 컷. 손 아래에 매달리도록 배치됩니다." },
  // 머리 소품
  { id: "cap", label: "캡모자", category: "head", defaultBone: "head", defaultPosition: [0, 0.08, 0.01], defaultRotationDeg: [-8, 0, 0], defaultScale: 1, defaultColor: "#2b3a55", hint: "캐주얼 컷. 앞뒤로 당겨 깊이를 맞추세요." },
  { id: "beret", label: "베레모", category: "head", defaultBone: "head", defaultPosition: [-0.03, 0.09, 0], defaultRotationDeg: [0, 0, 12], defaultScale: 1, defaultColor: "#7a3b52", hint: "아트·감성 컷. 한쪽으로 비스듬히." },
  { id: "glasses", label: "안경", category: "head", defaultBone: "head", defaultPosition: [0, 0.02, 0.07], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#1c1c22", hint: "지적 캐릭터. 색상으로 뿔테/투명 느낌을." },
  { id: "sunglasses", label: "선글라스", category: "head", defaultBone: "head", defaultPosition: [0, 0.02, 0.07], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#101014", hint: "쿨한 컷. 살짝 내려 콧등에 걸쳐도." },
  { id: "crown", label: "왕관", category: "head", defaultBone: "head", defaultPosition: [0, 0.11, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#e7c14b", hint: "공주·왕자 컷. 색으로 금/은을 선택." },
  { id: "ribbon", label: "머리 리본", category: "head", defaultBone: "head", defaultPosition: [0.05, 0.08, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#e8536e", hint: "소녀 캐릭터. 좌우로 옮겨 사이드 포인트." },
  { id: "surgicalCap", label: "수술 모자", category: "head", defaultBone: "head", defaultPosition: [0, 0.09, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#0f766e", hint: "수술실 컷. 머리 크기에 맞춰 스케일과 높이를 조정하세요." },
  { id: "faceMask", label: "의료 마스크", category: "head", defaultBone: "head", defaultPosition: [0, -0.025, 0.085], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#bfdbfe", hint: "수술·감염병 컷. 얼굴 앞쪽으로 당겨 코와 입을 덮습니다." },
  // 몸 소품
  { id: "backpack", label: "백팩", category: "body", defaultBone: "chest", defaultPosition: [0, -0.05, -0.1], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#3b4a3b", hint: "학생·여행 컷. 등 쪽으로 밀어 자연스럽게." },
  { id: "shoulderbag", label: "숄더백", category: "body", defaultBone: "chest", defaultPosition: [0.08, -0.08, 0.04], defaultRotationDeg: [0, 0, 10], defaultScale: 1, defaultColor: "#5a4632", hint: "데일리 컷. 한쪽 어깨로 사선 배치." },
  { id: "cape", label: "망토", category: "body", defaultBone: "chest", defaultPosition: [0, 0, -0.06], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#3a2b55", hint: "히어로·판타지 컷. 색으로 진영을 표현." },
  { id: "wings", label: "날개", category: "body", defaultBone: "chest", defaultPosition: [0, 0.02, -0.08], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f2f2f5", hint: "천사·요정 컷. 스케일을 키워 존재감을." },
  { id: "stethoscope", label: "청진기", category: "body", defaultBone: "neck", defaultPosition: [0, -0.055, 0.055], defaultRotationDeg: [90, 0, 0], defaultScale: 1, defaultColor: "#1e293b", hint: "의사·간호사 컷. 목 아래에 걸리도록 위치를 미세 조정하세요." },
  { id: "idBadge", label: "의료진 명찰", category: "body", defaultBone: "chest", defaultPosition: [0.08, 0.02, 0.09], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f8fafc", hint: "병원·연구실 컷. 가슴 한쪽에 붙는 ID 카드입니다." },
  // 추가 12종 (손/머리/몸 다양)
  { id: "umbrella", label: "우산", category: "hand", defaultBone: "rightHand", defaultPosition: [0.03, 0.05, 0.02], defaultRotationDeg: [0, 0, 10], defaultScale: 1.1, defaultColor: "#1e293b", hint: "비·그늘 컷. 색으로 천 변경." },
  { id: "flute", label: "플루트", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0, 0.01], defaultRotationDeg: [80, 10, 0], defaultScale: 0.9, defaultColor: "#854d0e", hint: "음악·판타지." },
  { id: "wand", label: "마법봉", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0, 0], defaultRotationDeg: [0, 0, -30], defaultScale: 1, defaultColor: "#6b7280", hint: "마법·효과 컷." },
  { id: "headphones", label: "헤드폰", category: "head", defaultBone: "head", defaultPosition: [0, 0.06, 0.04], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#1e293b", hint: "음악·현대 컷." },
  { id: "headband", label: "헤드밴드", category: "head", defaultBone: "head", defaultPosition: [0, 0.07, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#e11d48", hint: "스포츠·운동." },
  { id: "flowerCrown", label: "꽃관", category: "head", defaultBone: "head", defaultPosition: [0, 0.09, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f472b6", hint: "자연·요정." },
  { id: "scarf", label: "목도리", category: "body", defaultBone: "neck", defaultPosition: [0, -0.02, 0.05], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#dc2626", hint: "겨울·패션." },
  { id: "holster", label: "총집", category: "body", defaultBone: "hips", defaultPosition: [0.12, -0.1, -0.05], defaultRotationDeg: [0, 20, 0], defaultScale: 1, defaultColor: "#451a03", hint: "액션·서부." },
  { id: "belt", label: "벨트", category: "body", defaultBone: "hips", defaultPosition: [0, -0.08, 0.08], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#334155", hint: "허리 장식." },
  { id: "backwing", label: "작은 날개", category: "body", defaultBone: "chest", defaultPosition: [0, 0.05, -0.12], defaultRotationDeg: [10, 0, 0], defaultScale: 0.8, defaultColor: "#a5b4fc", hint: "요정·소악마." },
  { id: "gloves", label: "장갑", category: "body", defaultBone: "leftHand", defaultPosition: [0.01, -0.02, 0.01], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#1e293b", hint: "액션·정장." },
  { id: "choker", label: "초커", category: "head", defaultBone: "neck", defaultPosition: [0, -0.02, 0.06], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#111827", hint: "패션 장식." },
  // 추가 손 소품
  { id: "pencil", label: "연필", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.01, 0.02], defaultRotationDeg: [0, 0, -70], defaultScale: 0.95, defaultColor: "#fbbf24", hint: "필기·학원 컷." },
  { id: "camera", label: "카메라", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.01, 0.03], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#1c1c22", hint: "취재·여행 컷." },
  { id: "bottle", label: "물병", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#38bdf8", hint: "스포츠·일상." },
  { id: "coffee", label: "테이크아웃 커피", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f5f0e8", hint: "카페·오피스 컷." },
  { id: "laptop", label: "노트북", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0.02, 0.04], defaultRotationDeg: [55, 0, 0], defaultScale: 1, defaultColor: "#94a3b8", hint: "업무·카페 컷." },
  { id: "shield", label: "방패", category: "hand", defaultBone: "leftHand", defaultPosition: [0.03, 0.02, 0.02], defaultRotationDeg: [0, 0, 15], defaultScale: 1, defaultColor: "#9aa3b2", hint: "판타지·전투 컷." },
  { id: "torch", label: "횃불", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.01], defaultRotationDeg: [0, 0, -20], defaultScale: 1, defaultColor: "#8a5a2b", hint: "던전·야간 컷." },
  { id: "lollipop", label: "막대사탕", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.02, 0.02], defaultRotationDeg: [0, 0, -40], defaultScale: 0.9, defaultColor: "#f472b6", hint: "귀여운 일상 컷." },
  { id: "plate", label: "접시", category: "hand", defaultBone: "leftHand", defaultPosition: [0.02, 0.02, 0.03], defaultRotationDeg: [70, 0, 0], defaultScale: 1, defaultColor: "#f8fafc", hint: "요리·카페 컷." },
  { id: "gun", label: "권총", category: "hand", defaultBone: "rightHand", defaultPosition: [0.02, 0.01, 0.02], defaultRotationDeg: [0, 0, -90], defaultScale: 0.95, defaultColor: "#374151", hint: "액션·스릴러 컷." },
  // 추가 머리 소품
  { id: "catEars", label: "고양이 귀", category: "head", defaultBone: "head", defaultPosition: [0, 0.1, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f5c6a0", hint: "코스프레·귀여운 컷." },
  { id: "elfEars", label: "엘프 귀", category: "head", defaultBone: "head", defaultPosition: [0, 0.03, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f5c6a0", hint: "엘프·요정 컷. 머리 양옆에서 뒤로 살짝 뻗은 뾰족 귀." },
  { id: "horns", label: "뿔", category: "head", defaultBone: "head", defaultPosition: [0, 0.1, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#2b2b2b", hint: "악마·판타지." },
  { id: "halo", label: "후광", category: "head", defaultBone: "head", defaultPosition: [0, 0.16, 0], defaultRotationDeg: [90, 0, 0], defaultScale: 1, defaultColor: "#fde68a", hint: "천사·성스러운 컷." },
  { id: "eyepatch", label: "안대", category: "head", defaultBone: "head", defaultPosition: [0.03, 0.02, 0.07], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#111827", hint: "해적·다크 히어로." },
  { id: "beanie", label: "비니", category: "head", defaultBone: "head", defaultPosition: [0, 0.09, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#334155", hint: "겨울·캐주얼." },
  { id: "earmuffs", label: "귀마개", category: "head", defaultBone: "head", defaultPosition: [0, 0.05, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#e11d48", hint: "겨울 컷." },
  { id: "hairpin", label: "머리핀", category: "head", defaultBone: "head", defaultPosition: [0.06, 0.08, 0.02], defaultRotationDeg: [0, 20, 15], defaultScale: 1, defaultColor: "#fbbf24", hint: "포인트 장식." },
  { id: "goggles", label: "고글", category: "head", defaultBone: "head", defaultPosition: [0, 0.06, 0.06], defaultRotationDeg: [-15, 0, 0], defaultScale: 1, defaultColor: "#1e293b", hint: "이마에 올린 고글." },
  // 추가 몸 소품
  { id: "guitar", label: "기타", category: "body", defaultBone: "chest", defaultPosition: [0.05, -0.1, 0.08], defaultRotationDeg: [10, 0, -25], defaultScale: 1, defaultColor: "#a67c4a", hint: "밴드·거리 연주." },
  { id: "quiver", label: "화살통", category: "body", defaultBone: "chest", defaultPosition: [-0.1, -0.05, -0.08], defaultRotationDeg: [0, 0, 15], defaultScale: 1, defaultColor: "#5a4632", hint: "궁수·판타지." },
  { id: "nameTag", label: "명찰", category: "body", defaultBone: "chest", defaultPosition: [0.09, 0.05, 0.09], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f8fafc", hint: "학교·회사 컷." },
  { id: "apron", label: "앞치마", category: "body", defaultBone: "chest", defaultPosition: [0, -0.08, 0.08], defaultRotationDeg: [0, 0, 0], defaultScale: 1, defaultColor: "#f8fafc", hint: "요리·카페 컷." },
  { id: "tail", label: "꼬리", category: "body", defaultBone: "hips", defaultPosition: [0, 0, -0.08], defaultRotationDeg: [20, 0, 0], defaultScale: 1, defaultColor: "#f5c6a0", hint: "동물귀 코스튬." },
  // Blender 5.2 생성 3D GLB 소품
  { id: "blender_cyber_katana", label: "블렌더 사이버 카타나", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0, 0], defaultRotationDeg: [0, 0, -90], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 사이버 카타나 검." },
  { id: "blender_magic_staff", label: "블렌더 마법 지팡이", category: "hand", defaultBone: "rightHand", defaultPosition: [0, -0.2, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 수정 지팡이." },
  { id: "blender_scifi_drone", label: "블렌더 SF 탐사 드론", category: "body", defaultBone: "chest", defaultPosition: [0.35, 0.25, 0.4], defaultRotationDeg: [0, 0, 0], defaultScale: 0.8, defaultColor: null, hint: "Blender 5.2 생성 SF 탐사 드론." },
  { id: "blender_neon_bench", label: "블렌더 네온 벤치", category: "body", defaultBone: "hips", defaultPosition: [0, -0.342, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 카본 네온 벤치." },
  { id: "blender_cyber_visor", label: "블렌더 사이버 바이저", category: "head", defaultBone: "head", defaultPosition: [0, 0.04, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 0.65, defaultColor: null, hint: "Blender 5.2 생성 사이버 헬멧 바이저." },
  { id: "blender_holo_tablet", label: "블렌더 홀로 태블릿", category: "hand", defaultBone: "leftHand", defaultPosition: [0, 0.02, 0.02], defaultRotationDeg: [45, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 홀로그램 태블릿." },
  { id: "blender_rune_shield", label: "블렌더 룬 방패", category: "hand", defaultBone: "leftHand", defaultPosition: [0.05, 0, 0], defaultRotationDeg: [0, 90, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 룬문자 마법 방패." },
  { id: "blender_arcade_cabinet", label: "블렌더 아케이드 게임기", category: "body", defaultBone: "hips", defaultPosition: [0, 0.198, -0.515], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 레트로 아케이드 캐비닛." },
  { id: "blender_medieval_greatsword", label: "블렌더 중세 룬 그레이트소드", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0, 0], defaultRotationDeg: [0, 0, -90], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 룬 대검." },
  { id: "blender_cyber_hoverbike", label: "블렌더 SF 호버바이크", category: "body", defaultBone: "hips", defaultPosition: [0, -0.16, -0.2], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 사이버 호버바이크." },
  { id: "blender_magic_chest", label: "블렌더 마법 보물상자", category: "body", defaultBone: "hips", defaultPosition: [0, -0.7, 0.3], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 보물상자." },
  { id: "blender_modern_smartphone", label: "블렌더 모던 스마트폰", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0.01, 0.01], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 슬림 스마트폰." },
  { id: "blender_cyber_sniper_rifle", label: "블렌더 사이버 저격 소총", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0, 0], defaultRotationDeg: [0, 0, -90], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 사이버 저격 소총." },
  { id: "blender_magic_wand_staff", label: "블렌더 요술봉 지팡이", category: "hand", defaultBone: "rightHand", defaultPosition: [0, -0.1, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 별/달 발광 요술봉." },
  { id: "blender_steampunk_airship", label: "블렌더 스팀펑크 비행선", category: "body", defaultBone: "hips", defaultPosition: [0, 0.8, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 스팀펑크 비행선." },
  { id: "blender_cyberpunk_motorcycle", label: "블렌더 사이버 바이크", category: "body", defaultBone: "hips", defaultPosition: [0, -0.098, -0.36], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 사이버펑크 바이크." },
  { id: "blender_scifi_laser_gun", label: "블렌더 SF 레이저 건", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0, 0], defaultRotationDeg: [0, 0, -90], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 SF 레이저 총." },
  { id: "blender_magic_grimoire", label: "블렌더 마법 마도서", category: "hand", defaultBone: "leftHand", defaultPosition: [0, 0.02, 0.02], defaultRotationDeg: [45, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 룬 마도서." },
  { id: "blender_cyber_glasses", label: "블렌더 사이버 고글 안경", category: "head", defaultBone: "head", defaultPosition: [0, 0.02, 0.07], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 사이버 고글 안경." },
  { id: "blender_medieval_shield", label: "블렌더 중세 룬 방패", category: "hand", defaultBone: "leftHand", defaultPosition: [0.05, 0, 0], defaultRotationDeg: [0, 90, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 중세 룬 방패." },
  { id: "blender_street_lamp", label: "블렌더 도시 네온 가로등", category: "body", defaultBone: "hips", defaultPosition: [0.8, -0.9, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 네온 가로등." },
  { id: "blender_vending_machine", label: "블렌더 편의점 자판기", category: "body", defaultBone: "hips", defaultPosition: [-0.8, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 레트로 자판기." },
  { id: "blender_royal_throne", label: "블렌더 황실 왕좌", category: "body", defaultBone: "hips", defaultPosition: [0, -0.37, -0.17], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 황실 왕좌 의자." },
  { id: "blender_crystal_orb", label: "블렌더 마법 수정구", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0.02, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 마법 수정구." },
  { id: "blender_tactical_helmet", label: "블렌더 택티컬 헬멧", category: "head", defaultBone: "head", defaultPosition: [0, 0.05, 0.01], defaultRotationDeg: [0, 0, 0], defaultScale: 0.45, defaultColor: null, hint: "Blender 5.2 생성 SF 택티컬 헬멧." },
  { id: "blender_school_desk", label: "블렌더 학교 책상", category: "body", defaultBone: "hips", defaultPosition: [0, -0.7, 0.3], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 학교/오피스 책상." },
  { id: "blender_adaptive_power_wheelchair", label: "블렌더 어댑티브 전동휠체어", category: "body", defaultBone: "hips", defaultPosition: [0, -0.39, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 어댑티브 전동휠체어. 좌석 앵커로 캐릭터 골반을 자연스럽게 맞춥니다." },
  // Blender 5.2 diverse props pack v6 (음식·자연·거리·인테리어·판타지·SF)
  { id: "blender_ramen_bowl", label: "블렌더 라면 그릇", category: "hand", defaultBone: "leftHand", defaultPosition: [0, 0.02, 0.02], defaultRotationDeg: [10, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 계란·노리 라면 그릇." },
  { id: "blender_ice_cream_cone", label: "블렌더 아이스크림 콘", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0.01, 0.01], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 3단 스쿱 아이스크림." },
  { id: "blender_bubble_tea", label: "블렌더 버블티", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0.02, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 펄 버블티 컵." },
  { id: "blender_paper_lantern", label: "블렌더 종이 등롱", category: "hand", defaultBone: "rightHand", defaultPosition: [0, 0.05, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 발광 종이 등롱." },
  { id: "blender_fox_mask", label: "블렌더 여우 가면", category: "head", defaultBone: "head", defaultPosition: [0, -0.02, 0.075], defaultRotationDeg: [0, 0, 0], defaultScale: 0.8, defaultColor: null, hint: "Blender 5.2 생성 여우 탈. 얼굴에 착용." },
  { id: "blender_wizard_hat", label: "펠트 마법사 모자", category: "head", defaultBone: "head", defaultPosition: [0, 0.09, 0], defaultRotationDeg: [-6, 0, 4], defaultScale: 1.0, defaultColor: null, hint: "연속 곡면 크라운과 가죽 밴드로 제작한 마법사 모자." },
  { id: "blender_potted_monstera", label: "블렌더 몬스테라 화분", category: "body", defaultBone: "hips", defaultPosition: [0.7, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 인테리어 몬스테라 화분." },
  { id: "blender_bonsai_tree", label: "블렌더 분재 나무", category: "body", defaultBone: "hips", defaultPosition: [-0.7, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 선반용 분재." },
  { id: "blender_street_food_cart", label: "블렌더 노점 포장마차", category: "body", defaultBone: "hips", defaultPosition: [0, -0.9, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 랜턴 노점 카트." },
  { id: "blender_traffic_light", label: "블렌더 신호등", category: "body", defaultBone: "hips", defaultPosition: [1.0, -0.9, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 도시 신호등." },
  { id: "blender_mailbox", label: "블렌더 우편함", category: "body", defaultBone: "hips", defaultPosition: [-1.0, -0.9, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 빨간 미국식 우편함." },
  { id: "blender_grandfather_clock", label: "블렌더 괘종시계", category: "body", defaultBone: "hips", defaultPosition: [0.9, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 진자 괘종시계." },
  { id: "blender_fireplace", label: "블렌더 벽난로", category: "body", defaultBone: "hips", defaultPosition: [0, -0.95, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 불타는 벽난로." },
  { id: "blender_bathtub", label: "블렌더 욕조", category: "body", defaultBone: "hips", defaultPosition: [0, -0.8, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 물이 찬 욕조." },
  { id: "blender_kitchen_stove", label: "블렌더 가스레인지", category: "body", defaultBone: "hips", defaultPosition: [0.85, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 4구 레인지 오븐." },
  { id: "blender_campfire", label: "블렌더 모닥불", category: "body", defaultBone: "hips", defaultPosition: [0, -0.75, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 캠핑 모닥불." },
  { id: "blender_wishing_well", label: "블렌더 소원 우물", category: "body", defaultBone: "hips", defaultPosition: [-0.95, -0.9, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 판타지 우물." },
  { id: "blender_robot_pet", label: "블렌더 로봇 반려견", category: "body", defaultBone: "hips", defaultPosition: [0.45, -0.75, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 SF 로봇 강아지." },
  { id: "blender_mech_turret", label: "블렌더 메카 터렛", category: "body", defaultBone: "hips", defaultPosition: [-0.45, -0.85, 0], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 에너지 터렛." },
  { id: "blender_tea_set", label: "블렌더 티 세트", category: "body", defaultBone: "hips", defaultPosition: [0, -0.72, 0.35], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 찻주전자 티세트." },
  { id: "blender_hanging_sign", label: "블렌더 매달린 간판", category: "body", defaultBone: "chest", defaultPosition: [0.55, 0.3, -0.4], defaultRotationDeg: [0, 0, 0], defaultScale: 1.0, defaultColor: null, hint: "Blender 5.2 생성 가게 현판." },
] as const satisfies readonly LegacyPropDef[];

export type VrmPropId = (typeof VRM_PROP_BASES)[number]["id"];

type PropProfile = Pick<PropDef, "anchors" | "fit"> & {
  grip?: PropGripProfile;
  smartRotationDeg?: Vec3;
  secondaryGripInfluence?: number;
  wearSocket?: PropWearSocket;
};

const FORWARD: Vec3 = [0, 0, 1];
const NEGATIVE_Z_FORWARD: Vec3 = [0, 0, -1];
const UP: Vec3 = [0, 1, 0];

function anchor(id: string, role: PropAnchorRole, position: Vec3, forward: Vec3 = FORWARD, up: Vec3 = UP): PropAnchorDef {
  return { id, role, position, forward, up };
}

function handAnchor(
  id: string,
  role: "primary" | "secondary",
  position: Vec3,
  gripRadius: number,
  forward: Vec3 = FORWARD,
  up: Vec3 = UP,
): PropAnchorDef {
  return { ...anchor(id, role, position, forward, up), gripRadius };
}

function grip(kind: PropGripKind, radius: number, fingerCurlDeg: number, thumbOppositionDeg: number): PropGripProfile {
  return { kind, radius, fingerCurlDeg, thumbOppositionDeg };
}

function fit(reference: PropFitReference, designReference: number, minScale = 0.65, maxScale = 1.65): PropFitProfile {
  return { reference, designReference, minScale, maxScale };
}

/**
 * geometry와 같은 로컬 좌표로 기록한 접촉점 카탈로그.
 * Record<VrmPropId, ...>를 사용해 소품 추가 시 프로필 누락을 컴파일 단계에서 막는다.
 */
const PROP_PROFILES: Record<VrmPropId, PropProfile> = {
  smartphone: {
    anchors: [handAnchor("primary", "primary", [0, -0.02, -0.006], 0.009)],
    grip: grip("flat", 0.009, 38, 34),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  mug: {
    // 손바닥을 고리의 빈 중심이 아니라 바깥쪽 튜브 중심선에 맞춰 컵 본체 관통을 줄인다.
    anchors: [handAnchor("primary", "primary", [0.07, 0, 0], 0.008)],
    grip: grip("handle", 0.008, 58, 42),
    fit: fit("hand", 0.075, 0.72, 1.45),
  },
  sword: {
    anchors: [
      handAnchor("primary", "primary", [0, -0.37, 0], 0.014),
      handAnchor("secondary", "secondary", [0, -0.315, 0], 0.014),
    ],
    grip: grip("cylinder", 0.014, 64, 48),
    fit: fit("avatarHeight", 1.65, 0.72, 1.45),
    // legacy 본 좌표의 -90° Z 회전은 palm basis에서는 칼날을 카메라 깊이로 향하게 한다.
    smartRotationDeg: [0, 0, 0],
    secondaryGripInfluence: 0.82,
  },
  staff: {
    anchors: [
      handAnchor("primary", "primary", [0, -0.2, 0], 0.012),
      handAnchor("secondary", "secondary", [0, -0.06, 0], 0.012),
    ],
    grip: grip("cylinder", 0.012, 62, 46),
    fit: fit("avatarHeight", 1.65, 0.72, 1.5),
    secondaryGripInfluence: 0.8,
  },
  mic: {
    anchors: [handAnchor("primary", "primary", [0, -0.025, 0], 0.012)],
    grip: grip("cylinder", 0.012, 58, 44),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  book: {
    anchors: [
      // 왼쪽·오른쪽 모서리(Book_Left/RightGripEdge)가 손바닥 접점이다. 책은 XY 평면에 눕고 두께가 Z다.
      handAnchor("primary", "primary", [-0.07, -0.045, 0], 0.015),
      handAnchor("secondary", "secondary", [0.07, -0.045, 0], 0.015),
    ],
    grip: grip("support", 0.015, 22, 24),
    fit: fit("hand", 0.075, 0.72, 1.45),
    smartRotationDeg: [0, 0, 90],
    secondaryGripInfluence: 0.65,
  },
  fan: {
    anchors: [handAnchor("primary", "primary", [0, -0.1, 0], 0.008)],
    grip: grip("pinch", 0.008, 42, 38),
    fit: fit("hand", 0.075, 0.72, 1.5),
  },
  bouquet: {
    anchors: [
      handAnchor("primary", "primary", [0, -0.045, 0], 0.025),
      handAnchor("secondary", "secondary", [0, 0.015, 0], 0.025),
    ],
    grip: grip("cylinder", 0.025, 55, 42),
    fit: fit("hand", 0.075, 0.72, 1.5),
    secondaryGripInfluence: 0.7,
  },
  clipboard: {
    anchors: [
      handAnchor("primary", "primary", [-0.0725, -0.055, 0], 0.012),
      handAnchor("secondary", "secondary", [0.0725, -0.055, 0], 0.012),
    ],
    grip: grip("support", 0.012, 24, 28),
    fit: fit("hand", 0.075, 0.72, 1.45),
    secondaryGripInfluence: 0.65,
  },
  syringe: {
    anchors: [handAnchor("primary", "primary", [0, -0.075, 0], 0.014)],
    grip: grip("pinch", 0.014, 34, 36),
    fit: fit("hand", 0.075, 0.68, 1.4),
  },
  medicalBag: {
    // 반원 손잡이의 빈 중심이 아니라 실제 상단 손잡이 튜브 중심선에 손바닥을 둔다.
    anchors: [handAnchor("primary", "primary", [0, 0.155, 0], 0.012, [0, -1, 0], [0, 0, 1])],
    grip: grip("handle", 0.012, 60, 44),
    fit: fit("hand", 0.075, 0.72, 1.45),
  },
  cap: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  beret: { anchors: [anchor("surface", "surface", [0, -0.02, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  glasses: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("eyeDistance", 0.064, 0.72, 1.45), wearSocket: "face" },
  sunglasses: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("eyeDistance", 0.064, 0.72, 1.45), wearSocket: "face" },
  crown: { anchors: [anchor("surface", "surface", [0, -0.055, 0])], fit: fit("head", 0.18, 0.68, 1.55) },
  ribbon: { anchors: [anchor("surface", "surface", [-0.05, 0, 0])], fit: fit("head", 0.18, 0.68, 1.55) },
  surgicalCap: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  faceMask: { anchors: [anchor("surface", "surface", [0, 0, -0.004])], fit: fit("eyeDistance", 0.064, 0.72, 1.45), wearSocket: "face" },
  backpack: { anchors: [anchor("surface", "surface", [0, 0, 0.06], [0, 0, -1])], fit: fit("shoulder", 0.32, 0.68, 1.55) },
  shoulderbag: { anchors: [anchor("surface", "surface", [0, 0.06, 0])], fit: fit("shoulder", 0.32, 0.68, 1.55) },
  cape: { anchors: [anchor("surface", "surface", [0, 0, 0.01], [0, 0, -1])], fit: fit("shoulder", 0.32, 0.68, 1.6) },
  wings: { anchors: [anchor("surface", "surface", [0, 0, 0], [0, 0, -1])], fit: fit("shoulder", 0.32, 0.65, 1.65) },
  stethoscope: { anchors: [anchor("surface", "surface", [0, 0.105, 0])], fit: fit("none", 1, 0.72, 1.45) },
  idBadge: { anchors: [anchor("surface", "surface", [0, 0, -0.004])], fit: fit("shoulder", 0.32, 0.72, 1.45) },
  umbrella: {
    anchors: [
      handAnchor("primary", "primary", [-0.03, -0.35, 0], 0.008),
      handAnchor("secondary", "secondary", [0, -0.24, 0], 0.008),
    ],
    grip: grip("handle", 0.008, 60, 44),
    fit: fit("avatarHeight", 1.65, 0.72, 1.5),
    secondaryGripInfluence: 0.8,
  },
  flute: {
    anchors: [
      handAnchor("primary", "primary", [0, -0.08, 0], 0.008),
      handAnchor("secondary", "secondary", [0, 0.08, 0], 0.008),
    ],
    grip: grip("pinch", 0.008, 36, 34),
    fit: fit("hand", 0.075, 0.7, 1.45),
    secondaryGripInfluence: 0.75,
  },
  wand: {
    anchors: [handAnchor("primary", "primary", [0, -0.1, 0], 0.006)],
    grip: grip("cylinder", 0.006, 52, 40),
    fit: fit("hand", 0.075, 0.68, 1.5),
  },
  headphones: { anchors: [anchor("surface", "surface", [0, -0.04, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  headband: { anchors: [anchor("surface", "surface", [0, -0.04, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  flowerCrown: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  scarf: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("none", 1, 0.72, 1.5) },
  holster: { anchors: [anchor("surface", "surface", [0, 0.07, 0])], fit: fit("hip", 0.18, 0.68, 1.55) },
  belt: { anchors: [anchor("surface", "surface", [0, 0, -0.14])], fit: fit("hip", 0.18, 0.68, 1.55) },
  backwing: { anchors: [anchor("surface", "surface", [0, 0, 0], [0, 0, -1])], fit: fit("shoulder", 0.32, 0.68, 1.6) },
  gloves: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("hand", 0.075, 0.72, 1.4) },
  choker: { anchors: [anchor("surface", "surface", [0, 0, -0.065])], fit: fit("none", 1, 0.72, 1.45) },
  pencil: {
    anchors: [handAnchor("primary", "primary", [0, -0.06, 0], 0.005)],
    grip: grip("pinch", 0.005, 28, 40),
    fit: fit("hand", 0.075, 0.72, 1.35),
  },
  camera: {
    anchors: [handAnchor("primary", "primary", [0, -0.02, -0.02], 0.012)],
    grip: grip("flat", 0.012, 36, 32),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  bottle: {
    anchors: [handAnchor("primary", "primary", [0, -0.04, 0], 0.018)],
    grip: grip("cylinder", 0.018, 42, 30),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  coffee: {
    anchors: [handAnchor("primary", "primary", [0, -0.03, 0], 0.02)],
    grip: grip("cylinder", 0.02, 40, 28),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  laptop: {
    anchors: [handAnchor("primary", "primary", [0, 0, 0], 0.02)],
    grip: grip("flat", 0.01, 22, 20),
    fit: fit("hand", 0.075, 0.7, 1.45),
  },
  shield: {
    anchors: [handAnchor("primary", "primary", [0, 0, 0.01], 0.02)],
    grip: grip("handle", 0.015, 35, 25),
    fit: fit("hand", 0.075, 0.7, 1.5),
  },
  torch: {
    anchors: [handAnchor("primary", "primary", [0, -0.08, 0], 0.014)],
    grip: grip("cylinder", 0.014, 40, 28),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  lollipop: {
    anchors: [handAnchor("primary", "primary", [0, -0.05, 0], 0.004)],
    grip: grip("pinch", 0.004, 24, 38),
    fit: fit("hand", 0.075, 0.72, 1.3),
  },
  plate: {
    anchors: [handAnchor("primary", "primary", [0, 0, 0], 0.02)],
    grip: grip("flat", 0.01, 18, 22),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  gun: {
    anchors: [handAnchor("primary", "primary", [0, -0.02, 0], 0.012)],
    grip: grip("handle", 0.012, 45, 35),
    fit: fit("hand", 0.075, 0.72, 1.35),
  },
  catEars: { anchors: [anchor("surface", "surface", [0, -0.02, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  elfEars: { anchors: [anchor("surface", "surface", [0, -0.02, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  horns: { anchors: [anchor("surface", "surface", [0, -0.02, 0])], fit: fit("head", 0.18, 0.72, 1.5) },
  halo: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  eyepatch: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("eyeDistance", 0.064, 0.72, 1.4), wearSocket: "face" },
  beanie: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  earmuffs: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.72, 1.45) },
  hairpin: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("head", 0.18, 0.7, 1.4) },
  goggles: { anchors: [anchor("surface", "surface", [0, 0, 0])], fit: fit("eyeDistance", 0.064, 0.72, 1.45), wearSocket: "face" },
  guitar: { anchors: [anchor("surface", "surface", [0, 0.08, 0])], fit: fit("shoulder", 0.32, 0.68, 1.55) },
  quiver: { anchors: [anchor("surface", "surface", [0, 0.05, 0], [0, 0, -1])], fit: fit("shoulder", 0.32, 0.7, 1.5) },
  nameTag: { anchors: [anchor("surface", "surface", [0, 0, -0.004])], fit: fit("shoulder", 0.32, 0.72, 1.4) },
  apron: { anchors: [anchor("surface", "surface", [0, 0.05, 0])], fit: fit("shoulder", 0.32, 0.7, 1.5) },
  tail: { anchors: [anchor("surface", "surface", [0, 0, 0.02], [0, 0, -1])], fit: fit("hip", 0.18, 0.7, 1.5) },
  blender_cyber_katana: {
    anchors: [
      handAnchor("primary", "primary", [0, 0, 0.35], 0.034, NEGATIVE_Z_FORWARD),
      handAnchor("secondary", "secondary", [0, 0, 0.28], 0.034, NEGATIVE_Z_FORWARD),
    ],
    grip: grip("cylinder", 0.034, 62, 46),
    fit: fit("avatarHeight", 1.65, 0.72, 1.45),
    secondaryGripInfluence: 0.8,
  },
  blender_magic_staff: {
    anchors: [
      handAnchor("primary", "primary", [0, 0.27, 0], 0.036),
      handAnchor("secondary", "secondary", [0, 0.41, 0], 0.036),
    ],
    grip: grip("cylinder", 0.036, 60, 44),
    fit: fit("avatarHeight", 1.65, 0.72, 1.5),
    secondaryGripInfluence: 0.8,
  },
  blender_scifi_drone: {
    anchors: [handAnchor("primary", "primary", [0, 0, 0], 0.025)],
    grip: grip("flat", 0.025, 20, 20),
    fit: fit("hand", 0.075, 0.7, 1.5),
  },
  blender_neon_bench: {
    anchors: [anchor("seat", "surface", [0, 0.508, 0.02])],
    fit: fit("hip", 0.18, 0.7, 1.5),
  },
  blender_cyber_visor: {
    anchors: [anchor("surface", "surface", [0, 0, 0.015])],
    fit: fit("head", 0.18, 0.72, 1.45),
    wearSocket: "face",
  },
  blender_holo_tablet: {
    anchors: [handAnchor("primary", "primary", [-0.205, 0, 0], 0.012)],
    grip: grip("flat", 0.012, 30, 30),
    fit: fit("hand", 0.075, 0.7, 1.4),
  },
  blender_rune_shield: {
    anchors: [
      handAnchor("primary", "primary", [0, -0.055, 0.055], 0.028),
      handAnchor("secondary", "secondary", [0, -0.055, -0.055], 0.028),
    ],
    grip: grip("handle", 0.028, 60, 40),
    fit: fit("shoulder", 0.32, 0.7, 1.5),
    secondaryGripInfluence: 0.75,
  },
  blender_arcade_cabinet: {
    anchors: [anchor("surface", "surface", [0, 1.048, -0.315])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_medieval_greatsword: {
    anchors: [handAnchor("primary", "primary", [0, 0, -0.15], 0.046, NEGATIVE_Z_FORWARD)],
    grip: grip("cylinder", 0.046, 82, 60),
    fit: fit("avatarHeight", 1.65, 0.8, 1.4),
  },
  blender_cyber_hoverbike: {
    anchors: [anchor("seat", "surface", [0, 0.79, -0.2])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_magic_chest: {
    anchors: [anchor("surface", "surface", [0, 0.35, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.4),
  },
  blender_modern_smartphone: {
    anchors: [handAnchor("primary", "primary", [0, 0, 0], 0.009)],
    grip: grip("flat", 0.009, 38, 34),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  blender_cyber_sniper_rifle: {
    anchors: [handAnchor("primary", "primary", [0, -0.19, -0.22], 0.018, NEGATIVE_Z_FORWARD)],
    grip: grip("handle", 0.018, 75, 55),
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_magic_wand_staff: {
    anchors: [handAnchor("primary", "primary", [0, 0, -0.2], 0.028, NEGATIVE_Z_FORWARD)],
    grip: grip("cylinder", 0.028, 60, 40),
    fit: fit("avatarHeight", 1.65, 0.7, 1.4),
  },
  blender_steampunk_airship: {
    anchors: [anchor("surface", "surface", [0, 0.5, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.6),
  },
  blender_cyberpunk_motorcycle: {
    anchors: [anchor("seat", "surface", [0, 0.752, -0.36])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.6),
  },
  blender_scifi_laser_gun: {
    anchors: [handAnchor("primary", "primary", [0, -0.2, -0.1], 0.016, NEGATIVE_Z_FORWARD)],
    grip: grip("handle", 0.016, 75, 55),
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_magic_grimoire: {
    anchors: [handAnchor("primary", "primary", [0, -0.0745, 0], 0.02)],
    grip: grip("flat", 0.02, 45, 30),
    fit: fit("hand", 0.075, 0.7, 1.4),
  },
  blender_cyber_glasses: {
    anchors: [anchor("center", "surface", [0, 0, 0])],
    fit: fit("head", 0.16, 0.8, 1.3),
    wearSocket: "face",
  },
  blender_medieval_shield: {
    anchors: [handAnchor("primary", "primary", [0, 0, -0.075], 0.028)],
    grip: grip("handle", 0.028, 60, 40),
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_street_lamp: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.6),
  },
  blender_vending_machine: {
    anchors: [anchor("front", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_royal_throne: {
    anchors: [anchor("seat", "surface", [0, 0.63, 0.03])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_crystal_orb: {
    anchors: [handAnchor("primary", "primary", [0, 0.1, 0], 0.02)],
    grip: grip("pinch", 0.02, 50, 40),
    fit: fit("hand", 0.075, 0.7, 1.4),
  },
  blender_tactical_helmet: {
    anchors: [anchor("center", "surface", [0, 0, 0.105])],
    fit: fit("head", 0.16, 0.8, 1.3),
  },
  blender_school_desk: {
    anchors: [anchor("top", "surface", [0, 0.72, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_adaptive_power_wheelchair: {
    anchors: [anchor("seat", "surface", [0, 0.61, 0.02])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_ramen_bowl: {
    anchors: [handAnchor("primary", "primary", [0, -0.02, 0], 0.025)],
    grip: grip("flat", 0.025, 20, 20),
    fit: fit("hand", 0.075, 0.7, 1.4),
  },
  blender_ice_cream_cone: {
    anchors: [handAnchor("primary", "primary", [0, -0.04, 0], 0.014)],
    grip: grip("cylinder", 0.014, 42, 30),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  blender_bubble_tea: {
    anchors: [handAnchor("primary", "primary", [0, -0.03, 0], 0.02)],
    grip: grip("cylinder", 0.02, 40, 28),
    fit: fit("hand", 0.075, 0.72, 1.4),
  },
  blender_paper_lantern: {
    anchors: [handAnchor("primary", "primary", [0, 0.12, 0], 0.008)],
    grip: grip("pinch", 0.008, 30, 36),
    fit: fit("hand", 0.075, 0.7, 1.45),
  },
  blender_fox_mask: {
    anchors: [anchor("surface", "surface", [0, 0, 0.02])],
    fit: fit("head", 0.16, 0.75, 1.35),
    wearSocket: "face",
  },
  blender_wizard_hat: {
    anchors: [anchor("center", "surface", [0, -0.02, 0])],
    fit: fit("head", 0.18, 0.75, 1.45),
  },
  blender_potted_monstera: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_bonsai_tree: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_street_food_cart: {
    anchors: [anchor("center", "surface", [0, 0.8, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_traffic_light: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.6),
  },
  blender_mailbox: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_grandfather_clock: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_fireplace: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_bathtub: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_kitchen_stove: {
    anchors: [anchor("top", "surface", [0, 0.85, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_campfire: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_wishing_well: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_robot_pet: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.7, 1.5),
  },
  blender_mech_turret: {
    anchors: [anchor("base", "surface", [0, 0, 0])],
    fit: fit("avatarHeight", 1.65, 0.8, 1.5),
  },
  blender_tea_set: {
    anchors: [anchor("tray", "surface", [0, 0, 0])],
    fit: fit("hand", 0.075, 0.7, 1.45),
  },
  blender_hanging_sign: {
    anchors: [anchor("top", "surface", [0, 0.2, 0])],
    fit: fit("avatarHeight", 1.65, 0.75, 1.5),
  },
};

export const VRM_PROPS: readonly PropDef[] = VRM_PROP_BASES.map((def): PropDef => ({
  ...def,
  geometrySource: geometrySourceForPropId(def.id),
  wearSocket: "bone",
  ...PROP_PROFILES[def.id],
}));

export function propDefById(id: string): PropDef | undefined {
  return VRM_PROPS.find((p) => p.id === id);
}

export function propsByCategory(category: PropCategory): PropDef[] {
  return VRM_PROPS.filter((p) => p.category === category);
}

/* ── 부착 인스턴스(직렬화 대상) ──────────────────────────────────────── */

export type PropRigMode = "auto" | "custom";
export type PropHandBone = "rightHand" | "leftHand";

export interface PropRigSecondary {
  enabled: boolean;
  anchorId: string;
  bone: PropHandBone;
  /** 원래 포즈와 보조 손 IK 결과의 혼합 비율. */
  influence: number;
  /** VRM 아바타/모델 로컬 좌표의 팔꿈치 유도점. 런타임에서 vrm.scene.matrixWorld로 변환한다. */
  elbowHint?: Vec3;
}

/**
 * V2 자동 맞춤 정보. 기존 position/rotationDeg/scale은 그대로 남겨 V1 문서를 한 값도
 * 재해석하지 않는다. V2 renderer는 자동 소켓 결과 위에 delta* 필드만 추가 적용한다.
 */
export interface PropRigV2 {
  version: 2;
  mode: PropRigMode;
  anchorId: string;
  autoScale: boolean;
  autoFingerPose: boolean;
  /**
   * 자동 그립의 아트 디렉션 배율. 1은 실측 결과, 1보다 작으면 이완,
   * 크면 더 단단히 감는다. 기존 V2 문서는 파서에서 1로 복구한다.
   */
  gripFit: number;
  deltaPosition: Vec3;
  deltaRotationDeg: Vec3;
  deltaScale: number;
  secondary?: PropRigSecondary;
}

export interface PropInstance {
  /** 인스턴스 고유 id(같은 소품 복수 부착 허용). */
  uid: string;
  propId: string;
  bone: PropAttachBone;
  position: Vec3;
  rotationDeg: Vec3;
  scale: number;
  color: string | null;
  /** 없으면 기존 V1 절대 transform renderer를 사용한다. */
  rig?: PropRigV2;
}

export interface SerializedVrmProps {
  version: typeof VRM_PROPS_VERSION;
  items: PropInstance[];
}

let uidCounter = 0;
const issuedPropUids = new Set<string>();

function isValidPropUid(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function secureRandomUuid(): string | null {
  try {
    return typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : null;
  } catch {
    // 일부 임베디드 WebView는 crypto를 노출해도 호출 시 예외를 던질 수 있다.
    return null;
  }
}

function propUidCandidate(seed?: string): string {
  uidCounter = (uidCounter + 1) % Number.MAX_SAFE_INTEGER;
  const prefix = seed?.trim() || "prop";
  const counter = uidCounter.toString(36);
  const uuid = secureRandomUuid();
  if (uuid) return `${prefix}-${uuid}-${counter}`;

  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${prefix}-${timestamp}-${counter}-${random}`;
}

/** 저장·재실행 뒤에도 충돌하기 어려운 UI 인스턴스 키(테스트에서는 uid를 직접 주입할 수 있다). */
export function nextPropUid(seed?: string): string {
  let candidate = propUidCandidate(seed);
  while (issuedPropUids.has(candidate)) candidate = propUidCandidate(seed);
  issuedPropUids.add(candidate);
  return candidate;
}

/** 카탈로그 기본값으로 부착 인스턴스를 생성한다. */
export function createPropInstance(propId: string, uid?: string): PropInstance | null {
  const def = propDefById(propId);
  if (!def) return null;
  const primaryAnchor = def.anchors.find((candidate) => candidate.role === "primary" || candidate.role === "surface")!;
  const instanceUid = uid ?? nextPropUid(propId);
  if (isValidPropUid(instanceUid)) issuedPropUids.add(instanceUid);
  return {
    uid: instanceUid,
    propId: def.id,
    bone: def.defaultBone,
    position: def.defaultPosition,
    rotationDeg: def.defaultRotationDeg,
    scale: def.defaultScale,
    color: def.defaultColor,
    rig: {
      version: VRM_PROPS_VERSION,
      mode: "auto",
      anchorId: primaryAnchor.id,
      autoScale: true,
      autoFingerPose: Boolean(def.grip),
      gripFit: 1,
      deltaPosition: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: 1,
    },
  };
}

const POS_LIMIT = 1; // ±1m
const ROT_LIMIT = 180; // ±180°
const SCALE_MIN = 0.2;
const SCALE_MAX = 4;

function num(value: unknown, fallback: number, limit: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(limit, Math.max(-limit, n));
}

function vec3(value: unknown, fallback: Vec3, limit: number): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [num(value[0], fallback[0], limit), num(value[1], fallback[1], limit), num(value[2], fallback[2], limit)];
}

function normalizeColor(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function isAttachBone(value: unknown): value is PropAttachBone {
  return typeof value === "string" && (PROP_ATTACH_BONES as readonly string[]).includes(value);
}

function isHandBone(value: unknown): value is PropHandBone {
  return value === "rightHand" || value === "leftHand";
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function primaryAnchorOf(def: PropDef): PropAnchorDef {
  return def.anchors.find((candidate) => candidate.role === "primary" || candidate.role === "surface") ?? def.anchors[0];
}

function parseV2Rig(raw: unknown, def: PropDef, primaryBone: PropAttachBone): PropRigV2 | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<Record<keyof PropRigV2, unknown>>;
  if (value.version !== VRM_PROPS_VERSION) return undefined;

  const fallbackAnchor = primaryAnchorOf(def);
  const requestedAnchor = typeof value.anchorId === "string"
    ? def.anchors.find((candidate) => candidate.id === value.anchorId && candidate.role !== "secondary")
    : undefined;
  const secondaryAnchor = def.anchors.find((candidate) => candidate.role === "secondary");

  let secondary: PropRigSecondary | undefined;
  if (secondaryAnchor && isHandBone(primaryBone) && value.secondary && typeof value.secondary === "object") {
    const input = value.secondary as Partial<Record<keyof PropRigSecondary, unknown>>;
    const oppositeHand: PropHandBone = primaryBone === "leftHand" ? "rightHand" : "leftHand";
    const requestedBone = isHandBone(input.bone) && input.bone !== primaryBone ? input.bone : oppositeHand;
    const requestedSecondaryAnchor = typeof input.anchorId === "string"
      ? def.anchors.find((candidate) => candidate.id === input.anchorId && candidate.role === "secondary")
      : undefined;
    secondary = {
      enabled: bool(input.enabled, false),
      anchorId: (requestedSecondaryAnchor ?? secondaryAnchor).id,
      bone: requestedBone,
      influence: clamp(input.influence, def.secondaryGripInfluence ?? 0.75, 0, 1),
      ...(Array.isArray(input.elbowHint)
        ? { elbowHint: vec3(input.elbowHint, [0, 0, 0], POS_LIMIT) }
        : {}),
    };
  }

  return {
    version: VRM_PROPS_VERSION,
    mode: value.mode === "custom" ? "custom" : "auto",
    anchorId: (requestedAnchor ?? fallbackAnchor).id,
    autoScale: bool(value.autoScale, true),
    autoFingerPose: bool(value.autoFingerPose, Boolean(def.grip)),
    gripFit: clamp(value.gripFit, 1, VRM_PROP_GRIP_FIT_MIN, VRM_PROP_GRIP_FIT_MAX),
    deltaPosition: vec3(value.deltaPosition, [0, 0, 0], POS_LIMIT),
    deltaRotationDeg: vec3(value.deltaRotationDeg, [0, 0, 0], ROT_LIMIT),
    deltaScale: clamp(value.deltaScale, 1, SCALE_MIN, SCALE_MAX),
    ...(secondary ? { secondary } : {}),
  };
}

/** 임의 입력(직렬화 문서)을 안전한 부착 인스턴스 배열로 정규화한다(알 수 없는 propId는 제거). */
export function parseVrmProps(raw: unknown): SerializedVrmProps {
  const empty: SerializedVrmProps = { version: VRM_PROPS_VERSION, items: [] };
  if (!raw || typeof raw !== "object") return empty;
  const itemsRaw = (raw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) return empty;
  // version이 없거나 V1이면 item 안에 우연히 rig 키가 있어도 절대 새 의미로 해석하지 않는다.
  const parseRig = (raw as { version?: unknown }).version === VRM_PROPS_VERSION;

  // 유효한 기존 UID를 모두 먼저 예약한다. 앞쪽 빈/중복 항목의 재발급 UID가
  // 뒤쪽 정상 항목의 UID를 선점하지 않게 하면서, 각 UID의 첫 항목은 그대로 보존한다.
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<Record<keyof PropInstance, unknown>>;
    if (!propDefById(String(e.propId ?? "")) || !isValidPropUid(e.uid)) continue;
    issuedPropUids.add(e.uid);
  }

  const items: PropInstance[] = [];
  const seenDocumentUids = new Set<string>();
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<Record<keyof PropInstance, unknown>>;
    const def = propDefById(String(e.propId ?? ""));
    if (!def) continue;
    const bone = isAttachBone(e.bone) ? e.bone : def.defaultBone;
    const rig = parseRig ? parseV2Rig(e.rig, def, bone) : undefined;
    const preservedUid = isValidPropUid(e.uid) && !seenDocumentUids.has(e.uid) ? e.uid : undefined;
    const uid = preservedUid ?? nextPropUid(def.id);
    seenDocumentUids.add(uid);
    items.push({
      uid,
      propId: def.id,
      bone,
      position: vec3(e.position, def.defaultPosition, POS_LIMIT),
      rotationDeg: vec3(e.rotationDeg, def.defaultRotationDeg, ROT_LIMIT),
      scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, num(e.scale, def.defaultScale, SCALE_MAX))),
      color: def.defaultColor === null ? null : normalizeColor(e.color, def.defaultColor),
      ...(rig ? { rig } : {}),
    });
  }
  return { version: VRM_PROPS_VERSION, items };
}

export function serializeVrmProps(items: PropInstance[]): SerializedVrmProps | undefined {
  if (items.length === 0) return undefined; // 빈 경우 문서에 키를 남기지 않음(하위호환)
  return { version: VRM_PROPS_VERSION, items };
}

/* ── Shared Stage 투영용 엄격 검사 ─────────────────────────────────────
 * 편집기 로드 경로의 parseVrmProps는 오래된 문서를 최대한 복구해야 하므로 UID를 발급하고
 * 손상된 값을 정규화한다. 반면 Shared Stage는 다른 런타임으로 상태를 복제하므로, 같은 입력이
 * 언제나 같은 결과를 내고 지원하지 않는 의미를 조용히 버리지 않는 별도의 fail-closed 경계가
 * 필요하다. 아래 검사는 호출자 입력과 전역 UID 발급 상태를 전혀 변경하지 않는다.
 */

export type VrmPropsProjectionSourceVersion = "absent" | "legacy" | "unknown" | 1 | 2;

export type VrmPropsProjectionIssueReason =
  | "invalid-document"
  | "unsupported-document-field"
  | "unsupported-version"
  | "invalid-items"
  | "invalid-item"
  | "unsupported-item-field"
  | "missing-prop-id"
  | "invalid-prop-id"
  | "unknown-prop-id"
  | "missing-uid"
  | "invalid-uid"
  | "duplicate-uid"
  | "missing-bone"
  | "invalid-bone"
  | "invalid-position"
  | "invalid-rotation"
  | "invalid-scale"
  | "invalid-color"
  | "rig-not-supported-for-source-version"
  | "invalid-rig"
  | "unsupported-rig-version"
  | "unsupported-rig-field"
  | "invalid-rig-mode"
  | "invalid-rig-anchor"
  | "invalid-rig-auto-scale"
  | "invalid-rig-auto-finger-pose"
  | "invalid-rig-grip-fit"
  | "invalid-rig-delta-position"
  | "invalid-rig-delta-rotation"
  | "invalid-rig-delta-scale"
  | "unsupported-rig-secondary"
  | "invalid-rig-secondary"
  | "unsupported-secondary-field"
  | "invalid-secondary-enabled"
  | "invalid-secondary-anchor"
  | "invalid-secondary-bone"
  | "invalid-secondary-influence"
  | "invalid-secondary-elbow-hint";

export interface VrmPropsProjectionIssue {
  readonly reason: VrmPropsProjectionIssueReason;
  /** 문서 루트 기준의 안정적인 필드 경로. */
  readonly path: string;
  /** 항목 밖 문서 오류에는 존재하지 않는다. */
  readonly itemIndex?: number;
  /** 입력에 문자열 식별자가 있었다면 진단용으로 원문을 그대로 보존한다. */
  readonly uid?: string;
  readonly propId?: string;
}

export interface VrmPropsProjectionDocument {
  readonly version: typeof VRM_PROPS_VERSION;
  readonly items: readonly PropInstance[];
}

export type VrmPropsProjectionInspection =
  | Readonly<{
      status: "ready";
      sourceVersion: Exclude<VrmPropsProjectionSourceVersion, "unknown">;
      document: VrmPropsProjectionDocument;
    }>
  | Readonly<{
      status: "rejected";
      sourceVersion: VrmPropsProjectionSourceVersion;
      issues: readonly VrmPropsProjectionIssue[];
    }>;

const PROJECTION_RIG_FIELDS = [
  "version",
  "mode",
  "anchorId",
  "autoScale",
  "autoFingerPose",
  "gripFit",
  "deltaPosition",
  "deltaRotationDeg",
  "deltaScale",
  "secondary",
] as const;

const PROJECTION_SECONDARY_FIELDS = [
  "enabled",
  "anchorId",
  "bone",
  "influence",
  "elbowHint",
] as const;

const PROJECTION_DOCUMENT_FIELDS = ["version", "items"] as const;

const PROJECTION_ITEM_FIELDS = [
  "uid",
  "propId",
  "bone",
  "position",
  "rotationDeg",
  "scale",
  "color",
  "rig",
] as const;

function freezeVrmPropsProjectionValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeVrmPropsProjectionValue(child);
  }
  return Object.freeze(value);
}

function projectionIssue(
  reason: VrmPropsProjectionIssueReason,
  path: string,
  itemIndex?: number,
  entry?: Record<string, unknown>
): VrmPropsProjectionIssue {
  return {
    reason,
    path,
    ...(itemIndex === undefined ? {} : { itemIndex }),
    ...(typeof entry?.uid === "string" ? { uid: entry.uid } : {}),
    ...(typeof entry?.propId === "string" ? { propId: entry.propId } : {}),
  };
}

function isProjectionRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectionVec3(value: unknown, limit: number): Vec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((component) => typeof component !== "number" || !Number.isFinite(component) || Math.abs(component) > limit)
  ) return null;
  return [value[0] as number, value[1] as number, value[2] as number];
}

function isProjectionNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function unsupportedProjectionFields(
  value: Record<string, unknown>,
  supported: readonly string[]
): string[] {
  return Object.keys(value)
    .filter((field) => !supported.includes(field))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function inspectProjectionSecondary(
  value: unknown,
  def: PropDef,
  primaryBone: PropAttachBone,
  itemIndex: number,
  entry: Record<string, unknown>,
  issues: VrmPropsProjectionIssue[]
): PropRigSecondary | undefined {
  const path = `items[${itemIndex}].rig.secondary`;
  const secondaryAnchor = def.anchors.find((candidate) => candidate.role === "secondary");
  if (!secondaryAnchor || !isHandBone(primaryBone)) {
    issues.push(projectionIssue("unsupported-rig-secondary", path, itemIndex, entry));
    return undefined;
  }
  if (!isProjectionRecord(value)) {
    issues.push(projectionIssue("invalid-rig-secondary", path, itemIndex, entry));
    return undefined;
  }

  const unsupportedFields = unsupportedProjectionFields(value, PROJECTION_SECONDARY_FIELDS);
  for (const field of unsupportedFields) {
    issues.push(projectionIssue("unsupported-secondary-field", `${path}.${field}`, itemIndex, entry));
  }

  const enabled = value.enabled;
  if (typeof enabled !== "boolean") {
    issues.push(projectionIssue("invalid-secondary-enabled", `${path}.enabled`, itemIndex, entry));
  }

  const anchorId = value.anchorId;
  const anchorSupported = typeof anchorId === "string"
    && def.anchors.some((candidate) => candidate.role === "secondary" && candidate.id === anchorId);
  if (!anchorSupported) {
    issues.push(projectionIssue("invalid-secondary-anchor", `${path}.anchorId`, itemIndex, entry));
  }

  const bone = value.bone;
  const expectedBone: PropHandBone = primaryBone === "leftHand" ? "rightHand" : "leftHand";
  if (!isHandBone(bone) || bone !== expectedBone) {
    issues.push(projectionIssue("invalid-secondary-bone", `${path}.bone`, itemIndex, entry));
  }

  const influenceValue = value.influence;
  const influence = influenceValue === undefined
    ? def.secondaryGripInfluence ?? 0.75
    : influenceValue;
  if (!isProjectionNumberInRange(influence, 0, 1)) {
    issues.push(projectionIssue("invalid-secondary-influence", `${path}.influence`, itemIndex, entry));
  }

  const hasElbowHint = value.elbowHint !== undefined;
  const elbowHint = hasElbowHint ? projectionVec3(value.elbowHint, POS_LIMIT) : undefined;
  if (hasElbowHint && !elbowHint) {
    issues.push(projectionIssue("invalid-secondary-elbow-hint", `${path}.elbowHint`, itemIndex, entry));
  }

  if (
    typeof enabled !== "boolean"
    || !anchorSupported
    || !isHandBone(bone)
    || bone !== expectedBone
    || !isProjectionNumberInRange(influence, 0, 1)
    || (hasElbowHint && !elbowHint)
    || unsupportedFields.length > 0
  ) return undefined;

  return {
    enabled,
    anchorId,
    bone,
    influence,
    ...(elbowHint ? { elbowHint } : {}),
  };
}

function inspectProjectionRig(
  value: unknown,
  def: PropDef,
  primaryBone: PropAttachBone,
  itemIndex: number,
  entry: Record<string, unknown>,
  issues: VrmPropsProjectionIssue[]
): PropRigV2 | undefined {
  const path = `items[${itemIndex}].rig`;
  if (!isProjectionRecord(value)) {
    issues.push(projectionIssue("invalid-rig", path, itemIndex, entry));
    return undefined;
  }
  if (value.version !== VRM_PROPS_VERSION) {
    issues.push(projectionIssue("unsupported-rig-version", `${path}.version`, itemIndex, entry));
    return undefined;
  }

  const unsupportedFields = unsupportedProjectionFields(value, PROJECTION_RIG_FIELDS);
  for (const field of unsupportedFields) {
    issues.push(projectionIssue("unsupported-rig-field", `${path}.${field}`, itemIndex, entry));
  }

  const mode = value.mode;
  if (mode !== "auto" && mode !== "custom") {
    issues.push(projectionIssue("invalid-rig-mode", `${path}.mode`, itemIndex, entry));
  }

  const anchorId = value.anchorId;
  const anchorSupported = typeof anchorId === "string"
    && def.anchors.some((candidate) => candidate.role !== "secondary" && candidate.id === anchorId);
  if (!anchorSupported) {
    issues.push(projectionIssue("invalid-rig-anchor", `${path}.anchorId`, itemIndex, entry));
  }

  const autoScale = value.autoScale;
  if (typeof autoScale !== "boolean") {
    issues.push(projectionIssue("invalid-rig-auto-scale", `${path}.autoScale`, itemIndex, entry));
  }

  const autoFingerPose = value.autoFingerPose;
  if (typeof autoFingerPose !== "boolean") {
    issues.push(projectionIssue("invalid-rig-auto-finger-pose", `${path}.autoFingerPose`, itemIndex, entry));
  }

  const gripFitInput = value.gripFit;
  const gripFitValue = gripFitInput === undefined ? 1 : gripFitInput;
  if (!isProjectionNumberInRange(gripFitValue, VRM_PROP_GRIP_FIT_MIN, VRM_PROP_GRIP_FIT_MAX)) {
    issues.push(projectionIssue("invalid-rig-grip-fit", `${path}.gripFit`, itemIndex, entry));
  }

  const deltaPosition = projectionVec3(value.deltaPosition, POS_LIMIT);
  if (!deltaPosition) {
    issues.push(projectionIssue("invalid-rig-delta-position", `${path}.deltaPosition`, itemIndex, entry));
  }

  const deltaRotationDeg = projectionVec3(value.deltaRotationDeg, ROT_LIMIT);
  if (!deltaRotationDeg) {
    issues.push(projectionIssue("invalid-rig-delta-rotation", `${path}.deltaRotationDeg`, itemIndex, entry));
  }

  const deltaScaleValue = value.deltaScale;
  if (!isProjectionNumberInRange(deltaScaleValue, SCALE_MIN, SCALE_MAX)) {
    issues.push(projectionIssue("invalid-rig-delta-scale", `${path}.deltaScale`, itemIndex, entry));
  }

  const hasSecondary = value.secondary !== undefined;
  const secondary = hasSecondary
    ? inspectProjectionSecondary(value.secondary, def, primaryBone, itemIndex, entry, issues)
    : undefined;

  if (
    unsupportedFields.length > 0
    || (mode !== "auto" && mode !== "custom")
    || !anchorSupported
    || typeof autoScale !== "boolean"
    || typeof autoFingerPose !== "boolean"
    || !isProjectionNumberInRange(gripFitValue, VRM_PROP_GRIP_FIT_MIN, VRM_PROP_GRIP_FIT_MAX)
    || !deltaPosition
    || !deltaRotationDeg
    || !isProjectionNumberInRange(deltaScaleValue, SCALE_MIN, SCALE_MAX)
    || (hasSecondary && !secondary)
  ) return undefined;

  return {
    version: VRM_PROPS_VERSION,
    mode,
    anchorId,
    autoScale,
    autoFingerPose,
    gripFit: gripFitValue,
    deltaPosition,
    deltaRotationDeg,
    deltaScale: deltaScaleValue,
    ...(secondary ? { secondary } : {}),
  };
}

function inspectProjectionItem(
  value: unknown,
  sourceVersion: Exclude<VrmPropsProjectionSourceVersion, "absent" | "unknown">,
  itemIndex: number,
  seenUids: string[],
  issues: VrmPropsProjectionIssue[]
): PropInstance | undefined {
  const path = `items[${itemIndex}]`;
  if (!isProjectionRecord(value)) {
    issues.push(projectionIssue("invalid-item", path, itemIndex));
    return undefined;
  }
  const entry = value;
  const issueStart = issues.length;

  for (const field of unsupportedProjectionFields(entry, PROJECTION_ITEM_FIELDS)) {
    issues.push(projectionIssue("unsupported-item-field", `${path}.${field}`, itemIndex, entry));
  }

  const uidValue = entry.uid;
  let uid: string | undefined;
  if (!("uid" in entry)) {
    issues.push(projectionIssue("missing-uid", `${path}.uid`, itemIndex, entry));
  } else if (!isValidPropUid(uidValue)) {
    issues.push(projectionIssue("invalid-uid", `${path}.uid`, itemIndex, entry));
  } else if (seenUids.includes(uidValue)) {
    issues.push(projectionIssue("duplicate-uid", `${path}.uid`, itemIndex, entry));
  } else {
    seenUids.push(uidValue);
    uid = uidValue;
  }

  const propIdValue = entry.propId;
  if (!("propId" in entry)) {
    issues.push(projectionIssue("missing-prop-id", `${path}.propId`, itemIndex, entry));
    return undefined;
  }
  if (typeof propIdValue !== "string" || propIdValue.length === 0) {
    issues.push(projectionIssue("invalid-prop-id", `${path}.propId`, itemIndex, entry));
    return undefined;
  }
  const def = propDefById(propIdValue);
  if (!def) {
    issues.push(projectionIssue("unknown-prop-id", `${path}.propId`, itemIndex, entry));
    return undefined;
  }

  const boneValue = entry.bone;
  if (!("bone" in entry)) {
    issues.push(projectionIssue("missing-bone", `${path}.bone`, itemIndex, entry));
  } else if (!isAttachBone(boneValue)) {
    issues.push(projectionIssue("invalid-bone", `${path}.bone`, itemIndex, entry));
  }

  const position = projectionVec3(entry.position, POS_LIMIT);
  if (!position) issues.push(projectionIssue("invalid-position", `${path}.position`, itemIndex, entry));

  const rotationDeg = projectionVec3(entry.rotationDeg, ROT_LIMIT);
  if (!rotationDeg) issues.push(projectionIssue("invalid-rotation", `${path}.rotationDeg`, itemIndex, entry));

  const scaleValue = entry.scale;
  if (!isProjectionNumberInRange(scaleValue, SCALE_MIN, SCALE_MAX)) {
    issues.push(projectionIssue("invalid-scale", `${path}.scale`, itemIndex, entry));
  }

  const colorValue = entry.color;
  const colorValid = def.defaultColor === null
    ? colorValue === null
    : typeof colorValue === "string" && /^#[0-9a-fA-F]{6}$/.test(colorValue);
  if (!colorValid) issues.push(projectionIssue("invalid-color", `${path}.color`, itemIndex, entry));

  let rig: PropRigV2 | undefined;
  if (entry.rig !== undefined) {
    if (sourceVersion !== VRM_PROPS_VERSION) {
      issues.push(projectionIssue("rig-not-supported-for-source-version", `${path}.rig`, itemIndex, entry));
    } else if (isAttachBone(boneValue)) {
      rig = inspectProjectionRig(entry.rig, def, boneValue, itemIndex, entry, issues);
    }
  }

  if (
    issues.length !== issueStart
    || uid === undefined
    || !isAttachBone(boneValue)
    || !position
    || !rotationDeg
    || !isProjectionNumberInRange(scaleValue, SCALE_MIN, SCALE_MAX)
    || !colorValid
    || (entry.rig !== undefined && sourceVersion === VRM_PROPS_VERSION && !rig)
    || (entry.rig !== undefined && sourceVersion !== VRM_PROPS_VERSION)
  ) return undefined;

  return {
    uid,
    propId: def.id,
    bone: boneValue,
    position,
    rotationDeg,
    scale: scaleValue,
    color: typeof colorValue === "string" ? colorValue.toLowerCase() : null,
    ...(rig ? { rig } : {}),
  };
}

/**
 * Shared Stage 투영 전에 소품 문서를 순수하게 검사한다.
 *
 * - undefined/null은 저장 키가 없다는 뜻의 정상적인 빈 문서다.
 * - version 없음(legacy), V1, V2만 해석한다. 미래/알 수 없는 버전은 전체 거부한다.
 * - 한 항목이라도 손상되면 부분 성공이나 자동 복구 없이 전체 문서를 거부한다.
 * - 성공 결과와 모든 진단은 호출자 입력에서 분리된 깊은 불변 값이다.
 */
export function inspectVrmPropsDocumentForProjection(raw: unknown): VrmPropsProjectionInspection {
  if (raw === undefined || raw === null) {
    return freezeVrmPropsProjectionValue({
      status: "ready",
      sourceVersion: "absent",
      document: { version: VRM_PROPS_VERSION, items: [] },
    });
  }
  if (!isProjectionRecord(raw)) {
    return freezeVrmPropsProjectionValue({
      status: "rejected",
      sourceVersion: "unknown",
      issues: [projectionIssue("invalid-document", "$")],
    });
  }

  const hasVersion = Object.prototype.hasOwnProperty.call(raw, "version");
  const rawVersion = raw.version;
  const sourceVersion: Exclude<VrmPropsProjectionSourceVersion, "absent"> = !hasVersion
    ? "legacy"
    : rawVersion === 1 || rawVersion === VRM_PROPS_VERSION
      ? rawVersion
      : "unknown";
  if (sourceVersion === "unknown") {
    return freezeVrmPropsProjectionValue({
      status: "rejected",
      sourceVersion,
      issues: [projectionIssue("unsupported-version", "version")],
    });
  }

  if (!Array.isArray(raw.items)) {
    return freezeVrmPropsProjectionValue({
      status: "rejected",
      sourceVersion,
      issues: [projectionIssue("invalid-items", "items")],
    });
  }

  const unsupportedDocumentFields = unsupportedProjectionFields(raw, PROJECTION_DOCUMENT_FIELDS);
  if (unsupportedDocumentFields.length > 0) {
    return freezeVrmPropsProjectionValue({
      status: "rejected",
      sourceVersion,
      issues: unsupportedDocumentFields.map((field) =>
        projectionIssue("unsupported-document-field", field)),
    });
  }

  const issues: VrmPropsProjectionIssue[] = [];
  const items: PropInstance[] = [];
  const seenUids: string[] = [];
  for (let itemIndex = 0; itemIndex < raw.items.length; itemIndex += 1) {
    const item = inspectProjectionItem(raw.items[itemIndex], sourceVersion, itemIndex, seenUids, issues);
    if (item) items.push(item);
  }

  if (issues.length > 0) {
    return freezeVrmPropsProjectionValue({ status: "rejected", sourceVersion, issues });
  }
  return freezeVrmPropsProjectionValue({
    status: "ready",
    sourceVersion,
    document: { version: VRM_PROPS_VERSION, items },
  });
}

/* ── three.js 소품 메시 빌더(주입형 — 순수 테스트 가능) ──────────────────
 * StudioVrmPoser가 three를 주입해 호출한다. three에 의존하지 않도록 최소 팩토리 인터페이스만 받는다.
 */

export interface ThreeLike {
  Group: new () => ThreeObject;
  Mesh: new (geometry: unknown, material: unknown) => ThreeObject;
  MeshStandardMaterial: new (params: { color?: unknown; roughness?: number; metalness?: number; side?: unknown }) => unknown;
  BoxGeometry: new (w: number, h: number, d: number) => unknown;
  CylinderGeometry: new (
    rt: number,
    rb: number,
    h: number,
    seg?: number,
    heightSeg?: number,
    openEnded?: boolean,
    thetaStart?: number,
    thetaLength?: number
  ) => unknown;
  SphereGeometry: new (
    r: number,
    ws?: number,
    hs?: number,
    phiStart?: number,
    phiLength?: number,
    thetaStart?: number,
    thetaLength?: number
  ) => unknown;
  ConeGeometry: new (r: number, h: number, seg?: number) => unknown;
  TorusGeometry: new (r: number, tube: number, rs?: number, ts?: number, arc?: number) => unknown;
  Color: new (hex: string) => unknown;
  DoubleSide: unknown;
}

export interface ThreeObject {
  add(child: ThreeObject): void;
  position: { set(x: number, y: number, z: number): void };
  rotation: { set(x: number, y: number, z: number): void };
  scale: { setScalar(s: number): void };
  name: string;
  /** Present on real THREE.Mesh objects; optional so the headless injected test factory stays tiny. */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface PropGeometryQualityAdapter {
  /** Optional production renderer hook; headless/legacy callers retain plain boxes. */
  readonly roundedBox?: (
    width: number,
    height: number,
    depth: number,
    radius: number,
  ) => unknown;
}

/** 소품 한 종의 메시 그룹을 만든다. 색상은 인스턴스 색을 우선 적용한다. */
export function buildPropObject(
  three: ThreeLike,
  def: PropDef,
  color: string | null,
  qualityAdapter?: PropGeometryQualityAdapter,
): ThreeObject {
  if (def.geometrySource.kind !== "procedural") {
    throw new TypeError(`GLTF prop ${def.id} must be loaded from ${def.geometrySource.url}`);
  }
  const group = new three.Group();
  group.name = `prop:${def.id}`;
  const hex = color ?? def.defaultColor ?? "#cccccc";
  const mat = (roughness = 0.6, metalness = 0.1, c: string = hex) =>
    new three.MeshStandardMaterial({ color: new three.Color(c), roughness, metalness, side: three.DoubleSide });
  const roundedBox = (width: number, height: number, depth: number): unknown => {
    const radius = Math.max(0.000_15, Math.min(width, height, depth) * 0.18);
    return qualityAdapter?.roundedBox?.(width, height, depth, radius)
      ?? new three.BoxGeometry(width, height, depth);
  };
  const mesh = (geo: unknown, material: unknown): ThreeObject => {
    const object = new three.Mesh(geo, material);
    // Props previously looked detached from the character because they ignored the scene's key and
    // fill shadows.  Opt every generated surface into the same lighting contract as the avatar.
    object.castShadow = true;
    object.receiveShadow = true;
    return object;
  };

  switch (def.id) {
    case "smartphone": {
      group.add(mesh(roundedBox(0.07, 0.14, 0.008), mat(0.3, 0.4)));
      const screen = mesh(roundedBox(0.06, 0.12, 0.001), mat(0.1, 0, "#3a6ea5"));
      screen.position.set(0, 0, 0.006);
      group.add(screen);
      break;
    }
    case "mug": {
      group.add(mesh(new three.CylinderGeometry(0.04, 0.035, 0.08, 20), mat(0.5)));
      const handle = mesh(new three.TorusGeometry(0.025, 0.008, 8, 16), mat(0.5));
      handle.position.set(0.045, 0, 0);
      handle.rotation.set(0, Math.PI / 2, 0);
      group.add(handle);
      break;
    }
    case "sword": {
      group.add(mesh(roundedBox(0.025, 0.6, 0.008), mat(0.25, 0.85)));
      const guard = mesh(roundedBox(0.12, 0.02, 0.02), mat(0.4, 0.7, "#8a6a3c"));
      guard.position.set(0, -0.3, 0);
      group.add(guard);
      const grip = mesh(new three.CylinderGeometry(0.014, 0.014, 0.12, 12), mat(0.7, 0.1, "#3a2b1c"));
      grip.position.set(0, -0.37, 0);
      group.add(grip);
      break;
    }
    case "staff": {
      group.add(mesh(new three.CylinderGeometry(0.012, 0.012, 0.7, 12), mat(0.7, 0.05)));
      const orb = mesh(new three.SphereGeometry(0.04, 16, 16), mat(0.1, 0.2, "#6ec3e8"));
      orb.position.set(0, 0.37, 0);
      group.add(orb);
      break;
    }
    case "mic": {
      group.add(mesh(new three.CylinderGeometry(0.012, 0.012, 0.12, 12), mat(0.5, 0.3)));
      const head = mesh(new three.SphereGeometry(0.028, 16, 16), mat(0.6, 0.2, "#3a3a40"));
      head.position.set(0, 0.08, 0);
      group.add(head);
      break;
    }
    case "book": {
      group.add(mesh(roundedBox(0.14, 0.2, 0.03), mat(0.7)));
      const pages = mesh(roundedBox(0.13, 0.19, 0.025), mat(0.8, 0, "#f0ece0"));
      pages.position.set(0.005, 0, 0);
      group.add(pages);
      break;
    }
    case "fan": {
      const blade = mesh(new three.CylinderGeometry(0.12, 0.12, 0.004, 24, 1, false, 0, Math.PI), mat(0.6));
      blade.rotation.set(Math.PI / 2, 0, 0);
      group.add(blade);
      const fanHandle = mesh(new three.CylinderGeometry(0.008, 0.011, 0.1, 12), mat(0.62, 0.08, "#6b3e26"));
      fanHandle.position.set(0, -0.1, 0);
      group.add(fanHandle);
      break;
    }
    case "bouquet": {
      const wrap = mesh(new three.ConeGeometry(0.05, 0.14, 12), mat(0.7, 0, "#cdb89a"));
      group.add(wrap);
      for (let i = 0; i < 5; i += 1) {
        const flower = mesh(new three.SphereGeometry(0.03, 12, 12), mat(0.5));
        const a = (i / 5) * Math.PI * 2;
        flower.position.set(Math.cos(a) * 0.03, 0.09, Math.sin(a) * 0.03);
        group.add(flower);
      }
      break;
    }
    case "clipboard": {
      group.add(mesh(roundedBox(0.145, 0.205, 0.012), mat(0.72, 0.05)));
      const paper = mesh(roundedBox(0.125, 0.175, 0.002), mat(0.92, 0, "#f8fafc"));
      paper.position.set(0, -0.004, 0.008);
      group.add(paper);
      const clip = mesh(roundedBox(0.045, 0.025, 0.01), mat(0.28, 0.72, "#94a3b8"));
      clip.position.set(0, 0.095, 0.012);
      group.add(clip);
      break;
    }
    case "syringe": {
      group.add(mesh(new three.CylinderGeometry(0.014, 0.014, 0.16, 16), mat(0.18, 0.05, "#dbeafe")));
      const plunger = mesh(new three.CylinderGeometry(0.007, 0.007, 0.09, 12), mat(0.35, 0.25, "#64748b"));
      plunger.position.set(0, -0.115, 0);
      group.add(plunger);
      const flange = mesh(roundedBox(0.065, 0.012, 0.018), mat(0.4, 0.12, hex));
      flange.position.set(0, -0.08, 0);
      group.add(flange);
      const needle = mesh(new three.CylinderGeometry(0.0015, 0.0015, 0.1, 8), mat(0.2, 0.9, "#cbd5e1"));
      needle.position.set(0, 0.13, 0);
      group.add(needle);
      break;
    }
    case "medicalBag": {
      group.add(mesh(roundedBox(0.24, 0.16, 0.1), mat(0.72, 0.08)));
      const handle = mesh(new three.TorusGeometry(0.065, 0.012, 8, 20, Math.PI), mat(0.58, 0.1, "#7f1d1d"));
      handle.position.set(0, 0.09, 0);
      group.add(handle);
      const crossVertical = mesh(roundedBox(0.025, 0.09, 0.008), mat(0.5, 0.05, "#f8fafc"));
      crossVertical.position.set(0, 0, 0.055);
      group.add(crossVertical);
      const crossHorizontal = mesh(roundedBox(0.09, 0.025, 0.008), mat(0.5, 0.05, "#f8fafc"));
      crossHorizontal.position.set(0, 0, 0.055);
      group.add(crossHorizontal);
      break;
    }
    case "cap": {
      group.add(mesh(new three.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0.6)));
      const brim = mesh(roundedBox(0.16, 0.01, 0.1), mat(0.6));
      brim.position.set(0, 0, 0.11);
      group.add(brim);
      break;
    }
    case "beret": {
      group.add(mesh(new three.CylinderGeometry(0.11, 0.1, 0.04, 24), mat(0.7)));
      break;
    }
    case "glasses":
    case "sunglasses": {
      const tint = def.id === "sunglasses" ? 0.2 : 0.5;
      const frameMat = mat(0.4, 0.3);
      const lensMat = mat(0.1, def.id === "sunglasses" ? 0.6 : 0.1, def.id === "sunglasses" ? hex : "#cfe6f2");
      const left = mesh(new three.TorusGeometry(0.03, 0.005, 8, 20), frameMat);
      left.position.set(-0.035, 0, 0);
      const right = mesh(new three.TorusGeometry(0.03, 0.005, 8, 20), frameMat);
      right.position.set(0.035, 0, 0);
      const bridge = mesh(roundedBox(0.02, 0.004, 0.004), frameMat);
      group.add(left);
      group.add(right);
      group.add(bridge);
      if (def.id === "sunglasses" || tint < 0.3) {
        const ll = mesh(new three.CylinderGeometry(0.028, 0.028, 0.002, 16), lensMat);
        ll.position.set(-0.035, 0, 0);
        ll.rotation.set(Math.PI / 2, 0, 0);
        const rl = mesh(new three.CylinderGeometry(0.028, 0.028, 0.002, 16), lensMat);
        rl.position.set(0.035, 0, 0);
        rl.rotation.set(Math.PI / 2, 0, 0);
        group.add(ll);
        group.add(rl);
      }
      break;
    }
    case "crown": {
      group.add(mesh(new three.CylinderGeometry(0.06, 0.06, 0.04, 20, 1, true), mat(0.2, 0.9)));
      for (let i = 0; i < 6; i += 1) {
        const spike = mesh(new three.ConeGeometry(0.012, 0.04, 8), mat(0.2, 0.9));
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.06, 0.035, Math.sin(a) * 0.06);
        group.add(spike);
      }
      break;
    }
    case "ribbon": {
      const left = mesh(new three.ConeGeometry(0.03, 0.06, 4), mat(0.5));
      left.position.set(-0.03, 0, 0);
      left.rotation.set(0, 0, Math.PI / 2);
      const right = mesh(new three.ConeGeometry(0.03, 0.06, 4), mat(0.5));
      right.position.set(0.03, 0, 0);
      right.rotation.set(0, 0, -Math.PI / 2);
      const knot = mesh(new three.SphereGeometry(0.015, 10, 10), mat(0.5));
      group.add(left);
      group.add(right);
      group.add(knot);
      break;
    }
    case "surgicalCap": {
      group.add(mesh(new three.SphereGeometry(0.105, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0.82, 0.02)));
      const band = mesh(new three.TorusGeometry(0.09, 0.008, 8, 24), mat(0.72, 0.02, hex));
      band.rotation.set(Math.PI / 2, 0, 0);
      group.add(band);
      break;
    }
    case "faceMask": {
      const mask = mesh(roundedBox(0.12, 0.075, 0.012), mat(0.86, 0.01));
      group.add(mask);
      for (const side of [-1, 1] as const) {
        const strap = mesh(new three.TorusGeometry(0.035, 0.003, 6, 16, Math.PI), mat(0.65, 0, "#f8fafc"));
        strap.position.set(side * 0.072, 0, -0.005);
        strap.rotation.set(Math.PI / 2, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        group.add(strap);
      }
      break;
    }
    case "backpack": {
      group.add(mesh(roundedBox(0.18, 0.24, 0.1), mat(0.7)));
      const pocket = mesh(roundedBox(0.14, 0.1, 0.04), mat(0.7));
      pocket.position.set(0, -0.05, 0.06);
      group.add(pocket);
      break;
    }
    case "shoulderbag": {
      group.add(mesh(roundedBox(0.16, 0.14, 0.05), mat(0.7)));
      const strap = mesh(new three.TorusGeometry(0.14, 0.008, 6, 24, Math.PI), mat(0.7));
      strap.position.set(0, 0.05, 0);
      group.add(strap);
      break;
    }
    case "cape": {
      const cloth = mesh(roundedBox(0.4, 0.6, 0.01), mat(0.85));
      cloth.position.set(0, -0.3, 0);
      group.add(cloth);
      break;
    }
    case "wings": {
      for (const side of [-1, 1] as const) {
        const wing = mesh(new three.SphereGeometry(0.22, 12, 8, 0, Math.PI), mat(0.6));
        wing.position.set(side * 0.18, 0, 0);
        wing.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
        wing.scale.setScalar(1);
        group.add(wing);
      }
      break;
    }
    case "stethoscope": {
      const tube = mesh(new three.TorusGeometry(0.09, 0.006, 8, 28, Math.PI * 1.55), mat(0.64, 0.05));
      tube.rotation.set(0, 0, Math.PI * 0.72);
      group.add(tube);
      for (const side of [-1, 1] as const) {
        const earpiece = mesh(new three.CylinderGeometry(0.004, 0.004, 0.09, 8), mat(0.55, 0.18, "#94a3b8"));
        earpiece.position.set(side * 0.055, 0.08, 0);
        earpiece.rotation.set(0, 0, side * 0.38);
        group.add(earpiece);
      }
      const chestPiece = mesh(new three.CylinderGeometry(0.022, 0.022, 0.008, 20), mat(0.25, 0.8, "#cbd5e1"));
      chestPiece.position.set(0, -0.105, 0);
      chestPiece.rotation.set(Math.PI / 2, 0, 0);
      group.add(chestPiece);
      break;
    }
    case "idBadge": {
      group.add(mesh(roundedBox(0.065, 0.09, 0.008), mat(0.74, 0.04)));
      const portrait = mesh(roundedBox(0.022, 0.028, 0.003), mat(0.55, 0.04, "#93c5fd"));
      portrait.position.set(-0.015, 0.015, 0.006);
      group.add(portrait);
      const stripe = mesh(roundedBox(0.055, 0.008, 0.003), mat(0.5, 0.05, "#2563eb"));
      stripe.position.set(0, -0.025, 0.006);
      group.add(stripe);
      const clip = mesh(roundedBox(0.018, 0.018, 0.01), mat(0.3, 0.65, "#94a3b8"));
      clip.position.set(0, 0.052, 0);
      group.add(clip);
      break;
    }
    case "umbrella": {
      const canopy = mesh(new three.CylinderGeometry(0.3, 0.02, 0.15, 12, 1, false), mat(0.4, 0.1));
      canopy.position.set(0, 0.35, 0);
      group.add(canopy);
      const shaft = mesh(new three.CylinderGeometry(0.008, 0.008, 0.7, 8), mat(0.3, 0.8, "#64748b"));
      group.add(shaft);
      const handle = mesh(new three.TorusGeometry(0.03, 0.008, 8, 12, Math.PI), mat(0.4, 0.8, "#1e293b"));
      handle.position.set(-0.03, -0.35, 0);
      handle.rotation.set(0, 0, Math.PI);
      group.add(handle);
      break;
    }
    case "flute": {
      const body = mesh(new three.CylinderGeometry(0.008, 0.008, 0.5, 10), mat(0.2, 0.9, "#d1d5db"));
      group.add(body);
      for (let i = 0; i < 6; i++) {
        const key = mesh(new three.CylinderGeometry(0.003, 0.003, 0.004, 6), mat(0.3, 0.8, "#9ca3af"));
        key.position.set(0, -0.15 + i * 0.06, 0.008);
        key.rotation.set(Math.PI / 2, 0, 0);
        group.add(key);
      }
      break;
    }
    case "wand": {
      const stick = mesh(new three.CylinderGeometry(0.006, 0.004, 0.3, 8), mat(0.6, 0.1, "#8a5cf6"));
      group.add(stick);
      const starGroup = new three.Group();
      starGroup.position.set(0, 0.16, 0);
      starGroup.add(mesh(new three.SphereGeometry(0.02, 10, 10), mat(0.1, 0.9, hex)));
      for (let i = 0; i < 5; i++) {
        const pt = mesh(new three.ConeGeometry(0.012, 0.035, 4), mat(0.2, 0.8, "#fbbf24"));
        const angle = (i * Math.PI * 2) / 5;
        pt.position.set(Math.sin(angle) * 0.025, Math.cos(angle) * 0.025, 0);
        pt.rotation.set(0, 0, -angle);
        starGroup.add(pt);
      }
      group.add(starGroup);
      break;
    }
    case "headphones": {
      const band = mesh(new three.TorusGeometry(0.095, 0.008, 8, 24, Math.PI), mat(0.6, 0.1));
      band.position.set(0, 0.02, 0);
      group.add(band);
      for (const side of [-1, 1] as const) {
        const cup = mesh(new three.CylinderGeometry(0.035, 0.035, 0.02, 16), mat(0.5, 0.2, "#111827"));
        cup.position.set(side * 0.095, 0.01, 0);
        cup.rotation.set(0, 0, Math.PI / 2);
        group.add(cup);
        const logo = mesh(new three.SphereGeometry(0.012, 8, 8), mat(0.2, 0.9, hex));
        logo.position.set(side * 0.106, 0.01, 0);
        group.add(logo);
      }
      break;
    }
    case "headband": {
      const band = mesh(new three.TorusGeometry(0.09, 0.007, 8, 24, Math.PI), mat(0.5, 0.1));
      band.position.set(0, 0.02, 0);
      group.add(band);
      break;
    }
    case "flowerCrown": {
      const ring = mesh(new three.TorusGeometry(0.09, 0.006, 8, 24), mat(0.7, 0.05, "#15803d"));
      group.add(ring);
      for (let i = 0; i < 8; i++) {
        const flower = mesh(new three.SphereGeometry(0.018, 8, 8), mat(0.5, 0.1));
        const angle = (i * Math.PI * 2) / 8;
        flower.position.set(Math.cos(angle) * 0.09, 0.005, Math.sin(angle) * 0.09);
        group.add(flower);
      }
      break;
    }
    case "scarf": {
      const neckRing = mesh(new three.TorusGeometry(0.095, 0.022, 10, 16), mat(0.8, 0));
      neckRing.rotation.set(Math.PI / 2, 0, 0);
      group.add(neckRing);
      const hanging = mesh(roundedBox(0.04, 0.28, 0.015), mat(0.8, 0));
      hanging.position.set(0.05, -0.14, 0.07);
      hanging.rotation.set(0.1, -0.05, -0.1);
      group.add(hanging);
      break;
    }
    case "holster": {
      group.add(mesh(roundedBox(0.07, 0.14, 0.04), mat(0.75, 0.1, "#543825")));
      const grip = mesh(new three.CylinderGeometry(0.01, 0.012, 0.08, 8), mat(0.6, 0.2, "#2b2b2b"));
      grip.position.set(0.02, 0.07, 0.03);
      grip.rotation.set(0.3, 0, 0.6);
      group.add(grip);
      break;
    }
    case "belt": {
      const loop = mesh(new three.TorusGeometry(0.14, 0.01, 8, 24), mat(0.7, 0.2, "#1e293b"));
      loop.rotation.set(Math.PI / 2, 0, 0);
      group.add(loop);
      const buckle = mesh(roundedBox(0.035, 0.028, 0.022), mat(0.2, 0.9, "#fbbf24"));
      buckle.position.set(0, 0, 0.14);
      group.add(buckle);
      break;
    }
    case "backwing": {
      for (const side of [-1, 1] as const) {
        const wing = mesh(new three.SphereGeometry(0.1, 10, 8, 0, Math.PI), mat(0.3, 0.5));
        wing.position.set(side * 0.09, 0, 0);
        wing.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
        group.add(wing);
      }
      break;
    }
    case "gloves": {
      group.add(mesh(new three.SphereGeometry(0.045, 12, 12), mat(0.8, 0)));
      break;
    }
    case "choker": {
      const neckLoop = mesh(new three.TorusGeometry(0.065, 0.007, 8, 20), mat(0.6, 0.1, "#111827"));
      neckLoop.rotation.set(Math.PI / 2, 0, 0);
      group.add(neckLoop);
      const pendant = mesh(new three.SphereGeometry(0.009, 8, 8), mat(0.1, 0.9, hex));
      pendant.position.set(0, 0, 0.065);
      group.add(pendant);
      break;
    }
    case "pencil": {
      group.add(mesh(new three.CylinderGeometry(0.006, 0.006, 0.14, 10), mat(0.55, 0.05)));
      const tip = mesh(new three.ConeGeometry(0.006, 0.025, 10), mat(0.45, 0.05, "#f5e6c8"));
      tip.position.set(0, 0.08, 0);
      group.add(tip);
      const lead = mesh(new three.ConeGeometry(0.0025, 0.012, 8), mat(0.4, 0.1, "#1c1c1c"));
      lead.position.set(0, 0.095, 0);
      group.add(lead);
      break;
    }
    case "camera": {
      group.add(mesh(roundedBox(0.1, 0.065, 0.045), mat(0.55, 0.15)));
      const lens = mesh(new three.CylinderGeometry(0.022, 0.022, 0.035, 16), mat(0.2, 0.6, "#111827"));
      lens.position.set(0, 0, 0.035);
      lens.rotation.set(Math.PI / 2, 0, 0);
      group.add(lens);
      const flash = mesh(roundedBox(0.03, 0.015, 0.02), mat(0.3, 0.2, "#e2e8f0"));
      flash.position.set(0.03, 0.04, 0);
      group.add(flash);
      break;
    }
    case "bottle": {
      group.add(mesh(new three.CylinderGeometry(0.028, 0.03, 0.12, 16), mat(0.25, 0.15)));
      const neck = mesh(new three.CylinderGeometry(0.012, 0.016, 0.04, 12), mat(0.25, 0.15));
      neck.position.set(0, 0.075, 0);
      group.add(neck);
      const cap = mesh(new three.CylinderGeometry(0.014, 0.014, 0.015, 12), mat(0.5, 0.1, "#1e293b"));
      cap.position.set(0, 0.1, 0);
      group.add(cap);
      break;
    }
    case "coffee": {
      group.add(mesh(new three.CylinderGeometry(0.035, 0.03, 0.1, 16), mat(0.75, 0.02)));
      const lid = mesh(new three.CylinderGeometry(0.036, 0.036, 0.012, 16), mat(0.55, 0.05, "#1c1c1c"));
      lid.position.set(0, 0.055, 0);
      group.add(lid);
      const sleeve = mesh(new three.CylinderGeometry(0.037, 0.037, 0.035, 16), mat(0.85, 0, "#d6b98c"));
      sleeve.position.set(0, 0, 0);
      group.add(sleeve);
      break;
    }
    case "laptop": {
      const base = mesh(roundedBox(0.22, 0.01, 0.15), mat(0.4, 0.35));
      group.add(base);
      const screen = mesh(roundedBox(0.22, 0.14, 0.008), mat(0.35, 0.4));
      screen.position.set(0, 0.07, -0.07);
      screen.rotation.set(-0.35, 0, 0);
      group.add(screen);
      const display = mesh(roundedBox(0.19, 0.11, 0.002), mat(0.2, 0.2, "#0ea5e9"));
      display.position.set(0, 0.075, -0.065);
      display.rotation.set(-0.35, 0, 0);
      group.add(display);
      break;
    }
    case "shield": {
      group.add(mesh(roundedBox(0.22, 0.28, 0.03), mat(0.35, 0.55)));
      const boss = mesh(new three.SphereGeometry(0.035, 12, 12), mat(0.25, 0.8, "#cbd5e1"));
      boss.position.set(0, 0, 0.02);
      group.add(boss);
      const rim = mesh(new three.TorusGeometry(0.11, 0.012, 8, 24), mat(0.3, 0.7, "#94a3b8"));
      rim.position.set(0, 0, 0.01);
      group.add(rim);
      break;
    }
    case "torch": {
      group.add(mesh(new three.CylinderGeometry(0.014, 0.018, 0.22, 10), mat(0.75, 0.08)));
      const flame = mesh(new three.ConeGeometry(0.03, 0.08, 10), mat(0.3, 0.1, "#f97316"));
      flame.position.set(0, 0.14, 0);
      group.add(flame);
      const core = mesh(new three.SphereGeometry(0.02, 10, 10), mat(0.2, 0.1, "#fde68a"));
      core.position.set(0, 0.12, 0);
      group.add(core);
      break;
    }
    case "lollipop": {
      const stick = mesh(new three.CylinderGeometry(0.004, 0.004, 0.1, 8), mat(0.5, 0.05, "#f8fafc"));
      stick.position.set(0, -0.05, 0);
      group.add(stick);
      group.add(mesh(new three.SphereGeometry(0.028, 14, 14), mat(0.35, 0.05)));
      break;
    }
    case "plate": {
      group.add(mesh(new three.CylinderGeometry(0.09, 0.08, 0.012, 24), mat(0.35, 0.05)));
      const rim = mesh(new three.TorusGeometry(0.085, 0.008, 8, 24), mat(0.4, 0.05, "#e2e8f0"));
      group.add(rim);
      break;
    }
    case "gun": {
      group.add(mesh(roundedBox(0.04, 0.05, 0.14), mat(0.4, 0.35)));
      const grip = mesh(roundedBox(0.03, 0.08, 0.04), mat(0.55, 0.15, "#1c1c1c"));
      grip.position.set(0, -0.05, -0.03);
      group.add(grip);
      const barrel = mesh(new three.CylinderGeometry(0.01, 0.01, 0.08, 10), mat(0.3, 0.5, "#374151"));
      barrel.position.set(0, 0.01, 0.1);
      barrel.rotation.set(Math.PI / 2, 0, 0);
      group.add(barrel);
      break;
    }
    case "catEars": {
      for (const side of [-1, 1] as const) {
        const ear = mesh(new three.ConeGeometry(0.035, 0.07, 8), mat(0.55, 0.05));
        ear.position.set(side * 0.055, 0.04, 0);
        ear.rotation.set(0, 0, side * 0.25);
        group.add(ear);
        const inner = mesh(new three.ConeGeometry(0.018, 0.04, 8), mat(0.6, 0.05, "#f9a8d4"));
        inner.position.set(side * 0.055, 0.035, 0.01);
        inner.rotation.set(0, 0, side * 0.25);
        group.add(inner);
      }
      break;
    }
    case "elfEars": {
      // Two tapered cones per side: the outer ear points outward, slightly up and swept back
      // (Euler XYZ: Rz tilts +Y toward ±X, Ry sweeps the tip toward -Z); the inner ear is a
      // smaller, lighter cone nested just in front of it.
      for (const side of [-1, 1] as const) {
        const ear = mesh(new three.ConeGeometry(0.022, 0.085, 8), mat(0.55, 0.05));
        ear.position.set(side * 0.105, 0.014, -0.024);
        ear.rotation.set(0, side * 0.5, side * -1.22);
        group.add(ear);
        const inner = mesh(new three.ConeGeometry(0.011, 0.05, 8), mat(0.6, 0.05, "#f9c9c0"));
        inner.position.set(side * 0.1, 0.012, -0.015);
        inner.rotation.set(0, side * 0.5, side * -1.22);
        group.add(inner);
      }
      break;
    }
    case "horns": {
      for (const side of [-1, 1] as const) {
        const horn = mesh(new three.ConeGeometry(0.02, 0.08, 10), mat(0.45, 0.15));
        horn.position.set(side * 0.05, 0.05, -0.01);
        horn.rotation.set(-0.4, 0, side * 0.35);
        group.add(horn);
      }
      break;
    }
    case "halo": {
      const ring = mesh(new three.TorusGeometry(0.08, 0.008, 8, 28), mat(0.2, 0.85));
      ring.rotation.set(Math.PI / 2, 0, 0);
      group.add(ring);
      break;
    }
    case "eyepatch": {
      group.add(mesh(roundedBox(0.055, 0.04, 0.01), mat(0.7, 0.05)));
      const strap = mesh(roundedBox(0.14, 0.01, 0.006), mat(0.65, 0.05, "#1c1c1c"));
      strap.position.set(-0.02, 0.01, -0.01);
      group.add(strap);
      break;
    }
    case "beanie": {
      group.add(mesh(new three.SphereGeometry(0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.6), mat(0.75, 0.05)));
      const pom = mesh(new three.SphereGeometry(0.025, 10, 10), mat(0.55, 0.05, "#f8fafc"));
      pom.position.set(0, 0.1, 0);
      group.add(pom);
      break;
    }
    case "earmuffs": {
      const band = mesh(new three.TorusGeometry(0.1, 0.008, 8, 20, Math.PI), mat(0.55, 0.1));
      band.position.set(0, 0.02, 0);
      group.add(band);
      for (const side of [-1, 1] as const) {
        const muff = mesh(new three.SphereGeometry(0.04, 12, 12), mat(0.7, 0.05));
        muff.position.set(side * 0.1, 0.01, 0);
        group.add(muff);
      }
      break;
    }
    case "hairpin": {
      group.add(mesh(roundedBox(0.05, 0.01, 0.006), mat(0.25, 0.75)));
      const gem = mesh(new three.SphereGeometry(0.012, 10, 10), mat(0.15, 0.8, "#f472b6"));
      gem.position.set(0.02, 0.01, 0);
      group.add(gem);
      break;
    }
    case "goggles": {
      for (const side of [-1, 1] as const) {
        const cup = mesh(new three.TorusGeometry(0.028, 0.006, 8, 16), mat(0.4, 0.3));
        cup.position.set(side * 0.038, 0, 0);
        group.add(cup);
        const lens = mesh(new three.CylinderGeometry(0.024, 0.024, 0.004, 14), mat(0.2, 0.4, "#7dd3fc"));
        lens.position.set(side * 0.038, 0, 0);
        lens.rotation.set(Math.PI / 2, 0, 0);
        group.add(lens);
      }
      const strap = mesh(new three.TorusGeometry(0.09, 0.005, 6, 20, Math.PI), mat(0.6, 0.1, "#1c1c1c"));
      strap.position.set(0, 0.01, -0.02);
      group.add(strap);
      break;
    }
    case "guitar": {
      // 테스트 더블 mesh는 scale.set을 갖지 않을 수 있어 타원 변형 대신 박스 바디를 쓴다.
      group.add(mesh(roundedBox(0.16, 0.22, 0.055), mat(0.55, 0.15)));
      const neck = mesh(roundedBox(0.03, 0.28, 0.02), mat(0.5, 0.1, "#5a4632"));
      neck.position.set(0, 0.2, 0);
      group.add(neck);
      const headstock = mesh(roundedBox(0.05, 0.06, 0.02), mat(0.5, 0.1, "#5a4632"));
      headstock.position.set(0, 0.35, 0);
      group.add(headstock);
      break;
    }
    case "quiver": {
      group.add(mesh(new three.CylinderGeometry(0.035, 0.04, 0.28, 12), mat(0.7, 0.1)));
      for (let i = 0; i < 3; i += 1) {
        const arrow = mesh(new three.CylinderGeometry(0.004, 0.004, 0.32, 6), mat(0.4, 0.2, "#d6b98c"));
        arrow.position.set((i - 1) * 0.015, 0.08, 0);
        group.add(arrow);
      }
      break;
    }
    case "nameTag": {
      group.add(mesh(roundedBox(0.07, 0.035, 0.006), mat(0.55, 0.05)));
      const bar = mesh(roundedBox(0.06, 0.01, 0.003), mat(0.4, 0.1, "#2563eb"));
      bar.position.set(0, 0.008, 0.004);
      group.add(bar);
      break;
    }
    case "apron": {
      group.add(mesh(roundedBox(0.28, 0.35, 0.02), mat(0.8, 0.02)));
      const strapL = mesh(roundedBox(0.03, 0.2, 0.01), mat(0.75, 0.02));
      strapL.position.set(-0.1, 0.22, -0.02);
      group.add(strapL);
      const strapR = mesh(roundedBox(0.03, 0.2, 0.01), mat(0.75, 0.02));
      strapR.position.set(0.1, 0.22, -0.02);
      group.add(strapR);
      break;
    }
    case "tail": {
      const base = mesh(new three.CylinderGeometry(0.025, 0.018, 0.18, 10), mat(0.6, 0.05));
      base.rotation.set(0.8, 0, 0);
      group.add(base);
      const tip = mesh(new three.SphereGeometry(0.03, 10, 10), mat(0.55, 0.05));
      tip.position.set(0, -0.02, -0.16);
      group.add(tip);
      break;
    }
    default:
      group.add(mesh(roundedBox(0.05, 0.05, 0.05), mat()));
  }
  return group;
}
