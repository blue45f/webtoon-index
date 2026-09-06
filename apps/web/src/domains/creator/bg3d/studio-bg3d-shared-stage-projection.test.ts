import { describe, expect, it } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import { createStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

import {
  createStudioBg3dLinkedCharacterCapture,
  resolveStudioBg3dSharedStageMutationBlockedReason,
} from "./studio-bg3d-shared-stage-projection";

describe("Studio BG3D Shared Stage projection", () => {
  it("blocks both a first connection and an update when appearance fields are preview-only", () => {
    const readiness = {
      phase: "ready" as const,
      capturableElementIds: [],
      previewOnlyElementIds: ["hero"],
    };
    for (const operation of ["insert", "update"] as const) {
      const reason = resolveStudioBg3dSharedStageMutationBlockedReason({
        operation,
        mutationKind: "connect",
        includeCharactersInCapture: true,
        captureReadiness: readiness,
      });
      expect(reason).toBe(
        "캐릭터 1명의 일부 설정을 아직 배경 이미지에 빠짐없이 담을 수 없어 연결 적용을 멈췄어요. 연결 설정에서 ‘배경만’을 선택하면 캐릭터 원본은 그대로 두고 배경만 적용할 수 있어요.",
      );
      expect(reason).not.toMatch(/의상·소품|아바타 꾸미기|페인트|물리/u);
    }
  });

  it("allows an explicit background-only mutation without claiming a character capture", () => {
    expect(resolveStudioBg3dSharedStageMutationBlockedReason({
      operation: "insert",
      mutationKind: "background-only",
      includeCharactersInCapture: false,
      captureReadiness: {
        phase: "ready",
        capturableElementIds: [],
        previewOnlyElementIds: ["hero"],
      },
    })).toBeNull();
  });

  it("records exact Stage placement and runtime identity for captured characters", () => {
    const character = createStudioShared3dSceneSession([{
      elementId: "hero",
      scene: createStudioVrmSceneDocument(),
      stageId: "stage-a",
      stageTransform: { position: [2, 0.5, -3], rotationY: 0.75 },
    }]).characters[0]!;

    expect(createStudioBg3dLinkedCharacterCapture(["hero"], [character])).toEqual({
      kind: "full-fidelity-linked-vrm-capture",
      elementIds: ["hero"],
      stagePlacements: [{
        elementId: "hero",
        expectedRuntimeKey: character.runtimeKey,
        transform: { position: [2, 0.5, -3], rotationY: 0.75 },
      }],
    });
  });
});
