/**
 * Studio Background presets — PicsArt/Canva-class page fills.
 * Solid · multi-stop gradient · procedural pattern/atmosphere SVG.
 * Pure data + builders (no DOM/Konva).
 */

export { studioBackgroundGradientColorStops } from "./studio-background-gradient-color-stops";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StudioBackgroundKind = "solid" | "gradient" | "pattern" | "atmosphere";

export type StudioBackgroundCategory =
  | "solid"
  | "gradient"
  | "pattern"
  | "atmosphere"
  | "all";

export interface StudioSolidBackground {
  kind: "solid";
  id: string;
  label: string;
  labelKey: string;
  color: string;
  keywords: readonly string[];
}

export interface StudioGradientBackground {
  kind: "gradient";
  id: string;
  label: string;
  labelKey: string;
  /** 2–4 stop hex colors, top→bottom (or left→right when horizontal). */
  stops: readonly string[];
  direction: "vertical" | "horizontal";
  keywords: readonly string[];
}

export interface StudioSvgBackground {
  kind: "pattern" | "atmosphere";
  id: string;
  label: string;
  labelKey: string;
  keywords: readonly string[];
  /** Build full-bleed SVG for the page size. */
  buildSvg: (width: number, height: number) => string;
}

export type StudioBackgroundPreset =
  | StudioSolidBackground
  | StudioGradientBackground
  | StudioSvgBackground;

export type StudioBackgroundApply =
  | { kind: "solid"; color: string; presetId: string }
  | {
      kind: "gradient";
      stops: string[];
      direction: "vertical" | "horizontal";
      presetId: string;
    }
  | {
      kind: "svg";
      svg: string;
      width: number;
      height: number;
      presetId: string;
      label: string;
    };

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

export const STUDIO_SOLID_BACKGROUNDS: readonly StudioSolidBackground[] = Object.freeze([
  {
    kind: "solid",
    id: "s-white",
    label: "화이트",
    labelKey: "studio.background.preset.s-white",
    color: "#ffffff",
    keywords: ["white", "흰"],
  },
  {
    kind: "solid",
    id: "s-paper",
    label: "원고지",
    labelKey: "studio.background.preset.s-paper",
    color: "#f7f1e6",
    keywords: ["paper", "종이"],
  },
  {
    kind: "solid",
    id: "s-cream",
    label: "크림",
    labelKey: "studio.background.preset.s-cream",
    color: "#fbf3e4",
    keywords: ["cream"],
  },
  {
    kind: "solid",
    id: "s-warm-gray",
    label: "웜 그레이",
    labelKey: "studio.background.preset.s-warm-gray",
    color: "#e8e2d8",
    keywords: ["gray"],
  },
  {
    kind: "solid",
    id: "s-ink",
    label: "잉크",
    labelKey: "studio.background.preset.s-ink",
    color: "#1a1410",
    keywords: ["ink", "검정", "dark"],
  },
  {
    kind: "solid",
    id: "s-charcoal",
    label: "차콜",
    labelKey: "studio.background.preset.s-charcoal",
    color: "#2c2620",
    keywords: ["charcoal"],
  },
  {
    kind: "solid",
    id: "s-navy",
    label: "네이비",
    labelKey: "studio.background.preset.s-navy",
    color: "#1a2744",
    keywords: ["navy", "밤"],
  },
  {
    kind: "solid",
    id: "s-sky",
    label: "스카이",
    labelKey: "studio.background.preset.s-sky",
    color: "#c8e8ff",
    keywords: ["sky", "하늘"],
  },
  {
    kind: "solid",
    id: "s-mint",
    label: "민트",
    labelKey: "studio.background.preset.s-mint",
    color: "#d4f5ea",
    keywords: ["mint"],
  },
  {
    kind: "solid",
    id: "s-blush",
    label: "블러시",
    labelKey: "studio.background.preset.s-blush",
    color: "#ffd6e0",
    keywords: ["pink", "분홍"],
  },
  {
    kind: "solid",
    id: "s-peach",
    label: "피치",
    labelKey: "studio.background.preset.s-peach",
    color: "#ffd8c2",
    keywords: ["peach", "살구"],
  },
  {
    kind: "solid",
    id: "s-lavender",
    label: "라벤더",
    labelKey: "studio.background.preset.s-lavender",
    color: "#e4d8ff",
    keywords: ["lavender", "보라"],
  },
  {
    kind: "solid",
    id: "s-lemon",
    label: "레몬",
    labelKey: "studio.background.preset.s-lemon",
    color: "#fff3b0",
    keywords: ["yellow", "노랑"],
  },
  {
    kind: "solid",
    id: "s-coral",
    label: "코랄",
    labelKey: "studio.background.preset.s-coral",
    color: "#ff8f70",
    keywords: ["coral", "accent"],
  },
  {
    kind: "solid",
    id: "s-teal",
    label: "틸",
    labelKey: "studio.background.preset.s-teal",
    color: "#1f6f6a",
    keywords: ["teal", "청록"],
  },
  {
    kind: "solid",
    id: "s-wine",
    label: "와인",
    labelKey: "studio.background.preset.s-wine",
    color: "#5c1f2e",
    keywords: ["wine", "버건디"],
  },
]);

