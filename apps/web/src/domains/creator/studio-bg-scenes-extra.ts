import type { BgScene } from "./studio-bg-scenes";

const W = 720;
const H = 1080;
const INK = "#16100c";

type Stop = readonly [offset: string, color: string, opacity?: string];
type Point = readonly [x: number, y: number];

function scene(defs: string, body: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;
}

function grad(id: string, x1: number, y1: number, x2: number, y2: number, stops: readonly Stop[]): string {
  const s = stops
    .map(([offset, color, opacity]) => `<stop offset="${offset}" stop-color="${color}"${opacity ? ` stop-opacity="${opacity}"` : ""}/>`)
    .join("");
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
}

function vGrad(id: string, stops: readonly Stop[]): string {
  return grad(id, 0, 0, 0, 1, stops);
}

function hGrad(id: string, stops: readonly Stop[]): string {
  return grad(id, 0, 0, 1, 0, stops);
}

function rGrad(id: string, cx: number, cy: number, r: number, stops: readonly Stop[]): string {
  const s = stops
    .map(([offset, color, opacity]) => `<stop offset="${offset}" stop-color="${color}"${opacity ? ` stop-opacity="${opacity}"` : ""}/>`)
    .join("");
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">${s}</radialGradient>`;
}

function bg(fill: string): string {
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="${fill}"/>`;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function stars(count: number, seed: number, x0: number, y0: number, x1: number, y1: number, rMin: number, rMax: number, fill: string): string {
  const random = rng(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const cx = (x0 + random() * (x1 - x0)).toFixed(1);
    const cy = (y0 + random() * (y1 - y0)).toFixed(1);
    const rad = (rMin + random() * (rMax - rMin)).toFixed(2);
    const op = (0.35 + random() * 0.65).toFixed(2);
    out += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}" opacity="${op}"/>`;
  }
  return out;
}

function ridge(peaks: readonly Point[], baseY: number, fill: string, opacity = "1"): string {
  let d = `M0 ${baseY}`;
  for (const [x, y] of peaks) d += ` L ${x} ${y}`;
  d += ` L${W} ${baseY} L${W} ${H} L0 ${H} Z`;
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function mist(y: number, h: number, fill: string, opacity: string): string {
  return `<path d="M0 ${y} C160 ${y - 28} 280 ${y + 28} 430 ${y + 4} S630 ${y - 26} 720 ${y + 10} L720 ${y + h} C520 ${y + h - 20} 330 ${y + h + 22} 0 ${y + h - 4} Z" fill="${fill}" opacity="${opacity}"/>`;
}

function bambooStalk(x: number, width: number, base: number, height: number, lean: number, fill: string, nodeFill: string): string {
  const topX = x + lean;
  const body = `<path d="M${x - width / 2} ${base} C${x + lean * 0.2} ${base - height * 0.35} ${x + lean * 0.75} ${base - height * 0.7} ${topX - width / 2} ${base - height} L${topX + width / 2} ${base - height} C${x + lean * 0.8 + width / 2} ${base - height * 0.7} ${x + lean * 0.25 + width / 2} ${base - height * 0.35} ${x + width / 2} ${base} Z" fill="${fill}"/>`;
  let nodes = "";
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const y = base - height * t;
    const nx = x + lean * t;
    nodes += `<path d="M${(nx - width * 0.65).toFixed(1)} ${y.toFixed(1)} Q${nx.toFixed(1)} ${(y + 4).toFixed(1)} ${(nx + width * 0.65).toFixed(1)} ${y.toFixed(1)}" stroke="${nodeFill}" stroke-width="3" fill="none" opacity="0.8"/>`;
  }
  return body + nodes;
}

function bambooLeaves(x: number, y: number, scale: number, fill: string, opacity: string): string {
  let out = `<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}" opacity="${opacity}">`;
  for (const [dx, dy, rot] of [
    [-30, -18, -28],
    [-12, -26, -6],
    [18, -20, 18],
    [38, -8, 36],
    [-45, 4, -46],
  ] as readonly (readonly [number, number, number])[]) {
    out += `<path d="M${dx} ${dy} q36 -12 72 0 q-36 18 -72 0 Z" transform="rotate(${rot} ${dx} ${dy})"/>`;
  }
  return `${out}</g>`;
}

function pine(x: number, baseY: number, height: number, width: number, fill: string): string {
  const trunkW = Math.max(5, width * 0.12);
  let out = `<rect x="${(x - trunkW / 2).toFixed(1)}" y="${(baseY - height * 0.16).toFixed(1)}" width="${trunkW.toFixed(1)}" height="${(height * 0.18).toFixed(1)}" fill="${fill}"/>`;
  for (let i = 0; i < 4; i++) {
    const top = baseY - height + i * height * 0.18;
    const bottom = baseY - height * 0.44 + i * height * 0.13;
    const tierW = width * (1 - i * 0.12);
    out += `<path d="M${x} ${top.toFixed(1)} L${(x - tierW / 2).toFixed(1)} ${bottom.toFixed(1)} L${(x + tierW / 2).toFixed(1)} ${bottom.toFixed(1)} Z" fill="${fill}"/>`;
  }
  return out;
}

function building(x: number, baseY: number, width: number, height: number, fill: string, windowFill: string, seed: number): string {
  let out = `<rect x="${x}" y="${(baseY - height).toFixed(1)}" width="${width}" height="${height.toFixed(1)}" fill="${fill}"/>`;
  const random = rng(seed);
  const cols = Math.max(2, Math.floor(width / 22));
  const rows = Math.max(4, Math.floor(height / 36));
  const cellW = (width - 18) / cols;
  const cellH = (height - 26) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (random() < 0.36) continue;
      const wx = x + 9 + c * cellW + cellW * 0.22;
      const wy = baseY - height + 16 + r * cellH + cellH * 0.2;
      out += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${(cellW * 0.55).toFixed(1)}" height="${(cellH * 0.48).toFixed(1)}" fill="${windowFill}" opacity="${(0.42 + random() * 0.58).toFixed(2)}"/>`;
    }
  }
  return out;
}

function rain(count: number, seed: number, color: string, opacity: string): string {
  const random = rng(seed);
  let out = `<g stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="${opacity}">`;
  for (let i = 0; i < count; i++) {
    const x = random() * (W + 180) - 90;
    const y = random() * H;
    const len = 34 + random() * 56;
    out += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 18).toFixed(1)}" y2="${(y + len).toFixed(1)}"/>`;
  }
  return `${out}</g>`;
}

function lightShaft(x: number, y: number, width: number, height: number, fill: string, opacity: string): string {
  return `<path d="M${x} ${y} L${x + width} ${y} L${x + width * 1.55} ${y + height} L${x - width * 0.55} ${y + height} Z" fill="${fill}" opacity="${opacity}"/>`;
}

function windowGrid(x: number, y: number, width: number, height: number, cols: number, rows: number, frame: string, glass: string): string {
  let out = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${glass}" stroke="${frame}" stroke-width="5"/>`;
  for (let c = 1; c < cols; c++) {
    const gx = x + (width / cols) * c;
    out += `<line x1="${gx.toFixed(1)}" y1="${y}" x2="${gx.toFixed(1)}" y2="${y + height}" stroke="${frame}" stroke-width="3"/>`;
  }
  for (let r = 1; r < rows; r++) {
    const gy = y + (height / rows) * r;
    out += `<line x1="${x}" y1="${gy.toFixed(1)}" x2="${x + width}" y2="${gy.toFixed(1)}" stroke="${frame}" stroke-width="3"/>`;
  }
  return out;
}

function snow(count: number, seed: number, fill: string): string {
  const random = rng(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const cx = (random() * W).toFixed(1);
    const cy = (random() * H).toFixed(1);
    const r = (0.8 + random() * 3.4).toFixed(1);
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${(0.35 + random() * 0.55).toFixed(2)}"/>`;
  }
  return out;
}

