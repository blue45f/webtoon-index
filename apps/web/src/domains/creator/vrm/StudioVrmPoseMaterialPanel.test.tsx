// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetStudioDestructiveActionLedger,
  setStudioDestructiveConfirmPresenter,
  type StudioDestructiveActionRequest,
} from "../studio-destructive-action-preview";
import {
  parseStudioPoseMaterial,
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  type StudioPoseMaterial,
} from "../studio-pose-material";
import {
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
  STUDIO_POSE_MATERIAL_LIBRARY_KIND,
  STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
  STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
  type StudioPoseMaterialStorage,
} from "../studio-pose-material-library";

import { StudioVrmPoseMaterialPanel } from "./StudioVrmPoseMaterialPanel";


import type { StudioPoseScope } from "../studio-humanoid-bones";
import type {
  StudioVrmPoseMaterialApplyResult,
  StudioVrmPoseMaterialCaptureOptions,
} from "./studio-vrm-pose-material-adapter";
import type { StudioVrmPoseMaterialSqliteRepository } from "./studio-vrm-pose-material-sqlite-repository";

class MemoryStorage implements StudioPoseMaterialStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function materialFromCapture(options: StudioVrmPoseMaterialCaptureOptions) {
  const bone = options.scope === "gaze-jaw" ? "jaw" : options.scope === "lower" ? "hips" : "head";
  return parseStudioPoseMaterial({
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
    id: options.id,
    name: options.name,
    scope: options.scope,
    bones: [{ bone, rotation: [0, 0, 0, 1] }],
    metadata: { description: "", tags: [] },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetStudioDestructiveActionLedger();
});

describe("StudioVrmPoseMaterialPanel", () => {
  it("saves a strict normalized pose material and applies it with a scoped result announcement", () => {
    const storage = new MemoryStorage();
    const onCapture = vi.fn(materialFromCapture);
    const onApply = vi.fn((
      material: StudioPoseMaterial,
      scope: StudioPoseScope,
      _strength?: number,
    ): StudioVrmPoseMaterialApplyResult => ({
      materialId: material.id,
      requestedScope: scope,
      bones: { head: { rotation: [0, 0, 0] } },
      fingerEdits: {},
      appliedBones: ["head"],
      skippedLocked: ["neck"],
      skippedOutsideScope: [],
      skippedMissing: ["jaw"],
    }));

    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={1}
        storage={storage}
        onCapture={onCapture}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByLabelText("포즈 소재 이름"), {
      target: { value: "  검을 든   상체  " },
    });
    fireEvent.change(screen.getByLabelText("저장할 포즈 범위"), {
      target: { value: "upper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }));

    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture.mock.calls[0]?.[0]).toMatchObject({ name: "검을 든 상체", scope: "upper" });
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toContain("검을 든 상체");
    expect(screen.getByText("검을 든 상체")).toBeTruthy();
    expect(screen.getByText(/현재 잠금 본 1개/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[1]).toBe("upper");
    expect(onApply.mock.calls[0]?.[2]).toBe(1);
    expect(screen.getByText(/1개 본 적용 · 잠금 1개 유지 · 모델 미지원 1개 건너뜀/)).toBeTruthy();
  });

  it("forwards the 적용 강도 slider value into onApply", () => {
    const storage = new MemoryStorage();
    const material = materialFromCapture({
      id: "pose-strength",
      name: "Strength pose",
      scope: "full",
    })!;
    storage.setItem(
      STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
        version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
        materials: [material],
      }),
    );
    const onApply = vi.fn((
      applied: StudioPoseMaterial,
      scope: StudioPoseScope,
      _strength?: number,
    ): StudioVrmPoseMaterialApplyResult => ({
      materialId: applied.id,
      requestedScope: scope,
      bones: {},
      fingerEdits: {},
      appliedBones: ["head"],
      skippedLocked: [],
      skippedOutsideScope: [],
      skippedMissing: [],
    }));

    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={storage}
        onCapture={vi.fn()}
        onApply={onApply}
      />,
    );

    const slider = screen.getByLabelText("적용 강도");
    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[2]).toBeCloseTo(0.4);
  });

