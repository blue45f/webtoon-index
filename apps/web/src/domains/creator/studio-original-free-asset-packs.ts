/**
 * ToonSpectrum-authored starter assets.
 *
 * Every SVG below is generated from code in this repository. No marketplace thumbnail,
 * product file, texture, model, product name or description is embedded or referenced.
 */
import {
  STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
  type StudioMarketplaceIncludedItem,
  type StudioMarketplaceLicense,
  type StudioMarketplaceOrigin,
  type StudioMarketplacePackage,
  type StudioMarketplacePlacementPreset,
} from "./studio-marketplace-packages";

import type { StudioAsset } from "./studio-asset-library";

const INK = "#211914";
const PAPER = "#f5efe4";
const LINE = "#4b3c31";
const ACCENT = "#ed7541";
const COOL = "#72b8c8";
const GOOD = "#72b985";
const WARN = "#e5bd54";
const PINK = "#dd8eaa";
const NIGHT = "#272836";

export const STUDIO_ORIGINAL_FREE_ASSET_LICENSE: StudioMarketplaceLicense =
  Object.freeze({
    id: "cc0-1.0",
    label: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    derivativesAllowed: true,
    redistributionAllowed: true,
    sourceVerifiedAt: "2026-07-26",
    summary: "ToonSpectrum이 직접 제작해 CC0로 제공하는 원본입니다. 상업 작품 사용·수정·재배포가 가능합니다.",
  });

export type StudioOriginalFreeAssetCategory =
  | "modern-background"
  | "daily-prop"
  | "atmosphere-fx"
  | "genre-prop";

export interface StudioOriginalFreeAsset extends StudioMarketplaceIncludedItem {
  readonly packageId: string;
  readonly category: StudioOriginalFreeAssetCategory;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
  readonly origin: Extract<StudioMarketplaceOrigin, "original-procedural">;
  readonly license: typeof STUDIO_ORIGINAL_FREE_ASSET_LICENSE;
  readonly placementPresets: readonly StudioMarketplacePlacementPreset[];
}

export interface StudioOriginalFreeAssetPackage extends StudioMarketplacePackage {
  readonly includedItems: readonly StudioOriginalFreeAsset[];
}

function wrapSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">${body}</svg>`;
}

function originalAsset(
  packageId: string,
  id: string,
  name: string,
  category: StudioOriginalFreeAssetCategory,
  tags: readonly string[],
  width: number,
  height: number,
  body: string,
  placementPresets: readonly StudioMarketplacePlacementPreset[]
): StudioOriginalFreeAsset {
  return Object.freeze({
    id,
    name,
    kind: "vector-asset",
    format: "image/svg+xml",
    contentFingerprint: `original-svg:v1:${id}`,
    tags,
    packageId,
    category,
    width,
    height,
    svg: wrapSvg(width, height, body),
    origin: "original-procedural",
    license: STUDIO_ORIGINAL_FREE_ASSET_LICENSE,
    placementPresets,
  });
}

function roomShell(accent: string, body: string): string {
  return (
    `<rect width="360" height="240" rx="12" fill="${PAPER}"/>`
    + `<path d="M22 196 L180 108 L338 196 L180 230 Z" fill="${accent}" opacity=".18"/>`
    + `<path d="M22 44 V196 L180 108 L338 196 V44" fill="none" stroke="${LINE}" stroke-width="5" stroke-linejoin="round"/>`
    + `<path d="M22 44 L180 132 L338 44" fill="none" stroke="${LINE}" stroke-width="5"/>`
    + body
  );
}

function dots(
  count: number,
  width: number,
  height: number,
  color: string,
  radius: (index: number) => number
): string {
  return Array.from({ length: count }, (_, index) => {
    const x = 12 + ((index * 67) % Math.max(12, width - 24));
    const y = 12 + ((index * 43) % Math.max(12, height - 24));
    return `<circle cx="${x}" cy="${y}" r="${radius(index)}" fill="${color}" opacity="${(0.35 + (index % 5) * 0.11).toFixed(2)}"/>`;
  }).join("");
}