const sMurimBambooCanyon = (() => {
  const defs =
    vGrad("mbc-sky", [
      ["0", "#edf6df"],
      ["0.48", "#c9dfb8"],
      ["1", "#829d74"],
    ]) +
    rGrad("mbc-mist-glow", 360, 245, 520, [
      ["0", "#fff8dc", "0.78"],
      ["0.58", "#dceabb", "0.28"],
      ["1", "#dceabb", "0"],
    ]) +
    hGrad("mbc-cliff-left", [
      ["0", "#18291d"],
      ["0.58", "#37563c"],
      ["1", "#6f8362"],
    ]) +
    hGrad("mbc-cliff-right", [
      ["0", "#7e936d"],
      ["0.45", "#405f42"],
      ["1", "#142517"],
    ]) +
    vGrad("mbc-ground", [
      ["0", "#6a7650"],
      ["0.52", "#35472d"],
      ["1", "#182817"],
    ]);
  let farBamboo = "";
  for (let i = 0; i < 11; i++) {
    farBamboo += bambooStalk(20 + i * 70, 12, 980, 760, -30 + i * 5, "#6f9364", "#516f49");
  }
  let nearBamboo = "";
  for (let i = 0; i < 7; i++) {
    nearBamboo += bambooStalk(48 + i * 112, 24 + (i % 2) * 5, 1120, 1040, i % 2 === 0 ? 34 : -28, "#2f5732", "#1f3d23");
    nearBamboo += bambooLeaves(62 + i * 112, 150 + (i % 3) * 80, 0.85 + (i % 2) * 0.18, "#2f5732", "0.75");
  }
  const body =
    bg("url(#mbc-sky)") +
    bg("url(#mbc-mist-glow)") +
    `<g opacity="0.55">${farBamboo}</g>` +
    `<path d="M0 350 C80 500 95 760 0 1080 L0 1080 Z" fill="url(#mbc-cliff-left)"/>` +
    `<path d="M720 300 C610 510 600 760 720 1080 L720 1080 Z" fill="url(#mbc-cliff-right)"/>` +
    ridge(
      [
        [110, 680],
        [250, 595],
        [392, 662],
        [544, 570],
        [690, 645],
      ],
      760,
      "#536c4c",
      "0.45",
    ) +
    mist(650, 90, "#f4f7e5", "0.48") +
    nearBamboo +
    `<path d="M0 900 C170 840 310 890 430 850 S620 800 720 850 L720 1080 L0 1080 Z" fill="url(#mbc-ground)"/>` +
    `<path d="M330 980 C380 895 438 855 526 820" stroke="#cbd6a5" stroke-width="5" fill="none" opacity="0.36"/>`;
  return scene(defs, body);
})();

const sSageukTiledNight = (() => {
  const defs =
    vGrad("stn-sky", [
      ["0", "#080d24"],
      ["0.56", "#1b2853"],
      ["1", "#40527c"],
    ]) +
    rGrad("stn-moon", 548, 172, 210, [
      ["0", "#fff4d7", "0.95"],
      ["0.42", "#f8dca4", "0.42"],
      ["1", "#f8dca4", "0"],
    ]) +
    vGrad("stn-paper", [
      ["0", "#ffe9bc"],
      ["1", "#b46b3f"],
    ]) +
    hGrad("stn-roof", [
      ["0", "#10182b"],
      ["0.5", "#31415b"],
      ["1", "#0b1020"],
    ]) +
    vGrad("stn-courtyard", [
      ["0", "#2f354d"],
      ["1", "#0b0e18"],
    ]);
  const roofBack = `<path d="M-20 470 Q160 400 348 468 T740 452 L700 520 Q360 492 25 526 Z" fill="#26324a" opacity="0.72"/>`;
  const roofFront =
    `<path d="M-50 612 Q180 520 370 604 T770 582 L720 674 Q360 642 0 690 Z" fill="url(#stn-roof)"/>` +
    `<path d="M14 628 Q178 592 352 630 T690 618" stroke="#62708e" stroke-width="7" fill="none" opacity="0.58"/>`;
  let tiles = "";
  for (let x = -30; x < 760; x += 46) {
    tiles += `<path d="M${x} 614 Q${x + 22} 594 ${x + 46} 614" stroke="#71809a" stroke-width="3" fill="none" opacity="0.42"/>`;
  }
  const lanterns =
    `<g>` +
    `<line x1="112" y1="598" x2="112" y2="704" stroke="#392219" stroke-width="4"/>` +
    `<ellipse cx="112" cy="735" rx="34" ry="48" fill="url(#stn-paper)" opacity="0.95"/>` +
    `<line x1="596" y1="586" x2="596" y2="702" stroke="#392219" stroke-width="4"/>` +
    `<ellipse cx="596" cy="734" rx="34" ry="48" fill="url(#stn-paper)" opacity="0.95"/>` +
    `</g>`;
  const body =
    bg("url(#stn-sky)") +
    `<circle cx="548" cy="172" r="210" fill="url(#stn-moon)"/>` +
    `<circle cx="548" cy="172" r="74" fill="#fff4d7"/>` +
    stars(76, 2201, 0, 0, 720, 420, 0.5, 1.9, "#d9e5ff") +
    mist(385, 80, "#b7c5dc", "0.13") +
    roofBack +
    `<rect x="64" y="520" width="592" height="430" fill="#1e263a"/>` +
    windowGrid(98, 578, 178, 244, 4, 5, "#6b4b2d", "url(#stn-paper)") +
    windowGrid(444, 578, 178, 244, 4, 5, "#6b4b2d", "url(#stn-paper)") +
    `<rect x="314" y="610" width="92" height="340" fill="#151b2a"/>` +
    roofFront +
    tiles +
    lanterns +
    `<path d="M0 906 C170 884 386 930 720 884 L720 1080 L0 1080 Z" fill="url(#stn-courtyard)"/>`;
  return scene(defs, body);
})();

const sCyberNeonCity = (() => {
  const defs =
    vGrad("cnc-sky", [
      ["0", "#050713"],
      ["0.48", "#10133a"],
      ["1", "#25082e"],
    ]) +
    rGrad("cnc-haze-a", 170, 545, 430, [
      ["0", "#00e5ff", "0.34"],
      ["0.7", "#00e5ff", "0.1"],
      ["1", "#00e5ff", "0"],
    ]) +
    rGrad("cnc-haze-b", 590, 470, 430, [
      ["0", "#ff3ca6", "0.42"],
      ["0.66", "#ff3ca6", "0.14"],
      ["1", "#ff3ca6", "0"],
    ]) +
    vGrad("cnc-road", [
      ["0", "#211a32"],
      ["0.45", "#111623"],
      ["1", "#050713"],
    ]) +
    hGrad("cnc-neon", [
      ["0", "#00f5ff"],
      ["0.52", "#f9f871"],
      ["1", "#ff2ea6"],
    ]);
  let far = "";
  const randomFar = rng(301);
  for (let x = -12; x < 720; x += 54) {
    far += building(x, 760, 46, 180 + randomFar() * 300, "#1a2141", "#54e8ff", 400 + x);
  }
  let near = "";
  const randomNear = rng(302);
  for (let x = -40; x < 760; x += 92) {
    const h = 300 + randomNear() * 470;
    near += building(x, 1080, 78, h, "#080b19", randomNear() < 0.5 ? "#ff4eb3" : "#00f5ff", 900 + x);
    near += `<rect x="${x + 10}" y="${(1080 - h + 26).toFixed(1)}" width="56" height="12" fill="url(#cnc-neon)" opacity="0.9"/>`;
  }
  const roadLines =
    `<path d="M340 720 L270 1080" stroke="#00f5ff" stroke-width="5" opacity="0.65"/>` +
    `<path d="M382 720 L492 1080" stroke="#ff2ea6" stroke-width="5" opacity="0.65"/>` +
    `<path d="M360 728 L360 1080" stroke="#f9f871" stroke-width="4" stroke-dasharray="28 24" opacity="0.72"/>`;
  const signs =
    `<g opacity="0.94">` +
    `<rect x="58" y="430" width="126" height="44" fill="#05101c" stroke="#00f5ff" stroke-width="4"/>` +
    `<path d="M78 452 H164" stroke="#00f5ff" stroke-width="5"/>` +
    `<rect x="516" y="342" width="102" height="138" fill="#150916" stroke="#ff2ea6" stroke-width="4"/>` +
    `<path d="M540 382 H596 M540 424 H584" stroke="#ff2ea6" stroke-width="6"/>` +
    `</g>`;
  const body =
    bg("url(#cnc-sky)") +
    bg("url(#cnc-haze-a)") +
    bg("url(#cnc-haze-b)") +
    stars(70, 303, 0, 0, 720, 580, 0.8, 2.4, "#80f7ff") +
    `<g opacity="0.56">${far}</g>` +
    near +
    signs +
    `<path d="M0 720 H720 L630 1080 H80 Z" fill="url(#cnc-road)"/>` +
    roadLines +
    mist(670, 120, "#00f5ff", "0.1");
  return scene(defs, body);
})();

