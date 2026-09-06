// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import { createStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

import { StudioBg3dSharedStagePanel } from "./StudioBg3dSharedStagePanel";

import type { StudioBg3dSharedStagePanelProps } from "./StudioBg3dSharedStagePanel";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

afterEach(cleanup);

function createResolution(
  phase: StudioShared3dStageResolution["phase"],
): StudioShared3dStageResolution {
  const linked = phase === "unlinked" ? [] : ["hero-layer"];
  const missing = phase === "partial" ? ["missing-layer"] : [];
  return {
    phase,
    backgroundBundleId: phase === "unlinked" ? null : "background-bundle",
    backgroundElementId: phase === "unlinked" ? null : "background-layer",
    linkedCharacterElementIds: linked,
    updatedCharacterElementIds: phase === "live-update" ? linked : [],
    missingCharacterElementIds: missing,
    replacedCharacterElementIds: [],
    message: phase === "unlinked"
      ? "아직 이 배경과 캐릭터 원본이 연결되지 않았어요."
      : `persisted ${phase}`,
  };
}

function createProps(
  overrides: Partial<StudioBg3dSharedStagePanelProps> = {},
): StudioBg3dSharedStagePanelProps {
  const characters = createStudioShared3dSceneSession([{
    elementId: "hero-layer",
    label: "주인공",
    scene: createStudioVrmSceneDocument(),
  }]).characters;
  return {
    resolution: createResolution("unlinked"),
    characters,
    statuses: { [characters[0]!.runtimeKey]: "ready" },
    selectedElementId: characters[0]!.elementId,
    selectedGrounding: undefined,
    captureElementCount: 1,
    charactersLinkedToOtherBackgroundCount: 0,
    targetHasLinkedCharacters: false,
    targetHasSavedSharedScene: false,
    includeCharactersInCapture: true,
    mutationKind: "connect",
    materializationKind: "editable-lt-bundle",
    captureDisabled: false,
    placementDisabled: false,
    onSelectMutation: vi.fn(),
    onSetMutation: vi.fn(),
    onSetMaterialization: vi.fn(),
    onSelectCharacter: vi.fn(),
    onCommitCharacterTransform: vi.fn(),
    ...overrides,
  };
}

describe("StudioBg3dSharedStagePanel", () => {
  it("shows an unsaved connection draft instead of claiming either unlinked or connected", () => {
    const onSelectMutation = vi.fn();
    render(<StudioBg3dSharedStagePanel {...createProps({ onSelectMutation })} />);

    const relationshipStatus = screen.getByRole("status");
    expect(within(relationshipStatus).getByText("연결 예정")).toBeTruthy();
    expect(relationshipStatus.textContent).toContain("아래 적용을 누르기 전에는 저장되지 않아요");
    expect(within(relationshipStatus).queryByText("연결 안 됨")).toBeNull();
    expect(within(relationshipStatus).queryByText("연결됨")).toBeNull();

    const connectButton = screen.getByRole("button", { name: "이 배경에 캐릭터 연결" });
    const backgroundOnlyButton = screen.getByRole("button", { name: "배경만 추가" });
    expect(connectButton.getAttribute("aria-pressed")).toBe("true");
    expect(backgroundOnlyButton.getAttribute("aria-pressed")).toBe("false");
    expect((connectButton as HTMLButtonElement).disabled).toBe(false);
    expect((backgroundOnlyButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(connectButton);
    fireEvent.click(backgroundOnlyButton);
    expect(onSelectMutation.mock.calls).toEqual([["connect"], ["background-only"]]);
  });

  it("labels a background-only draft and keeps it explicitly pending until apply", () => {
    render(
      <StudioBg3dSharedStagePanel
        {...createProps({
          mutationKind: "background-only",
          includeCharactersInCapture: false,
          captureElementCount: 0,
        })}
      />,
    );

    const relationshipStatus = screen.getByRole("status");
    expect(within(relationshipStatus).getByText("배경만 추가 예정")).toBeTruthy();
    expect(relationshipStatus.textContent).toContain("아래 적용을 누르기 전에는 저장되지 않아요");
    expect(within(relationshipStatus).queryByText("배경만 연결됨")).toBeNull();
    expect(screen.getByRole("button", { name: "배경만 추가" }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("reports renderer preparation, runtime failure, and scene processing as distinct waits", () => {
    const base = createProps();
    const character = base.characters[0]!;
    const view = render(
      <StudioBg3dSharedStagePanel
        {...base}
        statuses={{ [character.runtimeKey]: "loading" }}
        captureElementCount={0}
      />,
    );

    expect(screen.getByText("캐릭터 준비 중")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("캐릭터 렌더 0/1명 준비됨");

    view.rerender(
      <StudioBg3dSharedStagePanel
        {...base}
        statuses={{ [character.runtimeKey]: "unavailable" }}
        captureElementCount={0}
      />,
    );
    expect(screen.getByText("캐릭터 확인 필요")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("렌더 인스턴스를 준비하지 못했어요");

    view.rerender(
      <StudioBg3dSharedStagePanel
        {...base}
        captureDisabled
      />,
    );
    expect(screen.getByText("장면 처리 중")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("캡처하거나 원본을 복원하는 중");
    const relationshipControls = screen.getByRole("group", {
      name: "이 배경의 공유 3D 장면 적용 방식",
    });
    expect(within(relationshipControls).getAllByRole("button").every((button) => (
      button as HTMLButtonElement
    ).disabled)).toBe(true);
  });

  it("keeps connection disabled without a candidate while background-only stays actionable", () => {
    const onSelectMutation = vi.fn();
    render(
      <StudioBg3dSharedStagePanel
        {...createProps({
          characters: [],
          statuses: {},
          selectedElementId: null,
          captureElementCount: 0,
          onSelectMutation,
        })}
      />,
    );

    const connectButton = screen.getByRole("button", { name: "이 배경에 캐릭터 연결" });
    const backgroundOnlyButton = screen.getByRole("button", { name: "배경만 추가" });
    expect((connectButton as HTMLButtonElement).disabled).toBe(true);
    expect((backgroundOnlyButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("연결 안 됨")).toBeTruthy();

    fireEvent.click(connectButton);
    fireEvent.click(backgroundOnlyButton);
    expect(onSelectMutation).toHaveBeenCalledTimes(1);
    expect(onSelectMutation).toHaveBeenCalledWith("background-only");
  });

  it.each([
    ["ready", "연결됨", "status"],
    ["live-update", "원본 변경됨", "status"],
    ["partial", "연결 확인 필요", "alert"],
  ] as const)(
    "preserves the persisted %s relationship state as %s",
    (phase, expectedLabel, expectedRole) => {
      render(
        <StudioBg3dSharedStagePanel
          {...createProps({
            resolution: createResolution(phase),
            characters: [],
            statuses: {},
            selectedElementId: null,
            captureElementCount: 0,
            targetHasLinkedCharacters: true,
            targetHasSavedSharedScene: true,
            includeCharactersInCapture: false,
            mutationKind: phase === "partial" ? "relink" : "refresh",
          })}
        />,
      );

      const relationshipState = screen.getByRole(expectedRole);
      expect(within(relationshipState).getByText(expectedLabel)).toBeTruthy();
      expect(relationshipState.textContent).toContain(`persisted ${phase}`);
    },
  );
});
