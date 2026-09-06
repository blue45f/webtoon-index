// 만화 효과(FX) 오버레이 라이브러리 — 패널 위에 "투명 이미지"로 드롭하는 망가식 연출 효과.
// 모두 순수 자체 벡터 SVG(외부 ref/래스터/이모지 아트 없음). 투명 배경, 적절한 곳에 굵은 잉크 라인(#16100c).
// 각 svg는 자체 완결형 standalone 문자열: <svg xmlns ... viewBox="0 0 W H"> ... </svg>

export interface FxOverlay {
  id: string;
  label: string;
  svg: string;
  width: number;
  height: number;
}

export interface ComicVectorSticker {
  id: string;
  label: string;
  svg: string;
  width: number;
  height: number;
}

const INK = "#16100c"; // 굵은 잉크 라인 색
const WHITE = "#ffffff";

// 내부 유틸: 자체 완결형 svg 문자열 래퍼.
function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

// ──────────────────────────────────────────────────────────────────────────
// 1) 집중선 — 중심으로 모이는 방사형 잉크 쐐기(가운데는 비워 시선 집중).
// ──────────────────────────────────────────────────────────────────────────
function radialFocus(): string {
  const W = 480;
  const H = 480;
  const cx = W / 2;
  const cy = H / 2;
  const rIn = 92; // 가운데 빈 원 반지름
  const rOut = 340;
  const count = 56;
  const wedges: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    // 두께를 살짝 들쭉날쭉하게(손맛).
    const tw = 0.018 + ((i % 3) === 0 ? 0.016 : (i % 2 === 0 ? 0.009 : 0.004));
    const oR = rOut + ((i % 4) - 1.5) * 14;
    const x0 = cx + Math.cos(a - tw) * rIn;
    const y0 = cy + Math.sin(a - tw) * rIn;
    const x1 = cx + Math.cos(a + tw) * rIn;
    const y1 = cy + Math.sin(a + tw) * rIn;
    const x2 = cx + Math.cos(a) * oR;
    const y2 = cy + Math.sin(a) * oR;
    wedges.push(
      `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${INK}"/>`,
    );
  }
  return svg(W, H, wedges.join(""));
}

// ──────────────────────────────────────────────────────────────────────────
// 2) 속도선 — 가로 방향 스피드 라인(좌우로 흐르는 잉크 줄).
// ──────────────────────────────────────────────────────────────────────────
function speedLines(): string {
  const W = 480;
  const H = 200;
  const rows = 22;
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const y = ((i + 0.5) / rows) * H;
    const thick = 1 + ((i * 7) % 5) * 0.9;
    // 좌측은 가늘게 시작해 우측으로 끝나는, 길이가 다른 줄.
    const x1 = ((i * 53) % 140);
    const x2 = W - ((i * 31) % 90);
    lines.push(
      `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${INK}" stroke-width="${thick.toFixed(1)}" stroke-linecap="round"/>`,
    );
  }
  return svg(W, H, lines.join(""));
}

