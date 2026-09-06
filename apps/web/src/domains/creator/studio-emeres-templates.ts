// 이메레스(Image Response) 스케치 템플릿 라이브러리 — 툰스푼 "이메레스" 스타일.
// 상황별 "스케치 밑그림 틀"을 캔버스에 반투명·잠금 레이어로 깔고, 작가가 그 위에 펜으로 그린다.
// 모든 템플릿은 프로시저럴 인라인 SVG(외부 URL/래스터 금지) — 연한 청색 연필 크로키 톤.

export type EmeresCategory = "관계" | "감정" | "일상" | "액션";

export interface EmeresTemplate {
  id: string;
  label: string;
  category: EmeresCategory;
  svg: string; // 자체 완결형 <svg ...>...</svg>
  width: number; // viewBox 크기(배치 비율 계산용)
  height: number;
  tip: string; // 추천 사용법 한 줄
}

export const EMERES_CATEGORIES: readonly EmeresCategory[] = ["관계", "감정", "일상", "액션"];

// 캔버스 삽입 시 기본 투명도(반투명 밑그림) — StudioPage 삽입 지점에서 사용.
export const EMERES_DEFAULT_OPACITY = 0.42;

const MAIN = "#6f9dc4"; // 주 스케치 라인(연한 청색 연필)
const GUIDE = "#aac7de"; // 보조 가이드(더 연한 점선)

const rad = (deg: number) => (deg * Math.PI) / 180;
const f1 = (v: number) => String(Math.round(v * 10) / 10);

function wrap(w: number, h: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<g fill="none" stroke="${MAIN}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    `</svg>`
  );
}

function guide(body: string): string {
  return `<g stroke="${GUIDE}" stroke-width="2" stroke-dasharray="6 5">${body}</g>`;
}

function ln(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
}

function pl(points: Array<readonly [number, number]>): string {
  return `<polyline points="${points.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}"/>`;
}

function cir(cx: number, cy: number, r: number): string {
  return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"/>`;
}

function ell(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}"/>`;
}

function qd(x1: number, y1: number, qx: number, qy: number, x2: number, y2: number): string {
  return `<path d="M${f1(x1)} ${f1(y1)} Q${f1(qx)} ${f1(qy)} ${f1(x2)} ${f1(y2)}"/>`;
}

// ── 마네킹(크로키 인체 틀) ─────────────────────────────────────────────
// 각도 규약: 0° = 수직 아래, 양수 = 몸 바깥쪽(왼쪽 사지는 -x, 오른쪽 사지는 +x), 음수 = 안쪽.
type Pt = readonly [number, number];
type LimbAngles = readonly [number, number]; // [윗마디, 아랫마디] 절대 각도(도)

function dirSide(deg: number, side: -1 | 1): Pt {
  return [side * Math.sin(rad(deg)), Math.cos(rad(deg))];
}

function add(p: Pt, d: Pt, len: number): Pt {
  return [p[0] + d[0] * len, p[1] + d[1] * len];
}

interface FigureOpts {
  x: number; // 머리 중심 x
  y: number; // 머리 중심 y
  s?: number; // 머리 반지름(스케일 기준, 기본 30)
  look?: number; // 시선/얼굴 방향 -1(왼)~1(오)
  lean?: number; // 척추 기울기(도, +x 방향)
  eyeDrop?: number; // 눈높이 가이드 내림(고개 숙임 연출, s 비율)
  armL?: LimbAngles | null; // null이면 팔 생략(커스텀 드로잉용)
  armR?: LimbAngles | null;
  legL?: LimbAngles | null;
  legR?: LimbAngles | null;
  feet?: -1 | 1; // 발끝 방향(기본: look 부호)
}

interface FigureRig {
  svg: string;
  neck: Pt;
  shoulderL: Pt;
  shoulderR: Pt;
  hipC: Pt;
  hipL: Pt;
  hipR: Pt;
}

