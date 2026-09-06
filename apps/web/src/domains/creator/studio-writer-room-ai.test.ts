import { describe, expect, it } from "vitest";

import { createEmptyStudioWriterRoomDocument } from "./studio-writer-room";
import {
  buildStudioWriterRoomAiPrompt,
  parseStudioWriterRoomAiDraft,
} from "./studio-writer-room-ai";

describe("studio-writer-room-ai", () => {
  it("현재 단계와 필요한 이전 단계만 포함하고 비밀정보를 요구하지 않는다", () => {
    const document = createEmptyStudioWriterRoomDocument();
    document.stages.premise.text = "한밤중 택배를 받은 주인공";
    const prompt = buildStudioWriterRoomAiPrompt({
      stage: "synopsis",
      document,
      characterContext: "hero-1: 서윤 / 야간 경비원",
      direction: "8화 분량의 미스터리",
    });
    expect(prompt.system).toContain('"stage":"synopsis"');
    expect(prompt.system).toContain("직접 수정하지 않습니다");
    expect(prompt.user).toContain("한밤중 택배");
    expect(prompt.user).toContain("hero-1");
    expect(prompt.user).toContain("미스터리");
    expect(prompt.user).not.toMatch(/api.?key/iu);
  });

  it("코드 펜스로 감싼 정상 단계 초안을 엄격하게 파싱한다", () => {
    const parsed = parseStudioWriterRoomAiDraft(
      '```json\n{"stage":"premise","rationale":"갈등을 선명하게 함","draft":{"text":"기억을 파는 소녀가 자신의 마지막 기억을 지키려 한다.","characterIds":["hero-1"]}}\n```',
      "premise"
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        stage: "premise",
        rationale: "갈등을 선명하게 함",
        draft: {
          text: "기억을 파는 소녀가 자신의 마지막 기억을 지키려 한다.",
          characterIds: ["hero-1"],
        },
      },
    });
  });

  it("배열 단계의 명시적 id와 참조를 보존한다", () => {
    const parsed = parseStudioWriterRoomAiDraft(
      JSON.stringify({
        stage: "scenes",
        rationale: "장소 변화 기준으로 분리",
        draft: {
          items: [
            {
              id: "scene-1",
              order: 0,
              beatIds: ["beat-1"],
              heading: "옥상 / 밤",
              summary: "주인공이 흔적을 발견한다.",
              location: "학교 옥상",
              time: "밤",
              characterIds: ["hero-1"],
            },
          ],
        },
      }),
      "scenes"
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.data.stage === "scenes") {
      expect(parsed.data.draft.items[0]?.id).toBe("scene-1");
    }
  });

  it("요청 단계 불일치, 알 수 없는 필드, 깨진 JSON을 거부한다", () => {
    expect(parseStudioWriterRoomAiDraft(
      '{"stage":"synopsis","rationale":"x","draft":{"text":"x","characterIds":[]}}',
      "premise"
    )).toMatchObject({ ok: false });
    expect(parseStudioWriterRoomAiDraft(
      '{"stage":"premise","rationale":"x","draft":{"text":"x","characterIds":[],"secret":"x"}}',
      "premise"
    )).toMatchObject({ ok: false });
    expect(parseStudioWriterRoomAiDraft("not-json", "premise")).toMatchObject({ ok: false });
  });

  it("허용되지 않은 id와 과도한 배열을 거부한다", () => {
    expect(parseStudioWriterRoomAiDraft(
      JSON.stringify({
        stage: "beats",
        rationale: "x",
        draft: { items: [{ id: "__proto__", order: 0, title: "x", summary: "x", characterIds: [] }] },
      }),
      "beats"
    )).toMatchObject({ ok: false });
    expect(parseStudioWriterRoomAiDraft(
      JSON.stringify({
        stage: "beats",
        rationale: "x",
        draft: {
          items: Array.from({ length: 81 }, (_, index) => ({
            id: `beat-${index}`,
            order: index,
            title: "x",
            summary: "x",
            characterIds: [],
          })),
        },
      }),
      "beats"
    )).toMatchObject({ ok: false });
  });
});