// ──────────────────────────────────────────────────────────────────────────
// 3) 임팩트 플래시 — 별폭발(starburst) 충격 폭. 뾰족한 다각형 외곽.
// ──────────────────────────────────────────────────────────────────────────
function impactFlash(): string {
  const W = 460;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const spikes = 18;
  const rOut = 220;
  const rIn = 118;
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    // 뾰족함을 들쭉날쭉하게.
    const r = i % 2 === 0 ? rOut + ((i % 4) - 1.5) * 18 : rIn - ((i % 3) - 1) * 14;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  // 안쪽 작은 별(밝은 중심 강조용 빈 폴리곤).
  const inner: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 96 : 44;
    inner.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return svg(
    W,
    H,
    `<polygon points="${pts.join(" ")}" fill="${INK}"/>` +
      `<polygon points="${inner.join(" ")}" fill="#ffffff"/>`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 4) 충격 번개 — 갈라지는 번개 크랙(굵은 지그재그 + 잔가지).
// ──────────────────────────────────────────────────────────────────────────
function lightningCrack(): string {
  const W = 320;
  const H = 460;
  // 메인 줄기(채워진 두꺼운 번개 보디).
  const main =
    `<path d="M168 8 L120 168 L176 168 L96 320 L150 300 L70 452 L208 232 L150 232 L214 96 L162 116 Z" ` +
    `fill="${INK}"/>`;
  // 잔가지(가는 stroke 번개).
  const fork1 = `<path d="M176 168 L236 214 L210 224 L262 268" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`;
  const fork2 = `<path d="M96 320 L52 352 L78 360 L40 404" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`;
  return svg(W, H, main + fork1 + fork2);
}

// ──────────────────────────────────────────────────────────────────────────
// 5) 스크린톤 도트 — 하프톤 도트 필드(균일 격자 점). 패널 음영/배경 톤.
// ──────────────────────────────────────────────────────────────────────────
function halftoneDots(): string {
  const W = 360;
  const H = 360;
  const step = 22;
  const r = 5.2;
  const dots: string[] = [];
  for (let yy = step / 2; yy < H; yy += step) {
    const odd = Math.round((yy - step / 2) / step) % 2 === 1;
    for (let xx = step / 2 + (odd ? step / 2 : 0); xx < W; xx += step) {
      dots.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="${r}" fill="${INK}"/>`);
    }
  }
  return svg(W, H, dots.join(""));
}

// ──────────────────────────────────────────────────────────────────────────
// 6) 비네팅 — 가장자리만 어두워지는 부드러운 비네트(라디얼 그라디언트 마스크).
// ──────────────────────────────────────────────────────────────────────────
function vignette(): string {
  const W = 480;
  const H = 480;
  // 가운데는 투명, 가장자리로 갈수록 잉크가 진해지는 라디얼.
  const grad =
    `<defs><radialGradient id="vgr" cx="50%" cy="50%" r="62%">` +
    `<stop offset="0%" stop-color="${INK}" stop-opacity="0"/>` +
    `<stop offset="58%" stop-color="${INK}" stop-opacity="0"/>` +
    `<stop offset="84%" stop-color="${INK}" stop-opacity="0.45"/>` +
    `<stop offset="100%" stop-color="${INK}" stop-opacity="0.92"/>` +
    `</radialGradient></defs>`;
  return svg(W, H, `${grad}<rect x="0" y="0" width="${W}" height="${H}" fill="url(#vgr)"/>`);
}

// ──────────────────────────────────────────────────────────────────────────
// 7) 큰 땀방울 — 단일 대형 만화식 땀방울(외곽선 + 하이라이트).
// ──────────────────────────────────────────────────────────────────────────
function bigSweatDrop(): string {
  const W = 240;
  const H = 320;
  // 위는 뾰족, 아래는 둥근 물방울.
  const body =
    `<path d="M120 24 C148 96 206 150 206 214 C206 274 168 308 120 308 ` +
    `C72 308 34 274 34 214 C34 150 92 96 120 24 Z" fill="#bfe9ff" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>`;
  // 하이라이트(왼쪽 위 흰 반점).
  const hi = `<ellipse cx="86" cy="206" rx="20" ry="34" fill="#ffffff" opacity="0.9"/>`;
  return svg(W, H, body + hi);
}

// ──────────────────────────────────────────────────────────────────────────
// 8) 분노 마크 — 💢 모양 벡터(교차하는 핏대 마크).
// ──────────────────────────────────────────────────────────────────────────
function angerMark(): string {
  const W = 260;
  const H = 260;
  const cx = W / 2;
  const cy = H / 2;
  // 4방향으로 뻗는 둥근 모서리 ㄱ자형 핏대 묶음.
  // 각 가지: 안쪽에서 바깥으로 굵게 꺾이는 path.
  const arm = (rot: number) =>
    `<g transform="rotate(${rot} ${cx} ${cy})">` +
    `<path d="M130 70 L130 36 L96 36" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M130 78 L168 40" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>` +
    `</g>`;
  const arms = [0, 90, 180, 270].map(arm).join("");
  // 가운데 작은 핏대 마름모.
  const core = `<path d="M130 104 L156 130 L130 156 L104 130 Z" fill="none" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>`;
  return svg(W, H, arms + core);
}

// ──────────────────────────────────────────────────────────────────────────
// 9) 하트 뿜뿜 — 크고 작은 하트가 위로 솟는 클러스터.
// ──────────────────────────────────────────────────────────────────────────
function heartBurst(): string {
  const W = 320;
  const H = 360;
  const heart = (x: number, y: number, s: number, fill: string) => {
    // 단위 하트(약 32×30)를 s배 스케일.
    return (
      `<g transform="translate(${x} ${y}) scale(${s})">` +
      `<path d="M16 28 C16 28 0 16 0 8 C0 2 4 0 8 0 C12 0 16 4 16 8 C16 4 20 0 24 0 C28 0 32 2 32 8 C32 16 16 28 16 28 Z" ` +
      `fill="${fill}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/></g>`
    );
  };
  const parts = [
    heart(120, 180, 3.4, "#ff6f91"),
    heart(40, 240, 1.9, "#ff97ad"),
    heart(220, 210, 2.2, "#ff8aa3"),
    heart(70, 90, 1.5, "#ffb3c4"),
    heart(200, 70, 1.8, "#ff7d9c"),
    heart(150, 20, 1.1, "#ffc2d0"),
  ].join("");
  return svg(W, H, parts);
}

// ──────────────────────────────────────────────────────────────────────────
// 10) 물음표 마크 — 말풍선 없는 큰 ? (당황/의문).
// ──────────────────────────────────────────────────────────────────────────
function questionMark(): string {
  const W = 200;
  const H = 280;
  // 곡선 갈고리 + 점. 굵은 잉크 stroke.
  const hook =
    `<path d="M44 78 C44 30 92 18 120 18 C158 18 178 44 178 76 C178 116 122 122 120 162 L120 184" ` +
    `fill="none" stroke="${INK}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = `<circle cx="120" cy="244" r="20" fill="${INK}"/>`;
  return svg(W, H, hook + dot);
}

// ──────────────────────────────────────────────────────────────────────────
// 11) 느낌표 마크 — 말풍선 없는 큰 ! (놀람/충격).
// ──────────────────────────────────────────────────────────────────────────
function exclaimMark(): string {
  const W = 140;
  const H = 280;
  const cx = W / 2;
  // 위가 굵고 아래로 가늘어지는 막대 + 점.
  const bar =
    `<path d="M${cx - 22} 24 L${cx + 22} 24 L${cx + 12} 188 L${cx - 12} 188 Z" ` +
    `fill="${INK}"/>`;
  const dot = `<circle cx="${cx}" cy="240" r="22" fill="${INK}"/>`;
  return svg(W, H, bar + dot);
}

// ──────────────────────────────────────────────────────────────────────────
// 12) 반짝임 클러스터 — 4갈래 스파클 별 무리(키라키라).
// ──────────────────────────────────────────────────────────────────────────
function sparkleCluster(): string {
  const W = 360;
  const H = 360;
  // 4갈래 별(오목한 마름모) 단위.
  const star = (x: number, y: number, s: number, fill: string) => {
    const r = 30 * s; // 바깥
    const w = 7 * s; // 오목 폭
    const pts = [
      `${x},${y - r}`,
      `${x + w},${y - w}`,
      `${x + r},${y}`,
      `${x + w},${y + w}`,
      `${x},${y + r}`,
      `${x - w},${y + w}`,
      `${x - r},${y}`,
      `${x - w},${y - w}`,
    ].join(" ");
    return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="${(2 * s).toFixed(1)}" stroke-linejoin="round"/>`;
  };
  const parts = [
    star(180, 150, 1.5, "#fff4b8"),
    star(86, 96, 0.85, "#ffffff"),
    star(268, 110, 1.05, "#ffe680"),
    star(120, 250, 0.7, "#ffffff"),
    star(252, 244, 0.95, "#fff0a0"),
    star(308, 188, 0.5, "#ffffff"),
  ].join("");
  return svg(W, H, parts);
}

// ──────────────────────────────────────────────────────────────────────────
// 13) 우울 세로줄 — 머리 위에서 떨어지는 수직 침울 라인(그림자 톤).
// ──────────────────────────────────────────────────────────────────────────
function gloomLines(): string {
  const W = 320;
  const H = 280;
  const cols = 16;
  const lines: string[] = [];
  for (let i = 0; i < cols; i++) {
    const x = ((i + 0.5) / cols) * W;
    const thick = 2 + ((i * 5) % 4) * 1.1;
    // 위에서 시작, 길이가 들쭉날쭉(끝이 다른).
    const y2 = H - ((i * 37) % 70);
    lines.push(
      `<line x1="${x.toFixed(1)}" y1="6" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="${thick.toFixed(1)}" stroke-linecap="round" opacity="0.82"/>`,
    );
  }
  return svg(W, H, lines.join(""));
}

// ──────────────────────────────────────────────────────────────────────────
// 14) 당황 식은땀 — 작은 식은땀 방울 여러 개(머리 옆 흩뿌림).
// ──────────────────────────────────────────────────────────────────────────
function nervousSweat(): string {
  const W = 320;
  const H = 240;
  const drop = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<path d="M0 -26 C9 -8 22 4 22 18 C22 32 12 40 0 40 C-12 40 -22 32 -22 18 C-22 4 -9 -8 0 -26 Z" ` +
    `fill="#cfeeff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<ellipse cx="-7" cy="16" rx="5" ry="8" fill="#ffffff" opacity="0.9"/></g>`;
  const parts = [
    drop(70, 90, 1.5),
    drop(176, 60, 1.1),
    drop(248, 120, 1.3),
    drop(128, 170, 0.85),
    drop(214, 190, 0.7),
  ].join("");
  return svg(W, H, parts);
}

// ──────────────────────────────────────────────────────────────────────────
// 15) 집중 강조선(speed-radial) — 방사형 + 속도감을 섞은, 중심에서 사방으로
//      가늘게 뻗는 강조선(가운데는 살짝 비움). 집중선보다 가볍고 날카로움.
// ──────────────────────────────────────────────────────────────────────────
function speedRadial(): string {
  const W = 480;
  const H = 480;
  const cx = W / 2;
  const cy = H / 2;
  const rIn = 64;
  const rOut = 350;
  const count = 88;
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const oR = rOut + ((i % 5) - 2) * 16;
    const tw = 1.1 + ((i % 3) === 0 ? 2.0 : 0.4); // 가는 라인, 가끔 굵게
    const x1 = cx + Math.cos(a) * rIn;
    const y1 = cy + Math.sin(a) * rIn;
    const x2 = cx + Math.cos(a) * oR;
    const y2 = cy + Math.sin(a) * oR;
    lines.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="${tw.toFixed(1)}" stroke-linecap="round"/>`,
    );
  }
  return svg(W, H, lines.join(""));
}

// ──────────────────────────────────────────────────────────────────────────
// 16) 졸음/잠 — zzz 만화 졸음 표식(말풍선 없이 떠오르는 Z 삼총사).
// ──────────────────────────────────────────────────────────────────────────
function sleepyZ(): string {
  const W = 260;
  const H = 280;
  const zChar = (x: number, y: number, s: number) => {
    // Z자 외곽(상단 가로, 대각선, 하단 가로)을 굵은 stroke로.
    const top = `M${x} ${y} L${x + 60 * s} ${y}`;
    const diag = `L${x} ${y + 64 * s}`;
    const bottom = `L${x + 60 * s} ${y + 64 * s}`;
    return `<path d="${top} ${diag} ${bottom}" fill="none" stroke="${INK}" stroke-width="${(11 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  const parts = [zChar(150, 184, 0.7), zChar(96, 100, 1.05), zChar(20, 0, 1.45)].join("");
  return svg(W, H, parts);
}

// ──────────────────────────────────────────────────────────────────────────
// 17) 음표 — 흥얼거림/노래 만화 음표 무리(♪♫).
// ──────────────────────────────────────────────────────────────────────────
function musicNotes(): string {
  const W = 300;
  const H = 280;
  // 8분음표 단위: 머리(타원) + 기둥 + 깃발.
  const eighth = (x: number, y: number, s: number, rot: number) =>
    `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot})">` +
    `<ellipse cx="0" cy="58" rx="18" ry="13" fill="${INK}" transform="rotate(-20 0 58)"/>` +
    `<path d="M16 56 L16 0" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M16 0 C42 6 44 28 36 40" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/></g>`;
  // 연음표(두 머리 + 빔).
  const beamed = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<ellipse cx="0" cy="60" rx="17" ry="12" fill="${INK}" transform="rotate(-20 0 60)"/>` +
    `<ellipse cx="64" cy="60" rx="17" ry="12" fill="${INK}" transform="rotate(-20 64 60)"/>` +
    `<path d="M15 58 L15 4" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M79 58 L79 4" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M11 4 L83 12" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/></g>`;
  const parts = [eighth(48, 150, 1.25, -8), beamed(150, 40, 1.0), eighth(110, 200, 0.8, 6)].join("");
  return svg(W, H, parts);
}

// ──────────────────────────────────────────────────────────────────────────
// 18) 화염 — 타오르는 불꽃 실루엣(분노/열정 강조).
// ──────────────────────────────────────────────────────────────────────────
function flameBurst(): string {
  const W = 280;
  const H = 360;
  // 바깥 큰 불꽃(채움) + 안쪽 작은 불꽃(밝은 코어).
  const outer =
    `<path d="M140 14 C176 86 214 120 214 200 C214 286 178 340 140 340 ` +
    `C102 340 66 286 66 200 C66 156 92 132 102 96 C118 132 110 168 132 184 ` +
    `C150 156 126 96 140 14 Z" fill="#ff7a2e" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`;
  const inner =
    `<path d="M140 132 C160 172 178 198 178 240 C178 290 160 318 140 318 ` +
    `C120 318 102 290 102 240 C102 206 122 184 140 132 Z" fill="#ffd24a"/>`;
  return svg(W, H, outer + inner);
}

// ──────────────────────────────────────────────────────────────────────────
// 만화 벡터 스티커 — 작게 붙여 쓰는 아이콘형 감정/상태 스티커.
// ──────────────────────────────────────────────────────────────────────────
function stickerSweatDrops(): string {
  const W = 240;
  const H = 220;
  const drop = (x: number, y: number, s: number, rot: number) =>
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
    `<path d="M0 -52 C18 -20 42 -2 42 28 C42 58 22 78 0 78 C-22 78 -42 58 -42 28 C-42 -2 -18 -20 0 -52 Z" fill="#9fe4ff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<ellipse cx="-14" cy="24" rx="8" ry="15" fill="#fff8ef" opacity="0.92"/></g>`;
  return svg(W, H, drop(76, 88, 0.78, -12) + drop(152, 108, 1.0, 10) + drop(105, 156, 0.55, -4));
}

function stickerAngerPop(): string {
  const W = 240;
  const H = 240;
  const arm = (rot: number) =>
    `<g transform="rotate(${rot} 120 120)">` +
    `<path d="M120 70 L120 34 L84 34" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M120 70 L120 34 L84 34" fill="none" stroke="#ff5147" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M132 78 L170 40" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round"/>` +
    `<path d="M132 78 L170 40" fill="none" stroke="#ff5147" stroke-width="10" stroke-linecap="round"/></g>`;
  return svg(W, H, [0, 90, 180, 270].map(arm).join("") + `<path d="M120 94 L146 120 L120 146 L94 120 Z" fill="#fff0a8" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`);
}

function stickerHeart(): string {
  const W = 240;
  const H = 220;
  const heart =
    `<path d="M120 196 C120 196 30 132 30 72 C30 34 54 20 82 20 C104 20 118 36 120 56 C122 36 136 20 158 20 C186 20 210 34 210 72 C210 132 120 196 120 196 Z" fill="#ff6f91" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>`;
  const hi = `<path d="M70 56 C82 42 100 42 108 58" fill="none" stroke="#fff8ef" stroke-width="9" stroke-linecap="round"/>`;
  return svg(W, H, heart + hi);
}

function stickerStar(): string {
  const W = 240;
  const H = 240;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 98 : 43;
    pts.push(`${(120 + Math.cos(a) * r).toFixed(1)},${(122 + Math.sin(a) * r).toFixed(1)}`);
  }
  return svg(
    W,
    H,
    `<polygon points="${pts.join(" ")}" fill="#ffd84d" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>` +
      `<path d="M84 70 L106 92" stroke="#fff8ef" stroke-width="9" stroke-linecap="round"/>`,
  );
}

function stickerMusicNotes(): string {
  const W = 260;
  const H = 240;
  const note = (x: number, y: number, s: number, color: string, rot: number) =>
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
    `<ellipse cx="0" cy="78" rx="23" ry="16" fill="${color}" stroke="${INK}" stroke-width="7" transform="rotate(-18 0 78)"/>` +
    `<path d="M20 75 L20 0" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M20 0 C58 8 64 38 48 58" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/></g>`;
  return svg(W, H, note(76, 64, 0.92, "#74d7ff", -8) + note(174, 36, 0.72, "#ff8ac8", 7) + `<path d="M126 84 L186 96" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`);
}

function stickerIdeaBulb(): string {
  const W = 240;
  const H = 260;
  const rays = [0, 45, 90, 135, 180].map((rot) => `<path d="M120 24 L120 4" transform="rotate(${rot} 120 110)" stroke="#ffd84d" stroke-width="9" stroke-linecap="round"/>`).join("");
  const bulb =
    `<path d="M76 106 C76 64 100 42 120 42 C140 42 164 64 164 106 C164 130 150 144 140 158 L100 158 C90 144 76 130 76 106 Z" fill="#fff2a8" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<path d="M100 160 L140 160 L136 190 L104 190 Z" fill="#b7c1cc" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<path d="M102 174 L138 174" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M108 96 C116 84 126 84 134 96" fill="none" stroke="#fff8ef" stroke-width="8" stroke-linecap="round"/>`;
  return svg(W, H, rays + bulb);
}

function stickerQuestionPop(): string {
  const W = 210;
  const H = 260;
  const hook =
    `<path d="M52 76 C52 34 90 20 118 20 C154 20 176 42 176 74 C176 114 122 116 120 154 L120 174" fill="none" stroke="${INK}" stroke-width="31" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M52 76 C52 34 90 20 118 20 C154 20 176 42 176 74 C176 114 122 116 120 154 L120 174" fill="none" stroke="#7fd8ff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg(W, H, hook + `<circle cx="120" cy="224" r="22" fill="${INK}"/><circle cx="120" cy="224" r="12" fill="#7fd8ff"/>`);
}

function stickerExclaimPop(): string {
  const W = 170;
  const H = 260;
  return svg(
    W,
    H,
    `<path d="M60 22 L112 22 L100 172 L72 172 Z" fill="${INK}"/>` +
      `<path d="M74 34 L99 34 L92 158 L79 158 Z" fill="#ff5d4d"/>` +
      `<circle cx="86" cy="218" r="27" fill="${INK}"/><circle cx="86" cy="218" r="16" fill="#ff5d4d"/>`,
  );
}

function stickerShockLines(): string {
  const W = 280;
  const H = 220;
  const rays = [
    "M28 110 L108 110",
    "M42 42 L116 88",
    "M42 178 L116 132",
    "M252 110 L172 110",
    "M238 42 L164 88",
    "M238 178 L164 132",
  ]
    .map((d) => `<path d="${d}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>`)
    .join("");
  return svg(W, H, rays + `<path d="M140 60 L166 110 L140 160 L114 110 Z" fill="#fff8ef" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`);
}

function stickerSleepyZzz(): string {
  const W = 260;
  const H = 240;
  const z = (x: number, y: number, s: number) =>
    `<path d="M${x} ${y} L${x + 58 * s} ${y} L${x} ${y + 58 * s} L${x + 58 * s} ${y + 58 * s}" fill="none" stroke="${INK}" stroke-width="${(12 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const bubbles = `<circle cx="58" cy="178" r="13" fill="#d8f4ff" stroke="${INK}" stroke-width="5"/><circle cx="94" cy="202" r="8" fill="#d8f4ff" stroke="${INK}" stroke-width="4"/>`;
  return svg(W, H, bubbles + z(38, 78, 1.35) + z(142, 50, 0.95) + z(188, 122, 0.68));
}

function stickerTwinkle(): string {
  const W = 240;
  const H = 240;
  const star = (x: number, y: number, r: number, color: string) => {
    const w = r * 0.22;
    const pts = `${x},${y - r} ${x + w},${y - w} ${x + r},${y} ${x + w},${y + w} ${x},${y + r} ${x - w},${y + w} ${x - r},${y} ${x - w},${y - w}`;
    return `<polygon points="${pts}" fill="${color}" stroke="${INK}" stroke-width="${Math.max(4, r * 0.11)}" stroke-linejoin="round"/>`;
  };
  return svg(W, H, star(124, 104, 58, "#fff2a8") + star(62, 64, 28, "#fff8ef") + star(184, 64, 34, "#ffd84d") + star(178, 170, 24, "#fff8ef"));
}

function stickerAngryVein(): string {
  const W = 240;
  const H = 220;
  const vein =
    `<path d="M52 126 C86 98 84 64 118 56 C138 52 150 66 142 84 C166 72 190 78 198 100 C206 122 188 138 164 134 C174 158 164 182 140 188 C112 194 104 166 114 144 C88 154 62 150 52 126 Z" fill="#ff6b5d" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<path d="M82 124 C110 118 124 100 120 72 M126 118 C148 100 164 98 188 104 M122 130 C118 154 126 170 142 180" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  return svg(W, H, vein);
}

function stickerEmbarrassedSweat(): string {
  const W = 260;
  const H = 220;
  const marks =
    `<path d="M54 64 L90 46 M42 112 L84 112 M58 158 L94 176" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>` +
    `<path d="M150 48 C166 82 196 100 196 134 C196 170 176 194 150 194 C124 194 104 170 104 134 C104 100 134 82 150 48 Z" fill="#aeeaff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<ellipse cx="132" cy="134" rx="10" ry="17" fill="#fff8ef" opacity="0.9"/>` +
    `<path d="M206 62 L224 42 M216 98 L244 92" stroke="#ff8aa3" stroke-width="8" stroke-linecap="round"/>`;
  return svg(W, H, marks);
}

function stickerFocusMark(): string {
  const W = 260;
  const H = 260;
  const corners = [
    "M70 34 L34 34 L34 70",
    "M190 34 L226 34 L226 70",
    "M34 190 L34 226 L70 226",
    "M226 190 L226 226 L190 226",
  ].map((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const rays = [0, 60, 120, 180, 240, 300].map((rot) => `<path d="M130 62 L130 26" transform="rotate(${rot} 130 130)" stroke="#ffcf3d" stroke-width="7" stroke-linecap="round"/>`).join("");
  return svg(W, H, rays + corners + `<circle cx="130" cy="130" r="30" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="130" cy="130" r="7" fill="${INK}"/>`);
}

function stickerPuppy(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <path d="M50 60 C30 90, 25 150, 45 160 C60 165, 80 130, 80 90 Z" fill="#b07a56" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M190 60 C210 90, 215 150, 195 160 C180 165, 160 130, 160 90 Z" fill="#b07a56" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <ellipse cx="120" cy="115" rx="65" ry="55" fill="#f5e6d3" stroke="${INK}" stroke-width="8"/>
    <circle cx="95" cy="105" r="8" fill="${INK}"/>
    <circle cx="145" cy="105" r="8" fill="${INK}"/>
    <circle cx="92" cy="102" r="2.5" fill="#fff"/>
    <circle cx="142" cy="102" r="2.5" fill="#fff"/>
    <ellipse cx="120" cy="130" rx="22" ry="16" fill="#ffffff" stroke="${INK}" stroke-width="4"/>
    <polygon points="110,122 130,122 120,132" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M120 130 Q112 138 106 134 M120 130 Q128 138 134 134" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  `);
}

function stickerKitten(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <polygon points="45,95 45,35 105,75" fill="#3a3a3a" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <polygon points="58,85 58,48 95,73" fill="#ffaabf"/>
    <polygon points="195,95 195,35 135,75" fill="#3a3a3a" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <polygon points="182,85 182,48 145,73" fill="#ffaabf"/>
    <ellipse cx="120" cy="115" rx="62" ry="48" fill="#e2e8f0" stroke="${INK}" stroke-width="8"/>
    <ellipse cx="92" cy="110" rx="9" ry="12" fill="#22d3ee" stroke="${INK}" stroke-width="4"/>
    <circle cx="92" cy="110" r="4" fill="${INK}"/>
    <circle cx="90" cy="107" r="1.5" fill="#fff"/>
    <ellipse cx="148" cy="110" rx="9" ry="12" fill="#22d3ee" stroke="${INK}" stroke-width="4"/>
    <circle cx="148" cy="110" r="4" fill="${INK}"/>
    <circle cx="146" cy="107" r="1.5" fill="#fff"/>
    <polygon points="116,122 124,122 120,126" fill="#ffaabf" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M120 126 Q115 132 110 129 M120 126 Q125 132 130 129" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <line x1="45" y1="120" x2="20" y2="118" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <line x1="45" y1="128" x2="18" y2="132" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <line x1="195" y1="120" x2="220" y2="118" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <line x1="195" y1="128" x2="222" y2="132" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  `);
}

function stickerBunny(): string {
  const W = 240;
  const H = 260;
  return svg(W, H, `
    <path d="M70 100 C50 30, 75 10, 85 10 C95 10, 105 30, 95 100 Z" fill="#ffffff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M77 90 C62 40, 78 22, 85 22 C92 22, 98 40, 88 90 Z" fill="#ffccd5"/>
    <path d="M170 100 C190 30, 165 10, 155 10 C145 10, 135 30, 145 100 Z" fill="#ffffff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M163 90 C178 40, 162 22, 155 22 C148 22, 142 40, 152 90 Z" fill="#ffccd5"/>
    <circle cx="120" cy="165" r="54" fill="#ffffff" stroke="${INK}" stroke-width="8"/>
    <circle cx="96" cy="160" r="7" fill="${INK}"/>
    <circle cx="144" cy="160" r="7" fill="${INK}"/>
    <circle cx="94" cy="158" r="2" fill="#fff"/>
    <circle cx="142" cy="158" r="2" fill="#fff"/>
    <ellipse cx="84" cy="172" rx="10" ry="5" fill="#ffaabf" opacity="0.6"/>
    <ellipse cx="156" cy="172" rx="10" ry="5" fill="#ffaabf" opacity="0.6"/>
    <polygon points="116,170 124,170 120,174" fill="#f43f5e" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M120 174 Q115 180 108 177 M120 174 Q125 180 132 177" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  `);
}

function stickerChick(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <ellipse cx="56" cy="130" rx="14" ry="24" fill="#fde047" stroke="${INK}" stroke-width="8" transform="rotate(-20 56 130)"/>
    <ellipse cx="184" cy="130" rx="14" ry="24" fill="#fde047" stroke="${INK}" stroke-width="8" transform="rotate(20 184 130)"/>
    <ellipse cx="120" cy="120" rx="60" ry="58" fill="#fef08a" stroke="${INK}" stroke-width="8"/>
    <circle cx="92" cy="115" r="7.5" fill="${INK}"/>
    <circle cx="148" cy="115" r="7.5" fill="${INK}"/>
    <circle cx="90" cy="112" r="2" fill="#fff"/>
    <circle cx="146" cy="112" r="2" fill="#fff"/>
    <path d="M106 126 Q120 114 134 126 Q120 144 106 126 Z" fill="#fb923c" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M96 178 v16 M96 186 l-10 8 M96 186 l10 8" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <path d="M144 178 v16 M144 186 l-10 8 M144 186 l10 8" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  `);
}

function stickerBird(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <path d="M50 145 L20 170 L40 180 Z" fill="#60a5fa" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M100 135 C70 100, 60 70, 75 55 C90 50, 110 80, 130 115 Z" fill="#2563eb" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <ellipse cx="125" cy="130" rx="60" ry="46" fill="#60a5fa" stroke="${INK}" stroke-width="8"/>
    <path d="M125 155 A 40 32 0 0 0 178 115 A 60 46 0 0 1 125 155 Z" fill="#93c5fd" opacity="0.9"/>
    <circle cx="158" cy="118" r="7" fill="${INK}"/>
    <circle cx="156" cy="115" r="2" fill="#fff"/>
    <polygon points="182,122 205,124 184,134" fill="#fb923c" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  `);
}

function stickerTeddy(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <circle cx="65" cy="68" r="24" fill="#a16207" stroke="${INK}" stroke-width="8"/>
    <circle cx="65" cy="68" r="13" fill="#fef08a"/>
    <circle cx="175" cy="68" r="24" fill="#a16207" stroke="${INK}" stroke-width="8"/>
    <circle cx="175" cy="68" r="13" fill="#fef08a"/>
    <circle cx="120" cy="125" r="62" fill="#ca8a04" stroke="${INK}" stroke-width="8"/>
    <circle cx="95" cy="115" r="8" fill="${INK}"/>
    <circle cx="145" cy="115" r="8" fill="${INK}"/>
    <circle cx="92" cy="112" r="2.5" fill="#fff"/>
    <circle cx="142" cy="112" r="2.5" fill="#fff"/>
    <ellipse cx="120" cy="140" rx="24" ry="18" fill="#fef08a" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="120" cy="136" rx="11" ry="7" fill="${INK}"/>
    <path d="M120 143 Q114 149 108 146 M120 143 Q126 149 132 146" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
  `);
}

export const COMIC_VECTOR_STICKERS: ComicVectorSticker[] = [
  { id: "dog-sticker", label: "귀여운 강아지", svg: stickerPuppy(), width: 240, height: 240 },
  { id: "cat-sticker", label: "귀여운 고양이", svg: stickerKitten(), width: 240, height: 240 },
  { id: "bunny-sticker", label: "귀여운 토끼", svg: stickerBunny(), width: 240, height: 260 },
  { id: "chick-sticker", label: "귀여운 병아리", svg: stickerChick(), width: 240, height: 240 },
  { id: "bird-sticker", label: "아기 파랑새", svg: stickerBird(), width: 240, height: 240 },
  { id: "teddy-sticker", label: "아기 곰돌이", svg: stickerTeddy(), width: 240, height: 240 },
  { id: "sweat-beads", label: "땀방울", svg: stickerSweatDrops(), width: 240, height: 220 },
  { id: "anger-pop", label: "분노마크", svg: stickerAngerPop(), width: 240, height: 240 },
  { id: "heart-sticker", label: "하트", svg: stickerHeart(), width: 240, height: 220 },
  { id: "star-sticker", label: "별", svg: stickerStar(), width: 240, height: 240 },
  { id: "music-notes-sticker", label: "음표", svg: stickerMusicNotes(), width: 260, height: 240 },
  { id: "idea-bulb", label: "전구", svg: stickerIdeaBulb(), width: 240, height: 260 },
  { id: "question-pop", label: "물음표", svg: stickerQuestionPop(), width: 210, height: 260 },
  { id: "exclaim-pop", label: "느낌표", svg: stickerExclaimPop(), width: 170, height: 260 },
  { id: "shock-lines-sticker", label: "충격선", svg: stickerShockLines(), width: 280, height: 220 },
  { id: "sleepy-zzz-sticker", label: "졸음 zzz", svg: stickerSleepyZzz(), width: 260, height: 240 },
  { id: "twinkle-sticker", label: "반짝", svg: stickerTwinkle(), width: 240, height: 240 },
  { id: "angry-vein", label: "혈관", svg: stickerAngryVein(), width: 240, height: 220 },
  { id: "embarrassed-sweat", label: "당황 식은땀", svg: stickerEmbarrassedSweat(), width: 260, height: 220 },
  { id: "focus-mark", label: "집중", svg: stickerFocusMark(), width: 260, height: 260 },
  { id: "glowing-crystal", label: "마법 마석", svg: stickerGlowingCrystal(), width: 240, height: 260 },
  { id: "cat-ears", label: "고양이 귀", svg: stickerCatEars(), width: 260, height: 160 },
  { id: "feather-dust", label: "흩날리는 깃털", svg: stickerFeathers(), width: 240, height: 240 },
  { id: "bubble-pop", label: "비눗방울", svg: stickerBubbles(), width: 240, height: 240 },
  { id: "magic-spell-circle", label: "마법 소환진", svg: stickerMagicCircle(), width: 260, height: 260 },
  { id: "blood-splatter", label: "액션 잉크튀김", svg: stickerBloodSplash(), width: 240, height: 240 },
  { id: "wind-slash", label: "바람 검기", svg: stickerWindSlash(), width: 280, height: 200 },
  { id: "sweat-drop-emoji", label: "이마 땀방울", svg: stickerSweatEmoji(), width: 200, height: 200 },
];

function stickerFeathers(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
      <path d="M 60 70 C 40 50 70 20 110 30 C 130 35 150 60 155 70 C 140 73 130 65 120 73 C 110 65 100 75 90 75 C 80 70 70 82 60 70 Z" fill="#eff6ff" transform="rotate(-15 100 50)"/>
      <path d="M 60 70 L 155 70" stroke-width="4" stroke="#bfdbfe" transform="rotate(-15 100 50)"/>
      
      <path d="M 40 160 C 25 145 48 122 78 130 C 93 134 108 152 112 160 C 101 162 93 156 86 162 C 78 156 71 164 64 164 Z" fill="#eff6ff" transform="rotate(30 75 145) scale(0.7)"/>
      <path d="M 40 160 L 112 160" stroke-width="3" stroke="#bfdbfe" transform="rotate(30 75 145) scale(0.7)"/>
      
      <path d="M 140 150 C 120 130 150 100 190 110 C 210 115 230 140 235 150 C 220 153 210 145 200 153 C 190 145 180 155 170 155 Z" fill="#eff6ff" transform="rotate(45 185 130) scale(0.85)"/>
      <path d="M 140 150 L 235 150" stroke-width="4" stroke="#bfdbfe" transform="rotate(45 185 130) scale(0.85)"/>
    </g>
  `);
}

function stickerBubbles(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="6" fill="none">
      <circle cx="120" cy="120" r="60" fill="#e0f2fe" opacity="0.3"/>
      <circle cx="120" cy="120" r="60" />
      <path d="M85 85 A50 50 0 0 1 155 85" stroke="${WHITE}" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
      <circle cx="95" cy="145" r="8" fill="${WHITE}" stroke="none"/>
      
      <circle cx="185" cy="65" r="30" fill="#fdf2f8" opacity="0.35"/>
      <circle cx="185" cy="65" r="30"/>
      <path d="M168 48 A25 25 0 0 1 202 48" stroke="${WHITE}" stroke-width="4.5" stroke-linecap="round" opacity="0.75"/>
      
      <circle cx="60" cy="175" r="20" fill="#f5f3ff" opacity="0.35"/>
      <circle cx="60" cy="175" r="20"/>
      <path d="M49 164 A16 16 0 0 1 71 164" stroke="${WHITE}" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
    </g>
  `);
}

function stickerMagicCircle(): string {
  const W = 260;
  const H = 260;
  return svg(W, H, `
    <g stroke="#a78bfa" stroke-width="5" fill="none" stroke-linejoin="round">
      <circle cx="130" cy="130" r="110" stroke-width="8" opacity="0.9"/>
      <circle cx="130" cy="130" r="95" stroke-width="3"/>
      <polygon points="130,30 216,180 44,180" stroke-width="5"/>
      <polygon points="130,230 216,80 44,80" stroke-width="5"/>
      <circle cx="130" cy="130" r="40" stroke-width="4" fill="#a78bfa" opacity="0.15"/>
      <circle cx="130" cy="130" r="25" stroke-width="2"/>
      <circle cx="130" cy="30" r="10" fill="#1e1b4b" stroke-width="3"/>
      <circle cx="130" cy="230" r="10" fill="#1e1b4b" stroke-width="3"/>
      <circle cx="44" cy="80" r="10" fill="#1e1b4b" stroke-width="3"/>
      <circle cx="216" cy="80" r="10" fill="#1e1b4b" stroke-width="3"/>
      <circle cx="44" cy="180" r="10" fill="#1e1b4b" stroke-width="3"/>
      <circle cx="216" cy="180" r="10" fill="#1e1b4b" stroke-width="3"/>
    </g>
  `);
}

function stickerBloodSplash(): string {
  const W = 240;
  const H = 240;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="6" fill="#be123c" stroke-linejoin="round" stroke-linecap="round">
      <path d="M120 120 C90 100, 70 80, 50 110 C30 140, 70 160, 100 150 C90 180, 100 200, 120 200 C150 200, 150 170, 160 150 C190 160, 200 130, 180 110 C160 90, 140 100, 120 120 Z" />
      <path d="M165 95 L205 75 L180 105 Z" />
      <path d="M75 145 L35 165 L55 135 Z" />
      <path d="M145 155 L165 215 L130 175 Z" />
      <path d="M95 95 L55 55 L90 80 Z" />
      <circle cx="110" cy="50" r="10" />
      <circle cx="190" cy="170" r="8" />
      <circle cx="50" cy="185" r="7" />
      <circle cx="215" cy="105" r="12" />
    </g>
  `);
}

function stickerWindSlash(): string {
  const W = 280;
  const H = 200;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="7" fill="#e0f2fe" stroke-linejoin="round" stroke-linecap="round">
      <path d="M30 160 C 90 90, 180 60, 250 80 C 190 110, 100 140, 30 160 Z" />
      <path d="M60 130 C 110 75, 170 55, 220 70 C 170 90, 110 110, 60 130 Z" fill="#bae6fd" stroke-width="5" />
      <polygon points="20,170 10,165 25,162" fill="${INK}" stroke="none"/>
      <polygon points="265,75 275,80 260,82" fill="${INK}" stroke="none"/>
      <polygon points="245,60 252,65 240,66" fill="${INK}" stroke="none"/>
    </g>
  `);
}