function rig(o: FigureOpts): FigureRig {
  const s = o.s ?? 30;
  const look = o.look ?? 0;
  const lean = o.lean ?? 0;
  const eyeDrop = (o.eyeDrop ?? 0) * s;
  const sp = dirSide(lean, 1); // 척추 진행 방향(아래로, lean만큼 +x로)
  const perp: Pt = [Math.cos(rad(lean)), -Math.sin(rad(lean))];

  const head: Pt = [o.x, o.y];
  const neck = add(head, sp, s * 1.18);
  const shoulderC = add(neck, sp, s * 0.32);
  const hipC = add(neck, sp, s * 2.35);
  const shW = s * 0.95;
  const hipW = s * 0.68;
  const shoulderL: Pt = [shoulderC[0] - perp[0] * shW, shoulderC[1] - perp[1] * shW];
  const shoulderR: Pt = [shoulderC[0] + perp[0] * shW, shoulderC[1] + perp[1] * shW];
  const hipL: Pt = [hipC[0] - perp[0] * hipW, hipC[1] - perp[1] * hipW];
  const hipR: Pt = [hipC[0] + perp[0] * hipW, hipC[1] + perp[1] * hipW];

  const parts: string[] = [];
  // 머리 + 얼굴 십자 가이드
  parts.push(cir(head[0], head[1], s));
  parts.push(
    guide(
      qd(head[0] + look * s * 0.5, head[1] - s * 0.85, head[0] + look * s * 0.9, head[1] + eyeDrop * 0.4, head[0] + look * s * 0.5, head[1] + s * 0.85) +
        ln(head[0] - s * 0.78 + look * s * 0.2, head[1] + s * 0.08 + eyeDrop, head[0] + s * 0.78 + look * s * 0.2, head[1] + s * 0.08 + eyeDrop)
    )
  );
  // 몸통: 척추 + 어깨선 + 골반선
  parts.push(ln(neck[0], neck[1], hipC[0], hipC[1]));
  parts.push(ln(shoulderL[0], shoulderL[1], shoulderR[0], shoulderR[1]));
  parts.push(ln(hipL[0], hipL[1], hipR[0], hipR[1]));

  const upperArm = s * 1.25;
  const lowerArm = s * 1.15;
  const upperLeg = s * 1.6;
  const lowerLeg = s * 1.5;
  const feet = o.feet ?? (look < 0 ? -1 : 1);

  const drawArm = (sh: Pt, angles: LimbAngles, side: -1 | 1) => {
    const elbow = add(sh, dirSide(angles[0], side), upperArm);
    const hand = add(elbow, dirSide(angles[1], side), lowerArm);
    parts.push(pl([sh, elbow, hand]));
    parts.push(cir(hand[0], hand[1], s * 0.2));
  };
  const drawLeg = (hip: Pt, angles: LimbAngles, side: -1 | 1) => {
    const knee = add(hip, dirSide(angles[0], side), upperLeg);
    const ankle = add(knee, dirSide(angles[1], side), lowerLeg);
    parts.push(pl([hip, knee, ankle]));
    parts.push(ln(ankle[0], ankle[1], ankle[0] + feet * s * 0.5, ankle[1] + s * 0.06));
  };

  if (o.armL !== null) drawArm(shoulderL, o.armL ?? [10, 6], -1);
  if (o.armR !== null) drawArm(shoulderR, o.armR ?? [10, 6], 1);
  if (o.legL !== null) drawLeg(hipL, o.legL ?? [5, 3], -1);
  if (o.legR !== null) drawLeg(hipR, o.legR ?? [5, 3], 1);

  return { svg: parts.join(""), neck, shoulderL, shoulderR, hipC, hipL, hipR };
}

function figure(o: FigureOpts): string {
  return rig(o).svg;
}