const sSfStarshipInterior = (() => {
  const defs =
    vGrad("ssi-space", [
      ["0", "#020716"],
      ["0.52", "#0c1a35"],
      ["1", "#111827"],
    ]) +
    rGrad("ssi-planet", 516, 315, 260, [
      ["0", "#7dd3fc", "0.94"],
      ["0.55", "#2563eb", "0.42"],
      ["1", "#2563eb", "0"],
    ]) +
    hGrad("ssi-panel", [
      ["0", "#101827"],
      ["0.52", "#28364c"],
      ["1", "#0b1220"],
    ]) +
    vGrad("ssi-floor", [
      ["0", "#1f2937"],
      ["0.48", "#111827"],
      ["1", "#050914"],
    ]) +
    rGrad("ssi-console", 360, 795, 280, [
      ["0", "#22d3ee", "0.4"],
      ["0.66", "#22d3ee", "0.12"],
      ["1", "#22d3ee", "0"],
    ]);
  const viewport =
    `<path d="M78 118 H642 Q666 118 666 144 V506 Q666 532 642 532 H78 Q54 532 54 506 V144 Q54 118 78 118 Z" fill="#030712" stroke="#334155" stroke-width="12"/>` +
    `<path d="M98 148 H622 Q638 148 638 164 V486 Q638 502 622 502 H98 Q82 502 82 486 V164 Q82 148 98 148 Z" fill="url(#ssi-space)"/>`;
  const frame =
    `<path d="M54 532 L0 700 V1080 H168 L248 532 Z" fill="url(#ssi-panel)"/>` +
    `<path d="M666 532 L720 700 V1080 H552 L472 532 Z" fill="url(#ssi-panel)"/>` +
    `<path d="M236 532 H484 L552 1080 H168 Z" fill="#111827"/>`;
  const consoles =
    `<path d="M112 760 H608 L680 1080 H40 Z" fill="url(#ssi-floor)"/>` +
    `<path d="M190 816 H530 L590 1004 H130 Z" fill="#0f172a" stroke="#334155" stroke-width="5"/>` +
    `<rect x="230" y="850" width="112" height="54" rx="8" fill="#083344" stroke="#22d3ee" stroke-width="3"/>` +
    `<rect x="376" y="850" width="94" height="54" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="3"/>` +
    `<path d="M242 930 H510" stroke="#22d3ee" stroke-width="4" stroke-dasharray="20 12" opacity="0.7"/>` +
    bg("url(#ssi-console)");
  const body =
    bg("#050914") +
    viewport +
    `<circle cx="516" cy="315" r="260" fill="url(#ssi-planet)"/>` +
    stars(120, 441, 92, 150, 638, 492, 0.5, 1.7, "#dbeafe") +
    `<path d="M382 186 C500 230 560 314 602 448" stroke="#bae6fd" stroke-width="18" fill="none" opacity="0.24"/>` +
    frame +
    `<path d="M88 612 H632" stroke="#475569" stroke-width="10"/>` +
    consoles +
    lightShaft(238, 532, 68, 356, "#60a5fa", "0.12") +
    lightShaft(420, 532, 68, 356, "#22d3ee", "0.1");
  return scene(defs, body);
})();

const sHorrorFogHouse = (() => {
  const defs =
    vGrad("hfh-sky", [
      ["0", "#10151c"],
      ["0.55", "#34404a"],
      ["1", "#6b7068"],
    ]) +
    rGrad("hfh-moon", 522, 210, 240, [
      ["0", "#d8ddc9", "0.76"],
      ["0.5", "#b6bdab", "0.34"],
      ["1", "#b6bdab", "0"],
    ]) +
    hGrad("hfh-fog", [
      ["0", "#c8cebf", "0"],
      ["0.45", "#c8cebf", "0.42"],
      ["1", "#c8cebf", "0"],
    ]) +
    vGrad("hfh-house", [
      ["0", "#313438"],
      ["1", "#0d0f12"],
    ]) +
    vGrad("hfh-ground", [
      ["0", "#30352f"],
      ["1", "#090b0a"],
    ]);
  let trees = "";
  for (let i = 0; i < 12; i++) {
    const x = 24 + i * 64;
    const h = 300 + (i % 4) * 72;
    trees += `<path d="M${x} 840 C${x - 20} 640 ${x + 18} 520 ${x - 8} ${840 - h}" stroke="#151a19" stroke-width="${10 + (i % 3) * 3}" fill="none" stroke-linecap="round" opacity="${i % 2 === 0 ? "0.88" : "0.6"}"/>`;
    trees += `<path d="M${x} ${690 - i * 4} q-42 -40 -92 -34 M${x + 4} ${650 - i * 5} q42 -44 92 -38" stroke="#151a19" stroke-width="6" fill="none" opacity="0.55"/>`;
  }
  const house =
    `<path d="M185 520 L360 394 L540 520 Z" fill="#171a1d"/>` +
    `<path d="M214 520 H512 L540 926 H184 Z" fill="url(#hfh-house)"/>` +
    `<path d="M160 536 L360 372 L566 536" stroke="#0a0b0d" stroke-width="34" fill="none" stroke-linecap="round"/>` +
    `<rect x="258" y="606" width="64" height="86" fill="#d5b064" opacity="0.24"/>` +
    `<rect x="414" y="622" width="56" height="72" fill="#d5b064" opacity="0.16"/>` +
    `<path d="M338 746 H416 V926 H338 Z" fill="#08090a"/>` +
    `<path d="M226 566 L512 566" stroke="#3f4548" stroke-width="6" opacity="0.5"/>`;
  const body =
    bg("url(#hfh-sky)") +
    `<circle cx="522" cy="210" r="240" fill="url(#hfh-moon)"/>` +
    `<circle cx="522" cy="210" r="82" fill="#cfd5c2" opacity="0.9"/>` +
    trees +
    mist(476, 120, "#aeb5aa", "0.28") +
    house +
    bg("url(#hfh-fog)") +
    mist(726, 150, "#d6dccf", "0.42") +
    mist(862, 170, "#aeb5aa", "0.36") +
    `<path d="M0 850 C210 804 408 870 720 812 L720 1080 L0 1080 Z" fill="url(#hfh-ground)"/>`;
  return scene(defs, body);
})();

const sSchoolRooftopSunset = (() => {
  const defs =
    vGrad("srs-sky", [
      ["0", "#6d6ed5"],
      ["0.35", "#f08eb1"],
      ["0.76", "#ffd081"],
      ["1", "#ffe7bd"],
    ]) +
    rGrad("srs-sun", 560, 380, 280, [
      ["0", "#fff7c8", "0.96"],
      ["0.5", "#ffd36f", "0.54"],
      ["1", "#ff8b6f", "0"],
    ]) +
    hGrad("srs-cloud", [
      ["0", "#ffffff", "0"],
      ["0.45", "#ffe5cf", "0.58"],
      ["1", "#ffffff", "0"],
    ]) +
    vGrad("srs-floor", [
      ["0", "#607083"],
      ["0.48", "#46566a"],
      ["1", "#253044"],
    ]) +
    vGrad("srs-fence", [
      ["0", "#eef3ff"],
      ["1", "#8795ad"],
    ]);
  let skyline = "";
  const random = rng(510);
  for (let x = -20; x < 740; x += 68) {
    skyline += building(x, 748, 58, 96 + random() * 178, "#6c6684", "#ffe6a8", 700 + x);
  }
  let fence = "";
  for (let x = 36; x <= 684; x += 54) {
    fence += `<line x1="${x}" y1="618" x2="${x}" y2="854" stroke="url(#srs-fence)" stroke-width="7"/>`;
  }
  const body =
    bg("url(#srs-sky)") +
    `<circle cx="560" cy="380" r="280" fill="url(#srs-sun)"/>` +
    bg("url(#srs-cloud)") +
    mist(252, 74, "#fff0d6", "0.22") +
    skyline +
    `<rect x="0" y="600" width="720" height="28" fill="#3b4658"/>` +
    `<line x1="20" y1="618" x2="700" y2="618" stroke="url(#srs-fence)" stroke-width="8"/>` +
    `<line x1="24" y1="738" x2="696" y2="738" stroke="#dbe4f4" stroke-width="6" opacity="0.75"/>` +
    fence +
    `<path d="M0 820 L720 760 L720 1080 L0 1080 Z" fill="url(#srs-floor)"/>` +
    `<path d="M120 930 L642 846" stroke="#1f2937" stroke-width="5" opacity="0.36"/>` +
    `<rect x="72" y="756" width="94" height="176" fill="#39475b"/>` +
    `<rect x="84" y="724" width="70" height="34" fill="#506174"/>`;
  return scene(defs, body);
})();