function stickerSweatEmoji(): string {
  const W = 200;
  const H = 200;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
      <path d="M100 25 C100 25 150 90 150 130 C150 165 125 180 100 180 C75 180 50 165 50 130 C50 90 100 25 100 25 Z" fill="#38bdf8"/>
      <path d="M75 120 C75 100 90 55 100 45" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round" opacity="0.65"/>
      <circle cx="120" cy="145" r="8" fill="${WHITE}" stroke="none"/>
    </g>
  `);
}

function stickerGlowingCrystal(): string {
  const W = 240;
  const H = 260;
  return svg(W, H, `
    <defs>
      <linearGradient id="crys-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22d3ee"/>
        <stop offset="60%" stop-color="#8b5cf6"/>
        <stop offset="100%" stop-color="#d946ef"/>
      </linearGradient>
    </defs>
    <path d="M120 20 L200 110 L120 240 L40 110 Z" fill="none" stroke="#22d3ee" stroke-width="12" stroke-linejoin="round" opacity="0.45"/>
    <path d="M120 25 L190 110 L120 230 L50 110 Z" fill="url(#crys-g)" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <line x1="120" y1="25" x2="120" y2="230" stroke="${INK}" stroke-width="4"/>
    <line x1="50" y1="110" x2="190" y2="110" stroke="${INK}" stroke-width="4"/>
    <line x1="120" y1="110" x2="50" y2="110" stroke="${INK}" stroke-width="4"/>
    <line x1="120" y1="110" x2="190" y2="110" stroke="${INK}" stroke-width="4"/>
    <polygon points="120,40 145,110 120,100" fill="#ffffff" opacity="0.6"/>
    <polygon points="120,110 170,110 120,180" fill="#ffffff" opacity="0.3"/>
    <circle cx="120" cy="110" r="16" fill="#ffffff" opacity="0.3"/>
  `);
}

function stickerCatEars(): string {
  const W = 260;
  const H = 160;
  return svg(W, H, `
    <path d="M70 130 C40 80, 20 40, 25 24 C40 20, 80 50, 110 100 Z" fill="#2d2d2d" stroke="${INK}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M60 115 C45 85, 38 60, 42 54 C52 52, 70 70, 85 100 Z" fill="#ffaabf"/>
    <path d="M190 130 C220 80, 240 40, 235 24 C220 20, 180 50, 150 100 Z" fill="#2d2d2d" stroke="${INK}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M200 115 C215 85, 222 60, 218 54 C208 52, 190 70, 175 100 Z" fill="#ffaabf"/>
    <path d="M48 120 Q52 110 50 104" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M212 120 Q208 110 210 104" fill="none" stroke="${INK}" stroke-width="3"/>
  `);
}

function rosePetalsFalling(): string {
  const W = 480;
  const H = 480;
  return svg(W, H, `
    <path d="M120 80 C100 60, 85 80, 110 100 C135 80, 140 60, 120 80 Z" fill="#f43f5e" stroke="${INK}" stroke-width="3"/>
    <path d="M380 140 C360 120, 345 140, 370 160 C395 140, 400 120, 380 140 Z" fill="#fb7185" stroke="${INK}" stroke-width="2.5" transform="rotate(30 380 140)"/>
    <path d="M80 320 C60 300, 45 320, 70 340 C95 320, 100 300, 80 320 Z" fill="#be123c" stroke="${INK}" stroke-width="3.5" transform="rotate(-25 80 320)"/>
    <path d="M410 380 C390 360, 375 380, 400 400 C425 380, 430 360, 410 380 Z" fill="#f43f5e" stroke="${INK}" stroke-width="3" transform="rotate(15 410 380)"/>
    <path d="M250 220 C235 205, 222 220, 242 235 C262 220, 265 205, 250 220 Z" fill="#fda4af" stroke="${INK}" stroke-width="2" transform="rotate(80 250 220) scale(0.7)"/>
    <circle cx="160" cy="180" r="3.5" fill="#f43f5e"/>
    <circle cx="320" cy="280" r="4.5" fill="#fb7185"/>
    <circle cx="200" cy="380" r="3" fill="#be123c"/>
  `);
}

function matrixCode(): string {
  const W = 480;
  const H = 480;
  return svg(W, H, `
    <defs>
      <linearGradient id="mtx-cyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00ffff" stop-opacity="0.1"/>
        <stop offset="80%" stop-color="#00ffff" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="1"/>
      </linearGradient>
      <linearGradient id="mtx-pink" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff007f" stop-opacity="0.1"/>
        <stop offset="80%" stop-color="#ff007f" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect x="40" y="20" width="12" height="340" fill="url(#mtx-cyan)" rx="4"/>
    <rect x="140" y="100" width="8" height="280" fill="url(#mtx-pink)" rx="3"/>
    <rect x="240" y="40" width="10" height="400" fill="url(#mtx-cyan)" rx="4"/>
    <rect x="340" y="120" width="12" height="300" fill="url(#mtx-pink)" rx="4"/>
    <rect x="420" y="80" width="8" height="340" fill="url(#mtx-cyan)" rx="3"/>
    <circle cx="46" cy="370" r="8" fill="#ffffff" stroke="${INK}" stroke-width="3"/>
    <circle cx="144" cy="390" r="6" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="245" cy="450" r="9" fill="#ffffff" stroke="${INK}" stroke-width="3.5"/>
    <circle cx="346" cy="430" r="7" fill="#ffffff" stroke="${INK}" stroke-width="3"/>
    <circle cx="424" cy="430" r="6" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
  `);
}

function sparkImpact(): string {
  const W = 480;
  const H = 480;
  return svg(W, H, `
    <g stroke="#f59e0b" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M 240 240 L 120 180 M 240 240 L 360 300 M 240 240 L 160 320 M 240 240 L 320 160" stroke="#fbbf24" stroke-width="6"/>
      <path d="M 240 240 L 220 80 M 240 240 L 260 400 M 240 240 L 60 260 M 240 240 L 420 220" />
      <path d="M 120 180 L 100 190 M 360 300 L 380 290 M 160 320 L 150 340 M 320 160 L 330 140" stroke="#ffffff" stroke-width="3"/>
      <circle cx="240" cy="240" r="18" fill="#ffffff" filter="url(#glow-local)"/>
    </g>
    <defs>
      <filter id="glow-local" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
  `);
}

function dazzlingAura(): string {
  const W = 480;
  const H = 480;
  return svg(W, H, `
    <g fill="#fef08a" opacity="0.8">
      <path d="M 240 40 Q 240 240 440 240 Q 240 240 240 440 Q 240 240 40 240 Q 240 240 240 40 Z" fill="url(#gold-grad)"/>
      <circle cx="120" cy="120" r="8" fill="#ffffff"/>
      <circle cx="360" cy="120" r="12" fill="#ffffff"/>
      <circle cx="100" cy="340" r="14" fill="#ffffff"/>
      <circle cx="380" cy="360" r="8" fill="#ffffff"/>
    </g>
    <defs>
      <radialGradient id="gold-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="40%" stop-color="#fef08a" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#ca8a04" stop-opacity="0"/>
      </radialGradient>
    </defs>
  `);
}

function gloomyRaincloud(): string {
  const W = 480;
  const H = 320;
  return svg(W, H, `
    <g fill="#475569" stroke="${INK}" stroke-width="4" stroke-linejoin="round">
      <path d="M 120 180 A 40 40 0 0 1 180 120 A 60 60 0 0 1 300 100 A 50 50 0 0 1 380 140 A 40 40 0 0 1 400 180 L 120 180 Z" fill="#334155"/>
      <g stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round" fill="none">
        <path d="M 160 210 L 150 250" />
        <path d="M 220 220 L 210 260" />
        <path d="M 280 215 L 270 255" />
        <path d="M 340 220 L 330 260" />
        <path d="M 190 240 L 180 280" opacity="0.6"/>
        <path d="M 250 245 L 240 285" opacity="0.6"/>
        <path d="M 310 240 L 300 280" opacity="0.6"/>
      </g>
    </g>
  `);
}

function shockStressLines(): string {
  const W = 320;
  const H = 460;
  return svg(W, H, `
    <g stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M 80 40 L 140 100 L 100 180 L 180 240 L 120 340 L 220 420" />
      <path d="M 240 60 L 200 140 L 260 220 L 180 320 L 240 400" stroke-width="3.5"/>
      <path d="M 50 120 L 70 170 L 40 230 L 90 290" stroke-width="3"/>
    </g>
  `);
}

function cyberNeonGrid(): string {
  const W = 480;
  const H = 480;
  return svg(W, H, `
    <g stroke="#06b6d4" stroke-width="2" opacity="0.75" fill="none">
      <line x1="240" y1="120" x2="-40" y2="480" />
      <line x1="240" y1="120" x2="60" y2="480" />
      <line x1="240" y1="120" x2="160" y2="480" />
      <line x1="240" y1="120" x2="240" y2="480" stroke-width="3"/>
      <line x1="240" y1="120" x2="320" y2="480" />
      <line x1="240" y1="120" x2="420" y2="480" />
      <line x1="240" y1="120" x2="520" y2="480" />
      <line x1="0" y1="440" x2="480" y2="440" stroke-width="3"/>
      <line x1="40" y1="380" x2="440" y2="380" />
      <line x1="80" y1="320" x2="400" y2="320" />
      <line x1="120" y1="260" x2="360" y2="260" />
      <line x1="150" y1="200" x2="330" y2="200" />
      <line x1="180" y1="160" x2="300" y2="160" />
    </g>
  `);
}

function concentricShockwave(): string {
  return svg(480, 480, `
    <g fill="none" stroke="${INK}" stroke-linecap="round">
      <circle cx="240" cy="240" r="58" stroke-width="12"/>
      <circle cx="240" cy="240" r="118" stroke-width="9" opacity="0.8"/>
      <circle cx="240" cy="240" r="184" stroke-width="6" opacity="0.55"/>
      <circle cx="240" cy="240" r="224" stroke-width="3" opacity="0.35"/>
    </g>
  `);
}

function cornerFocusLines(): string {
  const lines = Array.from({ length: 34 }, (_, index) => {
    const angle = -1.48 + (index / 33) * 1.4;
    const inner = 70 + (index % 4) * 5;
    const outer = 620 - (index % 5) * 14;
    const x1 = 24 + Math.cos(angle) * inner;
    const y1 = 456 + Math.sin(angle) * inner;
    const x2 = 24 + Math.cos(angle) * outer;
    const y2 = 456 + Math.sin(angle) * outer;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="${(3 + (index % 4)).toFixed(1)}" stroke-linecap="round"/>`;
  }).join("");
  return svg(480, 480, lines);
}