// 상반신 클로즈업(감정 컷용): 머리 + 목 + 어깨 곡선.
function bust(x: number, y: number, s: number, look = 0, eyeDrop = 0): string {
  const parts: string[] = [];
  parts.push(cir(x, y, s));
  parts.push(
    guide(
      qd(x + look * s * 0.5, y - s * 0.85, x + look * s * 0.9, y, x + look * s * 0.5, y + s * 0.85) +
        ln(x - s * 0.78 + look * s * 0.2, y + s * 0.08 + eyeDrop * s, x + s * 0.78 + look * s * 0.2, y + s * 0.08 + eyeDrop * s)
    )
  );
  // 목
  parts.push(ln(x - s * 0.24, y + s * 0.96, x - s * 0.3, y + s * 1.38));
  parts.push(ln(x + s * 0.24, y + s * 0.96, x + s * 0.3, y + s * 1.38));
  // 어깨 곡선
  parts.push(qd(x - s * 0.3, y + s * 1.38, x - s * 1.05, y + s * 1.5, x - s * 1.8, y + s * 2.05));
  parts.push(qd(x + s * 0.3, y + s * 1.38, x + s * 1.05, y + s * 1.5, x + s * 1.8, y + s * 2.05));
  return parts.join("");
}

// 바닥 가이드선.
function ground(x1: number, x2: number, y: number): string {
  return guide(ln(x1, y, x2, y));
}

// ── 템플릿 본문 ─────────────────────────────────────────────────────────

function tplFaceEachOther(): string {
  const a = figure({ x: 235, y: 145, s: 34, look: 0.65, lean: 3, armR: [16, 26], armL: [9, 5] });
  const b = figure({ x: 485, y: 145, s: 34, look: -0.65, lean: -3, armL: [16, 26], armR: [9, 5] });
  const tension = guide(ln(360, 150, 360, 172) + ln(360, 188, 360, 210));
  return wrap(720, 520, a + b + tension + ground(120, 600, 460));
}

function tplShoulderArm(): string {
  const a = rig({ x: 300, y: 150, s: 34, look: 0.2, lean: 4, armR: null, armL: [12, 7] });
  const b = figure({ x: 424, y: 152, s: 34, look: -0.2, lean: -4, armL: [9, 5], armR: [14, 8] });
  // A의 오른팔이 B의 어깨 위로 두르는 커스텀 라인
  const arm = pl([a.shoulderR, [378, 168], [428, 178]]) + cir(432, 180, 7);
  return wrap(720, 520, a.svg + b + arm + ground(140, 600, 462));
}

function tplBackHug(): string {
  const front = figure({ x: 352, y: 168, s: 33, look: -0.35, armL: [11, 6], armR: [12, 7] });
  const back = rig({ x: 392, y: 122, s: 36, look: -0.4, lean: -7, armL: null, armR: null, legL: [6, 3], legR: [10, 5] });
  // 뒤 인물의 두 팔이 앞 인물의 허리를 감싸는 곡선
  const hug =
    qd(back.shoulderL[0], back.shoulderL[1], 312, 240, 330, 282) +
    qd(back.shoulderR[0], back.shoulderR[1], 414, 252, 366, 288) +
    cir(335, 284, 7) +
    cir(362, 289, 7);
  return wrap(720, 520, front + back.svg + hug + ground(160, 600, 470));
}

function tplHoldHands(): string {
  const a = figure({ x: 268, y: 148, s: 34, look: 0.55, armR: [24, 38], armL: [10, 6], legL: [8, 4], legR: [14, 6] });
  const b = figure({ x: 452, y: 148, s: 34, look: -0.55, armL: [24, 38], armR: [10, 6], legR: [8, 4], legL: [14, 6] });
  const joined = cir(360, 268, 11) + guide(qd(338, 240, 360, 228, 382, 240));
  return wrap(720, 520, a + b + joined + ground(140, 590, 465));
}

function tplHeadpat(): string {
  const a = rig({ x: 295, y: 122, s: 34, look: 0.5, armR: null, armL: [10, 6] });
  const b = figure({ x: 425, y: 205, s: 29, look: -0.5, eyeDrop: 0.15, armL: [12, 7], armR: [10, 6] });
  const patArm = pl([a.shoulderR, [372, 188], [414, 182]]) + cir(420, 180, 7);
  const patFx = guide(qd(398, 152, 424, 142, 450, 152) + qd(404, 136, 426, 128, 448, 136));
  return wrap(720, 540, a.svg + b + patArm + patFx + ground(150, 590, 488));
}