const EVERYDAY_PACKAGE_ID = "original-everyday-spaces";
const EVERYDAY_ASSETS: readonly StudioOriginalFreeAsset[] = Object.freeze([
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-compact-studio-room",
    "컴팩트 작업실",
    "modern-background",
    ["원룸", "작업실", "책상", "일상", "실내"],
    360,
    240,
    roomShell(
      ACCENT,
      `<rect x="52" y="105" width="82" height="54" rx="5" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M58 159 V184 M128 159 V184" stroke="${INK}" stroke-width="5"/>`
      + `<rect x="218" y="104" width="86" height="60" rx="6" fill="${PINK}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M218 132 H304 M235 164 V188 M288 164 V188" stroke="${INK}" stroke-width="4"/>`
      + `<rect x="138" y="55" width="72" height="48" rx="4" fill="${WARN}" stroke="${INK}" stroke-width="4"/>`
      + `<circle cx="323" cy="140" r="17" fill="${GOOD}" stroke="${INK}" stroke-width="4"/><path d="M323 157 V187" stroke="${INK}" stroke-width="5"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-sunlit-classroom",
    "햇살 교실",
    "modern-background",
    ["학교", "교실", "책상", "학원", "배경"],
    360,
    240,
    roomShell(
      WARN,
      `<rect x="52" y="62" width="72" height="58" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M88 62 V120 M52 91 H124 M124 62 L176 126" stroke="${PAPER}" stroke-width="4" opacity=".85"/>`
      + Array.from({ length: 6 }, (_, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = 86 + col * 72 + row * 12;
        const y = 140 + row * 44;
        return `<g><path d="M${x} ${y} h45 l12 8 h-45 z" fill="${WARN}" stroke="${INK}" stroke-width="3"/><path d="M${x + 6} ${y + 7} v24 M${x + 43} ${y + 10} v22" stroke="${INK}" stroke-width="3"/></g>`;
      }).join("")
      + `<rect x="226" y="57" width="86" height="50" rx="3" fill="${GOOD}" stroke="${INK}" stroke-width="4"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-cafe-window-corner",
    "창가 카페 코너",
    "modern-background",
    ["카페", "창가", "데이트", "테이블", "실내"],
    360,
    240,
    roomShell(
      PINK,
      `<rect x="48" y="54" width="112" height="74" rx="4" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M104 54 V128 M48 92 H160" stroke="${PAPER}" stroke-width="4"/>`
      + `<ellipse cx="190" cy="157" rx="60" ry="25" fill="${ACCENT}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M190 179 V210 M153 157 V196 M227 157 V196" stroke="${INK}" stroke-width="5"/>`
      + `<path d="M280 117 q18 -24 36 0 v47 h-36 z" fill="${GOOD}" stroke="${INK}" stroke-width="4"/>`
      + `<circle cx="298" cy="99" r="22" fill="${GOOD}" stroke="${INK}" stroke-width="4"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-small-meeting-room",
    "소형 회의실",
    "modern-background",
    ["회사", "회의", "사무실", "테이블", "배경"],
    360,
    240,
    roomShell(
      COOL,
      `<path d="M94 142 l92 -36 82 43 -92 42 z" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M115 153 V196 M245 156 V196" stroke="${INK}" stroke-width="5"/>`
      + Array.from({ length: 4 }, (_, index) => {
        const x = 92 + index * 54;
        return `<rect x="${x}" y="${175 - (index % 2) * 30}" width="34" height="40" rx="8" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>`;
      }).join("")
      + `<rect x="224" y="56" width="88" height="54" rx="4" fill="${NIGHT}" stroke="${INK}" stroke-width="4"/><path d="M242 92 l18 -16 16 10 18 -20" fill="none" stroke="${GOOD}" stroke-width="4"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-clinic-waiting-room",
    "작은 병원 대기실",
    "modern-background",
    ["병원", "대기실", "의자", "의료", "실내"],
    360,
    240,
    roomShell(
      GOOD,
      `<rect x="56" y="127" width="146" height="45" rx="10" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M91 127 V172 M128 127 V172 M165 127 V172 M68 172 V196 M190 172 V196" stroke="${INK}" stroke-width="4"/>`
      + `<rect x="232" y="61" width="72" height="66" rx="5" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M268 76 V112 M250 94 H286" stroke="${ACCENT}" stroke-width="10" stroke-linecap="round"/>`
      + `<rect x="236" y="150" width="64" height="36" rx="5" fill="${GOOD}" stroke="${INK}" stroke-width="4"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-convenience-counter",
    "편의점 계산대",
    "modern-background",
    ["편의점", "상점", "계산대", "일상", "배경"],
    360,
    240,
    roomShell(
      WARN,
      `<rect x="44" y="65" width="92" height="94" rx="4" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M44 96 H136 M44 127 H136 M75 65 V159 M106 65 V159" stroke="${LINE}" stroke-width="3"/>`
      + `<path d="M154 154 l150 -28 20 52 -150 32 z" fill="${ACCENT}" stroke="${INK}" stroke-width="4"/>`
      + `<rect x="236" y="108" width="48" height="34" rx="4" fill="${NIGHT}" stroke="${INK}" stroke-width="4"/>`
      + `<path d="M250 119 h20 M250 128 h14" stroke="${GOOD}" stroke-width="3"/>`
    ),
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-subway-platform",
    "지하철 플랫폼",
    "modern-background",
    ["지하철", "역", "플랫폼", "도시", "교통"],
    360,
    240,
    `<rect width="360" height="240" rx="12" fill="${NIGHT}"/>`
    + `<rect x="20" y="34" width="320" height="120" rx="8" fill="${COOL}" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M20 118 H340 M90 34 V154 M180 34 V154 M270 34 V154" stroke="${PAPER}" stroke-width="4"/>`
    + `<path d="M20 174 H340 L310 226 H48 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M54 197 H318" stroke="${WARN}" stroke-width="10" stroke-dasharray="22 9"/>`
    + `<rect x="122" y="52" width="116" height="28" rx="14" fill="${INK}"/><circle cx="142" cy="66" r="8" fill="${GOOD}"/><path d="M160 66 H218" stroke="${PAPER}" stroke-width="5"/>`,
    ["background-cover", "current-view"]
  ),
  originalAsset(
    EVERYDAY_PACKAGE_ID,
    "original-rooftop-greenhouse",
    "옥상 온실",
    "modern-background",
    ["옥상", "온실", "도시", "정원", "배경"],
    360,
    240,
    `<rect width="360" height="240" rx="12" fill="${COOL}"/>`
    + `<path d="M0 128 L58 94 L112 120 L170 70 L226 116 L284 82 L360 128 V240 H0 Z" fill="${NIGHT}" opacity=".9"/>`
    + `<path d="M42 202 L180 130 L318 202 L180 232 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M112 192 V122 L180 84 L248 122 V192 Z" fill="${COOL}" fill-opacity=".35" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M112 122 L180 158 L248 122 M180 84 V192 M132 174 h96" fill="none" stroke="${PAPER}" stroke-width="4"/>`
    + `<circle cx="80" cy="178" r="22" fill="${GOOD}" stroke="${INK}" stroke-width="4"/><circle cx="280" cy="180" r="20" fill="${GOOD}" stroke="${INK}" stroke-width="4"/>`,
    ["background-cover", "current-view"]
  ),
]);