// ---------------------------------------------------------------------------
// Gradients (multi-stop)
// ---------------------------------------------------------------------------

export const STUDIO_GRADIENT_BACKGROUNDS: readonly StudioGradientBackground[] = Object.freeze([
  {
    kind: "gradient",
    id: "g-dawn",
    label: "새벽",
    labelKey: "studio.background.preset.g-dawn",
    stops: ["#1b2a52", "#f3b7c4"],
    direction: "vertical",
    keywords: ["dawn", "새벽"],
  },
  {
    kind: "gradient",
    id: "g-sunrise",
    label: "일출",
    labelKey: "studio.background.preset.g-sunrise",
    stops: ["#ff9a62", "#ffd7a8", "#87c5ff"],
    direction: "vertical",
    keywords: ["sunrise", "아침"],
  },
  {
    kind: "gradient",
    id: "g-midday",
    label: "한낮",
    labelKey: "studio.background.preset.g-midday",
    stops: ["#4aa6e8", "#eaf6ff"],
    direction: "vertical",
    keywords: ["day", "하늘"],
  },
  {
    kind: "gradient",
    id: "g-sunset",
    label: "노을",
    labelKey: "studio.background.preset.g-sunset",
    stops: ["#ff7a3d", "#ff9aa2", "#3a1d52"],
    direction: "vertical",
    keywords: ["sunset", "저녁"],
  },
  {
    kind: "gradient",
    id: "g-night",
    label: "밤하늘",
    labelKey: "studio.background.preset.g-night",
    stops: ["#05060f", "#1a2350", "#22305e"],
    direction: "vertical",
    keywords: ["night", "밤"],
  },
  {
    kind: "gradient",
    id: "g-aurora",
    label: "오로라",
    labelKey: "studio.background.preset.g-aurora",
    stops: ["#0b2a3a", "#1d6b5c", "#49dba0"],
    direction: "vertical",
    keywords: ["aurora", "극광"],
  },
  {
    kind: "gradient",
    id: "g-ocean",
    label: "바다",
    labelKey: "studio.background.preset.g-ocean",
    stops: ["#27c4d6", "#0a5a8a", "#0a3a6b"],
    direction: "vertical",
    keywords: ["ocean", "바다"],
  },
  {
    kind: "gradient",
    id: "g-forest",
    label: "숲",
    labelKey: "studio.background.preset.g-forest",
    stops: ["#a9c95a", "#3d6b3a", "#163a26"],
    direction: "vertical",
    keywords: ["forest", "숲"],
  },
  {
    kind: "gradient",
    id: "g-neon",
    label: "네온",
    labelKey: "studio.background.preset.g-neon",
    stops: ["#1a0533", "#ff2d95", "#00e5ff"],
    direction: "vertical",
    keywords: ["neon", "시티"],
  },
  {
    kind: "gradient",
    id: "g-peach",
    label: "피치 블렌드",
    labelKey: "studio.background.preset.g-peach",
    stops: ["#ffe0c8", "#ffb3c1"],
    direction: "vertical",
    keywords: ["soft", "파스텔"],
  },
  {
    kind: "gradient",
    id: "g-mint",
    label: "민트 블렌드",
    labelKey: "studio.background.preset.g-mint",
    stops: ["#d4f5ea", "#b8e0ff"],
    direction: "vertical",
    keywords: ["mint", "파스텔"],
  },
  {
    kind: "gradient",
    id: "g-warm-paper",
    label: "웜 페이퍼",
    labelKey: "studio.background.preset.g-warm-paper",
    stops: ["#fff8ee", "#f0e0c8"],
    direction: "vertical",
    keywords: ["paper", "원고"],
  },
  {
    kind: "gradient",
    id: "g-ink-fade",
    label: "잉크 페이드",
    labelKey: "studio.background.preset.g-ink-fade",
    stops: ["#1a1410", "#4a3c32"],
    direction: "vertical",
    keywords: ["ink", "dark"],
  },
  {
    kind: "gradient",
    id: "g-horizon",
    label: "수평선",
    labelKey: "studio.background.preset.g-horizon",
    stops: ["#87ceeb", "#f5d6a8", "#c47b4a"],
    direction: "vertical",
    keywords: ["horizon", "풍경"],
  },
  {
    kind: "gradient",
    id: "g-side-warm",
    label: "가로 웜",
    labelKey: "studio.background.preset.g-side-warm",
    stops: ["#ff9f68", "#ff6b9d"],
    direction: "horizontal",
    keywords: ["horizontal", "가로"],
  },
  {
    kind: "gradient",
    id: "g-side-cool",
    label: "가로 쿨",
    labelKey: "studio.background.preset.g-side-cool",
    stops: ["#5b8def", "#a78bfa"],
    direction: "horizontal",
    keywords: ["horizontal", "cool"],
  },
]);

