import { describe, expect, it } from "vitest";

import { StudioAiStoryboardDirector } from "./studio-ai-storyboard-director";

describe("StudioAiStoryboardDirector", () => {
  const director = new StudioAiStoryboardDirector();

  it("handles empty script gracefully", () => {
    const res = director.direct("");
    expect(res.totalCuts).toBe(0);
    expect(res.pacingScore).toBe(100);
  });

  it("parses lines into structured cuts with shot scales and emotions", () => {
    const script = `
주인공이 분노하며 "이건 절대 용서 못 해!"라고 외치며 검을 뽑는다.
적의 흔들리는 눈빛과 경악하는 표정.
뒤에서 몰래 다가오며 칼을 겨누는 마지막 결전.
    `;

    const res = director.direct(script);

    expect(res.totalCuts).toBe(3);
    expect(res.cuts[0].dialogue).toBe("이건 절대 용서 못 해!");
    expect(res.cuts[0].emotion).toBe("rage");
    expect(res.cuts[0].shotScale).toBe("full-shot");

    expect(res.cuts[1].emotion).toBe("shock");
    expect(res.cuts[1].shotScale).toBe("extreme-close-up");

    // The action branch sets exactly 1.5, so a strict > could never pass; the
    // intent is that an action cut is taller than the 1.0 baseline.
    expect(res.cuts[2].panelHeightRatio).toBeGreaterThanOrEqual(1.5);
    expect(res.estimatedEpisodeReadingSec).toBeGreaterThan(10);
  });

  it("does not mistake the adjective 검은 for a sword action", () => {
    const res = director.direct(
      "검은 고양이가 창가에 조용히 앉아 있다.\n주인공이 문을 닫는다."
    );

    expect(res.cuts[0]?.emotion).toBe("calm");
    expect(res.cuts[0]?.shotScale).toBe("medium-shot");
  });

  it("extracts speaker dialogue without leaking lettering into image prompts", () => {
    const res = director.direct('민서: "오늘은 여기까지 하자."');
    const cut = res.cuts[0];

    expect(cut?.dialogue).toBe("오늘은 여기까지 하자.");
    expect(cut?.backgroundPrompt).not.toContain("오늘은 여기까지 하자");
    expect(cut?.backgroundPrompt).toContain("no speech bubbles");
    expect(cut?.backgroundPrompt).toContain("no readable text");
  });
});
