/**
 * 재질 그룹 파생 — 브러시 서랍 분류의 단일 진실원.
 *
 * 왜 파생인가: 예전에는 id → 미디어 그룹을 손으로 적은 표가 분류를 결정했다. 그 표에는
 * `{base}--{lane}` 엔진 레인 키가 하나도 없어서 71개 레인 전부가 `?? "line"` 폴백으로 떨어졌고
 * (`oil--filbert-ribbon`, `watercolor--granular`, `mypaint-cc0--pastel` 이 모두 "선" 탭에 있었다),
 * 표에 빠진 코어 프리셋 17종도 같은 경로로 잘못 분류됐다. 총 88/330이 엉뚱한 탭에 있었다.
 *
 * 이제 코어는 렌더 계약(`STUDIO_BRUSH_RUNTIME_CONTRACT`)이 이미 선언한 `family`/`tip`에서,
 * 프로 팩은 디스크립터의 `category`/`runtimeBrushId`에서 재질을 계산한다. 두 원본 모두 감사
 * 대상이라(계약이 없는 프리셋은 모듈 로드 시점에 throw) 새 브러시가 조용히 오분류될 수 없다.
 */

import { resolveStudioBrushRuntimeContract } from "./studio-brush-runtime-contract";

import type { StudioBrushRenderFamily } from "../studio-brush";
import type {
  StudioBrushRuntimeContract,
  StudioBrushRuntimeTip,
} from "./studio-brush-runtime-contract";
import type { StudioBrushMaterialGroup } from "./studio-brush-visual";

export type { StudioBrushMaterialGroup };

/** 탭/칩 순서의 기준. 지우개는 재질이지만 페인트 레인에는 탭이 없다(도구 경계). */
export const STUDIO_BRUSH_MATERIAL_GROUPS = [
  "ink",
  "pencil",
  "marker",
  "watercolor",
  "oil",
  "airbrush",
  "pastel",
  "texture",
  "tone",
  "fx",
  "eraser",
] as const satisfies readonly StudioBrushMaterialGroup[];

export const STUDIO_BRUSH_MATERIAL_GROUP_LABELS: Readonly<
  Record<StudioBrushMaterialGroup, string>
> = Object.freeze({
  ink: "펜·잉크",
  pencil: "연필·흑연",
  marker: "마커",
  watercolor: "수채·수묵",
  oil: "유화·아크릴",
  airbrush: "에어브러시",
  pastel: "목탄·파스텔",
  texture: "질감",
  tone: "망점·해칭",
  fx: "빛·효과",
  eraser: "지우개",
});

const MATERIAL_GROUP_SET: ReadonlySet<string> = new Set<string>(STUDIO_BRUSH_MATERIAL_GROUPS);

export function isStudioBrushMaterialGroup(value: unknown): value is StudioBrushMaterialGroup {
  return typeof value === "string" && MATERIAL_GROUP_SET.has(value);
}

/**
 * 렌더 패밀리 → 재질. 패밀리는 "무엇으로 그리는가"를 이미 선언하므로 그대로 재질이 된다.
 * - `brush`(붓 리본)와 `calligraphy`/`perfect`/`gpen` 은 모두 균일한 잉크선이라 잉크로 모은다.
 * - `dry-media`(크레용·초크·목탄)는 파스텔과 같은 "마른 가루" 자국이라 한 탭에 둔다.
 * - `ink-particle`(입자 산란·타일링·대칭 잉크)은 절차적 그레인을 남기므로 질감이다.
 *   대칭·격자·스파이로 같은 "획 모양" 도구(web-mirror-ink, web-grid-ink, sketchpad-tile 등 16종)는
 *   재료가 아니라 도구 옵션에 가깝지만, 지금은 재료 기준으로 자기 자리에 둔다 — 잉크선을 그리는
 *   미러 펜은 잉크고, 절차적 그레인을 흩는 만화경은 질감이다. 이들은 "비슷한 질감이 너무 많다"는
 *   중복군이 아니라 오히려 서로 구별되는 쪽이라, 대체 거처(도구 옵션 패널)가 생기기 전에
 *   목록에서 빼면 기능이 사라진다. 로스터 축소(2단계)에서 다시 판단한다.
 * - `stamp`/`screentone` 은 패밀리만으로 부족해 아래에서 tip 으로 한 번 더 쪼갠다.
 */
const FAMILY_MATERIAL_GROUP: Readonly<
  Record<StudioBrushRenderFamily, StudioBrushMaterialGroup>
> = Object.freeze({
  pen: "ink",
  gpen: "ink",
  calligraphy: "ink",
  perfect: "ink",
  brush: "ink",
  marker: "marker",
  highlighter: "marker",
  neon: "fx",
  glow: "fx",
  glitter: "fx",
  watercolor: "watercolor",
  oil: "oil",
  airbrush: "airbrush",
  pencil: "pencil",
  pastel: "pastel",
  "dry-media": "pastel",
  "ink-particle": "texture",
  screentone: "tone",
  stamp: "ink",
  pixel: "texture",
});

/**
 * 스탬프 엔진은 재료를 tip 이 결정한다. 같은 `stamp-dabs` 엔진이라도 `stamp-wet-edge` 는
 * 수채 번짐을, `stamp-airbrush` 는 소프트 입자를 남긴다.
 */
const STAMP_TIP_MATERIAL_GROUP: Readonly<
  Partial<Record<StudioBrushRuntimeTip, StudioBrushMaterialGroup>>
> = Object.freeze({
  "stamp-ink": "ink",
  "stamp-airbrush": "airbrush",
  "stamp-wet-edge": "watercolor",
  "stamp-pencil": "pencil",
});

export function studioBrushContractMaterialGroup(
  contract: Pick<StudioBrushRuntimeContract, "family" | "tip" | "operation">
): StudioBrushMaterialGroup {
  // 지우개는 재료가 아니라 도구 경계다. 잉크 탭에 지우개가 섞이면 분류가 다시 거짓말을 한다.
  if (contract.operation === "erase") return "eraser";
  if (contract.family === "stamp") {
    return STAMP_TIP_MATERIAL_GROUP[contract.tip] ?? "texture";
  }
  // `screentone` 패밀리에는 진짜 망점 그리드(tone-dot)와 도트 텍스처 스탬프가 함께 있다.
  if (contract.family === "screentone") {
    return contract.tip === "tone-dot" ? "tone" : "texture";
  }
  return FAMILY_MATERIAL_GROUP[contract.family];
}

/**
 * 코어 프리셋·엔진 레인 재질. 계약이 없는 id 는 존재할 수 없지만(로드 시 감사에서 throw),
 * 사용자 저장 문서가 넘겨줄 수 있는 미지의 문자열은 안전 폴백과 같은 잉크로 수렴한다.
 */
export function studioBrushCoreMaterialGroup(brushId: unknown): StudioBrushMaterialGroup {
  const contract = resolveStudioBrushRuntimeContract(brushId);
  return contract ? studioBrushContractMaterialGroup(contract) : "ink";
}