const sCozyCafeInterior = (() => {
  const defs =
    vGrad("cci-wall", [
      ["0", "#ffe5bd"],
      ["0.58", "#c98b5e"],
      ["1", "#7a4b34"],
    ]) +
    rGrad("cci-lamp", 360, 170, 360, [
      ["0", "#fff4ce", "0.95"],
      ["0.45", "#f6b860", "0.36"],
      ["1", "#f6b860", "0"],
    ]) +
    hGrad("cci-window", [
      ["0", "#2a1c2e"],
      ["0.52", "#4b3152"],
      ["1", "#151827"],
    ]) +
    vGrad("cci-floor", [
      ["0", "#9a6744"],
      ["0.56", "#6c432e"],
      ["1", "#3a241b"],
    ]) +
    vGrad("cci-table", [
      ["0", "#c57d48"],
      ["1", "#5a3322"],
    ]);
  let planks = "";
  for (let i = 0; i < 11; i++) {
    const x = i * 72;
    planks += `<line x1="${x}" y1="742" x2="${(360 + (x - 360) * 0.28).toFixed(1)}" y2="1080" stroke="#44291d" stroke-width="3" opacity="0.42"/>`;
  }
  const pendant =
    `<line x1="360" y1="0" x2="360" y2="128" stroke="#4a2d22" stroke-width="5"/>` +
    `<path d="M284 126 H436 L396 208 H324 Z" fill="#5a3322"/>` +
    `<ellipse cx="360" cy="210" rx="78" ry="30" fill="#f9c46b" opacity="0.82"/>`;
  const shelves =
    `<rect x="438" y="248" width="186" height="18" fill="#6f422a"/>` +
    `<rect x="438" y="364" width="186" height="18" fill="#6f422a"/>` +
    `<rect x="458" y="206" width="30" height="44" rx="5" fill="#d6a65f"/>` +
    `<rect x="510" y="214" width="24" height="36" rx="5" fill="#92a879"/>` +
    `<rect x="560" y="198" width="34" height="52" rx="5" fill="#b86b52"/>` +
    `<rect x="462" y="322" width="42" height="42" rx="6" fill="#f2d3a3"/>` +
    `<rect x="532" y="306" width="30" height="58" rx="6" fill="#7a9c8d"/>`;
  const table =
    `<ellipse cx="362" cy="825" rx="182" ry="42" fill="#3d2419" opacity="0.3"/>` +
    `<path d="M178 762 Q360 716 542 762 L510 844 Q360 888 210 844 Z" fill="url(#cci-table)"/>` +
    `<rect x="344" y="830" width="32" height="178" fill="#5a3322"/>` +
    `<ellipse cx="360" cy="1008" rx="118" ry="26" fill="#3a241b"/>` +
    `<rect x="292" y="718" width="48" height="56" rx="8" fill="#fff0d2"/>` +
    `<path d="M340 736 q30 -8 30 20 q0 24 -32 18" stroke="#fff0d2" stroke-width="10" fill="none"/>`;
  const body =
    bg("url(#cci-wall)") +
    bg("url(#cci-lamp)") +
    windowGrid(72, 230, 280, 338, 3, 3, "#4a2d22", "url(#cci-window)") +
    stars(36, 612, 90, 248, 334, 538, 0.6, 2.1, "#f9d783") +
    shelves +
    pendant +
    `<rect x="0" y="720" width="720" height="360" fill="url(#cci-floor)"/>` +
    planks +
    `<rect x="0" y="698" width="720" height="30" fill="#5d3828"/>` +
    table +
    lightShaft(294, 202, 72, 640, "#fff0c2", "0.16");
  return scene(defs, body);
})();

const sFantasyEnchantedWoods = (() => {
  const defs =
    vGrad("few-sky", [
      ["0", "#17213d"],
      ["0.48", "#27524b"],
      ["1", "#9fd19a"],
    ]) +
    rGrad("few-orb", 356, 430, 420, [
      ["0", "#b9ffdf", "0.86"],
      ["0.48", "#5eead4", "0.34"],
      ["1", "#5eead4", "0"],
    ]) +
    hGrad("few-vines", [
      ["0", "#17351f"],
      ["0.58", "#2f6942"],
      ["1", "#112919"],
    ]) +
    vGrad("few-ground", [
      ["0", "#2e744c"],
      ["0.52", "#1d4930"],
      ["1", "#092016"],
    ]) +
    rGrad("few-magic", 360, 780, 270, [
      ["0", "#f0fdf4", "0.45"],
      ["0.46", "#86efac", "0.22"],
      ["1", "#86efac", "0"],
    ]);
  let trees = "";
  for (let i = 0; i < 9; i++) {
    const x = i * 92 - 28;
    const base = 1088;
    const height = 680 + (i % 3) * 110;
    trees += `<path d="M${x} ${base} C${x - 34} ${820} ${x + 48} ${520} ${x + (i % 2 === 0 ? 12 : -30)} ${base - height}" stroke="url(#few-vines)" stroke-width="${32 + (i % 3) * 8}" fill="none" stroke-linecap="round" opacity="${i % 2 === 0 ? "0.88" : "0.66"}"/>`;
    trees += `<path d="M${x + 10} ${base - 420} q90 -86 180 -92 M${x - 4} ${base - 520} q-82 -80 -174 -70" stroke="#15351f" stroke-width="12" fill="none" opacity="0.55"/>`;
  }
  let motes = "";
  const random = rng(730);
  for (let i = 0; i < 52; i++) {
    const cx = (120 + random() * 480).toFixed(1);
    const cy = (240 + random() * 620).toFixed(1);
    const r = (1.8 + random() * 6.4).toFixed(1);
    motes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#d9ffe8" opacity="${(0.22 + random() * 0.58).toFixed(2)}"/>`;
  }
  const body =
    bg("url(#few-sky)") +
    bg("url(#few-orb)") +
    `<circle cx="356" cy="430" r="82" fill="#ecfff4" opacity="0.72"/>` +
    mist(520, 110, "#d4ffe3", "0.2") +
    trees +
    motes +
    bg("url(#few-magic)") +
    `<path d="M0 834 C174 760 330 846 496 780 S650 780 720 738 L720 1080 L0 1080 Z" fill="url(#few-ground)"/>` +
    `<path d="M214 872 C286 820 436 810 512 858 C444 908 286 914 214 872 Z" fill="#b9ffdf" opacity="0.24"/>` +
    `<path d="M238 870 C320 850 420 846 496 862" stroke="#d9ffe8" stroke-width="4" fill="none" stroke-dasharray="12 10" opacity="0.72"/>`;
  return scene(defs, body);
})();

const sRainyCityStreet = (() => {
  const defs =
    vGrad("rcs-sky", [
      ["0", "#151a2a"],
      ["0.52", "#29364a"],
      ["1", "#526171"],
    ]) +
    rGrad("rcs-lamp", 170, 650, 360, [
      ["0", "#ffd98a", "0.48"],
      ["0.54", "#ffd98a", "0.16"],
      ["1", "#ffd98a", "0"],
    ]) +
    rGrad("rcs-neon", 552, 530, 360, [
      ["0", "#fb7185", "0.46"],
      ["0.58", "#60a5fa", "0.16"],
      ["1", "#60a5fa", "0"],
    ]) +
    vGrad("rcs-road", [
      ["0", "#2c3544"],
      ["0.5", "#151b26"],
      ["1", "#070a10"],
    ]) +
    hGrad("rcs-reflect", [
      ["0", "#fbbf24", "0.16"],
      ["0.48", "#38bdf8", "0.3"],
      ["1", "#fb7185", "0.18"],
    ]);
  let blocks = "";
  const random = rng(840);
  for (let x = -28; x < 740; x += 86) {
    blocks += building(x, 760, 72, 210 + random() * 330, "#182033", "#a7d8ff", 1000 + x);
  }
  const shop =
    `<rect x="428" y="586" width="190" height="236" fill="#111827"/>` +
    `<rect x="446" y="620" width="154" height="76" fill="#1d2b45" stroke="#38bdf8" stroke-width="4"/>` +
    `<path d="M466 660 H582" stroke="#fb7185" stroke-width="7"/>` +
    `<rect x="40" y="618" width="146" height="196" fill="#1b2332"/>` +
    `<rect x="62" y="646" width="96" height="44" fill="#2b1e24" stroke="#fbbf24" stroke-width="4"/>`;
  const body =
    bg("url(#rcs-sky)") +
    bg("url(#rcs-lamp)") +
    bg("url(#rcs-neon)") +
    `<g opacity="0.66">${blocks}</g>` +
    mist(548, 92, "#b9c4d3", "0.18") +
    shop +
    `<path d="M0 762 L720 720 L720 1080 L0 1080 Z" fill="url(#rcs-road)"/>` +
    `<path d="M0 805 C170 784 270 824 412 802 S620 768 720 786 L720 1080 L0 1080 Z" fill="url(#rcs-reflect)"/>` +
    `<path d="M210 864 C300 838 456 828 560 846" stroke="#38bdf8" stroke-width="7" opacity="0.42"/>` +
    `<path d="M86 910 C162 888 280 892 344 914" stroke="#fbbf24" stroke-width="7" opacity="0.32"/>` +
    rain(142, 841, "#dcecff", "0.46") +
    rain(72, 842, "#a7d8ff", "0.26");
  return scene(defs, body);
})();