const DAILY_PROPS_PACKAGE_ID = "original-daily-props";
const DAILY_PROP_ASSETS: readonly StudioOriginalFreeAsset[] = Object.freeze([
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-folding-umbrella",
    "접이식 우산",
    "daily-prop",
    ["우산", "비", "소품", "일상"],
    220,
    220,
    `<rect width="220" height="220" fill="${PAPER}"/><path d="M28 104 Q110 24 192 104 Q172 92 151 104 Q130 88 110 104 Q88 88 68 104 Q48 91 28 104 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M110 104 V180 q0 25 24 25 q20 0 20 -18" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M110 38 V104" stroke="${PAPER}" stroke-width="5"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-city-bicycle",
    "도시 자전거",
    "daily-prop",
    ["자전거", "교통", "거리", "소품"],
    300,
    210,
    `<rect width="300" height="210" fill="${PAPER}"/><circle cx="70" cy="144" r="48" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="230" cy="144" r="48" fill="none" stroke="${INK}" stroke-width="8"/><path d="M70 144 L126 82 L166 144 H70 L118 144 L145 54 M126 82 H196 L230 144 M134 54 H164 M190 72 H218" fill="none" stroke="${ACCENT}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="166" cy="144" r="10" fill="${WARN}" stroke="${INK}" stroke-width="5"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-delivery-box-stack",
    "택배 상자 더미",
    "daily-prop",
    ["택배", "상자", "박스", "이사", "소품"],
    260,
    220,
    `<rect width="260" height="220" fill="${PAPER}"/><path d="M26 118 L102 88 L174 118 L98 152 Z" fill="${WARN}" stroke="${INK}" stroke-width="5"/><path d="M26 118 V176 L98 210 V152 M174 118 V176 L98 210" fill="${WARN}" stroke="${INK}" stroke-width="5"/><path d="M92 54 L148 32 L230 70 L170 96 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="5"/><path d="M92 54 V106 L170 142 V96 M230 70 V118 L170 142" fill="${ACCENT}" stroke="${INK}" stroke-width="5"/><path d="M132 45 L210 82 M63 104 L136 137" stroke="${PAPER}" stroke-width="7"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-cafe-tray-set",
    "카페 트레이 세트",
    "daily-prop",
    ["카페", "커피", "디저트", "트레이", "소품"],
    280,
    200,
    `<rect width="280" height="200" fill="${PAPER}"/><ellipse cx="140" cy="142" rx="116" ry="40" fill="${LINE}" stroke="${INK}" stroke-width="6"/><ellipse cx="90" cy="112" rx="38" ry="16" fill="${PAPER}" stroke="${INK}" stroke-width="5"/><path d="M58 72 H122 L114 112 Q90 128 66 112 Z" fill="${COOL}" stroke="${INK}" stroke-width="5"/><path d="M122 82 q28 0 19 25 q-7 15 -25 6" fill="none" stroke="${INK}" stroke-width="6"/><path d="M163 122 l42 -34 38 45 z" fill="${PINK}" stroke="${INK}" stroke-width="5"/><circle cx="202" cy="112" r="6" fill="${ACCENT}"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-phone-earbuds",
    "휴대폰과 이어버드",
    "daily-prop",
    ["휴대폰", "스마트폰", "이어폰", "전자기기", "소품"],
    240,
    220,
    `<rect width="240" height="220" fill="${PAPER}"/><rect x="52" y="24" width="104" height="174" rx="20" fill="${NIGHT}" stroke="${INK}" stroke-width="7"/><rect x="63" y="43" width="82" height="125" rx="10" fill="${COOL}"/><path d="M86 33 H122" stroke="${PAPER}" stroke-width="5" stroke-linecap="round"/><circle cx="104" cy="182" r="8" fill="${PAPER}"/><path d="M184 70 q28 0 22 28 q-3 18 -20 18 q-15 0 -15 -17 V82 q0 -12 13 -12 Z M184 116 v42" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-school-backpack",
    "스쿨 백팩",
    "daily-prop",
    ["가방", "백팩", "학교", "학생", "소품"],
    220,
    240,
    `<rect width="220" height="240" fill="${PAPER}"/><path d="M68 64 q0 -42 42 -42 q42 0 42 42" fill="none" stroke="${INK}" stroke-width="10"/><path d="M48 78 Q110 42 172 78 V204 H48 Z" fill="${COOL}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M66 132 H154 V188 H66 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="6"/><path d="M48 96 L26 188 M172 96 L194 188" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M87 88 H133" stroke="${PAPER}" stroke-width="7"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-adjustable-desk-lamp",
    "관절 데스크 램프",
    "daily-prop",
    ["램프", "조명", "책상", "작업실", "소품"],
    240,
    220,
    `<rect width="240" height="220" fill="${PAPER}"/><ellipse cx="120" cy="194" rx="70" ry="20" fill="${NIGHT}" stroke="${INK}" stroke-width="6"/><path d="M120 180 L86 114 L142 66" fill="none" stroke="${LINE}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="86" cy="114" r="13" fill="${ACCENT}" stroke="${INK}" stroke-width="5"/><path d="M130 50 q52 -34 76 18 l-66 40 q-26 -20 -10 -58 Z" fill="${WARN}" stroke="${INK}" stroke-width="6"/><path d="M148 89 L100 150" stroke="${WARN}" stroke-width="18" opacity=".28"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    DAILY_PROPS_PACKAGE_ID,
    "original-indoor-planter",
    "실내 화분",
    "daily-prop",
    ["화분", "식물", "인테리어", "자연", "소품"],
    220,
    240,
    `<rect width="220" height="240" fill="${PAPER}"/><path d="M66 142 H154 L142 218 H78 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="7"/><path d="M110 144 V72 M110 112 Q68 98 62 54 Q104 52 110 92 M111 120 Q154 108 164 66 Q120 62 111 98 M110 82 Q92 60 108 20 Q134 48 110 82" fill="${GOOD}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M76 166 H144" stroke="${PAPER}" stroke-width="6"/>`,
    ["pointer", "current-view"]
  ),
]);

