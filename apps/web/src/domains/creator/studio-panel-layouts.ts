// 컷(패널) 레이아웃 템플릿 — 코미Po!(ComiPo!)식 "정형 컷 분할 프리셋".
// 한 번 클릭으로 패널 프레임(+필요 시 말풍선 시드)을 캔버스에 일괄 배치한다.
// 기존 FrameEl/BubbleEl 메커니즘을 그대로 재사용 — 적용 함수는 StudioPage의 applyPanelLayout.

import { CANVAS_W } from "./studio-assets";

export interface PanelLayoutFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelLayoutBubbleSeed {
  variant: "speech" | "box";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelLayoutPreset {
  id: string;
  label: string;
  hint: string;
  canvasH: number;
  frames: PanelLayoutFrame[];
  bubbles?: PanelLayoutBubbleSeed[];
}

const M = 24; // 컷 간격/여백
const W = CANVAS_W;
const FULL = W - M * 2;

// 세로 스택: 주어진 높이들을 위에서부터 전폭으로 쌓는다. canvasH는 합계로 계산.
function stackRows(heights: number[]): { frames: PanelLayoutFrame[]; canvasH: number } {
  let y = M;
  const frames = heights.map((h) => {
    const frame = { x: M, y, width: FULL, height: h };
    y += h + M;
    return frame;
  });
  return { frames, canvasH: y };
}

function row2(y: number, h: number): PanelLayoutFrame[] {
  const w = (W - M * 3) / 2;
  return [
    { x: M, y, width: w, height: h },
    { x: M * 2 + w, y, width: w, height: h },
  ];
}

const insta3 = stackRows([672, 672, 672]);
const cinema3 = stackRows([280, 280, 280]);
const accentMid = stackRows([320, 820, 320]);
const two = stackRows([604, 604]);
const talk2 = stackRows([560, 560]);

// 5컷 지그재그: 행마다 넓은 컷이 좌/우로 번갈아 배치.
function zigzag5(): { frames: PanelLayoutFrame[]; canvasH: number } {
  const h = 360;
  const w = Math.round(W * 0.72);
  let y = M;
  const frames: PanelLayoutFrame[] = [];
  for (let i = 0; i < 5; i++) {
    frames.push({ x: i % 2 === 0 ? M : W - M - w, y, width: w, height: h });
    y += h + M;
  }
  return { frames, canvasH: y };
}
const zig5 = zigzag5();

// 계단식 3컷(대각선 흐름): 좌→우→좌로 시선이 흐르는 사선 리듬.
function stair3(): { frames: PanelLayoutFrame[]; canvasH: number } {
  const h = 400;
  const w = 440;
  return {
    frames: [
      { x: M, y: M, width: w, height: h },
      { x: W - M - w, y: M * 2 + h, width: w, height: h },
      { x: M, y: M * 3 + h * 2, width: w, height: h },
    ],
    canvasH: M * 4 + h * 3,
  };
}
const stairs = stair3();

// 정통 4컷(제목칸 포함): 위에 얇은 제목칸 + 등간격 4컷.
function yonkomaTitled(): { frames: PanelLayoutFrame[]; canvasH: number } {
  const title = 120;
  const h = 400;
  const { frames, canvasH } = stackRows([title, h, h, h, h]);
  return { frames, canvasH };
}
const yonkoma = yonkomaTitled();

/** 패널 레이아웃을 캔버스 시드(프레임·말풍선)로 물질화 — StudioPage applyPanelLayout 과 동일 계약. */
export type PanelLayoutElementSeed =
  | {
      type: "frame";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      type: "bubble";
      variant: "speech" | "box";
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      textFill: string;
      rotation: number;
    };

export function materializePanelLayout(layout: PanelLayoutPreset): {
  canvasH: number;
  seeds: PanelLayoutElementSeed[];
} {
  const frames: PanelLayoutElementSeed[] = layout.frames.map((f) => ({
    type: "frame",
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
  }));
  const bubbles: PanelLayoutElementSeed[] = (layout.bubbles ?? []).map((b) => ({
    type: "bubble",
    variant: b.variant,
    text: b.text,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    fill: "#ffffff",
    textFill: "#16100c",
    rotation: 0,
  }));
  return { canvasH: layout.canvasH, seeds: [...frames, ...bubbles] };
}

export const PANEL_LAYOUTS: PanelLayoutPreset[] = [
  {
    id: "layout_single_hero",
    label: "1컷 일러스트",
    hint: "표지·한 장면 집중",
    canvasH: 900,
    frames: [{ x: M, y: M, width: FULL, height: 900 - M * 2 }],
  },
  {
    id: "layout_two_rows",
    label: "2단 기본",
    hint: "상황 → 리액션",
    canvasH: two.canvasH,
    frames: two.frames,
  },
  {
    id: "layout_insta_3",
    label: "3단 세로(인스타툰)",
    hint: "정방형 3컷 스크롤",
    canvasH: insta3.canvasH,
    frames: insta3.frames,
  },
  {
    id: "layout_yonkoma_titled",
    label: "정통 4컷(제목칸)",
    hint: "기승전결 + 제목칸",
    canvasH: yonkoma.canvasH,
    frames: yonkoma.frames,
  },
  {
    id: "layout_zigzag_5",
    label: "5컷 지그재그",
    hint: "좌우 교차 리듬",
    canvasH: zig5.canvasH,
    frames: zig5.frames,
  },
  {
    id: "layout_spread_2",
    label: "양면 펼침 2컷",
    hint: "나란한 두 장면 대비",
    canvasH: 720,
    frames: [
      { x: M, y: M, width: (W - M * 3) / 2, height: 720 - M * 2 },
      { x: M * 2 + (W - M * 3) / 2, y: M, width: (W - M * 3) / 2, height: 720 - M * 2 },
    ],
  },
  {
    id: "layout_stair_3",
    label: "대각선 흐름 3컷",
    hint: "계단식 사선 시선 유도",
    canvasH: stairs.canvasH,
    frames: stairs.frames,
  },
  {
    id: "layout_big_top",
    label: "상 1컷 · 하 2컷",
    hint: "큰 장면 → 분할 반응",
    canvasH: 1280,
    frames: [{ x: M, y: M, width: FULL, height: 580 }, ...row2(M * 2 + 580, 1280 - M * 3 - 580)],
  },
  {
    id: "layout_big_bottom",
    label: "상 2컷 · 하 1컷",
    hint: "빌드업 → 한 방",
    canvasH: 1280,
    frames: [...row2(M, 628), { x: M, y: M * 2 + 628, width: FULL, height: 1280 - M * 3 - 628 }],
  },
  {
    id: "layout_vertical_2col",
    label: "세로 2열 대칭",
    hint: "동시 진행·비교 연출",
    canvasH: 1080,
    frames: [
      { x: M, y: M, width: (W - M * 3) / 2, height: 1080 - M * 2 },
      { x: M * 2 + (W - M * 3) / 2, y: M, width: (W - M * 3) / 2, height: 1080 - M * 2 },
    ],
  },
  {
    id: "layout_cinema_3",
    label: "시네마 와이드 3컷",
    hint: "영화 같은 가로 프레임",
    canvasH: cinema3.canvasH,
    frames: cinema3.frames,
  },
  {
    id: "layout_accent_middle",
    label: "중앙 강조(좁·넓·좁)",
    hint: "가운데 컷에 힘주기",
    canvasH: accentMid.canvasH,
    frames: accentMid.frames,
  },
  {
    id: "layout_talk_2_bubbles",
    label: "대화 2컷 + 말풍선",
    hint: "말풍선까지 미리 배치",
    canvasH: talk2.canvasH,
    frames: talk2.frames,
    bubbles: [
      { variant: "speech", text: "대사를 입력", x: M + 36, y: M + 48, width: 250, height: 120 },
      { variant: "speech", text: "대사를 입력", x: W - M - 36 - 250, y: M * 2 + 560 + 48, width: 250, height: 120 },
    ],
  },
  {
    id: "layout_title_intro",
    label: "표지 + 내레이션 도입",
    hint: "1화 도입부 틀",
    canvasH: 1500,
    frames: [
      { x: M, y: M, width: FULL, height: 700 },
      { x: M, y: M * 2 + 700, width: FULL, height: 1500 - M * 3 - 700 },
    ],
    bubbles: [{ variant: "box", text: "내레이션", x: M + 28, y: M + 28, width: 300, height: 96 }],
  },
];