// ---------------------------------------------------------------------------
// Pattern / atmosphere SVG builders
// ---------------------------------------------------------------------------

function svgRoot(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

function clampSize(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.max(64, Math.min(8192, Math.round(w))),
    h: Math.max(64, Math.min(8192, Math.round(h))),
  };
}

function patternDots(w: number, h: number, bg: string, ink: string, pitch = 18, r = 1.6): string {
  const { w: W, h: H } = clampSize(w, h);
  const dots: string[] = [];
  for (let y = pitch / 2; y < H; y += pitch) {
    for (let x = pitch / 2; x < W; x += pitch) {
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${ink}"/>`);
    }
  }
  return svgRoot(W, H, `<rect width="${W}" height="${H}" fill="${bg}"/>${dots.join("")}`);
}

function patternStripes(w: number, h: number, bg: string, ink: string, gap = 14): string {
  const { w: W, h: H } = clampSize(w, h);
  const lines: string[] = [];
  for (let x = 0; x < W + H; x += gap) {
    lines.push(
      `<line x1="${x}" y1="0" x2="${x - H}" y2="${H}" stroke="${ink}" stroke-width="2"/>`
    );
  }
  return svgRoot(W, H, `<rect width="${W}" height="${H}" fill="${bg}"/>${lines.join("")}`);
}

function patternGrid(w: number, h: number, bg: string, ink: string, pitch = 24): string {
  const { w: W, h: H } = clampSize(w, h);
  const lines: string[] = [];
  for (let x = 0; x <= W; x += pitch) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${ink}" stroke-width="1"/>`);
  }
  for (let y = 0; y <= H; y += pitch) {
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${ink}" stroke-width="1"/>`);
  }
  return svgRoot(W, H, `<rect width="${W}" height="${H}" fill="${bg}"/>${lines.join("")}`);
}

function patternChecker(w: number, h: number, a: string, b: string, cell = 32): string {
  const { w: W, h: H } = clampSize(w, h);
  const rects: string[] = [`<rect width="${W}" height="${H}" fill="${a}"/>`];
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      if (((x / cell) + (y / cell)) % 2 === 0) continue;
      rects.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${b}"/>`);
    }
  }
  return svgRoot(W, H, rects.join(""));
}

