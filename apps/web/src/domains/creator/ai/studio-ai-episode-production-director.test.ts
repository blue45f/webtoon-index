import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_AI_EPISODE_CONTINUITY_LOCKS,
  planStudioAiEpisodeProduction,
} from "./studio-ai-episode-production-director";

describe("planStudioAiEpisodeProduction", () => {
  it("returns an honest blocked preflight for an empty script", () => {
    const plan = planStudioAiEpisodeProduction({ script: "   " });

    expect(plan.totalCuts).toBe(0);
    expect(plan.batches).toHaveLength(0);
    expect(plan.projectedOutputCount).toBe(0);
    expect(plan.scores.readiness).toBe(0);
    expect(plan.issues[0]).toMatchObject({
      id: "input-empty",
      severity: "blocker",
    });
  });

  it("turns scene headings into cut batches with explicit continuity receipts", () => {
    const plan = planStudioAiEpisodeProduction({
      episodeTitle: "푸른 보석 12화",
      mode: "quality",
      variants: 4,
      script: [
        "장면 1: 학교 옥상",
        "석양 아래 주인공이 난간 앞으로 걸어간다.",
        '주인공: "이 보석이 모든 일의 시작이었어."',
        "",
        "장면 2: 비 오는 골목",
        "밤, 주인공이 우산을 접고 달리기 시작한다.",
        '주인공: "이번에는 놓치지 않아."',
      ].join("\n"),
      characterAnchor: "주인공 · 검은 단발 · 회색 눈",
      costumeAnchor: "검은 교복과 은색 단추",
      styleAnchor: "깨끗한 한국 웹툰 셀 채색, 일정한 외곽선",
      propAnchor: "푸른 보석, 검은 우산",
    });

    expect(plan.scenes).toHaveLength(2);
    expect(plan.totalCuts).toBe(4);
    expect(plan.batchCount).toBe(2);
    expect(plan.projectedOutputCount).toBe(16);
    expect(plan.generationWorkUnits).toBe(41.6);
    expect(plan.anchors.characters).toContain("주인공 · 검은 단발 · 회색 눈");
    expect(plan.anchors.locations).toEqual(expect.arrayContaining(["학교 옥상", "골목"]));
    expect(plan.batches[0]?.continuityReceipt.join(" ")).toContain("캐릭터");
    expect(plan.batches[0]?.positivePrompt).toContain("Cut 1");
    expect(plan.batches[0]?.negativePrompt).toContain("identity drift");
  });

  it("blocks identity-locked generation when no character anchor can be found", () => {
    const plan = planStudioAiEpisodeProduction({
      script: "빈 교실 창문으로 오후 햇빛이 들어온다.\n칠판 위 분필가루가 천천히 떨어진다.",
      styleAnchor: "clean webtoon cel style",
      locks: {
        ...DEFAULT_STUDIO_AI_EPISODE_CONTINUITY_LOCKS,
        costume: false,
        props: false,
      },
    });

    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        id: "missing-character-anchor",
        severity: "blocker",
      })
    );
    expect(plan.scores.readiness).toBeLessThanOrEqual(49);
  });

  it("surfaces dialogue and camera risks before generation", () => {
    const longDialogue = "지금까지 네가 숨겨 온 모든 비밀을 오늘 여기서 반드시 밝혀내고 말겠어 그러니 더는 도망치지 마";
    const plan = planStudioAiEpisodeProduction({
      script: [
        `민서: ${longDialogue}`,
        "민서가 조용히 창밖을 바라본다.",
        "민서가 책상 위 편지를 집어 든다.",
        "민서가 문 쪽으로 천천히 걸어간다.",
      ].join("\n"),
      locks: {
        character: false,
        costume: false,
        location: false,
        lighting: false,
        style: false,
        props: false,
      },
    });

    expect(plan.issues).toContainEqual(
      expect.objectContaining({ category: "dialogue", cutNumber: 1 })
    );
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ category: "camera", severity: "warning" })
    );
    expect(plan.scores.dialogueReadability).toBeLessThan(100);
    expect(plan.scores.pacing).toBeLessThan(100);
  });

  it("flags unexplained costume changes but accepts an explicit transition", () => {
    const base = {
      script: "주인공이 교복 차림으로 학교를 나선다.\n주인공이 정장을 입고 사무실에 도착한다.",
      characterAnchor: "주인공",
      styleAnchor: "webtoon cel",
      lightingAnchor: "낮",
      propAnchor: "가방",
    } as const;

    const ambiguous = planStudioAiEpisodeProduction(base);
    const explained = planStudioAiEpisodeProduction({
      ...base,
      script: `${base.script}\n잠시 후 옷을 갈아입는 장면 전환.`,
    });

    expect(ambiguous.issues.map((issue) => issue.id)).toContain(
      "costume-change-without-transition"
    );
    expect(explained.issues.map((issue) => issue.id)).not.toContain(
      "costume-change-without-transition"
    );
  });


  it("does not treat scene headings or ambiguous Korean substrings as continuity anchors", () => {
    const plan = planStudioAiEpisodeProduction({
      script: [
        "장면 1: 완성된 번역 문서",
        "검은 고양이가 방향을 낮춰 정책 초안을 바라본다.",
      ].join("\n"),
      locks: {
        character: true,
        costume: false,
        location: false,
        lighting: false,
        style: false,
        props: false,
      },
    });

    expect(plan.anchors.characters).not.toContain("장면 1");
    expect(plan.anchors.locations).not.toEqual(
      expect.arrayContaining(["성", "역", "방"])
    );
    expect(plan.anchors.props).not.toEqual(expect.arrayContaining(["검", "책"]));
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ id: "missing-character-anchor", severity: "blocker" })
    );
  });

  it("keeps different characters' costumes separate instead of reporting a fake outfit change", () => {
    const plan = planStudioAiEpisodeProduction({
      script: [
        '민서: "출발하자."',
        "민서가 교복 차림으로 교실을 나선다.",
        '준호: "알겠어."',
        "준호가 정장 차림으로 뒤따라간다.",
      ].join("\n"),
      styleAnchor: "clean webtoon cel",
      locks: {
        ...DEFAULT_STUDIO_AI_EPISODE_CONTINUITY_LOCKS,
        location: false,
        lighting: false,
        props: false,
      },
    });

    expect(plan.anchors.costumes).toEqual(expect.arrayContaining(["교복", "정장"]));
    expect(plan.issues.map((issue) => issue.id)).not.toContain(
      "costume-change-without-transition"
    );
  });

  it("emits a deterministic, provider-neutral manifest", () => {
    const input = {
      episodeTitle: "테스트 회차",
      script: '장면 1: 카페\n유나: "안녕."',
      characterAnchor: "유나",
      costumeAnchor: "코트",
      lightingAnchor: "따뜻한 실내광",
      styleAnchor: "clean manhwa cel",
      propAnchor: "커피잔",
    } as const;

    const first = planStudioAiEpisodeProduction(input);
    const second = planStudioAiEpisodeProduction(input);
    const manifest = JSON.parse(first.manifestJson) as Record<string, unknown>;

    expect(second.manifestJson).toBe(first.manifestJson);
    expect(manifest.version).toBe(1);
    expect(manifest.episodeTitle).toBe("테스트 회차");
    expect(first.masterPrompt).toContain("WEBTOON EPISODE PRODUCTION DIRECTIVE");
    expect(first.masterPrompt).toContain("lettering is applied separately");
  });
});