const sWinterSnowPeaks = (() => {
  const defs =
    vGrad("wsp-sky", [
      ["0", "#d9f2ff"],
      ["0.45", "#9ec7e8"],
      ["1", "#5b7da3"],
    ]) +
    rGrad("wsp-sun", 138, 188, 300, [
      ["0", "#fff9df", "0.9"],
      ["0.44", "#ffe0a3", "0.28"],
      ["1", "#ffe0a3", "0"],
    ]) +
    vGrad("wsp-far", [
      ["0", "#f8fbff"],
      ["0.58", "#b8cbe0"],
      ["1", "#617795"],
    ]) +
    vGrad("wsp-near", [
      ["0", "#ffffff"],
      ["0.42", "#aebfd0"],
      ["1", "#334155"],
    ]) +
    hGrad("wsp-shadow", [
      ["0", "#315170", "0.08"],
      ["0.48", "#1e3a5f", "0.32"],
      ["1", "#0f253d", "0.08"],
    ]);
  const far =
    ridge(
      [
        [88, 542],
        [188, 360],
        [278, 548],
        [420, 340],
        [558, 560],
        [666, 430],
      ],
      690,
      "url(#wsp-far)",
      "0.86",
    ) +
    `<path d="M188 360 L150 538 H254 Z M420 340 L362 548 H502 Z M666 430 L608 598 H706 Z" fill="#ffffff" opacity="0.8"/>`;
  const near =
    ridge(
      [
        [92, 804],
        [246, 470],
        [360, 810],
        [520, 500],
        [700, 820],
      ],
      920,
      "url(#wsp-near)",
    ) +
    `<path d="M246 470 L178 820 H322 Z M520 500 L438 864 H620 Z" fill="#ffffff" opacity="0.92"/>` +
    `<path d="M246 470 L322 820 L246 704 Z M520 500 L620 864 L516 720 Z" fill="url(#wsp-shadow)"/>`;
  let forest = "";
  for (let i = 0; i < 12; i++) {
    forest += pine(20 + i * 64, 1018 + (i % 3) * 18, 130 + (i % 4) * 34, 58 + (i % 3) * 12, i % 2 === 0 ? "#263847" : "#1d2f3c");
  }
  const body =
    bg("url(#wsp-sky)") +
    `<circle cx="138" cy="188" r="300" fill="url(#wsp-sun)"/>` +
    mist(384, 70, "#ffffff", "0.24") +
    far +
    mist(668, 105, "#eaf7ff", "0.42") +
    near +
    forest +
    `<path d="M0 986 C150 950 306 998 456 956 S630 940 720 970 L720 1080 L0 1080 Z" fill="#f8fbff"/>` +
    snow(92, 921, "#ffffff");
  return scene(defs, body);
})();

const sWildWestDesert = (() => {
  const defs =
    vGrad("wwd-sky", [
      ["0", "#fc354c"],
      ["0.5", "#ff8235"],
      ["1", "#f7ff00"],
    ]) +
    rGrad("wwd-sun", 360, 480, 180, [
      ["0", "#ffffff", "1"],
      ["0.3", "#fff5cc", "0.8"],
      ["1", "#ffcc00", "0"],
    ]) +
    vGrad("wwd-dune1", [
      ["0", "#e65c00"],
      ["1", "#990000"],
    ]) +
    vGrad("wwd-dune2", [
      ["0", "#cc4e00"],
      ["1", "#660000"],
    ]);

  return scene(defs,
    bg("url(#wwd-sky)") +
    `<circle cx="360" cy="480" r="180" fill="url(#wwd-sun)"/>` +
    `<path d="M 0 540 L 120 500 L 240 500 L 260 540 Z" fill="#990000" opacity="0.6"/>` +
    `<path d="M 440 540 L 460 480 L 580 480 L 640 540 Z" fill="#800000" opacity="0.7"/>` +
    `<path d="M 0 680 Q 200 620 400 680 T 720 640 L 720 1080 L 0 1080 Z" fill="url(#wwd-dune2)"/>` +
    `<path d="M 0 760 Q 360 700 720 780 L 720 1080 L 0 1080 Z" fill="url(#wwd-dune1)"/>` +
    `<g transform="translate(100, 640) scale(0.95)" fill="#4d0000">` +
      `<rect x="-8" y="-120" width="16" height="120" rx="8"/>` +
      `<path d="M -8 -80 H -30 A 10 10 0 0 1 -40 -90 V -110 H -28 V -90 H -8" />` +
      `<path d="M 8 -50 H 30 A 10 10 0 0 0 40 -60 V -80 H 28 V -60 H 8" />` +
    `</g>` +
    `<g transform="translate(580, 680) scale(1.15)" fill="#330000">` +
      `<rect x="-9" y="-140" width="18" height="140" rx="9"/>` +
      `<path d="M -9 -70 H -26 A 9 9 0 0 1 -35 -79 V -105 H -24 V -79 H -9" />` +
      `<path d="M 9 -90 H 26 A 9 9 0 0 0 35 -99 V -125 H 24 V -99 H 9" />` +
    `</g>`
  );
})();

const sDeepSeaAbyss = (() => {
  const defs =
    vGrad("dsa-sky", [
      ["0", "#051937"],
      ["0.5", "#004d7a"],
      ["1", "#008793"],
    ]) +
    rGrad("dsa-light", 360, 0, 720, [
      ["0", "#ffffff", "0.4"],
      ["0.5", "#a5f3fc", "0.15"],
      ["1", "#000000", "0"],
    ]) +
    vGrad("dsa-bottom", [
      ["0", "#031b33"],
      ["1", "#010811"],
    ]);

  const rays =
    `<path d="M300 0 L150 1080 L220 1080 L340 0 Z" fill="#ffffff" opacity="0.08"/>` +
    `<path d="M380 0 L450 1080 L560 1080 L440 0 Z" fill="#ffffff" opacity="0.05"/>` +
    `<path d="M420 0 L680 1080 L720 1080 L480 0 Z" fill="#cffafe" opacity="0.07"/>`;

  const whale =
    `<g transform="translate(140, 280) scale(1.3) rotate(-10)" opacity="0.16">` +
      `<path d="M 0 40 C 60 -10, 180 -10, 240 20 C 300 50, 360 40, 420 60 C 450 40, 470 20, 490 30 C 480 60, 460 80, 440 80 C 360 80, 280 120, 200 120 C 100 120, -60 90, 0 40 Z" fill="#022c22"/>` +
      `<path d="M 220 90 Q 240 160 210 180 Q 200 180 190 140 Z" fill="#022c22"/>` +
    `</g>`;

  let bubbles = "";
  const random = rng(1004);
  for (let i = 0; i < 35; i++) {
    const cx = (random() * W).toFixed(1);
    const cy = (random() * H).toFixed(1);
    const r = (1 + random() * 5).toFixed(1);
    bubbles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#e0f2fe" opacity="0.45" stroke="#ffffff" stroke-width="0.5"/>`;
  }

  return scene(defs,
    bg("url(#dsa-sky)") +
    bg("url(#dsa-light)") +
    rays +
    whale +
    bubbles +
    `<path d="M 0 980 Q 180 940 360 980 T 720 960 L 720 1080 L 0 1080 Z" fill="url(#dsa-bottom)"/>` +
    `<path d="M 80 980 Q 100 900 120 980" stroke="#010811" stroke-width="12" stroke-linecap="round"/>` +
    `<path d="M 620 960 Q 640 880 670 960" stroke="#010811" stroke-width="16" stroke-linecap="round"/>`
  );
})();