function patternCrosshatch(w: number, h: number, bg: string, ink: string): string {
  const { w: W, h: H } = clampSize(w, h);
  const gap = 16;
  const lines: string[] = [];
  for (let i = -H; i < W + H; i += gap) {
    lines.push(`<line x1="${i}" y1="0" x2="${i + H}" y2="${H}" stroke="${ink}" stroke-width="1.2"/>`);
    lines.push(`<line x1="${i}" y1="${H}" x2="${i + H}" y2="0" stroke="${ink}" stroke-width="1.2"/>`);
  }
  return svgRoot(W, H, `<rect width="${W}" height="${H}" fill="${bg}"/>${lines.join("")}`);
}

function patternPaperGrain(w: number, h: number): string {
  const { w: W, h: H } = clampSize(w, h);
  // Deterministic pseudo-noise via many tiny rects from LCG
  let s = 0x9e3779b9;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const specs: string[] = [];
  const count = Math.min(2200, Math.floor((W * H) / 280));
  for (let i = 0; i < count; i++) {
    const x = next() * W;
    const y = next() * H;
    const a = 0.03 + next() * 0.08;
    specs.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.4 + next() * 1.2).toFixed(2)}" fill="#16100c" opacity="${a.toFixed(3)}"/>`
    );
  }
  return svgRoot(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="#f7f1e6"/>${specs.join("")}`
  );
}

function atmosphereSoftGlow(w: number, h: number, c0: string, c1: string, glow: string): string {
  const { w: W, h: H } = clampSize(w, h);
  return svgRoot(
    W,
    H,
    `<defs>
      <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="35%" r="55%">
        <stop offset="0%" stop-color="${glow}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#ag)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>`
  );
}

function atmosphereVignette(w: number, h: number, base: string): string {
  const { w: W, h: H } = clampSize(w, h);
  return svgRoot(
    W,
    H,
    `<defs>
      <radialGradient id="vig" cx="50%" cy="45%" r="70%">
        <stop offset="40%" stop-color="${base}" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0a0806" stop-opacity="0.55"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${base}"/>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>`
  );
}

function atmosphereBokeh(w: number, h: number): string {
  const { w: W, h: H } = clampSize(w, h);
  let s = 42;
  const next = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  const orbs: string[] = [];
  for (let i = 0; i < 28; i++) {
    const cx = next() * W;
    const cy = next() * H;
    const r = 20 + next() * 90;
    const op = 0.08 + next() * 0.18;
    const hue = next() > 0.5 ? "#ffb4a2" : "#a0e7e5";
    orbs.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${hue}" opacity="${op.toFixed(3)}"/>`
    );
  }
  return svgRoot(
    W,
    H,
    `<defs>
      <linearGradient id="bk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2a1f3d"/><stop offset="100%" stop-color="#0f1b2d"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bk)"/>${orbs.join("")}`
  );
}

function atmosphereMesh(w: number, h: number): string {
  const { w: W, h: H } = clampSize(w, h);
  return svgRoot(
    W,
    H,
    `<defs>
      <radialGradient id="m1" cx="20%" cy="20%" r="55%"><stop offset="0%" stop-color="#ff7a5c" stop-opacity="0.85"/><stop offset="100%" stop-color="#ff7a5c" stop-opacity="0"/></radialGradient>
      <radialGradient id="m2" cx="80%" cy="30%" r="50%"><stop offset="0%" stop-color="#7c5cff" stop-opacity="0.8"/><stop offset="100%" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
      <radialGradient id="m3" cx="50%" cy="85%" r="55%"><stop offset="0%" stop-color="#3dd6c6" stop-opacity="0.75"/><stop offset="100%" stop-color="#3dd6c6" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#1a1424"/>
    <rect width="${W}" height="${H}" fill="url(#m1)"/>
    <rect width="${W}" height="${H}" fill="url(#m2)"/>
    <rect width="${W}" height="${H}" fill="url(#m3)"/>`
  );
}

