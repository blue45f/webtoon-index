/**
 * Placeable vector asset packs for the Studio Elements catalog.
 *
 * These assets intentionally use the existing SVG → image element path instead of extending
 * DrawShapeKind. That route already supports canvas rendering, transforms, persistence and export,
 * while keeping the native two-point shape renderer's closed union intact.
 */

export type StudioElementAssetPackCategory =
  | "shape"
  | "panel"
  | "bubble"
  | "sfx"
  | "effect"
  | "pattern";

export interface StudioElementAssetPackItem {
  readonly id: string;
  readonly label: string;
  readonly category: StudioElementAssetPackCategory;
  readonly keywords: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly svg: string;
}

const INK = "#16100c";
const PAPER = "#f4efe6";
const ACCENT = "#e86a33";
const COOL = "#65b9e8";
const PINK = "#f28caf";
const YELLOW = "#f5c84b";

function wrapSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function asset(
  id: string,
  label: string,
  category: StudioElementAssetPackCategory,
  keywords: readonly string[],
  width: number,
  height: number,
  body: string
): StudioElementAssetPackItem {
  return { id, label, category, keywords, width, height, svg: wrapSvg(width, height, body) };
}

function radialStrokes(
  width: number,
  height: number,
  count: number,
  innerRadius: number,
  outerRadius: number,
  options: { centerX?: number; centerY?: number; strokeWidth?: number; color?: string } = {}
): string {
  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const color = options.color ?? INK;
  const strokeWidth = options.strokeWidth ?? 5;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    const outer = outerRadius - (index % 4) * 5;
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * outer;
    const y2 = centerY + Math.sin(angle) * outer;
    const widthVariation = strokeWidth + (index % 3) * 0.8;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${widthVariation.toFixed(1)}" stroke-linecap="round"/>`;
  }).join("");
}

function horizontalSpeedLines(direction: "left" | "right"): string {
  return Array.from({ length: 18 }, (_, index) => {
    const y = 14 + index * 12;
    const inset = (index * 37) % 120;
    const x1 = direction === "right" ? 8 + inset : 18;
    const x2 = direction === "right" ? 300 : 290 - inset;
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" stroke-width="${2 + (index % 4)}" stroke-linecap="round"/>`;
  }).join("");
}

function verticalSpeedLines(): string {
  return Array.from({ length: 17 }, (_, index) => {
    const x = 13 + index * 17;
    const inset = (index * 29) % 90;
    return `<line x1="${x}" y1="${8 + inset}" x2="${x}" y2="232" stroke="${INK}" stroke-width="${2 + (index % 3)}" stroke-linecap="round"/>`;
  }).join("");
}

function dotField(width: number, height: number, step: number, radius: number): string {
  const dots: string[] = [];
  for (let y = step / 2; y < height; y += step) {
    const row = Math.floor(y / step);
    for (let x = step / 2 + (row % 2 ? step / 2 : 0); x < width; x += step) {
      dots.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${INK}"/>`);
    }
  }
  return dots.join("");
}

function gridField(width: number, height: number, step: number, diagonal = false): string {
  const lines: string[] = [];
  if (diagonal) {
    for (let offset = -height; offset < width + height; offset += step) {
      lines.push(`<line x1="${offset}" y1="0" x2="${offset + height}" y2="${height}" stroke="${INK}" stroke-width="2"/>`);
    }
    return lines.join("");
  }
  for (let x = 0; x <= width; x += step) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${INK}" stroke-width="2"/>`);
  }
  for (let y = 0; y <= height; y += step) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${INK}" stroke-width="2"/>`);
  }
  return lines.join("");
}

function sfxText(
  text: string,
  options: { fill?: string; stroke?: string; rotate?: number; size?: number } = {}
): string {
  const fill = options.fill ?? YELLOW;
  const stroke = options.stroke ?? INK;
  const rotate = options.rotate ?? -5;
  const size = options.size ?? 64;
  return (
    `<g transform="rotate(${rotate} 150 80)">` +
    `<text x="150" y="102" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${size}" font-weight="900" letter-spacing="-2" fill="${fill}" stroke="${stroke}" stroke-width="9" paint-order="stroke fill" stroke-linejoin="round">${text}</text>` +
    `</g>`
  );
}