function verticalSpeedFall(): string {
  const lines = Array.from({ length: 30 }, (_, index) => {
    const x = 10 + index * 16;
    const y1 = (index * 47) % 150 - 60;
    const y2 = 480 - ((index * 29) % 90);
    return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${INK}" stroke-width="${2 + (index % 5)}" stroke-linecap="round"/>`;
  }).join("");
  return svg(480, 480, lines);
}

function diagonalRain(): string {
  const lines = Array.from({ length: 42 }, (_, index) => {
    const x = (index * 53) % 560 - 40;
    const y = (index * 79) % 430 - 80;
    return `<line x1="${x}" y1="${y}" x2="${x - 42}" y2="${y + 104}" stroke="#67bde8" stroke-width="${2 + (index % 3)}" stroke-linecap="round" opacity="${0.55 + (index % 4) * 0.1}"/>`;
  }).join("");
  return svg(480, 480, lines);
}

function motionArcs(): string {
  return svg(480, 360, `
    <path d="M44 252 C102 58 362 28 444 188" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
    <path d="M74 298 C142 128 348 112 412 232" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round" opacity="0.75"/>
    <path d="M122 330 C184 214 330 202 372 278" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" opacity="0.5"/>
    <path d="M402 142 L458 194 L388 210 Z" fill="${INK}"/>
  `);
}