export const STUDIO_PATTERN_BACKGROUNDS: readonly StudioSvgBackground[] = Object.freeze([
  {
    kind: "pattern",
    id: "p-dots-warm",
    label: "도트 웜",
    labelKey: "studio.background.preset.p-dots-warm",
    keywords: ["dots", "polka", "점"],
    buildSvg: (w, h) => patternDots(w, h, "#f7f1e6", "#c4a882", 20, 1.8),
  },
  {
    kind: "pattern",
    id: "p-dots-dark",
    label: "도트 다크",
    labelKey: "studio.background.preset.p-dots-dark",
    keywords: ["dots", "dark"],
    buildSvg: (w, h) => patternDots(w, h, "#1a1410", "#3d342c", 18, 1.5),
  },
  {
    kind: "pattern",
    id: "p-stripes",
    label: "사선 스트라이프",
    labelKey: "studio.background.preset.p-stripes",
    keywords: ["stripe", "줄무늬"],
    buildSvg: (w, h) => patternStripes(w, h, "#fff8f0", "#e8d5c0", 16),
  },
  {
    kind: "pattern",
    id: "p-grid",
    label: "그리드",
    labelKey: "studio.background.preset.p-grid",
    keywords: ["grid", "노트"],
    buildSvg: (w, h) => patternGrid(w, h, "#ffffff", "#d8d0c4", 28),
  },
  {
    kind: "pattern",
    id: "p-checker",
    label: "체크",
    labelKey: "studio.background.preset.p-checker",
    keywords: ["checker", "체크"],
    buildSvg: (w, h) => patternChecker(w, h, "#f4efe6", "#e2d6c4", 36),
  },
  {
    kind: "pattern",
    id: "p-cross",
    label: "교차선",
    labelKey: "studio.background.preset.p-cross",
    keywords: ["hatch", "교차"],
    buildSvg: (w, h) => patternCrosshatch(w, h, "#faf6f0", "#d0c4b4"),
  },
  {
    kind: "pattern",
    id: "p-paper",
    label: "종이 결",
    labelKey: "studio.background.preset.p-paper",
    keywords: ["paper", "grain", "질감"],
    buildSvg: (w, h) => patternPaperGrain(w, h),
  },
  {
    kind: "pattern",
    id: "p-halftone",
    label: "하프톤",
    labelKey: "studio.background.preset.p-halftone",
    keywords: ["halftone", "망점"],
    buildSvg: (w, h) => patternDots(w, h, "#f0ebe3", "#16100c", 12, 2.4),
  },
]);

export const STUDIO_ATMOSPHERE_BACKGROUNDS: readonly StudioSvgBackground[] = Object.freeze([
  {
    kind: "atmosphere",
    id: "a-soft-warm",
    label: "소프트 웜",
    labelKey: "studio.background.preset.a-soft-warm",
    keywords: ["soft", "glow", "분위기"],
    buildSvg: (w, h) => atmosphereSoftGlow(w, h, "#2a1830", "#1a1018", "#ff8f6b"),
  },
  {
    kind: "atmosphere",
    id: "a-soft-cool",
    label: "소프트 쿨",
    labelKey: "studio.background.preset.a-soft-cool",
    keywords: ["cool", "glow"],
    buildSvg: (w, h) => atmosphereSoftGlow(w, h, "#0f1c2e", "#0a1220", "#5ec8ff"),
  },
  {
    kind: "atmosphere",
    id: "a-vignette-paper",
    label: "비네트 페이퍼",
    labelKey: "studio.background.preset.a-vignette-paper",
    keywords: ["vignette", "paper"],
    buildSvg: (w, h) => atmosphereVignette(w, h, "#f7f1e6"),
  },
  {
    kind: "atmosphere",
    id: "a-vignette-ink",
    label: "비네트 잉크",
    labelKey: "studio.background.preset.a-vignette-ink",
    keywords: ["vignette", "dark"],
    buildSvg: (w, h) => atmosphereVignette(w, h, "#1a1410"),
  },
  {
    kind: "atmosphere",
    id: "a-bokeh",
    label: "보케",
    labelKey: "studio.background.preset.a-bokeh",
    keywords: ["bokeh", "blur", "밤"],
    buildSvg: (w, h) => atmosphereBokeh(w, h),
  },
  {
    kind: "atmosphere",
    id: "a-mesh",
    label: "메시 그라데이션",
    labelKey: "studio.background.preset.a-mesh",
    keywords: ["mesh", "abstract", "그라데이션"],
    buildSvg: (w, h) => atmosphereMesh(w, h),
  },
]);

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

