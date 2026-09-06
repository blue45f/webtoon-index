/**
 * Studio Elements catalog — PicsArt/Canva-class placeable vectors.
 * Geometric shapes, frames, badges, arrows (standalone SVG, no external assets).
 * Stickers/FX remain in existing modules; this catalog is the "Shapes & Decor" tier.
 */

import {
  STUDIO_ELEMENT_ASSET_PACK_ITEMS,
  type StudioElementAssetPackCategory,
} from "./studio-element-asset-packs";

export type StudioElementCategory =
  | "shape"
  | "frame"
  | "arrow"
  | "badge"
  | "line"
  | "decor"
  | StudioElementAssetPackCategory;

export interface StudioElementItem {
  id: string;
  label: string;
  category: StudioElementCategory;
  keywords: readonly string[];
  width: number;
  height: number;
  svg: string;
}

const INK = "#16100c";
const FILL = "#f4efe6";
const ACCENT = "#e86a33";

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function item(
  id: string,
  label: string,
  category: StudioElementCategory,
  keywords: string[],
  w: number,
  h: number,
  body: string
): StudioElementItem {
  return { id, label, category, keywords, width: w, height: h, svg: svg(w, h, body) };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const STUDIO_ELEMENT_ITEMS: readonly StudioElementItem[] = Object.freeze([
  // —— Shapes ——
  item("shape-rect", "사각형", "shape", ["네모", "rect", "box"], 240, 180,
    `<rect x="12" y="12" width="216" height="156" rx="8" fill="${FILL}" stroke="${INK}" stroke-width="8"/>`),
  item("shape-round-rect", "둥근 사각형", "shape", ["라운드", "rounded"], 240, 180,
    `<rect x="12" y="12" width="216" height="156" rx="36" fill="${FILL}" stroke="${INK}" stroke-width="8"/>`),
  item("shape-circle", "원", "shape", ["동그라미", "circle"], 220, 220,
    `<circle cx="110" cy="110" r="92" fill="${FILL}" stroke="${INK}" stroke-width="8"/>`),
  item("shape-ellipse", "타원", "shape", ["oval", "ellipse"], 260, 160,
    `<ellipse cx="130" cy="80" rx="112" ry="62" fill="${FILL}" stroke="${INK}" stroke-width="8"/>`),
  item("shape-triangle", "삼각형", "shape", ["triangle"], 220, 200,
    `<polygon points="110,18 202,182 18,182" fill="${FILL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  item("shape-diamond", "다이아", "shape", ["마름모", "diamond"], 200, 220,
    `<polygon points="100,14 186,110 100,206 14,110" fill="${FILL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  item("shape-hex", "육각형", "shape", ["hexagon"], 220, 200,
    `<polygon points="60,18 160,18 202,100 160,182 60,182 18,100" fill="${FILL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  item("shape-star", "별", "shape", ["star", "별점"], 220, 220,
    (() => {
      const cx = 110;
      const cy = 110;
      const spikes = 5;
      const rOut = 92;
      const rIn = 40;
      const pts: string[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? rOut : rIn;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(" ")}" fill="${FILL}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
    })()),
  item("shape-heart", "하트", "shape", ["heart", "사랑"], 220, 200,
    `<path d="M110 176 C40 120 18 78 48 48 C72 24 98 36 110 58 C122 36 148 24 172 48 C202 78 180 120 110 176 Z" fill="${FILL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  item("shape-pentagon", "오각형", "shape", ["pentagon"], 220, 210,
    (() => {
      const cx = 110;
      const cy = 112;
      const r = 90;
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(" ")}" fill="${FILL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`;
    })()),
  item("shape-ring", "링", "shape", ["donut", "고리"], 220, 220,
    `<circle cx="110" cy="110" r="92" fill="none" stroke="${INK}" stroke-width="22"/><circle cx="110" cy="110" r="52" fill="none" stroke="${FILL}" stroke-width="10"/>`),
  item("shape-pill", "알약", "shape", ["pill", "capsule"], 260, 100,
    `<rect x="12" y="12" width="236" height="76" rx="38" fill="${FILL}" stroke="${INK}" stroke-width="8"/>`),

  // —— Frames ——
  item("frame-simple", "심플 프레임", "frame", ["테두리", "border"], 260, 200,
    `<rect x="10" y="10" width="240" height="180" rx="4" fill="none" stroke="${INK}" stroke-width="10"/><rect x="28" y="28" width="204" height="144" rx="2" fill="none" stroke="${INK}" stroke-width="3" opacity="0.35"/>`),
  item("frame-double", "이중 프레임", "frame", ["double"], 260, 200,
    `<rect x="14" y="14" width="232" height="172" fill="none" stroke="${INK}" stroke-width="6"/><rect x="28" y="28" width="204" height="144" fill="none" stroke="${INK}" stroke-width="4"/>`),
  item("frame-polaroid", "폴라로이드", "frame", ["polaroid", "사진"], 220, 260,
    `<rect x="8" y="8" width="204" height="244" rx="6" fill="${FILL}" stroke="${INK}" stroke-width="6"/><rect x="28" y="28" width="164" height="164" fill="#ddd5c8" stroke="${INK}" stroke-width="3"/>`),
  item("frame-ticket", "티켓", "frame", ["ticket", "입장권"], 280, 140,
    `<path d="M16 20 h200 a18 18 0 0 1 0 50 a18 18 0 0 1 0 50 H16 a12 12 0 0 1-12-12 V32 a12 12 0 0 1 12-12 Z" fill="${FILL}" stroke="${INK}" stroke-width="6"/><line x1="200" y1="28" x2="200" y2="112" stroke="${INK}" stroke-width="3" stroke-dasharray="6 6"/>`),
  item("frame-circle", "원형 프레임", "frame", ["circle frame"], 220, 220,
    `<circle cx="110" cy="110" r="96" fill="none" stroke="${INK}" stroke-width="14"/><circle cx="110" cy="110" r="72" fill="none" stroke="${INK}" stroke-width="3" opacity="0.4"/>`),

  // —— Arrows ——
  item("arrow-right", "화살표 →", "arrow", ["arrow", "오른쪽"], 240, 100,
    `<path d="M16 50 H170 L140 20 H168 L224 50 L168 80 H140 L170 50 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`),
  item("arrow-left", "화살표 ←", "arrow", ["arrow", "왼쪽"], 240, 100,
    `<path d="M224 50 H70 L100 20 H72 L16 50 L72 80 H100 L70 50 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`),
  item("arrow-up", "화살표 ↑", "arrow", ["arrow", "위"], 100, 240,
    `<path d="M50 224 V70 L20 100 V72 L50 16 L80 72 V100 L50 70 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`),
  item("arrow-bidir", "양방향", "arrow", ["양방향", "swap"], 260, 90,
    `<path d="M20 45 H100 L80 22 H108 L150 45 L108 68 H80 L100 45 M240 45 H160 L180 22 H152 L110 45 L152 68 H180 L160 45" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>`),
  item("arrow-curved", "곡선 화살", "arrow", ["curve"], 220, 160,
    `<path d="M30 130 C40 40 160 40 170 90" fill="none" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round"/><path d="M150 70 L190 95 L145 110 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="4"/>`),

  // —— Badges ——
  item("badge-circle", "원형 배지", "badge", ["badge", "라벨"], 180, 180,
    `<circle cx="90" cy="90" r="78" fill="${ACCENT}" stroke="${INK}" stroke-width="8"/><circle cx="90" cy="90" r="58" fill="none" stroke="${FILL}" stroke-width="4" opacity="0.7"/>`),
  item("badge-burst", "버스트", "badge", ["starburst", "세일"], 200, 200,
    (() => {
      const cx = 100;
      const cy = 100;
      const spikes = 12;
      const rOut = 90;
      const rIn = 62;
      const pts: string[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? rOut : rIn;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(" ")}" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`;
    })()),
  item("badge-ribbon", "리본", "badge", ["ribbon"], 220, 100,
    `<path d="M20 20 H160 L200 50 L160 80 H20 L40 50 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`),
  item("badge-new", "NEW 배지", "badge", ["new"], 160, 80,
    `<rect x="8" y="12" width="144" height="56" rx="10" fill="${ACCENT}" stroke="${INK}" stroke-width="6"/><text x="80" y="50" text-anchor="middle" font-size="28" font-weight="800" font-family="system-ui,sans-serif" fill="${INK}">NEW</text>`),

  // —— Lines ——
  item("line-solid", "실선", "line", ["line", "divider"], 280, 40,
    `<line x1="12" y1="20" x2="268" y2="20" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`),
  item("line-dashed", "점선", "line", ["dashed"], 280, 40,
    `<line x1="12" y1="20" x2="268" y2="20" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-dasharray="16 12"/>`),
  item("line-dots", "점 구분선", "line", ["dots"], 280, 40,
    `<line x1="12" y1="20" x2="268" y2="20" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-dasharray="2 14"/>`),
  item("line-wave", "물결선", "line", ["wave"], 280, 60,
    `<path d="M12 30 C40 8 60 52 90 30 S140 8 170 30 S220 52 250 30 S268 20 268 20" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`),

  // —— Decor ——
  item("decor-spark", "스파클", "decor", ["sparkle", "반짝"], 160, 160,
    `<path d="M80 12 L92 68 L148 80 L92 92 L80 148 L68 92 L12 80 L68 68 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`),
  item("decor-burst-lines", "집중선", "decor", ["focus", "lines"], 200, 200,
    (() => {
      const lines: string[] = [];
      const cx = 100;
      const cy = 100;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x1 = cx + Math.cos(a) * 28;
        const y1 = cy + Math.sin(a) * 28;
        const x2 = cx + Math.cos(a) * 92;
        const y2 = cy + Math.sin(a) * 92;
        lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`);
      }
      return lines.join("");
    })()),
  item("decor-cloud", "구름", "decor", ["cloud"], 260, 140,
    `<ellipse cx="90" cy="80" rx="50" ry="36" fill="${FILL}" stroke="${INK}" stroke-width="6"/><ellipse cx="140" cy="70" rx="58" ry="42" fill="${FILL}" stroke="${INK}" stroke-width="6"/><ellipse cx="190" cy="84" rx="44" ry="32" fill="${FILL}" stroke="${INK}" stroke-width="6"/><ellipse cx="130" cy="96" rx="70" ry="28" fill="${FILL}" stroke="${INK}" stroke-width="6"/>`),
  item("decor-speech", "캡션 카드", "decor", ["speech", "캡션", "라벨"], 220, 180,
    `<rect x="16" y="16" width="188" height="120" rx="24" fill="${FILL}" stroke="${INK}" stroke-width="7"/><path d="M70 136 L58 168 L98 136 Z" fill="${FILL}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  item("decor-check", "체크", "decor", ["check", "완료"], 160, 160,
    `<circle cx="80" cy="80" r="68" fill="${FILL}" stroke="${INK}" stroke-width="7"/><path d="M48 82 L72 106 L116 54" fill="none" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`),
  item("decor-x", "X 마크", "decor", ["close", "x"], 160, 160,
    `<circle cx="80" cy="80" r="68" fill="${FILL}" stroke="${INK}" stroke-width="7"/><path d="M52 52 L108 108 M108 52 L52 108" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`),

  ...STUDIO_ELEMENT_ASSET_PACK_ITEMS,
]);

export const STUDIO_ELEMENT_CATEGORY_CHIPS: readonly {
  id: StudioElementCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "전체" },
  { id: "shape", label: "도형" },
  { id: "panel", label: "컷 패널" },
  { id: "sfx", label: "효과음" },
  { id: "effect", label: "효과선" },
  { id: "pattern", label: "배경 패턴" },
  { id: "frame", label: "프레임" },
  { id: "arrow", label: "화살표" },
  { id: "badge", label: "배지" },
  { id: "line", label: "선" },
  { id: "decor", label: "장식" },
];

export function listStudioElements(
  category: StudioElementCategory | "all" = "all",
  query = ""
): StudioElementItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return STUDIO_ELEMENT_ITEMS.filter((el) => {
    if (category !== "all" && el.category !== category) return false;
    if (terms.length === 0) return true;
    const searchable = [el.label, el.id, el.category, ...el.keywords].join(" ").toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

/**
 * Items shown in the generic element browser.
 *
 * Asset-pack speech balloons are flattened SVG images and cannot edit dialogue, tails,
 * or balloon geometry. Hiding them here keeps the dedicated native balloon tool as the
 * single, predictable speech-balloon entry point while preserving the pack for legacy
 * documents and direct lookup.
 */
export function listStudioElementLibrary(
  category: StudioElementCategory | "all" = "all",
  query = ""
): StudioElementItem[] {
  return listStudioElements(category, query).filter((item) => item.category !== "bubble");
}

export function findStudioElement(id: unknown): StudioElementItem | null {
  if (typeof id !== "string" || !id) return null;
  return STUDIO_ELEMENT_ITEMS.find((el) => el.id === id) ?? null;
}
