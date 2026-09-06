// @vitest-environment jsdom

/**
 * Hybrid DCC UI domain wiring — drives real panel handlers with real kernels.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioUnitCubeMesh } from "../studio-editable-half-edge-mesh";
import { disposeStudioOcctWorker } from "../studio-occt-worker-client";

import { StudioHybridDccPanel } from "./StudioHybridDccPanel";

import type {
  StudioOcctWorkerRequest,
  StudioOcctWorkerResponse,
} from "../studio-occt-worker-protocol";

/**
 * Deterministic browser transport for this UI integration gate. The dedicated
 * worker-client tests own timeout/crash/malformed-payload behavior; this test
 * keeps the real panel → workspace → worker-client → protocol boundary without
 * downloading or executing the 65 MiB OCCT runtime in jsdom.
 */
class FakePanelOcctWorker extends EventTarget {
  static operations: StudioOcctWorkerRequest["operation"][] = [];

  postMessage(request: StudioOcctWorkerRequest): void {
    FakePanelOcctWorker.operations.push(request.operation);
    queueMicrotask(() => {
      const isBox = request.operation.kind === "box";
      const response: StudioOcctWorkerResponse = {
        id: request.id,
        result: {
          ok: true,
          bodyKind: "solid",
          mesh: createStudioUnitCubeMesh(),
          faceCount: 6,
          triangleCount: 12,
          vertexCount: 8,
          volumeApprox: isBox ? 1 : 7,
          topology: {
            source: "tessellated-triangle-mesh",
            boundaryEdgeCount: 0,
            nonManifoldEdgeCount: 0,
            orientationConflictEdgeCount: 0,
            degenerateTriangleCount: 0,
            consistentOrientation: true,
            watertight: true,
            closedSolid: true,
            signedVolume: 1,
          },
          massProperties: {
            source: "occt-brep",
            density: 1,
            densityUnit: "mass/model-unit^3",
            mass: 1,
            volume: 1,
            volumeSource: "occt-brep",
            surfaceArea: 6,
            surfaceAreaSource: "occt-brep",
            centroid: { x: 0, y: 0, z: 0 },
            centroidSource: "occt-brep",
            inertia: { xx: 1, yy: 1, zz: 1, xy: 0, xz: 0, yz: 0 },
            inertiaSource: "occt-brep",
            approximate: false,
          },
          backend: "opencascade-wasm",
          operation: isBox ? "BRepPrimAPI_MakeBox" : "BRepAlgoAPI_Cut",
          loadPath: "browser",
        },
      };
      this.dispatchEvent(new MessageEvent("message", { data: response }));
    });
  }

  terminate(): void {
    // The real client owns lifecycle; no OS resource exists in this test double.
  }
}

function useFakeBrowserOcctWorker(): void {
  vi.stubGlobal("Worker", FakePanelOcctWorker);
}

afterEach(() => {
  cleanup();
  disposeStudioOcctWorker();
  vi.unstubAllGlobals();
  FakePanelOcctWorker.operations = [];
});