const ATMOSPHERE_PACKAGE_ID = "original-atmosphere-overlays";
const ATMOSPHERE_ASSETS: readonly StudioOriginalFreeAsset[] = Object.freeze([
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-rain-pane-overlay",
    "유리창 빗방울",
    "atmosphere-fx",
    ["비", "유리", "빗방울", "날씨", "오버레이"],
    360,
    240,
    `<rect width="360" height="240" fill="${COOL}" opacity=".12"/>`
    + Array.from({ length: 24 }, (_, index) => {
      const x = 10 + ((index * 73) % 344);
      const y = 8 + ((index * 47) % 198);
      const length = 18 + (index % 5) * 8;
      return `<path d="M${x} ${y} l-${6 + (index % 3) * 2} ${length}" stroke="${COOL}" stroke-width="${2 + (index % 3)}" stroke-linecap="round" opacity="${0.45 + (index % 4) * 0.12}"/>`;
    }).join(""),
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-soft-snow-overlay",
    "포근한 눈발",
    "atmosphere-fx",
    ["눈", "겨울", "날씨", "입자", "오버레이"],
    360,
    240,
    dots(44, 360, 240, PAPER, (index) => 2 + (index % 5)),
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-layered-fog-overlay",
    "겹 안개",
    "atmosphere-fx",
    ["안개", "공포", "새벽", "분위기", "오버레이"],
    360,
    240,
    `<path d="M-20 78 Q60 24 146 74 T380 64 V122 Q282 160 188 116 T-20 130 Z" fill="${PAPER}" opacity=".46"/><path d="M-24 142 Q68 92 160 146 T384 132 V198 Q276 220 188 184 T-24 204 Z" fill="${COOL}" opacity=".28"/><path d="M-20 30 Q86 -12 164 36 T380 24" fill="none" stroke="${PAPER}" stroke-width="28" stroke-linecap="round" opacity=".22"/>`,
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-window-sun-rays",
    "창문 햇살",
    "atmosphere-fx",
    ["햇살", "빛", "창문", "로맨스", "오버레이"],
    360,
    240,
    `<path d="M18 12 L142 12 L322 240 L186 240 Z" fill="${WARN}" opacity=".28"/><path d="M154 12 H222 L358 186 V240 H330 Z" fill="${WARN}" opacity=".18"/><path d="M18 12 H142 M154 12 H222" stroke="${PAPER}" stroke-width="5" opacity=".7"/>`,
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-night-bokeh",
    "야간 보케",
    "atmosphere-fx",
    ["보케", "야경", "빛망울", "로맨스", "오버레이"],
    360,
    240,
    `<rect width="360" height="240" fill="${NIGHT}" opacity=".18"/>${dots(28, 360, 240, WARN, (index) => 5 + (index % 6) * 2)}${dots(14, 360, 240, PINK, (index) => 3 + (index % 4) * 2)}`,
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-spring-petals",
    "봄날 꽃잎",
    "atmosphere-fx",
    ["꽃잎", "봄", "로맨스", "바람", "오버레이"],
    360,
    240,
    Array.from({ length: 28 }, (_, index) => {
      const x = 8 + ((index * 71) % 344);
      const y = 8 + ((index * 53) % 224);
      const rotation = (index * 37) % 180;
      return `<ellipse cx="${x}" cy="${y}" rx="${4 + (index % 4)}" ry="${8 + (index % 3)}" fill="${PINK}" stroke="${INK}" stroke-width="1.5" opacity="${0.5 + (index % 5) * 0.1}" transform="rotate(${rotation} ${x} ${y})"/>`;
    }).join(""),
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-autumn-leaves",
    "가을 낙엽",
    "atmosphere-fx",
    ["낙엽", "가을", "바람", "거리", "오버레이"],
    360,
    240,
    Array.from({ length: 24 }, (_, index) => {
      const x = 10 + ((index * 79) % 340);
      const y = 10 + ((index * 41) % 220);
      const rotation = (index * 43) % 180;
      const fill = index % 2 ? ACCENT : WARN;
      return `<path d="M${x} ${y} q12 -12 21 0 q-9 15 -21 0 Z" fill="${fill}" stroke="${INK}" stroke-width="1.5" opacity=".82" transform="rotate(${rotation} ${x} ${y})"/>`;
    }).join(""),
    ["background-cover", "pointer"]
  ),
  originalAsset(
    ATMOSPHERE_PACKAGE_ID,
    "original-golden-dust",
    "금빛 먼지",
    "atmosphere-fx",
    ["먼지", "빛", "마법", "입자", "오버레이"],
    360,
    240,
    dots(54, 360, 240, WARN, (index) => 1 + (index % 4))
    + Array.from({ length: 10 }, (_, index) => {
      const x = 18 + ((index * 101) % 324);
      const y = 18 + ((index * 59) % 204);
      return `<path d="M${x} ${y - 9} L${x + 3} ${y - 3} L${x + 9} ${y} L${x + 3} ${y + 3} L${x} ${y + 9} L${x - 3} ${y + 3} L${x - 9} ${y} L${x - 3} ${y - 3} Z" fill="${PAPER}" opacity=".8"/>`;
    }).join(""),
    ["background-cover", "pointer"]
  ),
]);

