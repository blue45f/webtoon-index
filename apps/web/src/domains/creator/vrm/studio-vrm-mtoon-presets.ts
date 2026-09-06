/**
 * 선화(LT) 추출을 목표로 튜닝한 MToon 프리셋.
 *
 * 각 프리셋의 `ltNote` 는 이 설정이 Studio 의 LT 추출(`studio-bg3d-lt-render`)에 **구체적으로**
 * 어떤 영향을 주는지를 적는다. LT 는 이렇게 동작한다:
 *   선(L) = 블러된 휘도의 소벨(내부 선) ⊕ 알파 소벨 × exteriorOutlineStrength(실루엣)
 *           ⊕ (선택) 깊이 에지 · 텍스처 라인(라플라시안)
 *   톤(T) = 같은 휘도를 tone.levels(2~8) 단계로 양자화 → 하프톤 패턴 랭크
 * 즉 LT 는 **화면 휘도의 계단**만 본다. MToon 파라미터는 그 계단을 만드는 유일한 손잡이다.
 *
 * 공통 원칙:
 *  - 아웃라인은 조명 반영(lightingMix)을 0 으로 둔다. 조명이 섞이면 같은 윤곽선이 부위마다
 *    다른 휘도로 찍혀, 하나의 `line.accuracy` 임계값으로는 일부만 잡히고 선이 끊긴다.
 *  - toony 를 1 에 붙이면 그림자 경계가 계단이 되어 소벨이 얇고 또렷한 내부 선을 만든다.
 *    낮추면 넓고 흐린 그라디언트가 되어 선이 두껍고 지저분해지며, 톤 양자화 경계도 흔들린다.
 *  - 림 라이트는 실루엣 안쪽에 밝은 띠를 만들어 실루엣 에지의 명암을 뒤집고 가짜 내부 선을
 *    하나 더 만든다. 선화용 프리셋은 전부 림을 끈다.
 */

import {
  sanitizeStudioVrmMtoonControls,
  type StudioVrmMtoonControls,
} from "./studio-vrm-mtoon-controls";

export interface StudioVrmMtoonPreset {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly hint: string;
  /** LT 추출에 미치는 영향 — UI 에 그대로 노출한다. */
  readonly ltNote: string;
  readonly controls: StudioVrmMtoonControls;
}

function preset(
  id: string,
  label: string,
  emoji: string,
  hint: string,
  ltNote: string,
  controls: unknown,
): StudioVrmMtoonPreset {
  return { id, label, emoji, hint, ltNote, controls: sanitizeStudioVrmMtoonControls(controls) };
}

