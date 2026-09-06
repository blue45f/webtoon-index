// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "../vrm/studio-vrm-scene-document";

import { resolveStudioBg3dSharedCharacterGrounding } from "./studio-bg3d-shared-character-grounding";
import { StudioBg3dSharedCharacterPlacementPanel } from "./StudioBg3dSharedCharacterPlacementPanel";

import type {
  StudioShared3dCharacterTransformCommitHandler,
  StudioShared3dCharacterTransformUpdateRequest,
} from "../studio-shared-3d-scene-bridge";

afterEach(cleanup);

function createCharacters() {
  const base = createStudioVrmSceneDocument();
  const hero = normalizeStudioVrmSceneDocument({
    ...base,
    pose: {
      ...base.pose,
      bodyRotationY: Math.PI / 4,
      yOffset: 0.25,
      translations: {
        ...base.pose.translations,
        root: [1.5, 0, -2],
      },
    },
    appearance: {
      ...base.appearance,
      wardrobe: { jacket: "navy" },
    },
  });
  return createStudioShared3dSceneSession([
    { elementId: "hero-layer", label: "주인공", scene: hero },
    { elementId: "friend-layer", label: "친구", scene: base },
  ]).characters;
}

function successResult(request: StudioShared3dCharacterTransformUpdateRequest) {
  return {
    ok: true as const,
    changed: true,
    receipt: {
      kind: "toonspectrum.shared-3d-character-transform-receipt" as const,
      version: 1 as const,
      elementId: request.elementId,
      beforeSourceHash: `sha256:${"a".repeat(64)}` as const,
      afterSourceHash: `sha256:${"a".repeat(64)}` as const,
      beforeRuntimeKey: request.expectedRuntimeKey,
      afterRuntimeKey: request.expectedRuntimeKey,
      authority: "stage-override" as const,
      ...(request.expectedPlacementHash
        ? { beforePlacementHash: request.expectedPlacementHash }
        : {}),
      afterPlacementHash: `sha256:${"c".repeat(64)}` as const,
      transform: request.transform,
    },
  };
}