const GENRE_PACKAGE_ID = "original-genre-props";
const GENRE_ASSETS: readonly StudioOriginalFreeAsset[] = Object.freeze([
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-arcane-gateway",
    "원형 마법 관문",
    "genre-prop",
    ["판타지", "마법", "관문", "포털", "소품"],
    260,
    260,
    `<rect width="260" height="260" fill="${NIGHT}"/><circle cx="130" cy="130" r="96" fill="none" stroke="${COOL}" stroke-width="8"/><circle cx="130" cy="130" r="72" fill="none" stroke="${WARN}" stroke-width="4" stroke-dasharray="12 10"/><path d="M130 38 L154 90 L212 72 L174 118 L224 148 L164 146 L176 208 L132 164 L88 212 L98 150 L38 150 L88 118 L48 76 L106 92 Z" fill="none" stroke="${PINK}" stroke-width="4" opacity=".85"/><circle cx="130" cy="130" r="32" fill="${COOL}" opacity=".28"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-potion-shelf",
    "연금술 물약 선반",
    "genre-prop",
    ["판타지", "연금술", "물약", "선반", "소품"],
    300,
    230,
    `<rect width="300" height="230" fill="${PAPER}"/><path d="M26 36 H274 V206 H26 Z M26 112 H274" fill="none" stroke="${INK}" stroke-width="8"/>`
    + Array.from({ length: 8 }, (_, index) => {
      const x = 50 + (index % 4) * 62;
      const y = index < 4 ? 60 : 138;
      const fill = [COOL, PINK, GOOD, WARN][index % 4];
      return `<g><path d="M${x} ${y} h24 v14 q18 8 14 37 q-2 18 -26 18 q-24 0 -26 -18 q-4 -29 14 -37 Z" fill="${fill}" stroke="${INK}" stroke-width="4"/><path d="M${x + 3} ${y - 8} h18 v12 h-18 z" fill="${LINE}"/></g>`;
    }).join(""),
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-crystal-cluster",
    "빛나는 수정 군락",
    "genre-prop",
    ["판타지", "수정", "광물", "동굴", "소품"],
    260,
    230,
    `<rect width="260" height="230" fill="${NIGHT}"/><path d="M28 204 L78 172 L112 184 L154 160 L232 202 Z" fill="${LINE}" stroke="${INK}" stroke-width="6"/><path d="M54 170 L82 76 L116 170 L82 194 Z" fill="${COOL}" stroke="${INK}" stroke-width="5"/><path d="M104 182 L138 38 L176 174 L140 204 Z" fill="${PINK}" stroke="${INK}" stroke-width="5"/><path d="M166 176 L196 92 L226 186 L196 204 Z" fill="${WARN}" stroke="${INK}" stroke-width="5"/><path d="M82 76 L82 175 M138 38 L140 184 M196 92 L196 188" stroke="${PAPER}" stroke-width="4" opacity=".65"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-small-treasure-chest",
    "탐험가 보물 상자",
    "genre-prop",
    ["판타지", "보물", "상자", "모험", "소품"],
    280,
    220,
    `<rect width="280" height="220" fill="${PAPER}"/><path d="M38 96 Q140 24 242 96 V190 H38 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="8"/><path d="M38 104 H242 M86 68 V190 M194 68 V190" fill="none" stroke="${WARN}" stroke-width="10"/><rect x="120" y="118" width="40" height="54" rx="5" fill="${WARN}" stroke="${INK}" stroke-width="6"/><circle cx="140" cy="139" r="7" fill="${INK}"/><path d="M140 146 V160" stroke="${INK}" stroke-width="5"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-sci-fi-airlock",
    "SF 에어록 도어",
    "genre-prop",
    ["SF", "문", "우주선", "연구소", "소품"],
    280,
    260,
    `<rect width="280" height="260" fill="${NIGHT}"/><path d="M42 28 H238 L264 54 V232 H16 V54 Z" fill="${LINE}" stroke="${INK}" stroke-width="7"/><path d="M72 54 H208 L228 76 V232 H52 V76 Z" fill="${COOL}" fill-opacity=".32" stroke="${PAPER}" stroke-width="5"/><path d="M140 54 V232 M64 180 H216" stroke="${PAPER}" stroke-width="4" opacity=".55"/><rect x="184" y="100" width="30" height="50" rx="4" fill="${INK}" stroke="${GOOD}" stroke-width="4"/><circle cx="199" cy="116" r="6" fill="${GOOD}"/><path d="M190 134 H208" stroke="${COOL}" stroke-width="4"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-hologram-dashboard",
    "홀로그램 대시보드",
    "genre-prop",
    ["SF", "홀로그램", "UI", "상태창", "소품"],
    320,
    220,
    `<rect width="320" height="220" fill="${NIGHT}"/><path d="M24 32 H296 V188 H24 Z" fill="${COOL}" fill-opacity=".14" stroke="${COOL}" stroke-width="5"/><circle cx="92" cy="110" r="48" fill="none" stroke="${GOOD}" stroke-width="5" stroke-dasharray="14 7"/><circle cx="92" cy="110" r="22" fill="${GOOD}" opacity=".35"/><path d="M166 64 H272 M166 90 H250 M166 116 H282 M166 142 H232" stroke="${PAPER}" stroke-width="7" stroke-linecap="round" opacity=".7"/><path d="M38 48 h30 M252 172 h30" stroke="${ACCENT}" stroke-width="5"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-energy-core",
    "동력 코어",
    "genre-prop",
    ["SF", "에너지", "코어", "기계", "소품"],
    260,
    260,
    `<rect width="260" height="260" fill="${NIGHT}"/><circle cx="130" cy="130" r="92" fill="${LINE}" stroke="${PAPER}" stroke-width="6"/><path d="M130 24 V66 M130 194 V236 M24 130 H66 M194 130 H236 M54 54 L84 84 M176 176 L206 206 M206 54 L176 84 M84 176 L54 206" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round"/><circle cx="130" cy="130" r="58" fill="${COOL}" fill-opacity=".22" stroke="${COOL}" stroke-width="8"/><path d="M130 78 L172 104 L160 156 L112 178 L82 134 L96 92 Z" fill="${WARN}" fill-opacity=".5" stroke="${PAPER}" stroke-width="5"/>`,
    ["pointer", "current-view"]
  ),
  originalAsset(
    GENRE_PACKAGE_ID,
    "original-adventure-map",
    "탐험 지도",
    "genre-prop",
    ["판타지", "지도", "모험", "퀘스트", "소품"],
    300,
    220,
    `<rect width="300" height="220" fill="${PAPER}"/><path d="M28 38 Q72 18 112 42 Q158 16 198 42 Q244 18 274 40 L264 188 Q220 206 184 182 Q140 208 102 184 Q56 208 34 184 Z" fill="${WARN}" fill-opacity=".52" stroke="${INK}" stroke-width="6"/><path d="M64 72 q28 22 8 48 t34 40 q30 -26 48 -4 t52 -32 q-16 -24 16 -48" fill="none" stroke="${LINE}" stroke-width="5" stroke-dasharray="9 7"/><path d="M214 78 l22 22 m0 -22 l-22 22" stroke="${ACCENT}" stroke-width="8" stroke-linecap="round"/><path d="M118 62 l20 12 -20 12 z" fill="${GOOD}" stroke="${INK}" stroke-width="4"/><circle cx="78" cy="146" r="12" fill="${COOL}" stroke="${INK}" stroke-width="4"/>`,
    ["pointer", "current-view"]
  ),
]);