describe("StudioHybridDccPanel industrial wiring", () => {
  it("exposes the durable receipt sequence and matching document hash without relying on a transient saving badge", () => {
    render(
      <StudioHybridDccPanel
        persistenceStatus="saved"
        persistenceReceipt={{
          sequence: 7,
          sourceHash: `sha256:${"a".repeat(64)}`,
          documentStateHash: "state-hash-7",
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("data-studio-hybrid-dcc-persistence")).toBe("saved");
    expect(status.getAttribute("data-studio-hybrid-dcc-persistence-sequence")).toBe("7");
    expect(status.getAttribute("data-studio-hybrid-dcc-persistence-source-hash"))
      .toBe(`sha256:${"a".repeat(64)}`);
    expect(status.getAttribute("data-studio-hybrid-dcc-persistence-document-state-hash"))
      .toBe("state-hash-7");
    expect(document.querySelector('[data-studio-hybrid-dcc-state-hash]')).not.toBeNull();
  });

  it("uses the route-owned workbench mode without duplicating mode authority", () => {
    const onWorkbenchModeChange = vi.fn();
    const view = render(
      <StudioHybridDccPanel
        onWorkbenchModeChange={onWorkbenchModeChange}
        workbenchMode="cad"
      />,
    );

    expect(screen.getByText("치수가 정확한 솔리드 제작")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "컷과 비사실 렌더 작업 모드" }));
    expect(onWorkbenchModeChange).toHaveBeenCalledWith("shot");
    expect(screen.getByText("치수가 정확한 솔리드 제작")).toBeTruthy();

    view.rerender(
      <StudioHybridDccPanel
        onWorkbenchModeChange={onWorkbenchModeChange}
        workbenchMode="shot"
      />,
    );
    expect(screen.getByText("카메라 컷과 웹툰용 선화 전달")).toBeTruthy();
  });

  it("guides beginners by work mode and commits numeric transforms as document authority", async () => {
    const onWorkspaceChange = vi.fn();
    render(<StudioHybridDccPanel onWorkspaceChange={onWorkspaceChange} />);

    expect(screen.getByText("오브젝트 만들기와 형태 편집")).toBeTruthy();
    expect(screen.getByRole("button", { name: "마지막 3D 편집 되돌리기" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /면 밀어내기/u })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /큐브 추가/u }));
    await waitFor(() => expect(screen.getByLabelText("위치 X")).toBeTruthy());

    const positionX = screen.getByLabelText("위치 X");
    fireEvent.change(positionX, { target: { value: "2.5" } });
    fireEvent.blur(positionX);
    await waitFor(() => {
      const latest = onWorkspaceChange.mock.calls.at(-1)?.[0] as {
        session?: { state?: { objectTransforms?: Record<string, { position: readonly number[] }> } };
      } | undefined;
      expect(latest?.session?.state?.objectTransforms?.["asset-cube"]?.position)
        .toEqual([2.5, 0, 0]);
    });

    fireEvent.click(screen.getByRole("button", { name: "마지막 3D 편집 되돌리기" }));
    await waitFor(() => {
      const latest = onWorkspaceChange.mock.calls.at(-1)?.[0] as {
        session?: { state?: { objectTransforms?: Record<string, { position: readonly number[] }> } };
      } | undefined;
      expect(latest?.session?.state?.objectTransforms?.["asset-cube"]?.position)
        .toEqual([0, 0, 0]);
    });
    fireEvent.click(screen.getByRole("button", { name: "되돌린 3D 편집 다시 실행" }));
    await waitFor(() => {
      const latest = onWorkspaceChange.mock.calls.at(-1)?.[0] as {
        session?: { state?: { objectTransforms?: Record<string, { position: readonly number[] }> } };
      } | undefined;
      expect(latest?.session?.state?.objectTransforms?.["asset-cube"]?.position)
        .toEqual([2.5, 0, 0]);
    });

    fireEvent.click(screen.getByRole("button", { name: "조형 작업 모드" }));
    expect(screen.getByText("조형 실험실 · voxel-lite")).toBeTruthy();
    expect(screen.getByRole("button", { name: /브러시 조형 · 부풀리기/u })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "부풀리기" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: "스네이크 훅" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /복셀 리메시/u })).toBeTruthy();
  });

  it("requires an explicit face in component mode while keeping object-mode quick start", async () => {
    const onWorkspaceChange = vi.fn();
    render(<StudioHybridDccPanel onWorkspaceChange={onWorkspaceChange} />);

    fireEvent.click(screen.getByRole("button", { name: /큐브 추가/u }));
    await waitFor(() => expect(screen.getByText("오브젝트 편집")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "면 선택 모드 (3)" }));
    expect(screen.getByText("면 0개 선택")).toBeTruthy();
    expect(screen.queryByLabelText("위치 X")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /면 밀어내기/u }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent)
        .toMatch(/선택한 면이 없습니다/u);
      const latest = onWorkspaceChange.mock.calls.at(-1)?.[0] as {
        activeAssetId?: string | null;
        session?: { state?: { geometry?: { records?: Record<string, { mesh: { faces: readonly unknown[] } }> } } };
      } | undefined;
      const active = latest?.activeAssetId;
      expect(active).toBe("asset-cube");
      expect(latest?.session?.state?.geometry?.records?.[active!]?.mesh.faces.length)
        .toBe(6);
    });

    fireEvent.click(screen.getByRole("button", { name: "오브젝트 선택 모드 (4)" }));
    fireEvent.click(screen.getByRole("button", { name: /면 밀어내기/u }));
    await waitFor(() => {
      const latest = onWorkspaceChange.mock.calls.at(-1)?.[0] as {
        activeAssetId?: string | null;
        session?: { state?: { geometry?: { records?: Record<string, { mesh: { faces: readonly unknown[] } }> } } };
      } | undefined;
      const active = latest?.activeAssetId;
      expect(latest?.session?.state?.geometry?.records?.[active!]?.mesh.faces.length)
        .toBeGreaterThan(6);
    });
    expect(screen.getByRole("button", { name: "마지막 3D 편집 되돌리기" }))
      .toHaveProperty("disabled", false);
  });

  it("Add cube mutates assets and log via real workspace kernel", async () => {
    render(<StudioHybridDccPanel />);
    expect(screen.getByLabelText("전문 3D 제작 작업 공간")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add cube" }));
    await waitFor(() => {
      const log = document.querySelector("[data-studio-hybrid-dcc-log]");
      expect(log?.textContent).toMatch(/Add cube 완료/u);
      expect(log?.textContent).toMatch(/오브젝트 1개/u);
    });
    const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
    expect(stats?.getAttribute("data-assets")).toBe("1");
  });

  it("OCCT box button invokes WASM CAD and updates stats", async () => {
    useFakeBrowserOcctWorker();
    render(<StudioHybridDccPanel />);
    fireEvent.click(screen.getByRole("button", { name: "OCCT box" }));
    await waitFor(
      () => {
        const log = document.querySelector("[data-studio-hybrid-dcc-log]");
        expect(log?.textContent).toMatch(/OCCT box 완료/u);
        const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
        expect(Number(stats?.getAttribute("data-occt-tris") ?? 0)).toBeGreaterThan(0);
        expect(stats?.getAttribute("data-occt-op")).toBe("BRepPrimAPI_MakeBox");
      },
      { timeout: 5_000 },
    );
    expect(FakePanelOcctWorker.operations).toEqual([
      { kind: "box", size: [1, 1, 1] },
    ]);
  });

  it("cube → dynatopo → retopo multi-domain path updates DOM state", async () => {
    render(<StudioHybridDccPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Add cube" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /Add cube 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Dynatopo" }));
    await waitFor(() => {
      const log = document.querySelector("[data-studio-hybrid-dcc-log]");
      expect(log?.textContent).toMatch(/Dynatopo 완료/u);
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(Number(stats?.getAttribute("data-dynatopo-faces") ?? 0)).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retopo" }));
    await waitFor(() => {
      const log = document.querySelector("[data-studio-hybrid-dcc-log]");
      expect(log?.textContent).toMatch(/Retopo 완료/u);
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(Number(stats?.getAttribute("data-retopo-faces") ?? 0)).toBeGreaterThan(0);
    });
  });

  it("CAD revolve, sculpt, cloth, shots, artist ink cover remaining domains", async () => {
    render(<StudioHybridDccPanel />);
    fireEvent.click(screen.getByRole("button", { name: "CAD revolve" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /CAD revolve 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Sculpt · voxel-lite 실험/u }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /Sculpt 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "천 시뮬레이션 1스텝" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /천 시뮬레이션 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "8 shots" }));
    await waitFor(() => {
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(stats?.getAttribute("data-shots")).toBe("8");
    });
    fireEvent.click(screen.getByRole("button", { name: "Artist ink" }));
    await waitFor(() => {
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(Number(stats?.getAttribute("data-ink") ?? 0)).toBeGreaterThan(0);
    });
  });

  it("build/document domains: room, BOM, collab, UV, boolean, export toon3d", async () => {
    useFakeBrowserOcctWorker();
    render(<StudioHybridDccPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Room" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /Room 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "BOM" }));
    await waitFor(() => {
      const log = document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent ?? "";
      expect(log).toMatch(/BOM 완료/u);
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(Number(stats?.getAttribute("data-bom") ?? 0)).toBeGreaterThanOrEqual(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Collab" }));
    await waitFor(() => {
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(Number(stats?.getAttribute("data-collab") ?? 0)).toBeGreaterThan(0);
    });
    // Need active mesh for UV/boolean
    fireEvent.click(screen.getByRole("button", { name: "Add cube" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /Add cube 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "UV unwrap" }));
    await waitFor(() => {
      const log = document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent ?? "";
      expect(log).toMatch(/UV 완료/u);
      const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
      expect(stats?.getAttribute("data-uv")).not.toBe("");
    });
    fireEvent.click(screen.getByRole("button", { name: "Subdiv" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /Subdiv 완료/u,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Export .toon3d" }));
    await waitFor(() => {
      expect(document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent).toMatch(
        /\.toon3d packed|hash=/u,
      );
    });
    // Industrial OCCT boolean (not Manifold pure path) on dedicated asset
    fireEvent.click(screen.getByRole("button", { name: "OCCT boolean" }));
    await waitFor(
      () => {
        const log = document.querySelector("[data-studio-hybrid-dcc-log]")?.textContent ?? "";
        expect(log).toMatch(/OCCT cut 완료/u);
        const stats = document.querySelector("[data-studio-hybrid-dcc-stats]");
        expect(Number(stats?.getAttribute("data-occt-tris") ?? 0)).toBeGreaterThan(0);
        expect(stats?.getAttribute("data-occt-op")).toBe("BRepAlgoAPI_Cut");
      },
      { timeout: 5_000 },
    );
    expect(FakePanelOcctWorker.operations.at(-1)?.kind).toBe("cut-boxes");
  });
});
