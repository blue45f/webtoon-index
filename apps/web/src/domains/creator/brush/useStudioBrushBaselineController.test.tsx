// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import * as brushBaselineContract from "./studio-brush-baseline-contract";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  studioCoreBrushCatalogSelection,
  type StudioBrushCatalogSelection,
} from "./studio-brush-selection";
import {
  useStudioBrushBaselineController,
  type StudioBrushBaselineControllerRuntime,
} from "./useStudioBrushBaselineController";

import type {
  StudioBrushDefaultRestoreDirection,
  StudioBrushDefaultRestoreTransaction,
} from "./studio-brush-default-restore";

function snapshot(
  overrides: Partial<StudioBrushSnapshot> = {},
): StudioBrushSnapshot {
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    ...overrides,
  };
}

function selection(id: string): StudioBrushCatalogSelection {
  const preset = BRUSH_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Missing test brush preset: ${id}`);
  return studioCoreBrushCatalogSelection(preset);
}

function savedBrush(
  overrides: Partial<StudioSavedBrush> = {},
): StudioSavedBrush {
  return {
    ...snapshot(),
    id: "saved-pen",
    name: "내 펜",
    createdAt: 10,
    updatedAt: 20,
    pinned: false,
    lastUsedAt: null,
    ...overrides,
  };
}

function resolvedRuntime(): StudioBrushBaselineControllerRuntime {
  return {
    loadContract: vi.fn(async () => brushBaselineContract),
  };
}

interface HookProps {
  readonly currentSnapshot: StudioBrushSnapshot;
  readonly savedBrushes: readonly StudioSavedBrush[];
  readonly preserveStrokeWidth: boolean;
  readonly preserveBrushOpacity: boolean;
}

function renderController({
  initialProps,
  runtime = resolvedRuntime(),
  materializeCatalogSelection = vi.fn(async (catalogId: string) => {
    const preset = BRUSH_PRESETS.find((candidate) => candidate.id === catalogId);
    return preset ? studioCoreBrushCatalogSelection(preset) : null;
  }),
}: {
  initialProps: HookProps;
  runtime?: StudioBrushBaselineControllerRuntime;
  materializeCatalogSelection?: (
    catalogId: string,
  ) => Promise<StudioBrushCatalogSelection | null>;
}) {
  const applyRestoreTransaction = vi.fn<
    (
      transaction: StudioBrushDefaultRestoreTransaction,
      direction: StudioBrushDefaultRestoreDirection,
    ) => void
  >();
  const announce = vi.fn<(message: string) => void>();
  const hook = renderHook(
    (props: HookProps) =>
      useStudioBrushBaselineController(
        {
          ...props,
          fallbackSourceName: "현재 브러시",
          materializeCatalogSelection,
          applyRestoreTransaction,
          announce,
        },
        runtime,
      ),
    { initialProps },
  );
  return {
    ...hook,
    announce,
    applyRestoreTransaction,
    materializeCatalogSelection,
    runtime,
  };
}

async function waitForReady(
  result: ReturnType<typeof renderController>["result"],
): Promise<void> {
  await waitFor(() => {
    expect(result.current.restoreState.loading).toBe(false);
    expect(result.current.restoreState.available).toBe(true);
  });
}

describe("useStudioBrushBaselineController", () => {
  it("keeps the optional contract behind one literal dynamic import", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "apps/web/src/domains/creator/brush/useStudioBrushBaselineController.ts",
      ),
      "utf8",
    );

    expect(
      source.match(
        /return import\("\.\/studio-brush-baseline-contract"\);/gu,
      ),
    ).toHaveLength(1);
    expect(source).not.toMatch(
      /import(?!\s+type)\s+[^;]+from "\.\/studio-brush-baseline-contract";/gu,
    );
    expect(source).not.toMatch(/\buse(?:Memo|Callback)\b/u);
  });

  it("loads the initial pen baseline and keeps color outside modified state", async () => {
    const initialProps: HookProps = {
      currentSnapshot: snapshot(),
      savedBrushes: [],
      preserveStrokeWidth: false,
      preserveBrushOpacity: false,
    };
    const { result, rerender } = renderController({ initialProps });

    await waitForReady(result);
    expect(result.current.restoreState).toMatchObject({
      sourceName: "매끈한 펜",
      modifiedCount: 0,
      undoAvailable: false,
    });

    rerender({
      ...initialProps,
      currentSnapshot: snapshot({ color: "#123456" }),
    });

    await waitFor(() => {
      expect(result.current.restoreState.modifiedCount).toBe(0);
      expect(result.current.restoreState.available).toBe(true);
    });
  });

  it("drops a late catalogue selection and keeps the newest baseline", async () => {
    const pending = new Map<
      string,
      {
        readonly promise: Promise<StudioBrushCatalogSelection | null>;
        readonly resolve: (
          value: StudioBrushCatalogSelection | null,
        ) => void;
      }
    >();
    const materializeCatalogSelection = vi.fn((catalogId: string) => {
      if (catalogId === "pen") {
        return Promise.resolve(selection("pen"));
      }
      let resolve!: (
        value: StudioBrushCatalogSelection | null,
      ) => void;
      const promise = new Promise<StudioBrushCatalogSelection | null>(
        (accept) => {
          resolve = accept;
        },
      );
      pending.set(catalogId, { promise, resolve });
      return promise;
    });
    const initialProps: HookProps = {
      currentSnapshot: snapshot(),
      savedBrushes: [],
      preserveStrokeWidth: false,
      preserveBrushOpacity: false,
    };
    const { result, rerender } = renderController({
      initialProps,
      materializeCatalogSelection,
    });
    await waitForReady(result);

    act(() => {
      result.current.selectCatalog("marker");
      result.current.selectCatalog("pencil");
    });
    await act(async () => {
      pending.get("pencil")?.resolve(selection("pencil"));
      await pending.get("pencil")?.promise;
    });
    rerender({
      ...initialProps,
      currentSnapshot: snapshot({
        brushId: "pencil",
        strokeWidth: selection("pencil").defaultWidth,
        brushOpacity: selection("pencil").defaultOpacity,
        brushDynamics:
          selection("pencil").brushDynamics
          ?? DEFAULT_STUDIO_BRUSH_SNAPSHOT.brushDynamics,
      }),
    });
    await waitFor(() => {
      expect(result.current.restoreState.sourceName).toBe("연필");
      expect(result.current.restoreState.available).toBe(true);
    });

    await act(async () => {
      pending.get("marker")?.resolve(selection("marker"));
      await pending.get("marker")?.promise;
    });
    expect(result.current.restoreState.sourceName).toBe("연필");
  });

  it("preserves locked size and opacity while restoring the remaining fields", async () => {
    const initialProps: HookProps = {
      currentSnapshot: snapshot({
        strokeWidth: 31,
        brushOpacity: 0.32,
        stabilizer: 4,
      }),
      savedBrushes: [],
      preserveStrokeWidth: true,
      preserveBrushOpacity: true,
    };
    const { result, applyRestoreTransaction } = renderController({
      initialProps,
    });
    await waitFor(() => {
      expect(result.current.restoreState.loading).toBe(false);
      expect(result.current.restoreState.modifiedCount).toBe(1);
    });

    await act(async () => {
      await result.current.restoreDefaults();
    });

    expect(applyRestoreTransaction).toHaveBeenCalledTimes(1);
    const [transaction, direction] =
      applyRestoreTransaction.mock.calls[0] ?? [];
    expect(direction).toBe("redo");
    expect(transaction?.changes.map(({ field }) => field)).toEqual([
      "stabilizer",
    ]);
    expect(transaction?.after.strokeWidth).toBe(31);
    expect(transaction?.after.brushOpacity).toBe(0.32);
  });

  it("offers one undo after restore and reuses the exact original transaction", async () => {
    const modified = snapshot({
      strokeWidth: 27,
      stabilizer: 3,
      color: "#654321",
    });
    const initialProps: HookProps = {
      currentSnapshot: modified,
      savedBrushes: [],
      preserveStrokeWidth: false,
      preserveBrushOpacity: false,
    };
    const {
      result,
      rerender,
      applyRestoreTransaction,
    } = renderController({ initialProps });
    await waitFor(() => {
      expect(result.current.restoreState.modifiedCount).toBeGreaterThan(0);
    });

    await act(async () => {
      await result.current.restoreDefaults();
    });
    const restoredTransaction = applyRestoreTransaction.mock.calls[0]?.[0];
    expect(restoredTransaction).toBeDefined();
    expect(applyRestoreTransaction.mock.calls[0]?.[1]).toBe("redo");

    rerender({
      ...initialProps,
      currentSnapshot: {
        ...modified,
        ...restoredTransaction?.after,
      },
    });
    await waitFor(() => {
      expect(result.current.restoreState.undoAvailable).toBe(true);
    });

    await act(async () => {
      await result.current.restoreDefaults();
    });

    expect(applyRestoreTransaction).toHaveBeenCalledTimes(2);
    expect(applyRestoreTransaction.mock.calls[1]).toEqual([
      restoredTransaction,
      "undo",
    ]);
    await waitFor(() => {
      expect(result.current.restoreState.undoAvailable).toBe(false);
    });
  });

  it("freshly revalidates a rendered undo and cancels it after a concurrent edit", async () => {
    let delayNextContract = false;
    let resolveDelayedContract!: (
      value: typeof brushBaselineContract,
    ) => void;
    const delayedContract = new Promise<typeof brushBaselineContract>(
      (resolve) => {
        resolveDelayedContract = resolve;
      },
    );
    const runtime: StudioBrushBaselineControllerRuntime = {
      loadContract: vi.fn(() => {
        if (!delayNextContract) {
          return Promise.resolve(brushBaselineContract);
        }
        delayNextContract = false;
        return delayedContract;
      }),
    };
    const modified = snapshot({ strokeWidth: 18 });
    const initialProps: HookProps = {
      currentSnapshot: modified,
      savedBrushes: [],
      preserveStrokeWidth: false,
      preserveBrushOpacity: false,
    };
    const {
      result,
      rerender,
      applyRestoreTransaction,
      announce,
    } = renderController({ initialProps, runtime });
    await waitFor(() => {
      expect(result.current.restoreState.modifiedCount).toBeGreaterThan(0);
    });
    await act(async () => {
      await result.current.restoreDefaults();
    });
    const transaction = applyRestoreTransaction.mock.calls[0]?.[0];
    rerender({
      ...initialProps,
      currentSnapshot: {
        ...modified,
        ...transaction?.after,
      },
    });
    await waitFor(() => {
      expect(result.current.restoreState.undoAvailable).toBe(true);
    });

    delayNextContract = true;
    let pendingRestore!: Promise<void>;
    act(() => {
      pendingRestore = result.current.restoreDefaults();
    });
    rerender({
      ...initialProps,
      currentSnapshot: {
        ...modified,
        ...transaction?.after,
        stabilizer: 6,
      },
    });
    await act(async () => {
      resolveDelayedContract(brushBaselineContract);
      await pendingRestore;
    });

    expect(applyRestoreTransaction).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(
      "브러시 설정이 바뀌어 이전 복원 되돌리기를 취소했어요.",
    );
    expect(result.current.restoreState.undoAvailable).toBe(false);
  });

  it("invalidates a saved baseline when its library source disappears", async () => {
    const saved = savedBrush();
    const initialProps: HookProps = {
      currentSnapshot: snapshot(),
      savedBrushes: [saved],
      preserveStrokeWidth: false,
      preserveBrushOpacity: false,
    };
    const { result, rerender } = renderController({ initialProps });
    await waitForReady(result);

    act(() => {
      result.current.select({ kind: "saved", brush: saved });
    });
    await waitFor(() => {
      expect(result.current.activeSavedBrushId).toBe(saved.id);
      expect(result.current.restoreState.sourceName).toBe(saved.name);
    });

    rerender({
      ...initialProps,
      savedBrushes: [],
    });
    await waitFor(() => {
      expect(result.current.activeSavedBrushId).toBeNull();
      expect(result.current.restoreState.available).toBe(false);
    });
  });
});