function tplKabedon(): string {
  const wall = ln(548, 56, 548, 480) + guide(ln(548, 120, 572, 110) + ln(548, 230, 572, 220) + ln(548, 340, 572, 330));
  const b = figure({ x: 462, y: 152, s: 33, look: -0.6, lean: 3, armL: [8, 4], armR: [6, 3] });
  const a = rig({ x: 318, y: 138, s: 35, look: 0.65, lean: 13, armR: null, armL: [12, 6] });
  const don = pl([a.shoulderR, [452, 158], [540, 150]]) + cir(544, 150, 8);
  const fx = guide(ln(520, 120, 538, 104) + ln(530, 176, 546, 188));
  return wrap(720, 540, wall + b + a.svg + don + fx + ground(140, 540, 492));
}

function tplPiggyback(): string {
  const carrier = rig({ x: 330, y: 186, s: 34, look: 0.6, lean: 17, armL: null, armR: null, legL: [10, 7], legR: [22, 10] });
  const carried = rig({ x: 296, y: 116, s: 30, look: 0.6, lean: 12, armL: null, armR: null, legL: null, legR: null });
  // 업힌 사람: 팔은 어깨 너머로, 다리는 허리 앞으로 감김
  const carriedLimbs =
    qd(carried.shoulderR[0], carried.shoulderR[1], 366, 196, 392, 232) +
    cir(394, 236, 6) +
    qd(carried.hipC[0], carried.hipC[1], 392, 270, 414, 312) +
    qd(carried.hipC[0] - 12, carried.hipC[1] + 6, 378, 282, 398, 326) +
    ln(414, 312, 428, 318) +
    ln(398, 326, 412, 332);
  // 업은 사람의 팔: 뒤로 돌아 업힌 다리를 받침
  const carrierArms = qd(carrier.shoulderR[0], carrier.shoulderR[1], 398, 264, 404, 300) + cir(405, 304, 7);
  return wrap(720, 560, carrier.svg + carried.svg + carriedLimbs + carrierArms + ground(160, 580, 510));
}

function tplCryCloseup(): string {
  const b = bust(240, 190, 84, 0.1, 0.06);
  const tears =
    qd(206, 230, 200, 252, 206, 268) +
    qd(280, 230, 286, 252, 280, 268) +
    guide(ln(150, 130, 134, 114) + ln(330, 130, 346, 114) + ln(240, 84, 240, 64));
  return wrap(480, 480, b + tears);
}

function tplShockUpper(): string {
  const b = bust(240, 206, 72, 0, 0);
  const hands = cir(140, 268, 17) + cir(340, 268, 17) + ln(128, 252, 120, 240) + ln(352, 252, 360, 240);
  const radial = guide(
    ln(160, 110, 142, 92) + ln(240, 92, 240, 68) + ln(320, 110, 338, 92) + ln(132, 170, 108, 162) + ln(348, 170, 372, 162)
  );
  return wrap(480, 480, b + hands + radial);
}

function tplAngryPoint(): string {
  const fg = figure({ x: 200, y: 140, s: 33, look: 0.7, lean: 9, armR: [86, 88], armL: [14, 8], legL: [6, 3], legR: [18, 7] });
  const spark = ln(238, 84, 252, 70) + ln(252, 84, 238, 70);
  const aim = guide(ln(330, 188, 420, 184));
  return wrap(480, 560, fg + spark + aim + ground(80, 420, 505));
}

function tplShyCover(): string {
  const b = bust(240, 208, 70, 0, 0.04);
  const hands = cir(178, 262, 16) + cir(302, 262, 16) + ln(166, 248, 158, 236) + ln(314, 248, 322, 236);
  const blush = guide(ln(186, 234, 198, 244) + ln(196, 228, 208, 238) + ln(282, 244, 294, 234) + ln(272, 238, 284, 228));
  return wrap(480, 480, b + hands + blush);
}

function tplDespairKneel(): string {
  const head = cir(238, 296, 30) + guide(ln(214, 310, 262, 310));
  const back = qd(262, 318, 312, 322, 330, 366); // 굽은 등
  const arms = pl([[226, 322], [204, 372], [196, 414]]) + cir(194, 418, 6) + pl([[252, 330], [240, 380], [236, 416]]) + cir(235, 420, 6);
  const legs = pl([[330, 366], [322, 416], [264, 420]]) + pl([[336, 380], [330, 422], [276, 428]]);
  const gloom = guide(ln(200, 250, 188, 234) + ln(238, 244, 238, 226) + ln(276, 250, 288, 234));
  return wrap(480, 480, head + back + arms + legs + gloom + ground(120, 400, 440));
}