function inkImpactBurst(): string {
  return svg(480, 480, `
    <path d="M240 42 L266 176 L354 82 L310 196 L442 148 L326 226 L454 264 L322 278 L412 378 L294 310 L318 446 L256 326 L188 444 L210 308 L88 382 L178 278 L42 256 L176 224 L54 142 L188 194 L134 74 L218 176 Z" fill="${INK}"/>
    <circle cx="88" cy="92" r="15" fill="${INK}"/><circle cx="402" cy="94" r="10" fill="${INK}"/>
    <circle cx="420" cy="406" r="18" fill="${INK}"/><circle cx="68" cy="390" r="9" fill="${INK}"/>
    <circle cx="240" cy="250" r="58" fill="${WHITE}"/>
  `);
}

function floatingEmbers(): string {
  const sparks = Array.from({ length: 30 }, (_, index) => {
    const x = 22 + ((index * 71) % 438);
    const y = 24 + ((index * 97) % 430);
    const radius = 2 + (index % 5);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${index % 3 === 0 ? "#fff2a8" : "#f47a32"}" opacity="${0.55 + (index % 4) * 0.12}"/>`;
  }).join("");
  return svg(480, 480, sparks);
}

function mangaShockMarks(): string {
  return svg(420, 300, `
    <path d="M62 32 L112 150 M206 14 L210 140 M356 38 L306 152" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>
    <path d="M104 190 L132 244 M210 174 L210 250 M314 190 L286 244" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="142" cy="270" r="10" fill="${INK}"/><circle cx="210" cy="278" r="10" fill="${INK}"/><circle cx="278" cy="270" r="10" fill="${INK}"/>
  `);
}

