import type { FxOverlay } from "./studio-fx-assets";

const INK = "#16100c";
const WHITE = "#ffffff";

function svg(width: number, height: number, body: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function prop(id: string, label: string, width: number, height: number, body: string): FxOverlay {
  return { id, label, svg: svg(width, height, body), width, height };
}

function shadow(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}" opacity="0.12"/>`;
}

export const PROP_STICKERS: FxOverlay[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 디지털·기기 (8)
  // ──────────────────────────────────────────────────────────────────────────
  prop(
    "prop-smartphone",
    "스마트폰",
    200,
    240,
    `${shadow(100, 225, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="50" y="30" width="100" height="180" rx="16" fill="#4a5568" />` +
      `<rect x="60" y="44" width="80" height="146" rx="8" fill="#e0f2fe" />` +
      `<path d="M85 36 H115" stroke-width="5" />` +
      `<circle cx="100" cy="204" r="5" fill="${WHITE}" />` +
      `<path d="M100 116 C95 106, 80 106, 80 119 C80 133, 100 146, 100 146 C100 146, 120 133, 120 119 C120 106, 105 106, 100 116 Z" fill="#ff7096" stroke-width="4" />` +
      `</g>`,
  ),
  prop(
    "prop-notebook",
    "노트북",
    240,
    200,
    `${shadow(120, 185, 95, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="45,145 55,40 185,40 195,145" fill="#cbd5e1" />` +
      `<polygon points="53,135 60,50 180,50 187,135" fill="#1e3a8a" />` +
      `<path d="M75 70 H115 M75 85 H155 M75 100 H135" stroke="#00f2ff" stroke-width="5" fill="none" />` +
      `<polygon points="30,145 210,145 225,175 15,175" fill="#94a3b8" />` +
      `<line x1="50" y1="160" x2="190" y2="160" stroke-dasharray="10,5" stroke-width="5" />` +
      `<rect x="105" y="166" width="30" height="7" rx="2" fill="#cbd5e1" />` +
      `</g>`,
  ),
  prop(
    "prop-tablet",
    "태블릿",
    240,
    200,
    `${shadow(120, 185, 90, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="35" y="30" width="170" height="130" rx="14" fill="#334155" />` +
      `<rect x="47" y="42" width="146" height="106" rx="8" fill="#e0f2fe" />` +
      `<circle cx="120" cy="95" r="28" fill="#fde047" />` +
      `<path d="M110 90 V92 M130 90 V92" fill="none" stroke-width="5" />` +
      `<path d="M112 105 Q120 113 128 105" fill="none" stroke-width="5" />` +
      `<polygon points="200,130 220,70 227,73 207,133" fill="${WHITE}" />` +
      `<polygon points="200,130 204,118 200,118" fill="#64748b" />` +
      `</g>`,
  ),
  prop(
    "prop-earphones",
    "이어폰",
    220,
    220,
    `${shadow(110, 195, 55, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="70" y="140" width="80" height="55" rx="18" fill="#e0e7ff" />` +
      `<rect x="70" y="140" width="80" height="14" rx="6" fill="#c7d2fe" />` +
      `<circle cx="110" cy="168" r="4" fill="#34d399" stroke="none" />` +
      `<circle cx="82" cy="95" r="20" fill="${WHITE}" />` +
      `<circle cx="82" cy="95" r="9" fill="#c7d2fe" stroke="none" />` +
      `<rect x="75" y="108" width="14" height="32" rx="7" fill="${WHITE}" />` +
      `<circle cx="138" cy="95" r="20" fill="${WHITE}" />` +
      `<circle cx="138" cy="95" r="9" fill="#c7d2fe" stroke="none" />` +
      `<rect x="131" y="108" width="14" height="32" rx="7" fill="${WHITE}" />` +
      `</g>`,
  ),
  prop(
    "prop-camera",
    "카메라",
    220,
    200,
    `${shadow(110, 185, 75, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="35" y="55" width="150" height="100" rx="15" fill="#fbbf24" />` +
      `<rect x="35" y="55" width="150" height="35" rx="6" fill="#374151" />` +
      `<rect x="50" y="44" width="25" height="12" rx="3" fill="#e2e8f0" />` +
      `<rect x="140" y="44" width="25" height="12" rx="3" fill="#94a3b8" />` +
      `<circle cx="110" cy="112" r="38" fill="#1e293b" />` +
      `<circle cx="110" cy="112" r="24" fill="#0f172a" />` +
      `<circle cx="102" cy="104" r="7" fill="${WHITE}" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-gamepad",
    "게임패드",
    240,
    200,
    `${shadow(120, 180, 85, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M50 70 H190 C220 70, 235 100, 215 150 C205 170, 175 155, 155 135 H85 C65 155, 35 170, 25 150 C5 100, 20 70, 50 70 Z" fill="#c084fc" />` +
      `<path d="M60 115 H90 M75 100 V130" stroke-width="7" fill="none" />` +
      `<circle cx="140" cy="120" r="15" fill="#475569" />` +
      `<circle cx="140" cy="120" r="8" fill="#1e293b" />` +
      `<circle cx="170" cy="100" r="9" fill="#ef4444" />` +
      `<circle cx="190" cy="115" r="9" fill="#3b82f6" />` +
      `<circle cx="170" cy="130" r="9" fill="#10b981" />` +
      `</g>`,
  ),
  prop(
    "prop-monitor",
    "TV/모니터",
    240,
    220,
    `${shadow(120, 205, 75, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="30" y="30" width="180" height="130" rx="10" fill="#1e293b" />` +
      `<rect x="40" y="40" width="160" height="110" rx="4" fill="#ffedd5" />` +
      `<path d="M40 120 Q80 100 120 125 T200 115 L200 150 L40 150 Z" fill="#86efac" stroke="none" />` +
      `<circle cx="120" cy="100" r="25" fill="#f97316" stroke="none" />` +
      `<path d="M40 120 Q80 100 120 125 T200 115" fill="none" stroke-width="5" />` +
      `<polygon points="105,160 135,160 145,195 95,195" fill="#334155" />` +
      `<rect x="70" y="195" width="100" height="10" rx="4" fill="#1e293b" />` +
      `</g>`,
  ),
  prop(
    "prop-headphones",
    "헤드폰",
    220,
    240,
    `${shadow(110, 225, 75, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M45 130 C45 50, 175 50, 175 130" fill="none" stroke-width="12" />` +
      `<rect x="30" y="110" width="32" height="65" rx="16" fill="#f472b6" />` +
      `<rect x="158" y="110" width="32" height="65" rx="16" fill="#f472b6" />` +
      `<rect x="54" y="118" width="12" height="49" rx="6" fill="#e2e8f0" />` +
      `<rect x="154" y="118" width="12" height="49" rx="6" fill="#e2e8f0" />` +
      `<path d="M46 142 C44 138, 38 138, 38 143 C38 148, 46 153, 46 153 C46 153, 54 148, 54 143 C54 138, 48 138, 46 142 Z" fill="${WHITE}" stroke="none" />` +
      `<path d="M174 142 C172 138, 166 138, 166 143 C166 148, 174 153, 174 153 C174 153, 182 148, 182 143 C182 138, 176 138, 174 142 Z" fill="${WHITE}" stroke="none" />` +
      `</g>`,
  ),

  // ──────────────────────────────────────────────────────────────────────────
  // 음식·음료 (11)
  // ──────────────────────────────────────────────────────────────────────────
  prop(
    "prop-coffee-cup",
    "커피컵(테이크아웃)",
    200,
    240,
    `${shadow(100, 225, 55, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M105 85 L115 45 L135 40" fill="none" stroke="#10b981" stroke-width="12" />` +
      `<polygon points="60,95 140,95 130,215 70,215" fill="#fbcfe8" />` +
      `<polygon points="56,125 144,125 137,175 63,175" fill="#d97706" />` +
      `<ellipse cx="100" cy="95" rx="44" ry="12" fill="#e2e8f0" />` +
      `<rect x="80" y="83" width="40" height="12" rx="4" fill="#e2e8f0" />` +
      `</g>`,
  ),
  prop(
    "prop-mug",
    "머그컵",
    220,
    200,
    `${shadow(100, 185, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M145 95 C175 95, 175 155, 145 155" fill="none" stroke-width="12" />` +
      `<rect x="50" y="75" width="100" height="110" rx="15" fill="#f87171" />` +
      `<ellipse cx="100" cy="75" rx="50" ry="12" fill="#78350f" />` +
      `<ellipse cx="100" cy="75" rx="44" ry="8" fill="#92400e" stroke="none" />` +
      `<path d="M80 45 Q85 30 80 18 M105 45 Q110 30 105 18 M130 45 Q135 30 130 18" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-cake",
    "케이크조각",
    220,
    220,
    `${shadow(110, 205, 80, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="40,170 180,170 180,90 40,120" fill="#fef08a" />` +
      `<polygon points="40,145 180,145 180,135 40,115" fill="${WHITE}" />` +
      `<polygon points="40,120 180,90 180,75 40,105" fill="#fbcfe8" />` +
      `<path d="M120 85 C110 70, 110 50, 125 50 C140 50, 140 70, 130 85 Z" fill="#ef4444" />` +
      `<path d="M120 50 Q125 40 130 50" fill="none" stroke="#10b981" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-donut",
    "도넛",
    200,
    200,
    `${shadow(100, 185, 75, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M100 25 A75 75 0 1 0 100 175 A75 75 0 1 0 100 25 Z M100 75 A25 25 0 1 1 100 125 A25 25 0 1 1 100 75 Z" fill-rule="evenodd" fill="#f59e0b" />` +
      `<path d="M100 35 C135 35, 165 55, 165 100 C165 130, 140 165, 100 165 C60 165, 35 130, 35 100 C35 55, 65 35, 100 35 Z M100 75 A25 25 0 1 1 100 125 A25 25 0 1 1 100 75 Z" fill-rule="evenodd" fill="#f472b6" />` +
      `<line x1="75" y1="80" x2="85" y2="75" stroke="${WHITE}" stroke-width="5" />` +
      `<line x1="120" y1="70" x2="130" y2="75" stroke="#facc15" stroke-width="5" />` +
      `<line x1="135" y1="110" x2="125" y2="115" stroke="#60a5fa" stroke-width="5" />` +
      `<line x1="80" y1="120" x2="90" y2="125" stroke="${WHITE}" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-hamburger",
    "햄버거",
    220,
    220,
    `${shadow(110, 205, 80, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M40 165 C40 190, 180 190, 180 165 Z" fill="#f59e0b" />` +
      `<rect x="30" y="140" width="160" height="28" rx="10" fill="#78350f" />` +
      `<polygon points="35,135 185,135 170,150 135,140 105,155 70,140" fill="#fde047" />` +
      `<rect x="32" y="122" width="156" height="15" rx="7" fill="#ef4444" />` +
      `<path d="M20 122 C35 110, 50 130, 65 122 C80 110, 95 130, 110 122 C125 110, 140 130, 155 122 C170 110, 185 130, 200 122" fill="#22c55e" />` +
      `<path d="M30 115 C30 60, 190 60, 190 115 Z" fill="#f59e0b" />` +
      `<ellipse cx="70" cy="85" rx="3" ry="5" transform="rotate(30 70 85)" fill="${WHITE}" stroke="none" />` +
      `<ellipse cx="110" cy="75" rx="3" ry="5" transform="rotate(-15 110 75)" fill="${WHITE}" stroke="none" />` +
      `<ellipse cx="150" cy="85" rx="3" ry="5" transform="rotate(45 150 85)" fill="${WHITE}" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-pizza",
    "피자조각",
    220,
    220,
    `${shadow(110, 205, 80, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M55 45 C105 30, 165 45, 185 85 L165 95 C145 65, 95 55, 45 65 Z" fill="#d97706" />` +
      `<polygon points="50,60 165,90 55,185" fill="#fde047" />` +
      `<circle cx="85" cy="100" r="12" fill="#ef4444" />` +
      `<circle cx="125" cy="105" r="12" fill="#ef4444" />` +
      `<circle cx="85" cy="140" r="12" fill="#ef4444" />` +
      `<circle cx="110" cy="135" r="5" fill="#1f2937" />` +
      `</g>`,
  ),
  prop(
    "prop-ramen",
    "라면(김 모락)",
    240,
    220,
    `${shadow(120, 205, 80, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M40 120 C40 190, 200 190, 200 120 Z" fill="#dc2626" />` +
      `<ellipse cx="120" cy="120" rx="80" ry="18" fill="#ea580c" />` +
      `<path d="M50 120 Q60 100 70 120 T90 120 T110 120 T130 120 T150 120 T170 120 T190 120" fill="none" stroke="#fde047" stroke-width="8" />` +
      `<path d="M110 120 Q115 105 125 110 T140 105" fill="none" stroke="#fde047" stroke-width="8" />` +
      `<line x1="85" y1="105" x2="215" y2="75" stroke="#fbbf24" stroke-width="9" />` +
      `<line x1="85" y1="113" x2="215" y2="83" stroke="#fbbf24" stroke-width="9" />` +
      `<ellipse cx="90" cy="130" rx="18" ry="12" fill="${WHITE}" />` +
      `<ellipse cx="90" cy="130" rx="10" ry="7" fill="#fbbf24" />` +
      `<rect x="140" y="122" width="8" height="12" rx="2" transform="rotate(20 140 122)" fill="#10b981" />` +
      `<rect x="155" y="125" width="8" height="12" rx="2" transform="rotate(-30 155 125)" fill="#10b981" />` +
      `<path d="M90 85 Q95 70 90 55 M120 85 Q125 70 120 55 M150 85 Q155 70 150 55" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-icecream",
    "아이스크림콘",
    200,
    260,
    `${shadow(100, 245, 45, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="60,150 140,150 100,240" fill="#d97706" />` +
      `<line x1="70" y1="170" x2="120" y2="200" stroke-width="4" />` +
      `<line x1="80" y1="195" x2="110" y2="215" stroke-width="4" />` +
      `<line x1="130" y1="170" x2="80" y2="200" stroke-width="4" />` +
      `<line x1="120" y1="195" x2="90" y2="215" stroke-width="4" />` +
      `<circle cx="100" cy="140" r="42" fill="#a7f3d0" />` +
      `<rect x="85" y="130" width="6" height="6" rx="1" fill="#78350f" stroke="none" />` +
      `<rect x="115" y="125" width="6" height="6" rx="1" fill="#78350f" stroke="none" />` +
      `<rect x="100" y="145" width="6" height="6" rx="1" fill="#78350f" stroke="none" />` +
      `<circle cx="100" cy="90" r="38" fill="#fbcfe8" />` +
      `<circle cx="100" cy="48" r="14" fill="#dc2626" />` +
      `<path d="M100 34 Q115 15 110 5" fill="none" stroke-width="4" />` +
      `</g>`,
  ),
  prop(
    "prop-milk",
    "우유팩",
    200,
    240,
    `${shadow(100, 225, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="50,90 150,90 150,210 50,210" fill="${WHITE}" />` +
      `<polygon points="50,90 100,50 150,90" fill="#fbcfe8" />` +
      `<line x1="100" y1="50" x2="100" y2="90" stroke-width="7" />` +
      `<rect x="50" y="90" width="100" height="25" fill="#fbcfe8" />` +
      `<path d="M90 145 C80 135, 80 120, 100 120 C120 120, 120 135, 110 145 C110 145, 100 155, 100 155 C100 155, 90 145, 90 145 Z" fill="#ef4444" />` +
      `<path d="M97 120 Q100 112 103 120" fill="none" stroke="#10b981" stroke-width="4" />` +
      `<path d="M70 175 H90 M80 175 V195 M110 175 H130 M120 175 V195" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-soda-can",
    "탄산음료캔",
    200,
    220,
    `${shadow(100, 205, 50, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="55" y="45" width="90" height="150" rx="14" fill="#3b82f6" />` +
      `<ellipse cx="100" cy="45" rx="45" ry="12" fill="#cbd5e1" />` +
      `<ellipse cx="100" cy="195" rx="45" ry="12" fill="#94a3b8" />` +
      `<rect x="92" y="32" width="16" height="10" rx="3" fill="#94a3b8" />` +
      `<polygon points="105,75 118,105 100,105 110,135 88,95 106,95" fill="#facc15" />` +
      `</g>`,
  ),
  prop(
    "prop-tteokbokki",
    "떡볶이/분식",
    240,
    220,
    `${shadow(120, 200, 85, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="120" cy="125" rx="85" ry="48" fill="#047857" />` +
      `<circle cx="70" cy="110" r="3" fill="${WHITE}" stroke="none" />` +
      `<circle cx="170" cy="130" r="4" fill="${WHITE}" stroke="none" />` +
      `<circle cx="100" cy="150" r="3" fill="${WHITE}" stroke="none" />` +
      `<circle cx="150" cy="105" r="4" fill="${WHITE}" stroke="none" />` +
      `<rect x="65" y="110" width="45" height="18" rx="9" transform="rotate(15 65 110)" fill="#f97316" />` +
      `<rect x="110" y="105" width="45" height="18" rx="9" transform="rotate(-10 110 105)" fill="#f97316" />` +
      `<rect x="85" y="125" width="45" height="18" rx="9" transform="rotate(35 85 125)" fill="#f97316" />` +
      `<rect x="130" y="120" width="45" height="18" rx="9" transform="rotate(-25 130 120)" fill="#f97316" />` +
      `<rect x="100" y="135" width="45" height="18" rx="9" transform="rotate(5 100 135)" fill="#f97316" />` +
      `<ellipse cx="155" cy="130" rx="16" ry="12" fill="${WHITE}" />` +
      `<ellipse cx="155" cy="130" rx="9" ry="7" fill="#facc15" />` +
      `<line x1="85" y1="120" x2="60" y2="70" stroke="#d97706" stroke-width="6" />` +
      `</g>`,
  ),

  // ──────────────────────────────────────────────────────────────────────────
  // 학용품·문구 (8)
  // ──────────────────────────────────────────────────────────────────────────
  prop(
    "prop-book-open",
    "책(펼친 책)",
    240,
    200,
    `${shadow(120, 185, 90, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M30 150 C70 160, 120 150, 120 150 C120 150, 170 160, 210 150 L200 75 C160 85, 120 75, 120 75 C120 75, 80 85, 40 75 Z" fill="#6d28d9" />` +
      `<path d="M35 145 C75 155, 120 145, 120 145 C120 145, 165 155, 205 145 L195 70 C155 80, 120 70, 120 70 C120 70, 85 80, 45 70 Z" fill="#fffbeb" />` +
      `<line x1="120" y1="70" x2="120" y2="145" stroke-width="5" />` +
      `<path d="M120 145 Q125 170 140 175" fill="none" stroke="#ef4444" stroke-width="8" />` +
      `<path d="M55 90 H95 M55 105 H100 M55 120 H85 M140 90 H180 M140 105 H185 M140 120 H165" fill="none" stroke-width="4" stroke="#d1d5db" />` +
      `</g>`,
  ),
  prop(
    "prop-notebook-ruled",
    "노트",
    200,
    240,
    `${shadow(100, 225, 65, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="45" y="35" width="115" height="170" rx="10" fill="#f97316" />` +
      `<rect x="55" y="35" width="105" height="170" rx="4" fill="#ffffff" />` +
      `<path d="M40 50 H55 M40 70 H55 M40 90 H55 M40 110 H55 M40 130 H55 M40 150 H55 M40 170 H55 M40 190 H55" fill="none" stroke-width="6" />` +
      `<path d="M70 65 H140 M70 85 H140 M70 105 H140 M70 125 H140 M70 145 H140 M70 165 H140" fill="none" stroke-width="4" stroke="#93c5fd" />` +
      `<polygon points="125,75 130,85 140,87 132,94 135,104 125,99 115,104 118,94 110,87 120,85" fill="#facc15" />` +
      `</g>`,
  ),
  prop(
    "prop-pencil",
    "연필",
    220,
    220,
    `${shadow(100, 205, 20, 6)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="85" y="55" width="30" height="110" rx="3" fill="#fbbf24" />` +
      `<path d="M85 55 C85 40, 115 40, 115 55 Z" fill="#f472b6" />` +
      `<rect x="85" y="55" width="30" height="12" fill="#cbd5e1" />` +
      `<polygon points="85,165 115,165 100,195" fill="#fde047" />` +
      `<polygon points="93,179 107,179 100,195" fill="#475569" />` +
      `<line x1="95" y1="67" x2="95" y2="165" stroke-width="4" />` +
      `<line x1="105" y1="67" x2="105" y2="165" stroke-width="4" />` +
      `</g>`,
  ),
  prop(
    "prop-pen",
    "펜",
    220,
    220,
    `${shadow(115, 190, 45, 8)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="90" y="40" width="20" height="120" rx="4" fill="#0d9488" />` +
      `<rect x="90" y="130" width="20" height="8" fill="#fbbf24" stroke="none" />` +
      `<line x1="90" y1="130" x2="110" y2="130" stroke-width="5" />` +
      `<line x1="90" y1="138" x2="110" y2="138" stroke-width="5" />` +
      `<polygon points="93,160 107,160 105,185 95,185" fill="#fbbf24" />` +
      `<line x1="100" y1="160" x2="100" y2="175" stroke-width="4" fill="none" />` +
      `<rect x="120" y="100" width="22" height="60" rx="4" fill="#0d9488" />` +
      `<path d="M136 100 V130" stroke-width="6" fill="none" />` +
      `</g>`,
  ),
  prop(
    "prop-backpack",
    "가방(백팩)",
    220,
    240,
    `${shadow(110, 225, 75, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M90 50 C90 30, 130 30, 130 50" fill="none" stroke-width="8" />` +
      `<path d="M68 58 C56 62, 56 96, 68 104" fill="none" stroke-width="9" />` +
      `<path d="M152 58 C164 62, 164 96, 152 104" fill="none" stroke-width="9" />` +
      `<rect x="50" y="50" width="120" height="150" rx="30" fill="#1e3a8a" />` +
      `<rect x="65" y="120" width="90" height="70" rx="15" fill="#3b82f6" />` +
      `<line x1="110" y1="128" x2="110" y2="182" stroke-width="4" stroke-dasharray="3,8" />` +
      `<polygon points="102,150 118,150 110,163" fill="#facc15" />` +
      `<polygon points="120,66 124,76 135,77 127,84 129,95 120,89 111,95 113,84 105,77 116,76" fill="#fbbf24" stroke-width="4" />` +
      `<rect x="170" y="110" width="12" height="35" fill="#facc15" />` +
      `<path d="M165 125 H178 V150 H165 Z" fill="#4b5563" />` +
      `</g>`,
  ),
  prop(
    "prop-magnifier",
    "돋보기",
    220,
    220,
    `${shadow(135, 175, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<line x1="130" y1="130" x2="185" y2="185" stroke="#92400e" stroke-width="20" />` +
      `<line x1="130" y1="130" x2="185" y2="185" stroke-width="7" />` +
      `<circle cx="95" cy="95" r="50" fill="#cbd5e1" />` +
      `<circle cx="95" cy="95" r="38" fill="#e0f2fe" />` +
      `<path d="M70 80 A25 25 0 0 1 110 70" fill="none" stroke="${WHITE}" stroke-width="8" />` +
      `</g>`,
  ),
  prop(
    "prop-clipboard",
    "클립보드",
    200,
    240,
    `${shadow(100, 225, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="45" y="45" width="110" height="165" rx="8" fill="#b45309" />` +
      `<rect x="55" y="60" width="90" height="140" rx="4" fill="${WHITE}" />` +
      `<rect x="85" y="32" width="30" height="20" rx="4" fill="#94a3b8" />` +
      `<circle cx="100" cy="42" r="3" fill="#475569" />` +
      `<path d="M70 90 L75 95 L85 85 M70 120 L75 125 L85 115 M70 150 L75 155 L85 145" fill="none" stroke="#22c55e" stroke-width="5" />` +
      `<path d="M95 90 H130 M95 120 H130 M95 150 H130" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-mortarboard",
    "졸업모",
    240,
    200,
    `${shadow(120, 185, 80, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M70 110 V145 C70 160, 170 160, 170 145 V110" fill="#1f2937" />` +
      `<polygon points="120,60 215,95 120,130 25,95" fill="#374151" />` +
      `<ellipse cx="120" cy="95" rx="8" ry="5" fill="#1f2937" />` +
      `<path d="M120 95 C145 100, 175 110, 175 130 L180 155" fill="none" stroke="#fbbf24" stroke-width="6" />` +
      `<rect x="174" y="150" width="12" height="15" rx="2" fill="#fbbf24" />` +
      `</g>`,
  ),

  // ──────────────────────────────────────────────────────────────────────────
  // 생활·소품 (12)
  // ──────────────────────────────────────────────────────────────────────────
  prop(
    "prop-umbrella",
    "우산",
    240,
    240,
    `${shadow(120, 225, 65, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<line x1="120" y1="180" x2="120" y2="215" stroke-width="8" />` +
      `<path d="M120 215 C120 225, 140 225, 140 215" fill="none" stroke-width="8" />` +
      `<line x1="120" y1="40" x2="120" y2="60" stroke-width="8" />` +
      `<path d="M45 130 C45 60, 195 60, 195 130 C170 120, 145 120, 120 130 C95 120, 70 120, 45 130 Z" fill="#ef4444" />` +
      `<path d="M120 60 Q120 130 120 130 M120 60 Q82 100 70 123 M120 60 Q158 100 170 123" fill="none" stroke-width="5" />` +
      `<path d="M30 70 Q30 85 25 90 M210 80 Q210 95 205 100" fill="none" stroke="#38bdf8" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-wall-clock",
    "시계(벽시계)",
    220,
    220,
    `${shadow(110, 205, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="110" cy="110" r="75" fill="#93c5fd" />` +
      `<circle cx="110" cy="110" r="60" fill="${WHITE}" />` +
      `<path d="M70 65 A50 50 0 0 1 145 62" fill="none" stroke="#e0f2fe" stroke-width="8" opacity="0.8" />` +
      `<line x1="110" y1="58" x2="110" y2="68" stroke-width="5" />` +
      `<line x1="110" y1="162" x2="110" y2="152" stroke-width="5" />` +
      `<line x1="58" y1="110" x2="68" y2="110" stroke-width="5" />` +
      `<line x1="162" y1="110" x2="152" y2="110" stroke-width="5" />` +
      `<circle cx="75" cy="75" r="3" fill="#1f2937" stroke="none" />` +
      `<circle cx="145" cy="75" r="3" fill="#1f2937" stroke="none" />` +
      `<circle cx="75" cy="145" r="3" fill="#1f2937" stroke="none" />` +
      `<circle cx="145" cy="145" r="3" fill="#1f2937" stroke="none" />` +
      `<line x1="110" y1="110" x2="110" y2="80" stroke-width="7" />` +
      `<line x1="110" y1="110" x2="135" y2="120" stroke-width="7" />` +
      `<line x1="110" y1="110" x2="118" y2="72" stroke="#ef4444" stroke-width="3" />` +
      `<circle cx="110" cy="110" r="8" fill="#1f2937" />` +
      `</g>`,
  ),
  prop(
    "prop-alarm-clock",
    "알람시계",
    220,
    220,
    `${shadow(110, 205, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<line x1="70" y1="170" x2="55" y2="195" stroke-width="8" />` +
      `<line x1="150" y1="170" x2="165" y2="195" stroke-width="8" />` +
      `<path d="M55 58 C40 70, 60 90, 75 78 Z" fill="#cbd5e1" />` +
      `<path d="M165 58 C180 70, 160 90, 145 78 Z" fill="#cbd5e1" />` +
      `<path d="M100 45 H120 M110 45 V60" stroke-width="8" fill="none" />` +
      `<circle cx="110" cy="120" r="60" fill="#ef4444" />` +
      `<circle cx="110" cy="120" r="48" fill="${WHITE}" />` +
      `<line x1="110" y1="120" x2="110" y2="95" stroke-width="6" />` +
      `<line x1="110" y1="120" x2="130" y2="130" stroke-width="6" />` +
      `<circle cx="110" cy="120" r="6" fill="#1f2937" />` +
      `<path d="M35 50 Q20 65 30 80 M185 50 Q200 65 190 80" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-key",
    "열쇠",
    220,
    220,
    `${shadow(110, 195, 60, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<line x1="85" y1="85" x2="165" y2="165" stroke="#fde047" stroke-width="14" />` +
      `<circle cx="65" cy="65" r="25" fill="#fde047" />` +
      `<circle cx="65" cy="65" r="8" fill="#ffffff" />` +
      `<polygon points="150,150 170,130 180,140 168,152 180,164 165,179 148,162" fill="#fde047" />` +
      `</g>`,
  ),
  prop(
    "prop-padlock",
    "자물쇠",
    200,
    220,
    `${shadow(100, 205, 55, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M65 100 V70 C65 40, 135 40, 135 70 V100" fill="none" stroke="#94a3b8" stroke-width="14" />` +
      `<rect x="50" y="95" width="100" height="85" rx="15" fill="#fde047" />` +
      `<circle cx="100" cy="130" r="8" fill="#1e293b" />` +
      `<polygon points="96,130 104,130 106,155 94,155" fill="#1e293b" />` +
      `</g>`,
  ),
  prop(
    "prop-envelope",
    "편지봉투",
    220,
    200,
    `${shadow(110, 185, 75, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="35" y="50" width="150" height="100" rx="10" fill="#fef3c7" />` +
      `<path d="M35 50 L110 105 L185 50 M35 150 L85 110 M185 150 L135 110" fill="none" />` +
      `<circle cx="110" cy="110" r="14" fill="#ef4444" />` +
      `<path d="M110 114 C107 108, 98 108, 98 115 C98 123, 110 130, 110 130 C110 130, 122 123, 122 115 C122 108, 113 108, 110 114 Z" fill="${WHITE}" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-giftbox",
    "선물상자",
    220,
    220,
    `${shadow(110, 205, 70, 11)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="50" y="100" width="120" height="95" rx="8" fill="#a78bfa" />` +
      `<rect x="42" y="80" width="136" height="25" rx="6" fill="#c084fc" />` +
      `<rect x="100" y="80" width="20" height="115" fill="#facc15" />` +
      `<path d="M110 80 C90 50, 70 80, 110 80 Z" fill="#facc15" />` +
      `<path d="M110 80 C130 50, 150 80, 110 80 Z" fill="#facc15" />` +
      `<circle cx="110" cy="80" r="10" fill="#fde047" />` +
      `</g>`,
  ),
  prop(
    "prop-shopping-bag",
    "쇼핑백",
    200,
    240,
    `${shadow(100, 225, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M75 70 C75 40, 95 40, 95 70 M105 70 C105 40, 125 40, 125 70" fill="none" stroke-width="8" />` +
      `<polygon points="55,70 145,70 135,210 65,210" fill="#d97706" />` +
      `<path d="M100 135 C95 125, 80 125, 80 138 C80 152, 100 165, 100 165 C100 165, 120 152, 120 138 C120 125, 105 125, 100 135 Z" fill="#f472b6" />` +
      `</g>`,
  ),
  prop(
    "prop-balloon",
    "풍선",
    200,
    250,
    `${shadow(100, 240, 20, 4)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M100 160 Q85 190, 110 210 T95 235" fill="none" stroke-width="5" />` +
      `<ellipse cx="100" cy="95" rx="55" ry="65" fill="#f43f5e" />` +
      `<polygon points="93,160 107,160 100,150" fill="#f43f5e" />` +
      `<ellipse cx="80" cy="75" rx="10" ry="18" transform="rotate(-30 80 75)" fill="${WHITE}" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-glasses",
    "안경",
    240,
    180,
    `${shadow(120, 160, 80, 8)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="75" cy="90" r="35" fill="#e2e8f0" />` +
      `<circle cx="165" cy="90" r="35" fill="#e2e8f0" />` +
      `<line x1="60" y1="75" x2="80" y2="95" stroke="${WHITE}" stroke-width="6" />` +
      `<line x1="150" y1="75" x2="170" y2="95" stroke="${WHITE}" stroke-width="6" />` +
      `<path d="M110 90 Q120 82 130 90" fill="none" stroke-width="8" />` +
      `<path d="M40 90 L20 70 M200 90 L220 70" fill="none" stroke-width="8" />` +
      `</g>`,
  ),
  prop(
    "prop-pill-bottle",
    "약병",
    200,
    220,
    `${shadow(100, 205, 50, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="60" y="80" width="80" height="110" rx="10" fill="#ca8a04" />` +
      `<rect x="60" y="105" width="80" height="50" fill="${WHITE}" />` +
      `<line x1="70" y1="120" x2="130" y2="120" stroke-width="4" stroke="#94a3b8" />` +
      `<line x1="70" y1="135" x2="110" y2="135" stroke-width="4" stroke="#94a3b8" />` +
      `<rect x="52" y="60" width="96" height="20" rx="4" fill="#cbd5e1" />` +
      `<line x1="70" y1="60" x2="70" y2="80" stroke-width="4" />` +
      `<line x1="85" y1="60" x2="85" y2="80" stroke-width="4" />` +
      `<line x1="100" y1="60" x2="100" y2="80" stroke-width="4" />` +
      `<line x1="115" y1="60" x2="115" y2="80" stroke-width="4" />` +
      `<line x1="130" y1="60" x2="130" y2="80" stroke-width="4" />` +
      `<rect x="155" y="110" width="14" height="30" rx="7" transform="rotate(45 155 110)" fill="#ef4444" />` +
      `<rect x="155" y="110" width="14" height="15" rx="2" transform="rotate(45 155 110)" fill="${WHITE}" />` +
      `</g>`,
  ),
  prop(
    "prop-luggage",
    "캐리어",
    200,
    250,
    `${shadow(100, 235, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="75" y="25" width="50" height="40" rx="4" fill="none" stroke-width="8" />` +
      `<rect x="50" y="65" width="100" height="150" rx="20" fill="#2dd4bf" />` +
      `<line x1="50" y1="100" x2="150" y2="100" stroke-width="6" />` +
      `<line x1="50" y1="135" x2="150" y2="135" stroke-width="6" />` +
      `<line x1="50" y1="170" x2="150" y2="170" stroke-width="6" />` +
      `<circle cx="70" cy="223" r="10" fill="#475569" />` +
      `<circle cx="130" cy="223" r="10" fill="#475569" />` +
      `<polygon points="75,115 85,115 80,125" fill="#fbbf24" stroke="none" />` +
      `<rect x="115" y="145" width="18" height="12" rx="2" fill="#ef4444" stroke="none" />` +
      `</g>`,
  ),

  // ──────────────────────────────────────────────────────────────────────────
  // 자연·날씨 (10)
  // ──────────────────────────────────────────────────────────────────────────
  prop(
    "prop-sun",
    "해(햇살)",
    220,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="110" cy="110" r="45" fill="#facc15" />` +
      `<line x1="110" y1="45" x2="110" y2="25" stroke-width="8" />` +
      `<line x1="110" y1="175" x2="110" y2="195" stroke-width="8" />` +
      `<line x1="45" y1="110" x2="25" y2="110" stroke-width="8" />` +
      `<line x1="175" y1="110" x2="195" y2="110" stroke-width="8" />` +
      `<line x1="64" y1="64" x2="50" y2="50" stroke-width="8" />` +
      `<line x1="156" y1="156" x2="170" y2="170" stroke-width="8" />` +
      `<line x1="156" y1="64" x2="170" y2="50" stroke-width="8" />` +
      `<line x1="64" y1="156" x2="50" y2="170" stroke-width="8" />` +
      `<circle cx="98" cy="105" r="4" fill="${INK}" stroke="none" />` +
      `<circle cx="122" cy="105" r="4" fill="${INK}" stroke="none" />` +
      `<path d="M104 118 Q110 125 116 118" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-cloud",
    "구름",
    240,
    180,
    `<defs><linearGradient id="propCloudShade" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="55%" stop-color="${WHITE}" /><stop offset="100%" stop-color="#d3e0ee" /></linearGradient></defs>` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M50 120 C30 120, 30 90, 55 90 C55 65, 90 55, 115 75 C135 55, 175 60, 185 85 C210 85, 210 120, 190 120 Z" fill="url(#propCloudShade)" />` +
      `<ellipse cx="88" cy="82" rx="20" ry="12" fill="${WHITE}" opacity="0.9" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-rain-cloud",
    "비구름",
    240,
    220,
    `<defs><linearGradient id="propRainCloudShade" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="45%" stop-color="#8895a8" /><stop offset="100%" stop-color="#48566b" /></linearGradient></defs>` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M50 100 C30 100, 30 70, 55 70 C55 45, 90 35, 115 55 C135 35, 175 40, 185 65 C210 65, 210 100, 190 100 Z" fill="url(#propRainCloudShade)" />` +
      `<ellipse cx="90" cy="62" rx="18" ry="10" fill="#a9b6c6" opacity="0.85" stroke="none" />` +
      `<line x1="75" y1="125" x2="65" y2="155" stroke="#38bdf8" stroke-width="6" />` +
      `<line x1="110" y1="130" x2="100" y2="160" stroke="#38bdf8" stroke-width="6" />` +
      `<line x1="145" y1="125" x2="135" y2="155" stroke="#38bdf8" stroke-width="6" />` +
      `<line x1="175" y1="130" x2="165" y2="160" stroke="#38bdf8" stroke-width="6" />` +
      `</g>`,
  ),
  prop(
    "prop-lightning",
    "번개",
    200,
    240,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="120,25 50,125 105,125 70,215 160,105 105,105" fill="#facc15" />` +
      `<polygon points="118,45 76,120 112,120 92,180 145,100 108,100" fill="#fef08a" stroke="none" />` +
      `<circle cx="45" cy="70" r="6" fill="#fde047" stroke="none" />` +
      `<circle cx="168" cy="160" r="5" fill="#fde047" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-snowflake",
    "눈송이",
    220,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="110" cy="110" r="10" fill="#7dd3fc" />` +
      `<line x1="110" y1="40" x2="110" y2="180" stroke-width="8" />` +
      `<line x1="49" y1="75" x2="171" y2="145" stroke-width="8" />` +
      `<line x1="49" y1="145" x2="171" y2="75" stroke-width="8" />` +
      `<path d="M100 60 L110 50 L120 60 M100 80 L110 70 L120 80" fill="none" stroke-width="6" />` +
      `<path d="M100 160 L110 170 L120 160 M100 140 L110 150 L120 140" fill="none" stroke-width="6" />` +
      `<path d="M60 85 L54 73 L66 69 M77 95 L71 83 L83 79" fill="none" stroke-width="6" />` +
      `<path d="M160 135 L166 147 L154 151 M143 125 L149 137 L137 141" fill="none" stroke-width="6" />` +
      `<path d="M60 135 L54 147 L66 151 M77 125 L71 137 L83 141" fill="none" stroke-width="6" />` +
      `<path d="M160 85 L166 73 L154 69 M143 95 L149 83 L137 79" fill="none" stroke-width="6" />` +
      `</g>`,
  ),
  prop(
    "prop-tree",
    "나무",
    200,
    240,
    `${shadow(100, 225, 60, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="85" y="140" width="30" height="75" rx="5" fill="#78350f" />` +
      `<path d="M85 160 L70 145 M115 170 L130 155" fill="none" stroke-width="7" />` +
      `<circle cx="100" cy="95" r="55" fill="#22c55e" />` +
      `<circle cx="70" cy="115" r="35" fill="#16a34a" />` +
      `<circle cx="130" cy="115" r="35" fill="#16a34a" />` +
      `<circle cx="75" cy="100" r="8" fill="#ef4444" stroke="none" />` +
      `<circle cx="115" cy="75" r="8" fill="#ef4444" stroke="none" />` +
      `<circle cx="125" cy="120" r="8" fill="#ef4444" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-flower",
    "꽃(튤립/장미)",
    200,
    240,
    `${shadow(100, 225, 55, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="65,160 135,160 125,215 75,215" fill="#ca8a04" />` +
      `<rect x="60" y="145" width="80" height="15" rx="3" fill="#eab308" />` +
      `<line x1="100" y1="145" x2="100" y2="90" stroke="#10b981" stroke-width="10" />` +
      `<path d="M100 125 C80 125, 75 110, 75 110 C75 110, 90 105, 100 120 Z" fill="#10b981" />` +
      `<path d="M100 135 C120 135, 125 120, 125 120 C125 120, 110 115, 100 130 Z" fill="#10b981" />` +
      `<path d="M80 90 C80 60, 100 50, 100 50 C100 50, 120 60, 120 90 C120 105, 80 105, 80 90 Z" fill="#f43f5e" />` +
      `<path d="M100 50 V90" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-moon",
    "달",
    220,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M130 50 A65 65 0 1 0 130 170 A55 55 0 1 1 130 50 Z" fill="#fde047" />` +
      `<path d="M130 50 C110 30, 80 40, 75 60 C70 75, 90 90, 105 80" fill="#3b82f6" />` +
      `<circle cx="70" cy="65" r="10" fill="${WHITE}" />` +
      `<path d="M95 115 Q102 120 109 115" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-stars",
    "별무리",
    220,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<polygon points="100,40 112,68 140,72 118,92 125,120 100,104 75,120 82,92 60,72 88,68" fill="#fde047" />` +
      `<polygon points="170,50 176,64 190,66 179,76 182,90 170,82 158,90 161,76 150,66 164,64" fill="#fde047" />` +
      `<polygon points="55,125 61,139 75,141 64,151 67,165 55,157 43,165 46,151 35,141 49,139" fill="#fde047" />` +
      `<circle cx="120" cy="150" r="5" fill="#60a5fa" stroke="none" />` +
      `<circle cx="70" cy="50" r="4" fill="#a78bfa" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-rainbow",
    "무지개",
    250,
    200,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M45 140 A80 80 0 0 1 205 140" fill="none" stroke="#ef4444" stroke-width="14" />` +
      `<path d="M59 140 A66 66 0 0 1 191 140" fill="none" stroke="#f97316" stroke-width="14" />` +
      `<path d="M73 140 A52 52 0 0 1 177 140" fill="none" stroke="#facc15" stroke-width="14" />` +
      `<path d="M87 140 A38 38 0 0 1 163 140" fill="none" stroke="#10b981" stroke-width="14" />` +
      `<path d="M101 140 A24 24 0 0 1 149 140" fill="none" stroke="#3b82f6" stroke-width="14" />` +
      `<path d="M30 155 C20 155, 15 135, 30 125 C35 110, 60 110, 65 125 C75 125, 80 140, 70 155 Z" fill="${WHITE}" />` +
      `<path d="M180 155 C170 155, 165 135, 180 125 C185 110, 210 110, 215 125 C225 125, 230 140, 220 155 Z" fill="${WHITE}" />` +
      `</g>`,
  ),
  prop(
    "prop-sword",
    "용사의 검",
    220,
    220,
    `${shadow(110, 205, 65, 8)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="105" y="145" width="10" height="50" rx="3" fill="#78350f" />` +
      `<circle cx="110" cy="198" r="12" fill="#fbbf24" />` +
      `<rect x="70" y="135" width="80" height="14" rx="4" fill="#fbbf24" />` +
      `<circle cx="110" cy="142" r="6" fill="#00f2ff" />` +
      `<path d="M98 135 L98 40 L110 20 L122 40 L122 135 Z" fill="#cbd5e1" />` +
      `<path d="M110 135 L110 25 L122 40 L122 135 Z" fill="#94a3b8" />` +
      `</g>`,
  ),
  prop(
    "prop-magic-staff",
    "마법 지팡이",
    220,
    220,
    `${shadow(110, 205, 50, 7)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M70 190 L140 60" stroke="#78350f" stroke-width="12" />` +
      `<circle cx="140" cy="60" r="18" fill="#fbbf24" />` +
      `<path d="M125 55 C120 40, 130 30, 140 35 C150 30, 160 40, 155 55" fill="none" stroke-width="6" />` +
      `<polygon points="140,15 155,35 140,55 125,35" fill="#d8b4fe" />` +
      `<polygon points="140,15 140,55 125,35" fill="#a78bfa" />` +
      `<polygon points="165,20 168,26 175,27 170,32 171,38 165,35 159,38 160,32 155,27 162,26" fill="#ffd166" stroke="none" />` +
      `<polygon points="110,50 112,54 117,55 113,59 114,64 110,61 106,64 107,59 103,55 108,54" fill="#60a5fa" stroke="none" />` +
      `</g>`,
  ),
  prop(
    "prop-magic-potion",
    "마법 물약",
    200,
    220,
    `${shadow(100, 205, 50, 10)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="85" y="55" width="30" height="30" rx="3" fill="#cbd5e1" opacity="0.8" />` +
      `<polygon points="87,55 113,55 108,35 92,35" fill="#b45309" />` +
      `<circle cx="100" cy="135" r="55" fill="#e2e8f0" opacity="0.4" />` +
      `<path d="M50 150 A55 55 0 0 0 150 150 C140 140, 130 140, 120 145 C100 155, 80 135, 50 150 Z" fill="#ec4899" />` +
      `<circle cx="85" cy="155" r="6" fill="#fbcfe8" stroke="none" />` +
      `<circle cx="115" cy="165" r="4" fill="#fbcfe8" stroke="none" />` +
      `<circle cx="100" cy="140" r="5" fill="#fbcfe8" stroke="none" />` +
      `<circle cx="100" cy="135" r="55" fill="none" />` +
      `<path d="M60 115 A45 45 0 0 1 125 95" fill="none" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" opacity="0.6" />` +
      `</g>`,
  ),
  prop(
    "prop-holy-shield",
    "수호의 방패",
    220,
    220,
    `${shadow(110, 205, 65, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M50 50 C110 40, 110 40, 170 50 C170 110, 160 170, 110 200 C60 170, 50 110, 50 50 Z" fill="#fbbf24" />` +
      `<path d="M62 62 C110 54, 110 54, 158 62 C158 112, 149 160, 110 186 C71 160, 62 112, 62 62 Z" fill="#e2e8f0" />` +
      `<path d="M102 70 H118 V165 H102 Z M80 95 H140 V111 H80 Z" fill="#ef4444" />` +
      `<polygon points="110,93 118,103 110,113 102,103" fill="#3b82f6" />` +
      `</g>`,
  ),
  prop(
    "prop-treasure-chest",
    "보물 상자",
    240,
    220,
    `${shadow(120, 205, 80, 12)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<rect x="40" y="115" width="160" height="75" rx="8" fill="#78350f" />` +
      `<circle cx="70" cy="115" r="10" fill="#fde047" />` +
      `<circle cx="90" cy="112" r="10" fill="#fbbf24" />` +
      `<circle cx="110" cy="115" r="10" fill="#fbbf24" />` +
      `<circle cx="130" cy="110" r="10" fill="#fde047" />` +
      `<circle cx="150" cy="113" r="10" fill="#fde047" />` +
      `<circle cx="170" cy="116" r="10" fill="#fbbf24" />` +
      `<polygon points="80,105 88,113 80,121 72,113" fill="#ef4444" />` +
      `<polygon points="145,100 151,108 145,116 139,108" fill="#10b981" />` +
      `<path d="M35 115 L45 70 C85 60, 155 60, 195 70 L205 115 Z" fill="#92400e" />` +
      `<path d="M40 115 L40 190" stroke="#f59e0b" stroke-width="12" />` +
      `<path d="M200 115 L200 190" stroke="#f59e0b" stroke-width="12" />` +
      `<path d="M40 145 H200" stroke="#f59e0b" stroke-width="8" />` +
      `<rect x="105" y="110" width="30" height="30" rx="4" fill="#fbbf24" />` +
      `<circle cx="120" cy="120" r="5" fill="${INK}" />` +
      `<line x1="120" y1="123" x2="120" y2="135" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-crown",
    "임금의 왕관",
    220,
    200,
    `${shadow(110, 185, 65, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M45 145 L40 75 L75 105 L110 50 L145 105 L180 75 L175 145 Z" fill="#fbbf24" />` +
      `<rect x="42" y="132" width="136" height="20" rx="3" fill="#d97706" />` +
      `<circle cx="65" cy="142" r="5" fill="#ef4444" stroke="none" />` +
      `<circle cx="110" cy="142" r="6" fill="#3b82f6" stroke="none" />` +
      `<circle cx="155" cy="142" r="5" fill="#10b981" stroke="none" />` +
      `<circle cx="40" cy="75" r="8" fill="#fbbf24" />` +
      `<circle cx="110" cy="50" r="10" fill="#fbbf24" />` +
      `<circle cx="180" cy="75" r="8" fill="#fbbf24" />` +
      `<polygon points="110,75 120,90 110,105 100,90" fill="#ef4444" />` +
      `</g>`,
  ),
  prop(
    "prop-coffee-mug",
    "커피 머그잔",
    220,
    200,
    `${shadow(100, 180, 60, 9)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M140 90 C175 90, 175 150, 140 150" fill="none" stroke-width="12" />` +
      `<path d="M50 80 H150 L140 170 H60 Z" fill="#67e8f9" />` +
      `<ellipse cx="100" cy="80" rx="46" ry="12" fill="#78350f" />` +
      `<path d="M100 83 C96 76, 80 80, 100 92 C120 80, 104 76, 100 83 Z" fill="#fef3c7" stroke="none" />` +
      `<path d="M80 60 Q75 45 85 30 T75 10" fill="none" stroke="${WHITE}" stroke-width="4" opacity="0.6" />` +
      `<path d="M105 60 Q115 45 105 30 T115 10" fill="none" stroke="${WHITE}" stroke-width="4" opacity="0.6" />` +
      `<path d="M125 60 Q120 48 130 35 T120 18" fill="none" stroke="${WHITE}" stroke-width="4" opacity="0.6" />` +
      `</g>`,
  ),
  prop(
    "prop-sunglasses",
    "힙한 선글라스",
    240,
    160,
    `${shadow(120, 125, 75, 8)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M40 70 C40 70 80 62 120 70 C160 62 200 70 200 70 L205 95 C190 120 160 125 145 110 C130 95 125 95 120 95 C115 95 110 95 95 110 C80 125 50 120 35 95 Z" fill="#1e293b" />` +
      `<path d="M48 78 C70 74 88 84 88 94 C84 108 62 113 52 100 C46 92 48 78 48 78 Z" fill="#ec4899" />` +
      `<path d="M192 78 C170 74 152 84 152 94 C156 108 178 113 188 100 C194 92 192 78 192 78 Z" fill="#f59e0b" />` +
      `<line x1="55" y1="84" x2="75" y2="104" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" opacity="0.7" />` +
      `<line x1="160" y1="84" x2="180" y2="104" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" opacity="0.7" />` +
      `</g>`,
  ),
  prop(
    "prop-angel-wing",
    "천사 날개",
    260,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M40 100 C40 100 80 40 150 50 C180 54 220 90 230 110 C210 115 190 105 180 115 C165 105 150 120 135 120 C120 115 105 130 90 125 C75 120 50 135 40 100 Z" fill="#eff6ff" />` +
      `<path d="M70 95 C90 70 130 75 160 85 C150 92 135 88 125 95 C115 92 100 102 90 100" fill="none" stroke-width="5" />` +
      `<path d="M95 110 C110 95 135 98 150 105" fill="none" stroke-width="5" />` +
      `</g>`,
  ),
  prop(
    "prop-devil-wing",
    "악마 날개",
    260,
    220,
    `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M40 110 C60 50 130 60 210 70 C225 73 235 65 240 75 L215 110 C195 125 185 115 165 140 C155 125 135 125 115 145 C105 130 75 130 40 110 Z" fill="#581c87" />` +
      `<path d="M40 110 Q120 80 210 70 M210 70 L165 140 M210 70 L115 145" fill="none" stroke="#a78bfa" stroke-width="5" />` +
      `</g>`,
  ),
];