export const STUDIO_BACKGROUND_CATEGORY_CHIPS: readonly {
  id: StudioBackgroundCategory;
  label: string;
  labelKey: string;
}[] = [
  { id: "all", label: "전체", labelKey: "studio.background.category.all" },
  { id: "solid", label: "단색", labelKey: "studio.background.category.solid" },
  { id: "gradient", label: "그라데이션", labelKey: "studio.background.category.gradient" },
  { id: "pattern", label: "패턴", labelKey: "studio.background.category.pattern" },
  { id: "atmosphere", label: "분위기", labelKey: "studio.background.category.atmosphere" },
];

export function listStudioBackgroundPresets(
  category: StudioBackgroundCategory = "all",
  query = ""
): StudioBackgroundPreset[] {
  const all: StudioBackgroundPreset[] = [
    ...STUDIO_SOLID_BACKGROUNDS,
    ...STUDIO_GRADIENT_BACKGROUNDS,
    ...STUDIO_PATTERN_BACKGROUNDS,
    ...STUDIO_ATMOSPHERE_BACKGROUNDS,
  ];
  const q = query.trim().toLowerCase();
  return all.filter((preset) => {
    if (category !== "all" && preset.kind !== category) return false;
    if (!q) return true;
    if (preset.id.includes(q) || preset.label.toLowerCase().includes(q)) return true;
    return preset.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

export function findStudioBackgroundPreset(id: unknown): StudioBackgroundPreset | null {
  if (typeof id !== "string" || !id) return null;
  return listStudioBackgroundPresets("all").find((p) => p.id === id) ?? null;
}

/** Build apply payload for StudioPage. */
export function planStudioBackgroundApply(
  preset: StudioBackgroundPreset,
  canvasW: number,
  canvasH: number
): StudioBackgroundApply {
  if (preset.kind === "solid") {
    return { kind: "solid", color: preset.color, presetId: preset.id };
  }
  if (preset.kind === "gradient") {
    return {
      kind: "gradient",
      stops: [...preset.stops],
      direction: preset.direction,
      presetId: preset.id,
    };
  }
  const svg = preset.buildSvg(canvasW, canvasH);
  return {
    kind: "svg",
    svg,
    width: canvasW,
    height: canvasH,
    presetId: preset.id,
    label: preset.label,
  };
}

/** CSS preview for solid/gradient tiles. */
export function studioBackgroundPreviewCss(preset: StudioBackgroundPreset): string {
  if (preset.kind === "solid") return preset.color;
  if (preset.kind === "gradient") {
    const dir = preset.direction === "horizontal" ? "to right" : "to bottom";
    return `linear-gradient(${dir}, ${preset.stops.join(", ")})`;
  }
  // pattern/atmosphere — approximate with muted surface; panel may use data-url later
  if (preset.kind === "pattern") return "oklch(0.88 0.02 70)";
  return "oklch(0.28 0.04 300)";
}

/** Full-bleed linear gradient SVG (for horizontal page fills or multi-stop export). */
export function buildStudioBackgroundGradientSvg(
  width: number,
  height: number,
  stops: readonly string[],
  direction: "vertical" | "horizontal" = "vertical"
): string {
  const { w, h } = clampSize(width, height);
  const safeStops = stops.length > 0 ? stops : ["#ffffff", "#f0ebe3"];
  const last = safeStops.length - 1;
  const stopMarkup = safeStops
    .map((color, index) => {
      const offset = last === 0 ? 0 : (index / last) * 100;
      return `<stop offset="${offset}%" stop-color="${color}"/>`;
    })
    .join("");
  const coords =
    direction === "horizontal"
      ? `x1="0" y1="0" x2="1" y2="0"`
      : `x1="0" y1="0" x2="0" y2="1"`;
  return svgRoot(
    w,
    h,
    `<defs><linearGradient id="pg" ${coords}>${stopMarkup}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#pg)"/>`
  );
}

/** Layer name prefix for auto-inserted pattern/atmosphere page fills. */
export const STUDIO_BG_FILL_LAYER_PREFIX = "배경 · 채우기";

export function isStudioBackgroundFillLayerName(name: unknown): boolean {
  return typeof name === "string" && name.startsWith(STUDIO_BG_FILL_LAYER_PREFIX);
}