function originalPackage(input: {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags: readonly string[];
  includedItems: readonly StudioOriginalFreeAsset[];
  version: string;
  changes: readonly string[];
}): StudioOriginalFreeAssetPackage {
  return Object.freeze({
    schema: STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
    id: input.id,
    name: input.name,
    summary: input.summary,
    category: input.category,
    tags: input.tags,
    kind: "vector-asset",
    access: "free",
    accessLabel: "무료",
    origin: "original-procedural",
    creator: {
      id: "toonspectrum-lab",
      name: "ToonSpectrum Lab",
      verified: true,
    },
    version: input.version,
    packageFingerprint: `original-pack:v1:${input.id}:${input.version}`,
    compatibility: {
      studioVersion: ">=1.0.0",
      renderer: ["canvas2d", "svg"] as const,
      devices: ["desktop", "tablet", "mobile"] as const,
      formats: ["image/svg+xml"],
    },
    license: STUDIO_ORIGINAL_FREE_ASSET_LICENSE,
    includedItems: input.includedItems,
    changelog: [{
      version: input.version,
      releasedAt: "2026-07-26",
      changes: input.changes,
    }],
    placementPresets: ["current-view", "pointer"] as const,
    availability: {
      catalog: "bundled",
      library: "local-only",
      payment: "unavailable",
      cloudSync: "unavailable",
      exportManifest: "local-only",
    } as const,
    updatedAt: "2026-07-26T00:00:00.000Z",
  });
}

const ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES: readonly StudioOriginalFreeAssetPackage[] =
  Object.freeze([
    originalPackage({
      id: EVERYDAY_PACKAGE_ID,
      name: "일상 공간 블록아웃",
      summary: "학교·회사·카페·병원·교통 장면을 빠르게 잡는 독자 제작 벡터 배경입니다.",
      category: "현대 배경",
      tags: ["현대", "실내", "도시", "학교", "회사", "카페"],
      includedItems: EVERYDAY_ASSETS,
      version: "1.0.0",
      changes: ["8개 일상 공간 원본 추가", "모바일·SVG 내보내기 호환"],
    }),
    originalPackage({
      id: DAILY_PROPS_PACKAGE_ID,
      name: "매일 쓰는 생활 소품",
      summary: "거리와 실내 장면에 바로 놓는 일상 소품 8종입니다.",
      category: "생활 소품",
      tags: ["일상", "소품", "학교", "거리", "인테리어"],
      includedItems: DAILY_PROP_ASSETS,
      version: "1.0.0",
      changes: ["8개 생활 소품 원본 추가", "드래그 포인터 배치 지원"],
    }),
    originalPackage({
      id: ATMOSPHERE_PACKAGE_ID,
      name: "날씨와 감정 오버레이",
      summary: "비·눈·안개·햇살·보케·계절 입자로 컷의 분위기를 만드는 오버레이입니다.",
      category: "자연·효과",
      tags: ["날씨", "오버레이", "입자", "로맨스", "공포"],
      includedItems: ATMOSPHERE_ASSETS,
      version: "1.0.0",
      changes: ["8개 투명 분위기 효과 추가", "배경 덮기 권장 프리셋 표기"],
    }),
    originalPackage({
      id: GENRE_PACKAGE_ID,
      name: "판타지·SF 장르 소품",
      summary: "판타지와 SF 컷에 범용적으로 쓰는 관문·물약·기계·지도 원본입니다.",
      category: "장르 소품",
      tags: ["판타지", "SF", "마법", "기계", "모험"],
      includedItems: GENRE_ASSETS,
      version: "1.0.0",
      changes: ["8개 장르 소품 원본 추가", "CC0 라이선스 명세 포함"],
    }),
  ]);

