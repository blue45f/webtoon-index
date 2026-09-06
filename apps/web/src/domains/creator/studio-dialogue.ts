/**
 * Studio Dialogue — 대사 스크립트 → 말풍선 자동 배치(웹툰 제작 시간 단축).
 *
 * 대사는 웹툰 텍스트 작업의 대부분이다. 한 줄에 한 대사씩 적은 스크립트를 붙여넣으면
 * 화자별로 좌/우 번갈아 놓인 말풍선들을 세로로 쌓아 한 번에 깔아준다.
 * 문법:
 *  - "이름: 대사"  → 화자 지정(같은 화자는 같은 쪽, 새 화자는 반대쪽 번갈아).
 *  - "(지문)" 또는 "[나레이션]" → 박스형 나레이션(가운데).
 *  - 그냥 대사     → 직전과 반대쪽으로 번갈아.
 *  - 빈 줄         → 무시.
 *
 * 전부 순수·결정적. 좌표는 메인 루프가 받은 startY 기준 세로로 누적한다. 반환 시드는
 * id를 뺀 BubbleEl 모양이라 메인 루프가 id만 붙여 캔버스에 넣는다. 사용자 노출 문자열 한글.
 */

export type DialogueKind = "speech" | "narration";
export type DialogueSide = "left" | "right";

export interface DialogueLine {
  speaker: string; // "" = 화자 미지정
  text: string;
  kind: DialogueKind;
  side: DialogueSide;
}

export interface DialogueBubbleSeed {
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
  tail?: "left" | "right" | "none";
  tailDirection?: "bottom" | "top" | "left" | "right";
  align?: "left" | "center" | "right";
}

const NARRATION_RE = /^[([](.*)[)\]]$/; // (지문) 또는 [나레이션]
const SPEAKER_RE = /^([^:：]{1,16})[:：]\s*(.+)$/; // "이름: 대사" (전각/반각 콜론)

/**
 * 스크립트 텍스트를 대사 라인 배열로 파싱한다. 화자별로 좌/우를 번갈아 배정한다.
 * 빈 줄은 건너뛴다.
 */
export function parseDialogueScript(text: string): DialogueLine[] {
  const out: DialogueLine[] = [];
  const sideBySpeaker = new Map<string, DialogueSide>();
  let nextSpeakerSide: DialogueSide = "left"; // 새 화자에게 줄 다음 쪽
  let lastSide: DialogueSide = "right"; // 화자 미지정 대사의 번갈기 기준(첫 줄이 left가 되도록)

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const narr = NARRATION_RE.exec(line);
    if (narr) {
      out.push({ speaker: "", text: narr[1].trim(), kind: "narration", side: "left" });
      continue;
    }

    const sp = SPEAKER_RE.exec(line);
    if (sp) {
      const speaker = sp[1].trim();
      let side = sideBySpeaker.get(speaker);
      if (!side) {
        side = nextSpeakerSide;
        sideBySpeaker.set(speaker, side);
        nextSpeakerSide = side === "left" ? "right" : "left";
      }
      lastSide = side;
      out.push({ speaker, text: sp[2].trim(), kind: "speech", side });
      continue;
    }

    // 화자 미지정 — 직전과 반대쪽으로
    const side: DialogueSide = lastSide === "left" ? "right" : "left";
    lastSide = side;
    out.push({ speaker: "", text: line, kind: "speech", side });
  }
  return out;
}

export interface DialogueLayoutOptions {
  canvasWidth: number;
  startY: number;
  gap?: number; // 말풍선 사이 세로 간격
  bubbleWidth?: number; // 말풍선 폭(미지정 시 캔버스의 약 56%)
  fontSize?: number; // 글자 크기(높이 추정용)
  margin?: number; // 좌우 여백
}

// 대략적 텍스트 높이 추정 — 폭/글자크기로 줄 수를 가늠해 패딩을 더한다(순수·결정적).
function estimateBubbleHeight(text: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(6, Math.floor((width - 28) / (fontSize * 0.62)));
  const explicitLines = text.split("\n").length;
  const wrapped = Math.ceil(text.length / charsPerLine);
  const lines = Math.max(explicitLines, wrapped, 1);
  return Math.round(lines * fontSize * 1.35 + 28);
}

/**
 * 대사 라인들을 startY부터 세로로 쌓아 말풍선 시드 배열로 만든다.
 * 좌/우 화자는 좌·우 정렬에 꼬리 방향을 맞추고, 나레이션은 가운데 박스로 넓게 깐다.
 */
export function layoutDialogueBubbles(
  lines: DialogueLine[],
  opts: DialogueLayoutOptions
): DialogueBubbleSeed[] {
  const canvasWidth = opts.canvasWidth;
  const margin = opts.margin ?? 28;
  const gap = opts.gap ?? 20;
  const fontSize = opts.fontSize ?? 22;
  const speechWidth = opts.bubbleWidth ?? Math.round(canvasWidth * 0.56);
  const narrationWidth = Math.round(canvasWidth - margin * 2);

  const seeds: DialogueBubbleSeed[] = [];
  let y = opts.startY;

  for (const line of lines) {
    if (line.kind === "narration") {
      const height = estimateBubbleHeight(line.text, narrationWidth, fontSize);
      seeds.push({
        type: "bubble",
        variant: "box",
        text: line.text,
        x: margin,
        y,
        width: narrationWidth,
        height,
        fill: "#1c1c1c",
        textFill: "#f4f4f4",
        rotation: 0,
        align: "center",
      });
      y += height + gap;
      continue;
    }

    const width = speechWidth;
    const height = estimateBubbleHeight(line.text, width, fontSize);
    const x = line.side === "left" ? margin : canvasWidth - width - margin;
    seeds.push({
      type: "bubble",
      variant: "speech",
      text: line.text,
      x,
      y,
      width,
      height,
      fill: "#ffffff",
      textFill: "#1a1a1a",
      rotation: 0,
      tail: line.side,
      tailDirection: "bottom",
      align: "left",
    });
    y += height + gap;
  }
  return seeds;
}

/** 스크립트 → 말풍선 시드(파싱+배치) 한 번에. 빈 스크립트는 빈 배열. */
export function dialogueToBubbles(script: string, opts: DialogueLayoutOptions): DialogueBubbleSeed[] {
  return layoutDialogueBubbles(parseDialogueScript(script), opts);
}