export const STUDIO_VRM_MTOON_PRESETS: readonly StudioVrmMtoonPreset[] = Object.freeze([
  preset(
    "model-original",
    "모델 원본",
    "◌",
    "모델 작가가 설정한 셰이딩을 그대로 씁니다.",
    "아무 그룹도 켜지 않으므로 캐시된 원본 유니폼으로 복원됩니다. 선/톤 결과는 모델마다 제각각이라 " +
      "여러 캐릭터를 한 컷에 합칠 때 선 굵기·농도가 튑니다.",
    {
      outline: { enabled: false },
      shading: { enabled: false },
      rim: { enabled: false },
    },
  ),
  preset(
    "clean-line",
    "클린 선화",
    "✒️",
    "해상도와 무관하게 굵기가 일정한 얇은 외곽선 + 또렷한 2톤.",
    "화면 좌표 아웃라인이라 캡처 배율을 바꿔도 선 굵기가 유지됩니다 — line.widthPx 를 재조정하지 " +
      "않아도 되고, 알파 소벨(실루엣)과 휘도 소벨(아웃라인)이 같은 위치에서 겹쳐 실루엣이 두 겹으로 " +
      "번지지 않습니다. toony 0.95 는 그림자 경계를 계단으로 만들어 내부 선을 얇게 뽑아줍니다.",
    {
      outline: {
        enabled: true,
        mode: "screenCoordinates",
        screenWidthRatio: 0.0022,
        color: "#1a1a1a",
        lightingMix: 0,
      },
      shading: { enabled: true, shadeColor: "#98a0ab", shadingShift: 0.02, toony: 0.95 },
      rim: { enabled: false },
    },
  ),
  preset(
    "bold-ink",
    "굵은 잉크",
    "🖌️",
    "먹선 느낌의 굵고 새까만 외곽선. 액션·강조 컷용.",
    "월드 좌표 아웃라인은 캐릭터가 멀어지면 화면상 선이 함께 얇아져 원근이 살아납니다. 순흑 + " +
      "lightingMix 0 이라 휘도 대비가 최대치라, line.accuracy 를 높게(엄격하게) 잡아도 외곽선만 " +
      "확실히 살아남고 노이즈성 내부 선은 걸러집니다.",
    {
      outline: {
        enabled: true,
        mode: "worldCoordinates",
        worldWidthMeters: 0.0065,
        color: "#000000",
        lightingMix: 0,
      },
      shading: { enabled: true, shadeColor: "#7d848f", shadingShift: 0, toony: 1 },
      rim: { enabled: false },
    },
  ),
  preset(
    "hairline",
    "헤어라인",
    "🪶",
    "얼굴 클로즈업용 극세선. 이목구비가 뭉치지 않습니다.",
    "선이 얇아 클로즈업에서 눈·입 주변이 검게 메워지지 않습니다. 대신 외곽선 휘도 대비가 작아지므로 " +
      "line.accuracy 를 낮춰(관대하게) 잡거나 exteriorOutlineStrength 를 올려 실루엣을 보강해야 합니다.",
    {
      outline: {
        enabled: true,
        mode: "screenCoordinates",
        screenWidthRatio: 0.0011,
        color: "#2b2b2b",
        lightingMix: 0,
      },
      shading: { enabled: true, shadeColor: "#a6adb6", shadingShift: 0.05, toony: 0.88 },
      rim: { enabled: false },
    },
  ),
  preset(
    "flat-two-tone",
    "플랫 2톤",
    "◧",
    "외곽선 없이 밝음/어둠 두 덩어리로만. 톤(스크린톤) 추출 전용.",
    "아웃라인을 끄고 toony 1 로 완전한 계단을 만들면 화면 휘도가 사실상 두 값만 갖습니다. " +
      "tone.levels 2 로 양자화하면 하프톤 경계가 캐릭터 형태와 정확히 일치해 지저분한 중간 계조가 " +
      "사라집니다. 선은 별도 레이어(깊이 에지 또는 다른 프리셋 패스)로 뽑는 2 패스 워크플로 전제입니다.",
    {
      outline: { enabled: true, mode: "none" },
      shading: { enabled: true, shadeColor: "#8d939c", shadingShift: 0, toony: 1 },
      rim: { enabled: false },
    },
  ),
  preset(
    "deep-shadow",
    "딥 섀도",
    "🌑",
    "그림자를 넓고 진하게. 어두운 분위기·역광 컷용.",
    "shadingShift 를 음수로 내려 그림자 영역을 넓히고 shade 색을 어둡게 잡습니다. 명암 대비가 커서 " +
      "내부 선(터미네이터)이 강하게 잡히지만, tone.levels 를 4 이상으로 올리지 않으면 어두운 쪽이 " +
      "한 단계로 뭉개져 옷 주름 같은 정보가 사라집니다.",
    {
      outline: {
        enabled: true,
        mode: "worldCoordinates",
        worldWidthMeters: 0.004,
        color: "#0d0d0d",
        lightingMix: 0,
      },
      shading: { enabled: true, shadeColor: "#4a4f57", shadingShift: -0.18, toony: 1 },
      rim: { enabled: false },
    },
  ),
  preset(
    "rim-drama",
    "림 드라마",
    "🌗",
    "역광 림 라이트로 실루엣을 띄웁니다. 연출용 — 선화 추출에는 비권장.",
    "경고: 림은 실루엣 **안쪽**에 밝은 띠를 만듭니다. 알파 소벨이 잡는 실루엣 에지 바로 옆에 반대 " +
      "부호의 휘도 계단이 생겨 선이 두 줄로 갈라지고, 띠가 끝나는 자리에 원본 형태에 없는 가짜 내부 " +
      "선이 하나 더 생깁니다. 선 레이어를 끄고 톤/컬러 렌더로만 쓰거나, line.textureLineEnabled 를 " +
      "꺼서 라플라시안이 띠를 잡지 않게 하세요.",
    {
      outline: {
        enabled: true,
        mode: "worldCoordinates",
        worldWidthMeters: 0.0035,
        color: "#101010",
        lightingMix: 0,
      },
      shading: { enabled: true, shadeColor: "#5a6068", shadingShift: -0.08, toony: 0.92 },
      rim: { enabled: true, color: "#ffe6bd", mix: 0.62, fresnelPower: 4.2, lift: 0.05 },
    },
  ),
]);

export const STUDIO_VRM_MTOON_PRESET_IDS: readonly string[] = Object.freeze(
  STUDIO_VRM_MTOON_PRESETS.map((item) => item.id),
);

export function findStudioVrmMtoonPreset(id: unknown): StudioVrmMtoonPreset | null {
  if (typeof id !== "string") return null;
  return STUDIO_VRM_MTOON_PRESETS.find((item) => item.id === id) ?? null;
}

/** 프리셋에서 새 컨트롤 값을 만든다(항상 새 객체 — 프리셋 원본은 공유·불변). */
export function createStudioVrmMtoonControlsFromPreset(id: unknown): StudioVrmMtoonControls {
  return sanitizeStudioVrmMtoonControls(findStudioVrmMtoonPreset(id)?.controls);
}

/** 선화 추출을 목적으로 만든 프리셋인지(= 림이 꺼져 있는지). UI 필터·경고에 쓴다. */
export function isStudioVrmMtoonLineArtPreset(item: StudioVrmMtoonPreset): boolean {
  return !item.controls.rim.enabled;
}