function tplCheerBanzai(): string {
  const fg = figure({ x: 240, y: 150, s: 32, look: 0.15, armL: [156, 166], armR: [156, 166], legL: [14, 6], legR: [14, 6] });
  const fx = guide(qd(140, 70, 168, 56, 196, 66) + qd(284, 66, 312, 56, 340, 70) + ln(240, 64, 240, 44));
  return wrap(480, 560, fg + fx + ground(100, 400, 500));
}

function tplCafeTable(): string {
  const table = ln(248, 332, 472, 332) + ln(268, 332, 268, 424) + ln(452, 332, 452, 424);
  const cups = ell(322, 324, 13, 6) + ln(311, 324, 311, 312) + ln(333, 324, 333, 312) + ell(398, 324, 13, 6) + ln(387, 324, 387, 312) + ln(409, 324, 409, 312);
  const a = figure({ x: 196, y: 168, s: 30, look: 0.6, armR: [28, -32], armL: [10, 5], legL: [-78, -4], legR: [-84, -8], feet: 1 });
  const b = figure({ x: 524, y: 168, s: 30, look: -0.6, armL: [28, -32], armR: [10, 5], legR: [-78, -4], legL: [-84, -8], feet: -1 });
  const chairs = guide(ln(150, 290, 218, 290) + ln(160, 290, 160, 410) + ln(502, 290, 570, 290) + ln(560, 290, 560, 410));
  return wrap(720, 520, table + cups + a + b + chairs);
}

function tplUmbrellaShare(): string {
  const canopy =
    qd(150, 196, 300, 76, 450, 196) +
    qd(150, 196, 188, 182, 226, 196) +
    qd(226, 196, 264, 182, 300, 196) +
    qd(300, 196, 338, 182, 376, 196) +
    qd(376, 196, 414, 182, 450, 196) +
    ln(300, 96, 300, 76);
  const shaft = ln(300, 96, 300, 196) + ln(300, 196, 326, 346) + qd(326, 346, 330, 362, 318, 366);
  const a = figure({ x: 252, y: 248, s: 29, look: 0.25, armR: [12, 7], armL: [9, 5] });
  const b = rig({ x: 364, y: 242, s: 31, look: -0.25, armL: null, armR: [11, 6] });
  const holdArm = pl([b.shoulderL, [330, 312], [324, 338]]) + cir(323, 342, 6);
  return wrap(600, 560, canopy + shaft + a + b.svg + holdArm + ground(120, 490, 516));
}

function tplPhoneCheck(): string {
  const fg = figure({ x: 240, y: 142, s: 32, look: 0, eyeDrop: 0.3, armL: [-9, -54], armR: [-9, -54], legL: [7, 3], legR: [11, 5], feet: 1 });
  const phone = `<rect x="224" y="246" width="34" height="48" rx="5"/>`;
  const gaze = guide(ln(232, 182, 236, 240) + ln(248, 182, 246, 240));
  return wrap(480, 560, fg + phone + gaze + ground(100, 400, 505));
}

function tplWalkSide(): string {
  const a = figure({ x: 268, y: 152, s: 33, look: 0.6, lean: 4, armL: [-22, -10], armR: [26, 12], legL: [20, 6], legR: [-16, -10], feet: 1 });
  const b = figure({ x: 438, y: 148, s: 34, look: 0.6, lean: 4, armL: [24, 11], armR: [-20, -9], legL: [-18, -10], legR: [22, 7], feet: 1 });
  return wrap(720, 520, a + b + ground(120, 620, 468));
}

