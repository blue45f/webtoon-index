import { describe, it, expect } from "vitest";

import { dialogueToBubbles, layoutDialogueBubbles, parseDialogueScript } from "./studio-dialogue";

describe("parseDialogueScript", () => {
  it("빈 줄을 건너뛰고 한 줄 = 한 대사", () => {
    const lines = parseDialogueScript("안녕\n\n반가워\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.text)).toEqual(["안녕", "반가워"]);
  });

  it("화자 미지정 대사는 좌→우 번갈아", () => {
    const lines = parseDialogueScript("첫째\n둘째\n셋째");
    expect(lines.map((l) => l.side)).toEqual(["left", "right", "left"]);
  });

  it('"이름: 대사"는 화자별로 좌/우 고정(같은 화자는 같은 쪽)', () => {
    const lines = parseDialogueScript("민수: 안녕\n지영: 오랜만이야\n민수: 잘 지냈어?");
    expect(lines[0]).toMatchObject({ speaker: "민수", side: "left", kind: "speech", text: "안녕" });
    expect(lines[1]).toMatchObject({ speaker: "지영", side: "right" });
    expect(lines[2]).toMatchObject({ speaker: "민수", side: "left" }); // 같은 화자 → 같은 쪽
  });

  it("전각 콜론도 화자로 인식", () => {
    expect(parseDialogueScript("민수： 안녕")[0].speaker).toBe("민수");
  });

  it("(지문)·[나레이션]은 박스 나레이션", () => {
    const lines = parseDialogueScript("(잠시 후)\n[그날 밤]");
    expect(lines[0]).toMatchObject({ kind: "narration", text: "잠시 후" });
    expect(lines[1]).toMatchObject({ kind: "narration", text: "그날 밤" });
  });
});

describe("layoutDialogueBubbles", () => {
  const opts = { canvasWidth: 720, startY: 100 };

  it("말풍선을 세로로 겹치지 않게 쌓는다", () => {
    const lines = parseDialogueScript("민수: 안녕\n지영: 반가워");
    const seeds = layoutDialogueBubbles(lines, opts);
    expect(seeds).toHaveLength(2);
    // 두 번째 말풍선은 첫 번째 아래에
    expect(seeds[1].y).toBeGreaterThanOrEqual(seeds[0].y + seeds[0].height);
    // 첫 말풍선은 startY에서 시작
    expect(seeds[0].y).toBe(100);
  });

  it("좌측 화자는 왼쪽, 우측 화자는 오른쪽에 배치되고 꼬리 방향이 맞다", () => {
    const lines = parseDialogueScript("민수: 안녕\n지영: 반가워");
    const seeds = layoutDialogueBubbles(lines, opts);
    expect(seeds[0].tail).toBe("left");
    expect(seeds[0].x).toBe(28); // 좌측 여백에 붙음
    expect(seeds[1].tail).toBe("right");
    // 우측 정렬: 오른쪽 가장자리가 캔버스 우측 여백에 붙고, 좌측 x는 좌측 말풍선보다 오른쪽
    expect(seeds[1].x + seeds[1].width).toBe(720 - 28);
    expect(seeds[1].x).toBeGreaterThan(seeds[0].x);
  });

  it("모든 시드는 캔버스 폭 안에 들어온다", () => {
    const seeds = dialogueToBubbles("가\n나\n다\n라", opts);
    for (const s of seeds) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.width).toBeLessThanOrEqual(720);
      expect(s.height).toBeGreaterThan(0);
    }
  });

  it("나레이션은 넓은 박스(box variant)로 깔린다", () => {
    const seeds = dialogueToBubbles("(잠시 후)", opts);
    expect(seeds[0].variant).toBe("box");
    expect(seeds[0].width).toBeGreaterThan(720 * 0.7);
  });

  it("긴 대사는 짧은 대사보다 높다", () => {
    const short = dialogueToBubbles("짧음", opts);
    const long = dialogueToBubbles("아주 길고 긴 대사를 여러 글자로 적으면 줄이 늘어나서 말풍선 높이가 더 커져야 정상입니다 정말로요", opts);
    expect(long[0].height).toBeGreaterThan(short[0].height);
  });

  it("빈 스크립트는 빈 배열", () => {
    expect(dialogueToBubbles("   \n  ", opts)).toEqual([]);
  });
});
