// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { workspaceAddActiveModifier } from "./studio-hybrid-dcc-modifier-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
} from "./studio-hybrid-dcc-workspace";
import { StudioHybridDccPanel } from "./StudioHybridDccPanel";

import type { StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";

function activeGeometryRecord(workspace: StudioHybridDccWorkspace) {
  const assetId = workspace.activeAssetId;
  if (!assetId) throw new Error("활성 3D 오브젝트가 없습니다.");
  const record = workspace.session.state.geometry.records[assetId];
  if (!record) throw new Error(`활성 오브젝트 ${assetId}의 권위 메시가 없습니다.`);
  return record;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-modifier-integration-host]").forEach((node) => {
    node.remove();
  });
});

describe("StudioHybridDccPanel modifier inspector integration", () => {
  it("restores a cold modifier preview through StrictMode effect replay", async () => {
    let initialWorkspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("strict-preview-restore"),
      "strict-cube",
    );
    initialWorkspace = await workspaceAddActiveModifier(initialWorkspace, "mirror");
    const initialRecord = activeGeometryRecord(initialWorkspace);
    initialWorkspace = {
      ...initialWorkspace,
      session: {
        ...initialWorkspace.session,
        state: {
          ...initialWorkspace.session.state,
          geometry: {
            ...initialWorkspace.session.state.geometry,
            records: {
              ...initialWorkspace.session.state.geometry.records,
              [initialRecord.assetId]: { ...initialRecord, renderCache: null },
            },
          },
        },
      },
    };
    expect(activeGeometryRecord(initialWorkspace).renderCache).toBeNull();

    let restoredWorkspace: StudioHybridDccWorkspace | null = null;
    render(
      <StrictMode>
        <StudioHybridDccPanel
          initialWorkspace={initialWorkspace}
          onWorkspaceChange={(workspace) => {
            restoredWorkspace = workspace;
          }}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(restoredWorkspace).not.toBeNull();
      expect(activeGeometryRecord(restoredWorkspace!).renderCache).not.toBeNull();
    });
  });

  it("adds and toggles a non-destructive X mirror while preserving the cube source mesh", async () => {
    let latestWorkspace: StudioHybridDccWorkspace | null = null;
    const currentWorkspace = (): StudioHybridDccWorkspace => {
      if (!latestWorkspace) throw new Error("패널이 아직 작업공간 변경을 내보내지 않았습니다.");
      return latestWorkspace;
    };
    const narrowHost = document.createElement("main");
    narrowHost.dataset.modifierIntegrationHost = "true";
    narrowHost.style.width = "320px";
    document.body.append(narrowHost);

    render(
      <StudioHybridDccPanel
        onWorkspaceChange={(workspace) => {
          latestWorkspace = workspace;
        }}
      />,
      { container: narrowHost },
    );

    expect(screen.queryByRole("region", { name: "비파괴 변형 스택" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /큐브 추가/u }));

    await waitFor(() => {
      expect(currentWorkspace().activeAssetId).toBe("asset-cube");
      expect(screen.getByRole("region", { name: "비파괴 변형 스택" })).toBeTruthy();
    });

    const cubeRecord = activeGeometryRecord(currentWorkspace());
    const sourceMesh = cubeRecord.mesh;
    const sourceMeshHash = cubeRecord.meshHash;
    expect(cubeRecord.modifierStack.modifiers).toHaveLength(0);
    expect(cubeRecord.modifierStack.source).toBe(sourceMesh);

    const kindSelect = screen.getByRole("combobox", { name: "추가할 변형 종류" });
    expect((kindSelect as HTMLSelectElement).value).toBe("mirror");
    fireEvent.click(screen.getByRole("button", { name: "변형 추가" }));

    await waitFor(() => {
      const record = activeGeometryRecord(currentWorkspace());
      expect(record.modifierStack.modifiers).toHaveLength(1);
      expect(screen.getByRole("switch", {
        name: "1단계 대칭 복사",
      }).getAttribute("aria-checked")).toBe("true");
    });

    const mirroredRecord = activeGeometryRecord(currentWorkspace());
    expect(mirroredRecord.modifierStack.modifiers[0]).toMatchObject({
      kind: "mirror",
      axis: "x",
      enabled: true,
    });
    expect(mirroredRecord.mesh).toBe(sourceMesh);
    expect(mirroredRecord.meshHash).toBe(sourceMeshHash);
    expect(mirroredRecord.modifierStack.source).toBe(sourceMesh);
    expect(mirroredRecord.renderCache).not.toBeNull();

    const inspector = screen.getByRole("region", { name: "비파괴 변형 스택" });
    const addLayout = kindSelect.parentElement?.parentElement;
    const applyButton = screen.getByRole("button", { name: "적용해 원본 메시로 확정" });
    expect(screen.getByText(/적용하기 전에는 원본 메시를 바꾸지 않습니다/u)).toBeTruthy();
    expect(screen.getByText("확정 전 원본 보존")).toBeTruthy();
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    expect(applyButton.getAttribute("aria-describedby")).toBeTruthy();
    expect(narrowHost.style.width).toBe("320px");
    expect(inspector.className).toContain("min-w-0");
    expect(inspector.className).toContain("max-w-full");
    expect(inspector.className).toContain("overflow-hidden");
    expect(addLayout?.className).toContain("grid-cols-1");
    expect(addLayout?.className).toContain("min-[360px]:grid-cols-[minmax(0,1fr)_auto]");

    fireEvent.click(screen.getByRole("switch", {
      name: "1단계 대칭 복사",
    }));

    await waitFor(() => {
      const record = activeGeometryRecord(currentWorkspace());
      expect(record.modifierStack.modifiers[0]?.enabled).toBe(false);
      expect(screen.getByRole("switch", {
        name: "1단계 대칭 복사",
      }).getAttribute("aria-checked")).toBe("false");
    });

    const toggledRecord = activeGeometryRecord(currentWorkspace());
    expect(toggledRecord.mesh).toBe(sourceMesh);
    expect(toggledRecord.meshHash).toBe(sourceMeshHash);
    expect(toggledRecord.modifierStack.source).toBe(sourceMesh);
    expect(screen.getByRole("button", { name: "적용해 원본 메시로 확정" })).toBeTruthy();
  });
});