function tplDeskStudy(): string {
  const desk = ln(170, 296, 545, 296) + ln(192, 296, 192, 420) + ln(522, 296, 522, 420);
  const book = pl([[352, 290], [398, 282], [444, 290]]) + ln(398, 282, 398, 292);
  const fg = figure({ x: 292, y: 158, s: 30, look: 0.3, eyeDrop: 0.22, armR: [42, -16], armL: [18, -28], legL: [-76, -5], legR: [-82, -8], feet: 1 });
  const pencil = ln(352, 270, 368, 252);
  const lamp = guide(pl([[486, 296], [486, 226], [442, 198]]) + ell(436, 194, 16, 9));
  return wrap(720, 520, desk + book + fg + pencil + lamp);
}

function tplWindowSeat(): string {
  const frame = `<rect x="372" y="76" width="262" height="282" rx="4"/>` + ln(503, 76, 503, 358) + ln(372, 217, 634, 217);
  const sill = ln(348, 358, 658, 358) + ln(360, 372, 648, 372);
  const fg = figure({ x: 478, y: 252 - 106, s: 30, look: 0.45, armL: [14, -20], armR: [22, 10], legL: [7, 3], legR: [13, 6], feet: 1 });
  const moon = guide(cir(584, 130, 22) + ln(560, 168, 548, 180));
  return wrap(720, 560, frame + sill + fg + moon);
}

function tplRunDash(): string {
  const fg = figure({
    x: 318, y: 148, s: 34, look: 0.7, lean: 21,
    armL: [-46, -88], armR: [58, 118], legL: [42, 14], legR: [-38, -64], feet: 1,
  });
  const speed = guide(ln(120, 200, 226, 198) + ln(96, 260, 218, 258) + ln(128, 320, 232, 318));
  return wrap(720, 540, fg + speed + ground(120, 620, 490));
}

function tplFightFaceOff(): string {
  const a = figure({ x: 210, y: 150, s: 33, look: 0.75, lean: 7, armL: [-34, -78], armR: [40, -64], legL: [10, 4], legR: [26, 9] });
  const b = figure({ x: 510, y: 150, s: 33, look: -0.75, lean: -7, armR: [-34, -78], armL: [40, -64], legR: [10, 4], legL: [26, 9] });
  const clash = pl([[368, 130], [352, 158], [372, 164], [354, 196]]);
  return wrap(720, 540, a + b + clash + ground(110, 620, 488));
}

function tplPunchImpact(): string {
  const a = rig({ x: 248, y: 158, s: 34, look: 0.8, lean: 17, armR: null, armL: [-30, -62], legL: [12, 5], legR: [34, 12] });
  const punch = pl([a.shoulderR, [382, 222], [444, 226]]) + cir(450, 227, 8);
  const b = figure({ x: 506, y: 142, s: 33, look: -0.6, lean: -13, armL: [62, 96], armR: [54, 84], legR: [16, 6], legL: [30, 10] });
  const impact =
    ln(462, 204, 482, 188) + ln(470, 232, 494, 234) + ln(458, 252, 474, 270) + ln(438, 198, 430, 178) + ln(436, 250, 420, 264);
  return wrap(720, 540, a.svg + punch + b + impact + ground(120, 620, 492));
}

function tplJumpAir(): string {
  const fg = figure({ x: 240, y: 132, s: 32, look: 0.3, armL: [128, 152], armR: [128, 152], legL: [104, 8], legR: [122, 16] });
  const shadow = guide(ell(240, 468, 72, 12));
  const arcs = guide(qd(150, 400, 178, 386, 204, 398) + qd(276, 398, 302, 386, 330, 400));
  return wrap(480, 560, fg + shadow + arcs);
}

function tplChase(): string {
  const runner = figure({
    x: 486, y: 140, s: 32, look: 0.7, lean: 19,
    armL: [-44, -84], armR: [52, 110], legL: [40, 12], legR: [-34, -58], feet: 1,
  });
  const chaser = rig({ x: 206, y: 152, s: 34, look: 0.8, lean: 22, armR: null, armL: [-38, -72], legL: [44, 14], legR: [-36, -60] });
  const reach = pl([chaser.shoulderR, [318, 196], [368, 192]]) + cir(374, 192, 7);
  const dust = guide(cir(120, 452, 14) + cir(94, 466, 9) + cir(420, 446, 12));
  return wrap(720, 540, runner + chaser.svg + reach + dust + ground(100, 640, 490));
}

