import { describe, expect, it } from "vitest";

import { buildStudioProductionInsightsInput } from "./studio-production-projection";

describe("buildStudioProductionInsightsInput", () => {
  it("projects framed and unframed text/assets once and keeps review metadata", () => {
    const result = buildStudioProductionInsightsInput(
      [
        {
          review: { status: "approved", locked: true },
          elements: [
            { id: "frame", type: "frame", x: 0, y: 0, width: 500, height: 500, bg: "data:image/png,x", aiProvenance: { action: "generated" } },
            { id: "speech", type: "bubble", variant: "speech", text: "안녕", x: 10, y: 10, width: 80, height: 40 },
            { id: "narration", type: "bubble", variant: "box", text: "그날", x: 20, y: 80, width: 80, height: 40 },
            { id: "inside", type: "image", x: 100, y: 100, width: 50, height: 50, aiProvenance: { action: "edited" } },
            { id: "outside", type: "text", text: "페이지 제목", x: 700, y: 20, width: 100 },
            { id: "sticker", type: "sticker", text: "✨", x: 700, y: 100 },
          ],
        },
      ],
      [{ severity: "warning" }]
    );

    expect(result.pages).toEqual([
      {
        review: { status: "approved", locked: true },
        frames: [
          {
            dialogue: ["안녕"],
            narration: ["그날"],
            assets: [
              { aiGenerated: true, aiEdited: false },
              { aiGenerated: false, aiEdited: true },
            ],
          },
        ],
        dialogue: [],
        narration: ["페이지 제목"],
        assets: [{ aiGenerated: false, aiEdited: false }],
      },
    ]);
    expect(result.issues).toEqual([{ severity: "warning" }]);
  });

  it("drops hidden elements and malformed frames without throwing", () => {
    expect(
      buildStudioProductionInsightsInput([
        {
          elements: [
            { id: "bad", type: "frame", x: 0, y: 0, width: -1, height: 20 },
            { id: "hidden", type: "text", text: "숨김", x: 0, y: 0, hidden: true },
            null,
          ],
        },
      ])
    ).toMatchObject({
      pages: [{ frames: [], dialogue: [], narration: [], assets: [], review: null }],
    });
    expect(buildStudioProductionInsightsInput("bad").pages).toEqual([]);
  });
});