function panelRects(rects: readonly [number, number, number, number][]): string {
  return rects
    .map(([x, y, width, height]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="7"/>`)
    .join("");
}

/**
 * High-value vector pack: advanced geometry, comic panels, speech assets, SFX, effect lines and
 * full-bleed patterns. Every entry is standalone and deterministic; no remote art is referenced.
 */
export const STUDIO_ELEMENT_ASSET_PACK_ITEMS: readonly StudioElementAssetPackItem[] = Object.freeze([
  // Advanced geometry — represented as placeable SVG elements so render/export remain lossless.
  asset("shape-superellipse", "슈퍼타원", "shape", ["squircle", "superellipse", "스쿼클", "둥근"], 240, 220,
    `<path d="M120 14 C198 14 226 42 226 110 C226 178 198 206 120 206 C42 206 14 178 14 110 C14 42 42 14 120 14 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8"/>`),
  asset("shape-arc", "원호", "shape", ["arc", "curve", "곡선", "반원"], 260, 170,
    `<path d="M28 142 A104 104 0 0 1 232 142" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>`),
  asset("shape-sector", "부채꼴", "shape", ["sector", "pie", "파이", "각도"], 220, 220,
    `<path d="M110 110 L110 18 A92 92 0 0 1 196 143 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-donut", "도넛", "shape", ["donut", "ring", "고리", "원형"], 220, 220,
    `<path d="M110 14 A96 96 0 1 1 109.9 14 M110 62 A48 48 0 1 0 110.1 62" fill="${PAPER}" fill-rule="evenodd" stroke="${INK}" stroke-width="7"/>`),
  asset("shape-spiral", "나선", "shape", ["spiral", "swirl", "소용돌이", "회전"], 230, 230,
    `<path d="M115 116 C115 88 151 86 159 108 C171 142 128 169 92 153 C45 132 49 67 96 39 C158 2 224 57 214 126 C202 207 109 235 39 190" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`),
  asset("shape-bezier", "베지어 곡선", "shape", ["bezier", "curve", "path", "s curve", "곡선"], 280, 160,
    `<path d="M22 124 C76 14 166 14 258 124" fill="none" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round"/><circle cx="22" cy="124" r="7" fill="${INK}"/><circle cx="258" cy="124" r="7" fill="${INK}"/>`),
  asset("shape-crescent", "초승달", "shape", ["crescent", "moon", "달", "야간"], 210, 220,
    `<path d="M154 20 C79 34 54 130 112 184 C133 203 160 208 184 199 C129 180 105 116 129 67 C139 47 151 33 168 24 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-trapezoid", "사다리꼴", "shape", ["trapezoid", "사다리", "기하"], 250, 180,
    `<path d="M64 18 H186 L232 162 H18 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-parallelogram", "평행사변형", "shape", ["parallelogram", "slant", "기울기"], 260, 170,
    `<path d="M72 16 H246 L188 154 H14 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-cross", "십자", "shape", ["cross", "plus", "더하기", "십자가"], 220, 220,
    `<path d="M78 16 H142 V78 H204 V142 H142 V204 H78 V142 H16 V78 H78 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-chevron", "셰브론", "shape", ["chevron", "angle", "꺾쇠", "방향"], 260, 170,
    `<path d="M24 22 L112 85 L24 148 H82 L170 85 L82 22 Z M118 22 L206 85 L118 148 H176 L246 85 L176 22 Z" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("shape-clover", "네잎 클로버", "shape", ["clover", "flower", "꽃", "행운"], 220, 220,
    `<path d="M110 110 C62 84 54 32 84 20 C108 10 126 30 110 70 C94 30 112 10 136 20 C166 32 158 84 110 110 C158 94 186 112 178 140 C168 174 124 162 110 122 C96 162 52 174 42 140 C34 112 62 94 110 110 Z" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("shape-arch", "아치", "shape", ["arch", "door", "문", "반원"], 220, 240,
    `<path d="M24 220 V110 A86 86 0 0 1 196 110 V220 H150 V112 A40 40 0 0 0 70 112 V220 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("shape-wave", "웨이브", "shape", ["wave", "sine", "물결", "파동"], 300, 120,
    `<path d="M14 60 C48 10 82 10 116 60 S184 110 218 60 S266 10 286 48" fill="none" stroke="${COOL}" stroke-width="14" stroke-linecap="round"/>`),
  asset("shape-scallop", "스캘럽 원", "shape", ["scallop", "seal", "물결 테두리", "스티커"], 220, 220,
    `<path d="M110 14 L127 27 L148 20 L159 39 L181 41 L184 63 L203 74 L195 95 L208 112 L193 128 L199 150 L178 159 L172 181 L150 181 L136 199 L116 191 L97 205 L80 191 L58 198 L45 180 L23 176 L22 154 L4 141 L14 121 L2 103 L18 88 L13 66 L34 57 L41 35 L63 36 L77 18 L97 27 Z" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("shape-hexagram", "육각별", "shape", ["hexagram", "magic", "star", "마법진"], 220, 220,
    `<path d="M110 16 L194 160 H26 Z M110 204 L26 60 H194 Z" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>`),
  asset("shape-ribbon-wave", "리본 곡선", "shape", ["ribbon", "banner", "리본", "배너"], 300, 150,
    `<path d="M18 38 C82 2 108 84 170 48 C216 22 254 44 282 20 L260 110 C224 132 196 92 152 116 C92 148 62 70 10 112 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),

  // Comic panel guides — fast composition assets, visually distinct from functional clip frames.
  asset("panel-duo-vertical", "2컷 세로 분할", "panel", ["panel", "2컷", "split", "분할"], 300, 240,
    panelRects([[8, 8, 137, 224], [155, 8, 137, 224]])),
  asset("panel-duo-horizontal", "2컷 가로 분할", "panel", ["panel", "2컷", "stack", "위아래"], 300, 240,
    panelRects([[8, 8, 284, 107], [8, 125, 284, 107]])),
  asset("panel-trio-hero-top", "3컷 히어로 상단", "panel", ["panel", "3컷", "hero", "강조"], 300, 260,
    panelRects([[8, 8, 284, 142], [8, 160, 137, 92], [155, 160, 137, 92]])),
  asset("panel-trio-hero-left", "3컷 히어로 좌측", "panel", ["panel", "3컷", "hero", "비대칭"], 300, 260,
    panelRects([[8, 8, 166, 244], [184, 8, 108, 117], [184, 135, 108, 117]])),
  asset("panel-four-grid", "4컷 그리드", "panel", ["panel", "4컷", "grid", "2x2"], 300, 260,
    panelRects([[8, 8, 137, 117], [155, 8, 137, 117], [8, 135, 137, 117], [155, 135, 137, 117]])),
  asset("panel-four-stagger", "4컷 엇갈림", "panel", ["panel", "4컷", "stagger", "리듬"], 300, 280,
    panelRects([[8, 8, 174, 102], [192, 8, 100, 154], [8, 120, 174, 152], [192, 172, 100, 100]])),
  asset("panel-five-manga", "5컷 만화 리듬", "panel", ["panel", "5컷", "manga", "연출"], 300, 300,
    panelRects([[8, 8, 284, 112], [8, 130, 132, 74], [150, 130, 142, 162], [8, 214, 64, 78], [82, 214, 58, 78]])),
  asset("panel-filmstrip", "필름 스트립", "panel", ["panel", "film", "sequence", "연속"], 320, 180,
    panelRects([[8, 18, 70, 144], [88, 18, 70, 144], [168, 18, 70, 144], [248, 18, 64, 144]])),
  asset("panel-diagonal", "사선 2컷 가이드", "panel", ["panel", "diagonal", "action", "사선"], 300, 240,
    `<path d="M8 8 H292 V72 L8 164 Z" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M8 174 L292 82 V232 H8 Z" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("panel-overlap", "오버랩 컷 가이드", "panel", ["panel", "overlap", "memory", "회상"], 300, 260,
    `<rect x="8" y="8" width="284" height="244" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="7"/><rect x="76" y="52" width="154" height="156" rx="8" fill="${PAPER}" stroke="${ACCENT}" stroke-width="9" transform="rotate(-5 153 130)"/>`),

  // Speech and caption assets.
  asset("bubble-speech-left", "기본 말풍선 · 왼쪽", "bubble", ["speech", "dialogue", "대사", "왼쪽 꼬리"], 280, 190,
    `<rect x="12" y="12" width="256" height="132" rx="54" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><path d="M78 140 L46 180 L112 143" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("bubble-speech-right", "기본 말풍선 · 오른쪽", "bubble", ["speech", "dialogue", "대사", "오른쪽 꼬리"], 280, 190,
    `<rect x="12" y="12" width="256" height="132" rx="54" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><path d="M202 140 L234 180 L168 143" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("bubble-thought", "생각 구름", "bubble", ["thought", "cloud", "생각", "독백"], 290, 210,
    `<path d="M56 158 C20 148 18 104 48 88 C28 50 70 20 102 38 C122 6 174 12 182 46 C222 26 268 58 250 96 C284 120 258 164 222 160 C198 190 148 190 126 166 C100 188 70 180 56 158 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><circle cx="70" cy="186" r="13" fill="${PAPER}" stroke="${INK}" stroke-width="6"/><circle cx="44" cy="202" r="8" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`),
  asset("bubble-shout", "외침 버스트", "bubble", ["shout", "burst", "외침", "충격"], 300, 230,
    `<path d="M150 10 L172 38 L208 20 L216 58 L264 54 L246 94 L292 118 L250 140 L272 188 L220 180 L208 220 L172 194 L142 224 L122 190 L78 210 L76 172 L24 180 L46 138 L8 112 L52 90 L30 48 L82 56 L96 18 L126 42 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("bubble-whisper", "속삭임 점선", "bubble", ["whisper", "soft", "속삭임", "작은 소리"], 280, 180,
    `<rect x="12" y="12" width="256" height="126" rx="48" fill="${PAPER}" stroke="${INK}" stroke-width="6" stroke-dasharray="12 9"/><path d="M92 136 L70 168 L122 138" fill="${PAPER}" stroke="${INK}" stroke-width="6" stroke-dasharray="12 9" stroke-linejoin="round"/>`),
  asset("bubble-angry", "격앙 톱니", "bubble", ["angry", "rage", "분노", "절규"], 300, 220,
    `<path d="M18 116 L42 92 L22 66 L58 58 L56 24 L92 42 L110 12 L138 38 L166 10 L184 42 L222 22 L220 60 L278 66 L250 96 L284 122 L250 144 L270 182 L226 178 L212 210 L176 188 L148 214 L124 188 L82 206 L78 174 L34 176 L48 144 Z" fill="${PAPER}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`),
  asset("bubble-narration", "내레이션 박스", "bubble", ["narration", "caption", "내레이션", "설명"], 300, 150,
    `<rect x="10" y="10" width="280" height="130" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><path d="M24 28 H276" stroke="${ACCENT}" stroke-width="8" stroke-linecap="round"/>`),
  asset("bubble-phone", "메신저 말풍선", "bubble", ["phone", "chat", "message", "메신저"], 290, 160,
    `<rect x="10" y="10" width="236" height="116" rx="34" fill="${COOL}" stroke="${INK}" stroke-width="7"/><path d="M210 122 L264 148 L240 106" fill="${COOL}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><circle cx="48" cy="68" r="7" fill="${INK}"/><circle cx="76" cy="68" r="7" fill="${INK}"/><circle cx="104" cy="68" r="7" fill="${INK}"/>`),
  asset("bubble-system", "게임 상태창", "bubble", ["system", "game", "ui", "상태창", "퀘스트"], 300, 180,
    `<path d="M24 10 H276 L292 28 V152 L276 170 H24 L8 152 V28 Z" fill="${INK}"/><path d="M30 28 H270 L274 34 V146 L268 152 H32 L26 146 V34 Z" fill="${COOL}"/><path d="M44 48 H256 M44 78 H224 M44 108 H244" stroke="${INK}" stroke-width="8" stroke-linecap="round" opacity="0.7"/>`),
  asset("bubble-heart", "하트 말풍선", "bubble", ["heart", "love", "romance", "설렘"], 280, 190,
    `<path d="M140 162 C54 104 28 68 56 34 C80 6 120 20 140 54 C160 20 200 6 224 34 C252 68 226 104 140 162 Z" fill="${PINK}" stroke="${INK}" stroke-width="8"/><path d="M142 160 L126 186 L168 166" fill="${PINK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("bubble-double", "이어 말하기", "bubble", ["double", "continued", "연속 대사", "이어"], 300, 210,
    `<ellipse cx="142" cy="84" rx="124" ry="68" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><ellipse cx="174" cy="126" rx="104" ry="66" fill="${PAPER}" stroke="${INK}" stroke-width="8"/><path d="M112 178 L86 204 L138 184" fill="${PAPER}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`),
  asset("bubble-cinematic-caption", "시네마 자막 띠", "bubble", ["cinematic", "subtitle", "caption", "자막"], 320, 100,
    `<rect x="8" y="12" width="304" height="76" rx="8" fill="${INK}"/><path d="M28 34 H292 M28 66 H242" stroke="${PAPER}" stroke-width="7" stroke-linecap="round" opacity="0.82"/>`),
  asset("bubble-radio", "무전 대사", "bubble", ["radio", "walkie", "무전", "통신"], 300, 170,
    `<path d="M20 20 H280 V130 H208 L184 158 L166 130 H20 Z" fill="${INK}" stroke="${ACCENT}" stroke-width="7" stroke-linejoin="round"/><path d="M44 50 H256 M44 82 H224 M44 108 H244" stroke="${PAPER}" stroke-width="7" stroke-linecap="round" opacity="0.78"/>`),
  asset("bubble-jagged-whisper", "불안한 속말", "bubble", ["nervous", "whisper", "불안", "떨림"], 290, 185,
    `<path d="M18 78 Q26 12 88 22 Q142 -2 190 28 Q260 18 272 82 Q284 140 220 150 Q162 180 108 150 Q38 160 18 104 Z" fill="${PAPER}" stroke="${INK}" stroke-width="6" stroke-dasharray="5 8" stroke-linecap="round"/><path d="M84 146 L56 174 L114 150" fill="${PAPER}" stroke="${INK}" stroke-width="6" stroke-dasharray="5 8"/>`),

  // Flattened SFX assets — editable SFX remain available in the dedicated SFX library.
  asset("sfx-bang", "쾅! 타이틀", "sfx", ["쾅", "bang", "impact", "충격"], 300, 160, sfxText("쾅!")),
  asset("sfx-crash", "와장창! 타이틀", "sfx", ["와장창", "crash", "glass", "파괴"], 300, 160, sfxText("와장창!", { fill: ACCENT, size: 50, rotate: -7 })),
  asset("sfx-heartbeat", "두근두근 타이틀", "sfx", ["두근", "heartbeat", "romance", "긴장"], 300, 160, sfxText("두근두근", { fill: PINK, size: 48, rotate: 3 })),
  asset("sfx-whoosh", "슈욱 타이틀", "sfx", ["슈욱", "whoosh", "motion", "이동"], 300, 160, sfxText("슈욱", { fill: COOL, size: 62, rotate: -14 })),
  asset("sfx-step", "타박타박 타이틀", "sfx", ["타박", "step", "walk", "발걸음"], 300, 160, sfxText("타박타박", { fill: PAPER, size: 46, rotate: 0 })),
  asset("sfx-shiver", "오싹 타이틀", "sfx", ["오싹", "chill", "horror", "공포"], 300, 160, sfxText("오싹…", { fill: COOL, size: 58, rotate: 2 })),
  asset("sfx-sparkle", "반짝 타이틀", "sfx", ["반짝", "sparkle", "shine", "빛"], 300, 160, sfxText("반짝", { fill: YELLOW, size: 58, rotate: 4 })),
  asset("sfx-rumble", "쿠구궁 타이틀", "sfx", ["쿠구궁", "rumble", "quake", "진동"], 300, 160, sfxText("쿠구궁", { fill: ACCENT, size: 55, rotate: -2 })),
  asset("sfx-silence", "정적 타이틀", "sfx", ["정적", "silence", "quiet", "고요"], 300, 160, sfxText("…정적…", { fill: PAPER, size: 44, rotate: 0 })),
  asset("sfx-beep", "삐빅 타이틀", "sfx", ["삐빅", "beep", "digital", "기계음"], 300, 160, sfxText("삐빅", { fill: COOL, size: 58, rotate: 0 })),

  // Manga action and atmosphere overlays.
  asset("effect-speed-right", "오른쪽 속도선", "effect", ["speed", "motion", "right", "속도선"], 320, 230, horizontalSpeedLines("right")),
  asset("effect-speed-left", "왼쪽 속도선", "effect", ["speed", "motion", "left", "속도선"], 320, 230, horizontalSpeedLines("left")),
  asset("effect-speed-vertical", "낙하 속도선", "effect", ["speed", "fall", "vertical", "낙하"], 300, 240, verticalSpeedLines()),
  asset("effect-focus-center", "중앙 집중선", "effect", ["focus", "radial", "집중선", "시선"], 280, 280,
    radialStrokes(280, 280, 32, 56, 136, { strokeWidth: 3.5 })),
  asset("effect-focus-corner", "코너 집중선", "effect", ["focus", "corner", "집중선", "등장"], 300, 250,
    radialStrokes(300, 250, 26, 30, 330, { centerX: 16, centerY: 232, strokeWidth: 3 })),
  asset("effect-impact-rings", "임팩트 링", "effect", ["impact", "ring", "shockwave", "충격파"], 280, 280,
    `<circle cx="140" cy="140" r="38" fill="none" stroke="${INK}" stroke-width="9"/><circle cx="140" cy="140" r="78" fill="none" stroke="${INK}" stroke-width="7" opacity="0.8"/><circle cx="140" cy="140" r="120" fill="none" stroke="${INK}" stroke-width="5" opacity="0.55"/>`),
  asset("effect-shock-marks", "충격 마크", "effect", ["shock", "surprise", "marks", "당황"], 260, 220,
    `<path d="M48 28 L76 98 M128 12 L130 92 M210 30 L178 100" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/><circle cx="78" cy="134" r="9" fill="${INK}"/><circle cx="130" cy="126" r="9" fill="${INK}"/><circle cx="176" cy="136" r="9" fill="${INK}"/>`),
  asset("effect-rain", "빗줄기", "effect", ["rain", "weather", "비", "우천"], 300, 260,
    Array.from({ length: 22 }, (_, index) => {
      const x = (index * 43) % 320 - 20;
      const y = (index * 67) % 200 - 20;
      return `<line x1="${x}" y1="${y}" x2="${x - 30}" y2="${y + 74}" stroke="${COOL}" stroke-width="${3 + (index % 3)}" stroke-linecap="round"/>`;
    }).join("")),
  asset("effect-gloom", "우울 세로선", "effect", ["gloom", "sad", "우울", "좌절"], 300, 230,
    Array.from({ length: 19 }, (_, index) => `<path d="M${12 + index * 16} 8 V${120 + (index % 5) * 20}" stroke="${INK}" stroke-width="${3 + (index % 3)}" stroke-linecap="round" opacity="${0.55 + (index % 4) * 0.1}"/>`).join("")),
  asset("effect-motion-arcs", "회전 모션 아크", "effect", ["motion", "arc", "spin", "회전"], 300, 240,
    `<path d="M36 146 C64 34 222 12 270 102" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M58 174 C98 76 220 68 254 134" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" opacity="0.72"/><path d="M236 72 L278 104 L230 116" fill="${INK}"/>`),

  // Ready-to-place full-bleed background patterns.
  asset("pattern-halftone", "하프톤 도트 배경", "pattern", ["halftone", "dots", "screen tone", "망점"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/>${dotField(300, 220, 22, 4.2)}`),
  asset("pattern-grid", "모눈 배경", "pattern", ["grid", "graph", "격자", "모눈"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/>${gridField(300, 220, 28)}`),
  asset("pattern-diagonal", "사선 배경", "pattern", ["diagonal", "stripe", "사선", "해칭"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/>${gridField(300, 220, 24, true)}`),
  asset("pattern-crosshatch", "교차 해칭 배경", "pattern", ["crosshatch", "ink", "빗금", "음영"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/>${gridField(300, 220, 30, true)}<g transform="translate(300 0) scale(-1 1)">${gridField(300, 220, 30, true)}</g>`),
  asset("pattern-checker", "체커 배경", "pattern", ["checker", "chess", "체크", "픽셀"], 300, 220,
    `<defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="${INK}"/><rect x="20" y="20" width="20" height="20" fill="${INK}"/></pattern></defs><rect width="300" height="220" fill="${PAPER}"/><rect width="300" height="220" fill="url(#p)"/>`),
  asset("pattern-stars", "별무늬 배경", "pattern", ["stars", "night", "별", "밤"], 300, 220,
    `<rect width="300" height="220" fill="${INK}"/><defs><pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M18 7 L21 15 L30 15 L23 20 L26 29 L18 24 L10 29 L13 20 L6 15 L15 15 Z" fill="${YELLOW}"/><circle cx="48" cy="44" r="3" fill="${PAPER}"/></pattern></defs><rect width="300" height="220" fill="url(#p)"/>`),
  asset("pattern-hearts", "하트 배경", "pattern", ["hearts", "romance", "하트", "로맨스"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/><defs><pattern id="p" width="58" height="54" patternUnits="userSpaceOnUse"><path d="M29 38 C12 25 12 12 21 9 C26 7 29 11 29 15 C29 11 32 7 37 9 C46 12 46 25 29 38 Z" fill="${PINK}"/></pattern></defs><rect width="300" height="220" fill="url(#p)"/>`),
  asset("pattern-waves", "물결 배경", "pattern", ["waves", "water", "물결", "바다"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/><defs><pattern id="p" width="64" height="32" patternUnits="userSpaceOnUse"><path d="M0 16 C12 2 20 2 32 16 S52 30 64 16" fill="none" stroke="${COOL}" stroke-width="5"/></pattern></defs><rect width="300" height="220" fill="url(#p)"/>`),
  asset("pattern-bricks", "벽돌 배경", "pattern", ["brick", "wall", "벽돌", "건물"], 300, 220,
    `<rect width="300" height="220" fill="${PAPER}"/><defs><pattern id="p" width="72" height="44" patternUnits="userSpaceOnUse"><path d="M0 0 H72 V44 H0 Z M0 22 H72 M36 0 V22 M18 22 V44 M54 22 V44" fill="none" stroke="${INK}" stroke-width="3"/></pattern></defs><rect width="300" height="220" fill="url(#p)"/>`),
  asset("pattern-sparkles", "스파클 배경", "pattern", ["sparkle", "glitter", "반짝", "빛"], 300, 220,
    `<rect width="300" height="220" fill="${INK}"/><defs><pattern id="p" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M18 5 L22 18 L35 22 L22 26 L18 39 L14 26 L1 22 L14 18 Z" fill="${YELLOW}"/><path d="M54 36 L57 45 L66 48 L57 51 L54 60 L51 51 L42 48 L51 45 Z" fill="${PAPER}"/></pattern></defs><rect width="300" height="220" fill="url(#p)"/>`),
]);