/** Blockout-only backgrounds are retained for old works, not advertised as finished art. */
export const STUDIO_RETIRED_ORIGINAL_FREE_ASSETS = Object.freeze([...EVERYDAY_ASSETS]);

export const STUDIO_ORIGINAL_FREE_ASSET_PACKAGES: readonly StudioOriginalFreeAssetPackage[] =
  Object.freeze(ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.filter((pkg) => pkg.id !== EVERYDAY_PACKAGE_ID));

const ALL_STUDIO_ORIGINAL_FREE_ASSETS = Object.freeze(
  ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.flatMap((pkg) => pkg.includedItems)
);

export const STUDIO_ORIGINAL_FREE_ASSETS: readonly StudioOriginalFreeAsset[] =
  Object.freeze(
    STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.flatMap((pkg) => pkg.includedItems)
  );

export function encodeStudioOriginalAssetSvg(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createStudioOriginalFreeAssetRecord(
  asset: StudioOriginalFreeAsset
): StudioAsset {
  return {
    id: `starter:${asset.id}`,
    name: asset.name,
    dataUrl: encodeStudioOriginalAssetSvg(asset.svg),
    width: asset.width,
    height: asset.height,
    createdAt: Date.UTC(2026, 6, 27),
    kind: "original-procedural",
  };
}

export function findStudioOriginalFreeAsset(
  assetId: unknown
): StudioOriginalFreeAsset | null {
  if (typeof assetId !== "string") return null;
  return ALL_STUDIO_ORIGINAL_FREE_ASSETS.find((asset) => asset.id === assetId) ?? null;
}

export function findStudioOriginalFreeAssetPackage(
  packageId: unknown
): StudioOriginalFreeAssetPackage | null {
  if (typeof packageId !== "string") return null;
  return ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.find((pkg) => pkg.id === packageId) ?? null;
}

export function filterStudioOriginalFreeAssets(input: {
  readonly query?: string;
  readonly packageIds?: readonly string[];
  readonly categories?: readonly StudioOriginalFreeAssetCategory[];
} = {}): StudioOriginalFreeAsset[] {
  const query = input.query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const packageIds = new Set(input.packageIds ?? []);
  const categories = new Set(input.categories ?? []);
  return STUDIO_ORIGINAL_FREE_ASSETS.filter((asset) => {
    if (packageIds.size > 0 && !packageIds.has(asset.packageId)) return false;
    if (categories.size > 0 && !categories.has(asset.category)) return false;
    if (!query) return true;
    return [asset.name, asset.category, ...asset.tags]
      .join("\n")
      .toLocaleLowerCase("ko-KR")
      .includes(query);
  });
}