const sCherryBlossoms = (() => {
  const defs =
    vGrad("cb-sky", [
      ["0", "#ffe5ec"],
      ["0.5", "#ffc3a0"],
      ["1", "#ffafbd"],
    ]) +
    rGrad("cb-sun", 360, 540, 480, [
      ["0", "#ffffff", "0.65"],
      ["0.6", "#ffe5ec", "0.2"],
      ["1", "#ffafbd", "0"],
    ]) +
    vGrad("cb-path", [
      ["0", "#fff3f8"],
      ["1", "#fbcfe8"],
    ]);

  let petals = "";
  const random = rng(555);
  for (let i = 0; i < 40; i++) {
    const cx = (random() * W).toFixed(1);
    const cy = (random() * H).toFixed(1);
    const rx = (4 + random() * 6).toFixed(1);
    const ry = (2 + random() * 4).toFixed(1);
    const rot = (random() * 360).toFixed(0);
    petals += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#f472b6" opacity="0.8" transform="rotate(${rot} ${cx} ${cy})"/>`;
  }

  const branches =
    `<g stroke="#472a2b" stroke-linecap="round" fill="none">` +
      `<path d="M -20 -20 Q 180 80 320 20" stroke-width="14"/>` +
      `<path d="M 140 40 Q 200 120 250 140" stroke-width="6"/>` +
      `<path d="M 60 18 Q 80 80 140 90" stroke-width="5"/>` +
      `<path d="M 740 -20 Q 560 100 420 50" stroke-width="12"/>` +
      `<path d="M 520 60 Q 480 140 410 150" stroke-width="5"/>` +
    `</g>` +
    `<g fill="#f472b6" opacity="0.95">` +
      `<circle cx="280" cy="30" r="28"/>` +
      `<circle cx="310" cy="20" r="20"/>` +
      `<circle cx="250" cy="40" r="24" fill="#fb7185"/>` +
      `<circle cx="180" cy="90" r="32"/>` +
      `<circle cx="220" cy="110" r="22" fill="#fb7185"/>` +
      `<circle cx="110" cy="70" r="26"/>` +
      `<circle cx="430" cy="70" r="30"/>` +
      `<circle cx="480" cy="110" r="28" fill="#fb7185"/>` +
      `<circle cx="390" cy="130" r="22"/>` +
    `</g>`;

  return scene(defs,
    bg("url(#cb-sky)") +
    `<circle cx="360" cy="540" r="480" fill="url(#cb-sun)"/>` +
    `<path d="M 0 720 Q 360 620 720 720 L 720 1080 L 0 1080 Z" fill="#fbcfe8" opacity="0.5"/>` +
    `<path d="M 300 660 L 420 660 L 680 1080 L 40 1080 Z" fill="url(#cb-path)"/>` +
    `<path d="M 360 660 L 360 1080" stroke="#f472b6" stroke-dasharray="15, 15" stroke-width="4"/>` +
    branches +
    petals
  );
})();

const sMurimInkCliff = (() => {
  const defs =
    vGrad("mic-sky", [
      ["0", "#111111"],
      ["0.6", "#333333"],
      ["1", "#666666"],
    ]) +
    rGrad("mic-sun", 540, 260, 160, [
      ["0", "#ff3333", "0.95"],
      ["0.7", "#ff3333", "0.3"],
      ["1", "#ff3333", "0"],
    ]) +
    vGrad("mic-cliff", [
      ["0", "#222222"],
      ["1", "#050505"],
    ]) +
    `<filter id="wwd-blur-local" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="15" /></filter>`;

  const fog =
    `<path d="M0 640 Q 200 580 400 640 T 720 620 L 720 760 L 0 760 Z" fill="#555555" opacity="0.35" filter="url(#wwd-blur-local)"/>` +
    `<path d="M0 780 Q 360 740 720 800 L 720 940 L 0 940 Z" fill="#777777" opacity="0.25" filter="url(#wwd-blur-local)"/>`;

  const pineTree =
    `<g transform="translate(140, 520) scale(0.9)" stroke="#000000" fill="none">` +
      `<path d="M 0 0 C 40 -40, 80 -20, 120 -60 C 140 -80, 130 -120, 180 -140" stroke-width="12" stroke-linecap="round"/>` +
      `<path d="M 60 -30 Q 100 -100 80 -120" stroke-width="6"/>` +
      `<g fill="#111111" stroke="none">` +
        `<ellipse cx="180" cy="-140" rx="34" ry="18"/>` +
        `<ellipse cx="80" cy="-120" rx="28" ry="14"/>` +
        `<ellipse cx="120" cy="-60" rx="24" ry="12"/>` +
      `</g>` +
    `</g>`;

  return scene(defs,
    bg("url(#mic-sky)") +
    `<circle cx="540" cy="260" r="160" fill="url(#mic-sun)"/>` +
    `<path d="M 0 540 L 140 400 L 260 540 M 200 540 L 320 440 L 440 540 Z" fill="#222222" opacity="0.5"/>` +
    fog +
    `<path d="M -20 380 L 140 520 L 80 1080 L -20 1080 Z" fill="url(#mic-cliff)"/>` +
    pineTree +
    `<path d="M 0 880 Q 240 850 480 890 T 720 860 L 720 1080 L 0 1080 Z" fill="#0d0d0d"/>`
  );
})();

const sHorrorCrimsonForest = (() => {
  const defs =
    vGrad("hcf-sky", [
      ["0", "#450a0a"],
      ["0.6", "#1e1b4b"],
      ["1", "#020617"],
    ]) +
    rGrad("hcf-moon", 360, 240, 120, [
      ["0", "#fef08a", "0.9"],
      ["0.4", "#eab308", "0.45"],
      ["1", "#000000", "0"],
    ]) +
    `<filter id="hcf-blur-local" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="20" /></filter>`;

  const deadTree = (x: number, y: number, scale: number) =>
    `<g transform="translate(${x}, ${y}) scale(${scale})" stroke="#020617" stroke-width="8" stroke-linecap="round" fill="none">` +
      `<path d="M 0 0 Q -20 -100 -10 -200" />` +
      `<path d="M -10 -100 Q -60 -150 -80 -180" stroke-width="5"/>` +
      `<path d="M -5 -150 Q 40 -200 60 -240" stroke-width="4"/>` +
      `<path d="M -12 -200 Q -30 -260 -10 -310" stroke-width="3"/>` +
    `</g>`;

  const eyes = (x: number, y: number) =>
    `<g fill="#ef4444" transform="translate(${x}, ${y})">` +
      `<ellipse cx="-8" cy="0" rx="5" ry="2" transform="rotate(-10 -8 0)"/>` +
      `<ellipse cx="8" cy="0" rx="5" ry="2" transform="rotate(10 8 0)"/>` +
    `</g>`;

  return scene(defs,
    bg("url(#hcf-sky)") +
    `<circle cx="360" cy="240" r="120" fill="url(#hcf-moon)"/>` +
    `<g opacity="0.5">` +
      deadTree(180, 780, 0.95) +
      deadTree(520, 760, 0.8) +
    `</g>` +
    `<path d="M 0 760 Q 360 700 720 810 L 720 1080 L 0 1080 Z" fill="#7f1d1d" opacity="0.25" filter="url(#hcf-blur-local)"/>` +
    deadTree(80, 960, 1.35) +
    deadTree(640, 980, 1.25) +
    `<path d="M 0 880 Q 200 840 400 890 T 720 860 L 720 1080 L 0 1080 Z" fill="#090514"/>` +
    `<path d="M 0 940 Q 360 900 720 950 L 720 1080 L 0 1080 Z" fill="#02010a"/>` +
    eyes(220, 910) +
    eyes(480, 930) +
    eyes(140, 960)
  );
})();

