import { describe, expect, it } from "vitest";

import {
  computeBalloonTextBounds,
  generateBalloonTailSvgPath,
  solveBalloonCollisions,
  validateBalloonLayout,
  type BalloonRecord,
  type ObstacleRect,
} from "./studio-balloon-auto-layout";

describe("Studio Responsive Balloon Auto-Layout & Tail Generator", () => {
  it("computes hug-content text bounds dynamically", () => {
    const shortText = "안녕!";
    const longText = "안녕하세요, 오늘 날씨가 정말 화창하고 좋네요. 같이 산책이라도 나갈까요?";

    const rule = {
      sizeMode: "hug-content" as const,
      minWidthPx: 120,
      maxWidthPx: 400,
      paddingPx: 16,
      avoidCollisions: true,
    };

    const boundsShort = computeBalloonTextBounds(shortText, 16, rule);
    const boundsLong = computeBalloonTextBounds(longText, 16, rule);

    expect(boundsShort.width).toBe(rule.minWidthPx);
    expect(boundsLong.width).toBeGreaterThan(boundsShort.width);
    expect(boundsLong.width).toBeLessThanOrEqual(rule.maxWidthPx);
    expect(boundsLong.height).toBeGreaterThan(boundsShort.height);
  });

  it("generates smooth quadratic bezier SVG tail paths", () => {
    const bounds = { x: 100, y: 100, width: 200, height: 120 };
    const tail = {
      id: "tail_1",
      targetSpeakerPoint: [200, 300] as const,
      curvature: 0.2,
      tailWidth: 20,
    };

    const path = generateBalloonTailSvgPath(bounds, tail);
    expect(path).toContain("M ");
    expect(path).toContain("Q ");
    expect(path).toContain("200.0 300.0"); // tip point
    expect(path).toContain("Z");
  });

  it("solves collisions by displacing overlapping balloons away from character face", () => {
    const faceObstacle: ObstacleRect = {
      id: "hero_face",
      kind: "character-face",
      bounds: { x: 100, y: 100, width: 80, height: 100 },
    };

    const collidingBalloon: BalloonRecord = {
      id: "b_1",
      dialogueId: "d_1",
      text: "저기 봐!",
      fontSize: 16,
      shape: "round-rect",
      readingOrder: 1,
      bounds: { x: 110, y: 110, width: 140, height: 80 }, // Collides with face
      tails: [],
      layoutRule: { sizeMode: "hug-content", minWidthPx: 100, maxWidthPx: 300, paddingPx: 10, avoidCollisions: true },
    };

    const panelBounds = { x: 0, y: 0, width: 800, height: 1200 };
    const solved = solveBalloonCollisions([collidingBalloon], [faceObstacle], panelBounds);

    expect(solved).toHaveLength(1);
    // Solved position should not collide with face
    const solvedBounds = solved[0].bounds;
    const stillCollides =
      solvedBounds.x < faceObstacle.bounds.x + faceObstacle.bounds.width &&
      solvedBounds.x + solvedBounds.width > faceObstacle.bounds.x &&
      solvedBounds.y < faceObstacle.bounds.y + faceObstacle.bounds.height &&
      solvedBounds.y + solvedBounds.height > faceObstacle.bounds.y;

    expect(stillCollides).toBe(false);
  });

  it("validates balloon layout diagnostics", () => {
    const face: ObstacleRect = { id: "face", kind: "character-face", bounds: { x: 10, y: 10, width: 50, height: 50 } };
    const bColliding: BalloonRecord = {
      id: "b_bad",
      dialogueId: "d_bad",
      text: "충돌",
      fontSize: 14,
      shape: "oval",
      readingOrder: 1,
      bounds: { x: 20, y: 20, width: 60, height: 40 },
      tails: [{ id: "t_dangling", targetSpeakerPoint: [0, 0], curvature: 0, tailWidth: 10 }],
      layoutRule: { sizeMode: "fixed", minWidthPx: 60, maxWidthPx: 60, paddingPx: 10, avoidCollisions: false },
    };

    const diags = validateBalloonLayout([bColliding], [face]);
    expect(diags.some((d) => d.code === "OBSTACLE_COLLISION")).toBe(true);
    expect(diags.some((d) => d.code === "DANGLING_TAIL")).toBe(true);
  });
});