describe("StudioBg3dSharedCharacterPlacementPanel", () => {
  it("keeps a wardrobe preview-only character visible but blocks placement promises and commits", () => {
    const characters = createCharacters();
    const hero = characters[0]!;
    const onCommitMock = vi.fn(successResult);
    const grounding = resolveStudioBg3dSharedCharacterGrounding({
      identity: {
        ...(hero.stageId ? { stageId: hero.stageId } : {}),
        elementId: hero.elementId,
        modelRuntimeKey: hero.modelRuntimeKey,
        placementHash: hero.placementHash,
      },
      placementY: hero.stageTransform.position[1],
      anchors: [{ kind: "left-foot", point: [1.5, 0.5, -2] }],
      surfaceHit: {
        source: "background-surface",
        targetEntityId: "room-floor",
        point: [1.5, 0, -2],
        normal: [0, 1, 0],
      },
    });

    render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [hero.runtimeKey]: "ready" }}
        selectedElementId={hero.elementId}
        grounding={grounding}
        onSelect={vi.fn()}
        onCommit={onCommitMock}
      />,
    );

    for (const input of screen.getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole("button", { name: "배경 표면에 맞추기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "배치 초기화" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("note", { name: "미리보기 전용 캐릭터 안내" }).textContent)
      .toContain("캐릭터와 배치는 이번 연결에 저장되지 않아요");
    expect(screen.getByText(/배경만 적용하거나/u)).toBeTruthy();
    expect(screen.getByText(/고급 상태를 정리한 뒤 다시 연결/u)).toBeTruthy();
    expect(screen.queryByText(/아래 적용을 누를 때 배경 결과와 함께 저장/u)).toBeNull();
    expect(onCommitMock).not.toHaveBeenCalled();
  });

  it("commits a full-fidelity character Stage-local draft without replacing other axes", () => {
    const characters = createCharacters();
    const friend = characters[1]!;
    const onCommitMock = vi.fn(successResult);
    const onCommit: StudioShared3dCharacterTransformCommitHandler = onCommitMock;

    render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [friend.runtimeKey]: "ready" }}
        selectedElementId={friend.elementId}
        onSelect={vi.fn()}
        onCommit={onCommit}
      />,
    );

    const xInput = screen.getByRole("spinbutton", { name: "좌우 X (m)" });
    expect((xInput as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(xInput, { target: { value: "2.75" } });
    fireEvent.blur(xInput);

    expect(onCommitMock).toHaveBeenLastCalledWith({
      elementId: friend.elementId,
      expectedRuntimeKey: friend.runtimeKey,
      expectedPlacementHash: friend.placementHash,
      transform: {
        position: [2.75, 0, 0],
        rotationY: 0,
      },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "미리보기에 반영",
    );
    expect(screen.getByText(/아래 적용을 누를 때/u)).toBeTruthy();

    const yawInput = screen.getByRole("spinbutton", { name: "바라보는 방향 (°)" });
    fireEvent.change(yawInput, { target: { value: "90" } });
    fireEvent.blur(yawInput);
    const yawRequest = onCommitMock.mock.calls.at(-1)?.[0];
    expect(yawRequest?.transform.rotationY).toBeCloseTo(Math.PI / 2, 10);
    expect(yawRequest?.transform.position).toEqual([0, 0, 0]);
  });

  it("switches linked characters and keeps every compact control touch-sized", () => {
    const characters = createCharacters();
    const onSelect = vi.fn();
    const onCommit = vi.fn(successResult) as StudioShared3dCharacterTransformCommitHandler;
    const { container } = render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={Object.fromEntries(characters.map(({ runtimeKey }) => [runtimeKey, "ready"]))}
        selectedElementId={characters[0]!.elementId}
        onSelect={onSelect}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /친구/u }));
    expect(onSelect).toHaveBeenCalledWith("friend-layer");
    expect(container.querySelectorAll(".min-h-11").length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText(/고급 상태 1개 때문에 미리보기 전용/u)).toBeTruthy();
  });

  it("does not show the previous character's placement notice after an external selection change", () => {
    const characters = createCharacters();
    const previewOnly = characters[0]!;
    const fullFidelity = characters[1]!;
    const props = {
      characters,
      statuses: Object.fromEntries(characters.map(({ runtimeKey }) => [runtimeKey, "ready" as const])),
      onSelect: vi.fn(),
      onCommit: vi.fn(successResult) as StudioShared3dCharacterTransformCommitHandler,
    };
    const { rerender } = render(
      <StudioBg3dSharedCharacterPlacementPanel
        {...props}
        selectedElementId={fullFidelity.elementId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "배치 초기화" }));
    expect(screen.getByRole("status").textContent).toContain("미리보기에 반영");

    rerender(
      <StudioBg3dSharedCharacterPlacementPanel
        {...props}
        selectedElementId={previewOnly.elementId}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains floating feet and commits only the admitted background-surface Y", () => {
    const characters = createCharacters();
    const friend = characters[1]!;
    const onCommitMock = vi.fn(successResult);
    const grounding = resolveStudioBg3dSharedCharacterGrounding({
      identity: {
        ...(friend.stageId ? { stageId: friend.stageId } : {}),
        elementId: friend.elementId,
        modelRuntimeKey: friend.modelRuntimeKey,
        placementHash: friend.placementHash,
      },
      placementY: friend.stageTransform.position[1],
      anchors: [{ kind: "left-foot", point: [0, 0.5, 0] }],
      surfaceHit: {
        source: "background-surface",
        targetEntityId: "room-floor",
        point: [0, 0, 0],
        normal: [0, 1, 0],
      },
    });

    render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [friend.runtimeKey]: "ready" }}
        selectedElementId={friend.elementId}
        grounding={grounding}
        onSelect={vi.fn()}
        onCommit={onCommitMock}
      />,
    );

    expect(screen.getByText("바닥에서 떠 있음")).toBeTruthy();
    expect(screen.getByText(/50cm 떠 있어요/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "배경 표면에 맞추기" }));
    expect(onCommitMock).toHaveBeenLastCalledWith({
      elementId: friend.elementId,
      expectedRuntimeKey: friend.runtimeKey,
      expectedPlacementHash: friend.placementHash,
      transform: {
        position: [0, -0.5, 0],
        rotationY: 0,
      },
    });
  });

  it("fails closed with a visible stale-source message and cancels Escape without commit", () => {
    const characters = createCharacters();
    const friend = characters[1]!;
    const onCommit = vi.fn(() => ({
      ok: false as const,
      code: "stale-source" as const,
      message: "캐릭터 원본이 바뀌어 현재 배치를 다시 확인해 주세요.",
    })) as StudioShared3dCharacterTransformCommitHandler;

    render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [friend.runtimeKey]: "ready" }}
        selectedElementId={friend.elementId}
        onSelect={vi.fn()}
        onCommit={onCommit}
      />,
    );

    const zInput = screen.getByRole("spinbutton", { name: "앞뒤 Z (m)" });
    fireEvent.change(zInput, { target: { value: "9" } });
    fireEvent.keyDown(zInput, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect((zInput as HTMLInputElement).value).toBe("0");

    fireEvent.change(zInput, { target: { value: "3" } });
    fireEvent.blur(zInput);
    expect(screen.getByRole("alert").textContent).toContain("원본이 바뀌어");
    expect((zInput as HTMLInputElement).value).toBe("0");
  });

  it("disables editing when the runtime is unavailable or the parent is transient", () => {
    const characters = createCharacters();
    const friend = characters[1]!;
    const { rerender } = render(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [friend.runtimeKey]: "unavailable" }}
        selectedElementId={friend.elementId}
        onSelect={vi.fn()}
        onCommit={vi.fn(successResult)}
      />,
    );

    for (const input of screen.getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText("모델 확인 필요")).toBeTruthy();

    rerender(
      <StudioBg3dSharedCharacterPlacementPanel
        characters={characters}
        statuses={{ [friend.runtimeKey]: "ready" }}
        selectedElementId={friend.elementId}
        disabled
        onSelect={vi.fn()}
        onCommit={vi.fn(successResult)}
      />,
    );
    expect((screen.getByRole("button", { name: /친구/u }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "배치 초기화" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