const sFantasyTemple = (() => {
  const defs =
    vGrad("hft-sky", [
      ["0", "#0c051a"],
      ["0.5", "#1e0b36"],
      ["1", "#2e0f4a"],
    ]) +
    rGrad("hft-pool", 360, 1080, 500, [
      ["0", "#22d3ee", "0.9"],
      ["0.6", "#0891b2", "0.4"],
      ["1", "#0f172a", "0"],
    ]) +
    rGrad("hft-glow", 360, 400, 300, [
      ["0", "#a78bfa", "0.65"],
      ["0.5", "#818cf8", "0.25"],
      ["1", "#a78bfa", "0"],
    ]);

  const column = (x: number, y: number, w: number, h: number) => {
    return `<g>` +
      `<rect x="${x - w * 0.15}" y="${y + h - 25}" width="${w * 1.3}" height="25" fill="#f8fafc" rx="4" />` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h - 25}" fill="#e2e8f0" />` +
      `<line x1="${x + w * 0.25}" y1="${y}" x2="${x + w * 0.25}" y2="${y + h - 25}" stroke="#cbd5e1" stroke-width="4"/>` +
      `<line x1="${x + w * 0.5}" y1="${y}" x2="${x + w * 0.5}" y2="${y + h - 25}" stroke="#94a3b8" stroke-width="5"/>` +
      `<line x1="${x + w * 0.75}" y1="${y}" x2="${x + w * 0.75}" y2="${y + h - 25}" stroke="#cbd5e1" stroke-width="4"/>` +
      `<rect x="${x - w * 0.1}" y="${y}" width="${w * 1.2}" height="35" fill="#f1f5f9" rx="6" />` +
      `<rect x="${x - w * 0.05}" y="${y + 15}" width="${w * 1.1}" height="10" fill="#cbd5e1" />` +
      `</g>`;
  };

  const body =
    bg("url(#hft-sky)") +
    stars(80, 777, 0, 0, 720, 700, 0.9, 2.5, "#fff") +
    `<circle cx="360" cy="400" r="180" fill="url(#hft-glow)"/>` +
    `<circle cx="360" cy="380" r="80" fill="#faf5ff" opacity="0.12" />` +
    `<circle cx="360" cy="380" r="75" fill="#fff" opacity="0.8" />` +
    `<circle cx="360" cy="380" r="120" fill="none" stroke="#c084fc" stroke-width="12" stroke-dasharray="10 30" opacity="0.7" />` +
    `<circle cx="360" cy="380" r="105" fill="none" stroke="#38bdf8" stroke-width="6" stroke-dasharray="5 15" opacity="0.8" />` +
    ridge([
      [0, 650], [120, 580], [280, 680], [420, 560], [560, 640], [720, 590]
    ], 700, "#1e113a") +
    `<rect x="140" y="660" width="440" height="20" fill="#0f172a" />` +
    `<rect x="110" y="680" width="500" height="30" fill="#334155" />` +
    `<rect x="60" y="710" width="600" height="40" fill="#475569" />` +
    column(80, 480, 50, 230) +
    column(180, 450, 45, 260) +
    column(590, 480, 50, 230) +
    column(495, 450, 45, 260) +
    `<path d="M 0 750 H 720 L 640 1080 H 80 Z" fill="#1e293b" />` +
    `<path d="M 180 750 L 80 1080 H 640 L 540 750 Z" fill="url(#hft-pool)" />` +
    `<circle cx="280" cy="620" r="6" fill="#67e8f9" opacity="0.8" />` +
    `<circle cx="440" cy="640" r="8" fill="#c084fc" opacity="0.75" />` +
    `<circle cx="320" cy="520" r="5" fill="#fef08a" opacity="0.6" />` +
    `<circle cx="410" cy="500" r="4" fill="#a78bfa" opacity="0.7" />` +
    `<circle cx="240" cy="570" r="6" fill="#38bdf8" opacity="0.6" />` +
    `<circle cx="480" cy="580" r="5" fill="#22d3ee" opacity="0.8" />`;

  return scene(defs, body);
})();

const sCyberLab = (() => {
  const defs =
    vGrad("hcl-sky", [
      ["0", "#080711"],
      ["0.5", "#0f1122"],
      ["1", "#151833"],
    ]) +
    rGrad("hcl-cyan-glow", 150, 450, 350, [
      ["0", "#06b6d4", "0.35"],
      ["0.7", "#06b6d4", "0.08"],
      ["1", "#06b6d4", "0"],
    ]) +
    rGrad("hcl-magenta-glow", 570, 400, 300, [
      ["0", "#d946ef", "0.32"],
      ["0.65", "#d946ef", "0.06"],
      ["1", "#d946ef", "0"],
    ]) +
    vGrad("hcl-floor", [
      ["0", "#181a30"],
      ["0.5", "#0a0c16"],
      ["1", "#04050a"],
    ]);

  const body =
    bg("url(#hcl-sky)") +
    bg("url(#hcl-cyan-glow)") +
    bg("url(#hcl-magenta-glow)") +
    `<rect x="20" y="100" width="100" height="500" fill="#1e1e2f" stroke="#06b6d4" stroke-width="4" />` +
    `<rect x="35" y="120" width="70" height="15" fill="#0891b2" opacity="0.8" />` +
    `<rect x="35" y="145" width="70" height="15" fill="#0f172a" />` +
    `<circle cx="45" cy="152" r="3" fill="#22c55e" stroke="none" />` +
    `<circle cx="55" cy="152" r="3" fill="#ef4444" stroke="none" />` +
    `<rect x="35" y="170" width="70" height="15" fill="#0891b2" opacity="0.8" />` +
    `<rect x="35" y="195" width="70" height="15" fill="#0891b2" opacity="0.8" />` +
    `<rect x="35" y="220" width="70" height="15" fill="#0f172a" />` +
    `<circle cx="45" cy="227" r="3" fill="#22c55e" stroke="none" />` +
    `<rect x="35" y="245" width="70" height="15" fill="#0891b2" opacity="0.8" />` +
    `<rect x="35" y="270" width="70" height="15" fill="#0f172a" />` +
    `<circle cx="55" cy="277" r="3" fill="#f59e0b" stroke="none" />` +
    `<rect x="35" y="295" width="70" height="80" fill="#0a0f1d" stroke="#3b82f6" stroke-width="2"/>` +
    `<path d="M 45 315 L 95 355" stroke="#38bdf8" stroke-width="3" fill="none" />` +
    `<rect x="600" y="80" width="100" height="520" fill="#1e1e2f" stroke="#d946ef" stroke-width="4" />` +
    `<rect x="615" y="110" width="70" height="40" fill="#4a044e" />` +
    `<path d="M625 130 H 675" stroke="#e879f9" stroke-width="5" />` +
    `<rect x="615" y="170" width="70" height="40" fill="#0f172a" />` +
    `<circle cx="630" cy="190" r="5" fill="#22c55e" />` +
    `<circle cx="645" cy="190" r="5" fill="#22c55e" />` +
    `<circle cx="660" cy="190" r="5" fill="#ef4444" />` +
    `<rect x="615" y="230" width="70" height="40" fill="#4a044e" />` +
    `<path d="M625 250 H 675" stroke="#e879f9" stroke-width="5" />` +
    `<g opacity="0.85">` +
      `<rect x="180" y="120" width="360" height="280" rx="16" fill="#0f172a" stroke="#00f5ff" stroke-width="5" opacity="0.75"/>` +
      `<rect x="195" y="135" width="330" height="250" rx="10" fill="#050811" />` +
      `<line x1="195" y1="260" x2="525" y2="260" stroke="#00f5ff" stroke-width="1" opacity="0.2"/>` +
      `<line x1="360" y1="135" x2="360" y2="385" stroke="#00f5ff" stroke-width="1" opacity="0.2"/>` +
      `<circle cx="360" cy="260" r="80" fill="none" stroke="#ff2ea6" stroke-width="2.5" stroke-dasharray="6 8"/>` +
      `<circle cx="360" cy="260" r="40" fill="none" stroke="#00f5ff" stroke-width="2"/>` +
      `<path d="M 360 260 L 420 200" stroke="#00f5ff" stroke-width="3" stroke-linecap="round" />` +
      `<polygon points="415,200 422,198 420,205" fill="#00f5ff" />` +
      `<rect x="210" y="150" width="40" height="15" fill="#00f5ff" />` +
      `<rect x="210" y="170" width="60" height="15" fill="#00f5ff" opacity="0.7" />` +
      `<rect x="210" y="190" width="25" height="15" fill="#00f5ff" opacity="0.4" />` +
      `<rect x="450" y="150" width="50" height="12" fill="#ff2ea6" />` +
      `<rect x="450" y="167" width="35" height="12" fill="#ff2ea6" opacity="0.6" />` +
    `</g>` +
    `<path d="M0 600 H720 L660 760 H60 Z" fill="#1e1e2f" stroke="${INK}" stroke-width="8"/>` +
    `<rect x="140" y="630" width="440" height="80" rx="10" fill="#0f172a" stroke="#3b82f6" stroke-width="4"/>` +
    `<circle cx="170" cy="670" r="10" fill="#ef4444" />` +
    `<circle cx="200" cy="670" r="10" fill="#22c55e" />` +
    `<circle cx="230" cy="670" r="10" fill="#3b82f6" />` +
    `<rect x="270" y="650" width="100" height="40" rx="4" fill="#334155" />` +
    `<path d="M280 670 H360" stroke="#10b981" stroke-width="6" />` +
    `<rect x="390" y="650" width="160" height="40" rx="4" fill="#334155" />` +
    `<rect x="410" y="660" width="30" height="20" fill="#a78bfa" />` +
    `<rect x="450" y="660" width="30" height="20" fill="#fbcfe8" />` +
    `<rect x="490" y="660" width="40" height="20" fill="#00f5ff" />` +
    `<path d="M 0 760 H 720 L 720 1080 H 0 Z" fill="url(#hcl-floor)" />` +
    `<path d="M 360 760 L 360 1080" stroke="#3b82f6" stroke-width="3" opacity="0.3" />` +
    `<path d="M 220 760 L 60 1080" stroke="#3b82f6" stroke-width="2" opacity="0.25" />` +
    `<path d="M 500 760 L 660 1080" stroke="#3b82f6" stroke-width="2" opacity="0.25" />` +
    `<line x1="0" y1="840" x2="720" y2="840" stroke="#3b82f6" stroke-width="1.5" opacity="0.2" />` +
    `<line x1="0" y1="940" x2="720" y2="940" stroke="#3b82f6" stroke-width="1.5" opacity="0.2" />` +
    `<line x1="0" y1="1040" x2="720" y2="1040" stroke="#3b82f6" stroke-width="2" opacity="0.3" />`;

  return scene(defs, body);
})();