  it("keeps corrupt and future storage read-only instead of silently replacing it", () => {
    const corrupt = new MemoryStorage();
    corrupt.values.set(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY, "{not-json");
    const first = render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={corrupt}
        onCapture={vi.fn(materialFromCapture)}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/손상된 포즈 소재 저장소/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(corrupt.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toBe("{not-json");

    first.unmount();
    const future = new MemoryStorage();
    future.values.set(
      STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
        version: 99,
        materials: [],
      }),
    );
    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={future}
        onCapture={vi.fn(materialFromCapture)}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/더 최신 버전의 포즈 소재 저장소/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "JSON 병합" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes only after confirmation and preserves the already-applied character provenance callback", async () => {
    const storage = new MemoryStorage();
    const onMaterialDeleted = vi.fn();
    // 승인은 구조화된 요청을 거친다 — 무엇이 사라지는지 요청 자체가 말해야 한다.
    const approvals: StudioDestructiveActionRequest[] = [];
    setStudioDestructiveConfirmPresenter((request) => {
      approvals.push(request);
      return true;
    });
    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={storage}
        onCapture={materialFromCapture}
        onApply={vi.fn()}
        onMaterialDeleted={onMaterialDeleted}
      />,
    );
    fireEvent.change(screen.getByLabelText("포즈 소재 이름"), { target: { value: "삭제 테스트" } });
    fireEvent.click(screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제 테스트 포즈 소재 삭제" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "studio.pose-material.delete",
      // 브라우저 저장소 레코드 삭제 — 히스토리를 지나지 않으므로 ⌘Z 로 돌아오지 않는다.
      reversibility: "irreversible",
    });
    expect(onMaterialDeleted).toHaveBeenCalledOnce();
    expect(screen.queryByText("삭제 테스트")).toBeNull();
    expect(screen.getByText(/이미 적용된 캐릭터 자세는 유지/)).toBeTruthy();
  });

  it("imports only a strict library envelope in merge mode and exports canonical JSON", async () => {
    const storage = new MemoryStorage();
    const importedMaterial = materialFromCapture({
      id: "imported-pose",
      name: "가져온 포즈",
      scope: "full",
    });
    if (!importedMaterial) throw new Error("invalid imported test material");
    const importedJson = JSON.stringify({
      kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
      version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
      materials: [importedMaterial],
    });
    const createObjectURL = vi.fn(() => "blob:pose-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const view = render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={storage}
        onCapture={materialFromCapture}
        onApply={vi.fn()}
      />,
    );
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("missing file input");
    fireEvent.change(fileInput, {
      target: {
        files: [{ size: new TextEncoder().encode(importedJson).byteLength, text: async () => importedJson }],
      },
    });

    await waitFor(() => expect(screen.getByText("가져온 포즈")).toBeTruthy());
    expect(storage.values.get(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY)).toContain("imported-pose");
    fireEvent.click(screen.getByRole("button", { name: "JSON 내보내기" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pose-export");
    expect(screen.getByText(/canonical JSON으로 내보냈습니다/)).toBeTruthy();
  });

  it("resets a stale apply scope and invalidates provenance when import replaces the same id", async () => {
    const storage = new MemoryStorage();
    const original = parseStudioPoseMaterial({
      kind: STUDIO_POSE_MATERIAL_KIND,
      version: STUDIO_POSE_MATERIAL_VERSION,
      rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
      id: "replace-pose",
      name: "전신 원본",
      scope: "full",
      bones: [
        { bone: "head", rotation: [0, 0, 0, 1] },
        { bone: "hips", rotation: [0, 0, 0, 1] },
      ],
      metadata: { description: "", tags: [] },
    });
    const replacement = parseStudioPoseMaterial({
      kind: STUDIO_POSE_MATERIAL_KIND,
      version: STUDIO_POSE_MATERIAL_VERSION,
      rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
      id: "replace-pose",
      name: "교체된 상체",
      scope: "upper",
      bones: [{ bone: "head", rotation: [0, 0.1, 0, 0.994987] }],
      metadata: { description: "", tags: [] },
    });
    if (!original || !replacement) throw new Error("invalid replacement test material");
    storage.values.set(
      STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
        version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
        materials: [original],
      }),
    );
    const onMaterialReplaced = vi.fn();
    const onApply = vi.fn((material, scope) => ({
      materialId: material.id,
      requestedScope: scope,
      bones: { head: { rotation: [0, 0, 0] } },
      fingerEdits: {},
      appliedBones: ["head"],
      skippedLocked: [],
      skippedOutsideScope: [],
      skippedMissing: [],
    } as const));
    const view = render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId="replace-pose"
        lockedBoneCount={0}
        storage={storage}
        onCapture={materialFromCapture}
        onApply={onApply}
        onMaterialReplaced={onMaterialReplaced}
      />,
    );

    const scopeSelect = screen.getByLabelText("적용 범위") as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: "lower" } });
    expect(scopeSelect.value).toBe("lower");

    const importedJson = JSON.stringify({
      kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
      version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
      materials: [replacement],
    });
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("missing file input");
    fireEvent.change(fileInput, {
      target: {
        files: [{ size: new TextEncoder().encode(importedJson).byteLength, text: async () => importedJson }],
      },
    });

    await waitFor(() => expect(screen.getByText("교체된 상체")).toBeTruthy());
    expect(onMaterialReplaced).toHaveBeenCalledOnce();
    expect(onMaterialReplaced).toHaveBeenCalledWith("replace-pose");
    expect((screen.getByLabelText("적용 범위") as HTMLSelectElement).value).toBe("upper");
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(replacement, "upper", 1);
  });

  it("uses touch-sized action controls and disables runtime mutation during live operations", () => {
    render(
      <StudioVrmPoseMaterialPanel
        disabled
        activeMaterialId={null}
        lockedBoneCount={0}
        storage={new MemoryStorage()}
        onCapture={vi.fn(materialFromCapture)}
        onApply={vi.fn()}
      />,
    );

    const save = screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.className).toContain("min-h-11");
    expect(screen.getByText(/실시간 추적·애니메이션·캡처·관절 드래그/)).toBeTruthy();
  });

  it("hydrates from the async product repository and keeps a failed durable save explicitly in memory", async () => {
    const repository: StudioVrmPoseMaterialSqliteRepository = {
      authority: "sqlite",
      load: vi.fn(async () => EMPTY_STUDIO_POSE_MATERIAL_LIBRARY),
      save: vi.fn(async () => {
        throw new Error("quota denied");
      }),
    };
    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        repository={repository}
        onCapture={materialFromCapture}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect((screen.getByLabelText("포즈 소재 이름") as HTMLInputElement).disabled)
      .toBe(false));
    fireEvent.change(screen.getByLabelText("포즈 소재 이름"), {
      target: { value: "메모리 복구 소재" },
    });
    fireEvent.click(screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }));

    await waitFor(() => expect(screen.getByText("메모리 복구 소재")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/현재 탭 메모리 임시 · 새로고침 시 사라짐/))
      .toBeTruthy());
    expect(repository.save).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").getAttribute("data-studio-vrm-pose-material-authority"))
      .toBe("memory");
  });

  it("serializes rapid product saves and prevents a late first write from winning", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const repository: StudioVrmPoseMaterialSqliteRepository = {
      authority: "sqlite",
      load: vi.fn(async () => EMPTY_STUDIO_POSE_MATERIAL_LIBRARY),
      save: vi.fn(async (payload) => {
        if (++calls === 1) await firstGate;
        return payload;
      }),
    };
    render(
      <StudioVrmPoseMaterialPanel
        disabled={false}
        activeMaterialId={null}
        lockedBoneCount={0}
        repository={repository}
        onCapture={materialFromCapture}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() => expect((screen.getByLabelText("포즈 소재 이름") as HTMLInputElement).disabled)
      .toBe(false));

    fireEvent.change(screen.getByLabelText("포즈 소재 이름"), { target: { value: "첫 소재" } });
    fireEvent.click(screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }));
    fireEvent.change(screen.getByLabelText("포즈 소재 이름"), { target: { value: "마지막 소재" } });
    fireEvent.click(screen.getByRole("button", { name: "현재 자세를 범용 소재로 저장" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    releaseFirst();
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(2));
    const finalPayload = vi.mocked(repository.save).mock.calls[1]?.[0];
    expect(new Set(finalPayload?.materials.map((entry) => entry.name)))
      .toEqual(new Set(["첫 소재", "마지막 소재"]));
  });
});