// 공개 목록. 라벨은 한글, id는 영문.
export const FX_OVERLAYS: FxOverlay[] = [
  { id: "radial-focus", label: "집중선", svg: radialFocus(), width: 480, height: 480 },
  { id: "speed-lines", label: "속도선", svg: speedLines(), width: 480, height: 200 },
  { id: "impact-flash", label: "임팩트 플래시", svg: impactFlash(), width: 460, height: 460 },
  { id: "lightning-crack", label: "충격 번개", svg: lightningCrack(), width: 320, height: 460 },
  { id: "halftone-dots", label: "스크린톤 도트", svg: halftoneDots(), width: 360, height: 360 },
  { id: "vignette", label: "비네팅", svg: vignette(), width: 480, height: 480 },
  { id: "sweat-drop", label: "큰 땀방울", svg: bigSweatDrop(), width: 240, height: 320 },
  { id: "anger-mark", label: "분노 마크", svg: angerMark(), width: 260, height: 260 },
  { id: "heart-burst", label: "하트 뿜뿜", svg: heartBurst(), width: 320, height: 360 },
  { id: "question-mark", label: "물음표", svg: questionMark(), width: 200, height: 280 },
  { id: "exclaim-mark", label: "느낌표", svg: exclaimMark(), width: 140, height: 280 },
  { id: "sparkle-cluster", label: "반짝임", svg: sparkleCluster(), width: 360, height: 360 },
  { id: "gloom-lines", label: "우울 세로줄", svg: gloomLines(), width: 320, height: 280 },
  { id: "nervous-sweat", label: "당황 식은땀", svg: nervousSweat(), width: 320, height: 240 },
  { id: "speed-radial", label: "집중 강조선", svg: speedRadial(), width: 480, height: 480 },
  { id: "sleepy-z", label: "졸음 (zzz)", svg: sleepyZ(), width: 260, height: 280 },
  { id: "music-notes", label: "음표", svg: musicNotes(), width: 300, height: 280 },
  { id: "flame-burst", label: "화염", svg: flameBurst(), width: 280, height: 360 },
  { id: "rose-petals-falling", label: "흩날리는 장미꽃잎", svg: rosePetalsFalling(), width: 480, height: 480 },
  { id: "matrix-code", label: "디지털 매트릭스", svg: matrixCode(), width: 480, height: 480 },
  { id: "spark-impact", label: "스파크 임팩트", svg: sparkImpact(), width: 480, height: 480 },
  { id: "dazzling-aura", label: "눈부신 오라", svg: dazzlingAura(), width: 480, height: 480 },
  { id: "gloomy-raincloud", label: "우울한 먹구름", svg: gloomyRaincloud(), width: 480, height: 320 },
  { id: "shock-stress-lines", label: "당황 번개선", svg: shockStressLines(), width: 320, height: 460 },
  { id: "cyber-neon-grid", label: "사이버 네온그리드", svg: cyberNeonGrid(), width: 480, height: 480 },
  { id: "concentric-shockwave", label: "동심원 충격파", svg: concentricShockwave(), width: 480, height: 480 },
  { id: "corner-focus-lines", label: "코너 집중선", svg: cornerFocusLines(), width: 480, height: 480 },
  { id: "vertical-speed-fall", label: "낙하 속도선", svg: verticalSpeedFall(), width: 480, height: 480 },
  { id: "diagonal-rain", label: "사선 빗줄기", svg: diagonalRain(), width: 480, height: 480 },
  { id: "motion-arcs", label: "회전 모션 아크", svg: motionArcs(), width: 480, height: 360 },
  { id: "ink-impact-burst", label: "먹 임팩트 버스트", svg: inkImpactBurst(), width: 480, height: 480 },
  { id: "floating-embers", label: "흩날리는 불씨", svg: floatingEmbers(), width: 480, height: 480 },
  { id: "manga-shock-marks", label: "만화 충격 마크", svg: mangaShockMarks(), width: 420, height: 300 },
];