const sVintageStudy = (() => {
  const defs =
    vGrad("hvs-sky", [
      ["0", "#0c0a21"],
      ["0.6", "#14112e"],
      ["1", "#1e153f"],
    ]) +
    rGrad("hvs-room-glow", 360, 800, 600, [
      ["0", "#fef08a", "0.45"],
      ["0.4", "#fcd34d", "0.22"],
      ["1", "#451a03", "0"],
    ]) +
    vGrad("hvs-wood", [
      ["0", "#451a03"],
      ["0.5", "#301002"],
      ["1", "#1c0901"],
    ]);

  const books = (x: number, y: number, w: number, h: number) => {
    let out = "";
    const colors = ["#b91c1c", "#1d4ed8", "#15803d", "#d97706", "#7c3aed", "#475569"];
    let curX = x;
    const random = rng(x + y);
    while (curX < x + w - 10) {
      const bw = 8 + random() * 12;
      const bh = h * 0.7 + random() * (h * 0.25);
      const color = colors[Math.floor(random() * colors.length)];
      out += `<rect x="${curX.toFixed(1)}" y="${(y + h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" stroke="${INK}" stroke-width="2.5" />`;
      if (bh > 45) {
        out += `<line x1="${(curX + bw / 2).toFixed(1)}" y1="${(y + h - bh + 10).toFixed(1)}" x2="${(curX + bw / 2).toFixed(1)}" y2="${(y + h - 10).toFixed(1)}" stroke="#fef08a" stroke-dasharray="4,8" stroke-width="2" opacity="0.7" />`;
      }
      curX += bw;
    }
    return out;
  };

  const shelf = (y: number) => {
    return `<rect x="40" y="${y}" width="240" height="15" fill="#3f1a04" stroke="${INK}" stroke-width="4" />` +
      books(50, y - 80, 220, 80) +
      `<rect x="440" y="${y}" width="240" height="15" fill="#3f1a04" stroke="${INK}" stroke-width="4" />` +
      books(450, y - 80, 220, 80);
  };

  const body =
    bg("#1c1917") +
    bg("url(#hvs-room-glow)") +
    `<path d="M 280 450 C 280 280, 440 280, 440 450 L 440 700 H 280 Z" fill="url(#hvs-sky)" stroke="${INK}" stroke-width="8" />` +
    stars(30, 999, 290, 310, 430, 680, 0.7, 2.0, "#fff") +
    `<path d="M 400 350 A 25 25 0 1 0 400 390 A 20 20 0 1 1 400 350 Z" fill="#fef08a" opacity="0.85" />` +
    `<path d="M 360 300 V 700 M 280 480 H 440 M 280 580 H 440" stroke="${INK}" stroke-width="6" fill="none" opacity="0.8" />` +
    `<path d="M 280 300 C 260 400, 260 500, 240 680 L 280 680 Z" fill="#991b1b" stroke="${INK}" stroke-width="4" />` +
    `<path d="M 440 300 C 460 400, 460 500, 480 680 L 440 680 Z" fill="#991b1b" stroke="${INK}" stroke-width="4" />` +
    `<rect x="30" y="80" width="260" height="740" fill="#5c2606" stroke="${INK}" stroke-width="7" />` +
    `<rect x="40" y="90" width="240" height="720" fill="#2d1502" />` +
    `<rect x="430" y="80" width="260" height="740" fill="#5c2606" stroke="${INK}" stroke-width="7" />` +
    `<rect x="440" y="90" width="240" height="720" fill="#2d1502" />` +
    shelf(180) +
    shelf(290) +
    shelf(400) +
    shelf(510) +
    shelf(620) +
    shelf(730) +
    `<ellipse cx="360" cy="850" rx="140" ry="40" fill="#7f1d1d" stroke="${INK}" stroke-width="5" />` +
    `<ellipse cx="360" cy="850" rx="110" ry="30" fill="#fb7185" stroke-width="3" fill-opacity="0.3" />` +
    `<path d="M 0 820 L 0 1080 H 720 L 720 820 Z" fill="url(#hvs-wood)" opacity="0.9" stroke="${INK}" stroke-width="7" />` +
    `<polygon points="120,950 600,950 640,1080 80,1080" fill="#78350f" stroke="${INK}" stroke-width="8" />` +
    `<rect x="220" y="960" width="80" height="60" rx="3" fill="#fafaf9" stroke="${INK}" stroke-width="3" transform="rotate(-8 260 990)" />` +
    `<rect x="340" y="962" width="100" height="70" rx="3" fill="#fafaf9" stroke="${INK}" stroke-width="3" transform="rotate(5 390 997)" />` +
    `<ellipse cx="500" cy="980" rx="15" ry="6" fill="#fbbf24" stroke="${INK}" stroke-width="3" />` +
    `<rect x="496" y="955" width="8" height="25" fill="#fef08a" stroke="${INK}" stroke-width="3" />` +
    `<path d="M 500 955 C 500 955, 490 940, 500 930 C 510 940, 500 955, 500 955 Z" fill="#f97316" stroke="${INK}" stroke-width="2" />`;

  return scene(defs, body);
})();

export const BG_SCENES_EXTRA: BgScene[] = [
  { id: "x-murim-bamboo-canyon", label: "협곡 대나무길", genre: "무협", svg: sMurimBambooCanyon },
  { id: "x-sageuk-tiled-night", label: "기와 야경", genre: "사극", svg: sSageukTiledNight },
  { id: "x-cyber-neon-city", label: "네온 도시", genre: "사이버펑크", svg: sCyberNeonCity },
  { id: "x-sf-starship-interior", label: "함선 내부", genre: "SF", svg: sSfStarshipInterior },
  { id: "x-horror-fog-house", label: "안개 폐가", genre: "공포", svg: sHorrorFogHouse },
  { id: "x-school-rooftop-sunset", label: "옥상 노을", genre: "학원", svg: sSchoolRooftopSunset },
  { id: "x-cozy-cafe-interior", label: "아늑한 카페", genre: "일상", svg: sCozyCafeInterior },
  { id: "x-fantasy-enchanted-woods", label: "마법 숲", genre: "판타지", svg: sFantasyEnchantedWoods },
  { id: "x-rainy-city-street", label: "비 내린 거리", genre: "드라마", svg: sRainyCityStreet },
  { id: "x-winter-snow-peaks", label: "설산 봉우리", genre: "모험", svg: sWinterSnowPeaks },
  { id: "x-wild-west-desert", label: "황야의 서부", genre: "모험", svg: sWildWestDesert },
  { id: "x-deep-sea-abyss", label: "심해 아비스", genre: "판타지", svg: sDeepSeaAbyss },
  { id: "x-cherry-blossoms", label: "고요한 벚꽃길", genre: "로맨스", svg: sCherryBlossoms },
  { id: "x-murim-ink-cliff", label: "무협 검은절벽", genre: "무협", svg: sMurimInkCliff },
  { id: "x-horror-crimson-forest", label: "공포 핏빛숲", genre: "공포", svg: sHorrorCrimsonForest },
  { id: "x-fantasy-temple", label: "신비로운 신전", genre: "판타지", svg: sFantasyTemple },
  { id: "x-cyber-lab", label: "사이버 연구소", genre: "사이버펑크", svg: sCyberLab },
  { id: "x-vintage-study", label: "고풍스러운 서재", genre: "일상", svg: sVintageStudy },
];