function tplReaction4Cut(): string {
  const cells: Array<[number, number]> = [
    [20, 20],
    [370, 20],
    [20, 370],
    [370, 370],
  ];
  const framesSvg = cells.map(([cx, cy]) => `<rect x="${cx}" y="${cy}" width="330" height="330" rx="6"/>`).join("");
  // 1컷: 평온 / 2컷: 놀람 / 3컷: 기쁨(눈웃음) / 4컷: 분노
  const b1 = bust(185, 168, 56, 0.25, 0);
  const b2 = bust(535, 168, 56, 0, 0) + guide(ln(458, 86, 444, 70) + ln(535, 70, 535, 50) + ln(612, 86, 626, 70));
  const b3 = bust(185, 518, 56, 0, 0) + qd(158, 522, 168, 512, 178, 522) + qd(192, 522, 202, 512, 212, 522);
  const b4 = bust(535, 518, 56, 0, 0) + ln(604, 432, 624, 412) + ln(624, 432, 604, 412) + guide(ln(500, 498, 522, 506) + ln(570, 506, 592, 498));
  return wrap(720, 720, framesSvg + b1 + b2 + b3 + b4);
}

export const EMERES_TEMPLATES: EmeresTemplate[] = [
  // ── 관계 ──
  { id: "emeres_face_each_other", label: "두 인물 마주보기", category: "관계", svg: tplFaceEachOther(), width: 720, height: 520, tip: "대화·고백 장면. 머리 원 위에 얼굴을, 막대 위에 몸을 입혀 그리세요." },
  { id: "emeres_shoulder_arm", label: "어깨동무", category: "관계", svg: tplShoulderArm(), width: 720, height: 520, tip: "절친 케미 컷. 두른 팔 라인을 따라 소매 주름을 그리면 자연스러워요." },
  { id: "emeres_back_hug", label: "백허그", category: "관계", svg: tplBackHug(), width: 720, height: 520, tip: "로맨스 명장면. 감싸는 팔 곡선을 살리고 앞 인물 표정에 집중하세요." },
  { id: "emeres_hold_hands", label: "손 잡기", category: "관계", svg: tplHoldHands(), width: 720, height: 520, tip: "맞잡은 손 원을 두 손으로 디테일업. 설렘 효과선과 같이 쓰면 좋아요." },
  { id: "emeres_headpat", label: "머리 쓰다듬기", category: "관계", svg: tplHeadpat(), width: 720, height: 540, tip: "키 차이 연출 컷. 점선 아치는 쓰담쓰담 모션 가이드입니다." },
  { id: "emeres_kabedon", label: "벽치기(벽쿵)", category: "관계", svg: tplKabedon(), width: 720, height: 540, tip: "벽 라인은 패널 테두리에 맞춰도 OK. 손 위치의 '쿵' 효과를 추가해 보세요." },
  { id: "emeres_piggyback", label: "업기(피기백)", category: "관계", svg: tplPiggyback(), width: 720, height: 560, tip: "업힌 인물의 팔·다리 곡선을 따라 그리면 무게감이 살아나요." },
  // ── 감정 ──
  { id: "emeres_cry_closeup", label: "울먹임 클로즈업", category: "감정", svg: tplCryCloseup(), width: 480, height: 480, tip: "눈물 방울 위치가 잡혀 있어요. 눈썹을 八자로 그리면 완성." },
  { id: "emeres_shock_upper", label: "놀람 상반신", category: "감정", svg: tplShockUpper(), width: 480, height: 480, tip: "양손과 방사선 가이드를 활용해 '헉!' 리액션을 그리세요." },
  { id: "emeres_angry_point", label: "분노 삿대질", category: "감정", svg: tplAngryPoint(), width: 480, height: 560, tip: "뻗은 팔 끝 방향의 점선이 시선 유도선. 말풍선을 그쪽에 두면 좋아요." },
  { id: "emeres_shy_cover", label: "부끄러움(볼 감싸기)", category: "감정", svg: tplShyCover(), width: 480, height: 480, tip: "볼의 빗금은 홍조 가이드. 눈은 살짝 내려 그리면 수줍은 느낌이 나요." },
  { id: "emeres_despair_kneel", label: "좌절(무릎 꿇기)", category: "감정", svg: tplDespairKneel(), width: 480, height: 480, tip: "OTL 구도. 머리 위 점선은 우울 표식 자리예요." },
  { id: "emeres_cheer_banzai", label: "환호 만세", category: "감정", svg: tplCheerBanzai(), width: 480, height: 560, tip: "승리·합격 컷. 손 위 아치를 따라 반짝이 효과를 얹어 보세요." },
  // ── 일상 ──
  { id: "emeres_cafe_table", label: "카페 테이블 마주앉기", category: "일상", svg: tplCafeTable(), width: 720, height: 520, tip: "테이블·컵·의자 가이드 포함. 배경 씬과 겹쳐 쓰면 분위기가 완성돼요." },
  { id: "emeres_umbrella_share", label: "우산 함께 쓰기", category: "일상", svg: tplUmbrellaShare(), width: 600, height: 560, tip: "비 오는 날 명장면. 우산 살을 추가하고 빗줄기는 속도선으로." },
  { id: "emeres_phone_check", label: "스마트폰 보기", category: "일상", svg: tplPhoneCheck(), width: 480, height: 560, tip: "시선 점선이 폰까지 이어져 있어요. 화면 빛을 밝게 칠하면 야간 연출." },
  { id: "emeres_walk_side", label: "나란히 걷기", category: "일상", svg: tplWalkSide(), width: 720, height: 520, tip: "등하굣길·산책 컷. 다리 보폭 가이드에 맞춰 걸음을 그리세요." },
  { id: "emeres_desk_study", label: "책상 공부", category: "일상", svg: tplDeskStudy(), width: 720, height: 520, tip: "스탠드·책 가이드 포함. 시험 기간 에피소드에 활용하세요." },
  { id: "emeres_window_seat", label: "창가에 앉기", category: "일상", svg: tplWindowSeat(), width: 720, height: 560, tip: "창틀 십자선 기준으로 밤하늘이나 노을을 채워 보세요." },
  // ── 액션 ──
  { id: "emeres_run_dash", label: "전력 질주", category: "액션", svg: tplRunDash(), width: 720, height: 540, tip: "지각 위기 컷. 뒤쪽 점선 위에 속도선 에셋을 겹치면 박력 UP." },
  { id: "emeres_fight_face_off", label: "싸움 대치 구도", category: "액션", svg: tplFightFaceOff(), width: 720, height: 540, tip: "결투 직전 긴장 컷. 가운데 번개 라인이 대립 표식이에요." },
  { id: "emeres_punch_impact", label: "펀치 임팩트", category: "액션", svg: tplPunchImpact(), width: 720, height: 540, tip: "타격점의 방사선을 진하게 따면 액션 만화 한 컷 완성." },
  { id: "emeres_jump_air", label: "점프(공중)", category: "액션", svg: tplJumpAir(), width: 480, height: 560, tip: "바닥 그림자 타원이 높이감을 만들어요. 머리카락을 위로 날리면 효과적." },
  { id: "emeres_chase", label: "추격전", category: "액션", svg: tplChase(), width: 720, height: 540, tip: "쫓는 손이 닿을 듯 말 듯한 거리. 흙먼지 원을 구름처럼 키워 보세요." },
  { id: "emeres_reaction_4cut", label: "4컷 리액션 틀", category: "감정", svg: tplReaction4Cut(), width: 720, height: 720, tip: "평온→놀람→기쁨→분노 4단 리액션. 같은 캐릭터로 표정만 바꿔 그리세요." },
];

// 카테고리별 그룹(피커 섹션용) — 빈 카테고리는 제외.
export function emeresSections(templates: EmeresTemplate[] = EMERES_TEMPLATES): { category: EmeresCategory; templates: EmeresTemplate[] }[] {
  return EMERES_CATEGORIES.map((category) => ({
    category,
    templates: templates.filter((t) => t.category === category),
  })).filter((section) => section.templates.length > 0);
}
