import { describe, expect, it, vi } from "vitest";

import {
  createStudioProjectArchiveIntentController,
  type StudioProjectArchiveIntentState,
} from "./useStudioProjectArchiveOrchestration";
import {
  createStudioRasterExportIntentController,
  type StudioRasterExportIntentLock,
} from "./useStudioRasterExportOrchestration";

import type { StudioRasterExportOrchestration } from "./render/studio-raster-export-orchestration-runtime";
import type { StudioProjectArchiveOrchestration } from "./studio-project-archive-orchestration-runtime";
import type { ChangeEvent } from "react";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function projectFileEvent(file: File): ChangeEvent<HTMLInputElement> {
  return {
    currentTarget: {
      files: [file],
      value: "selected",
    },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

describe("StudioPage intent-loaded operation locks", () => {
  it("holds one raster lock across deferred loading and rejects a different export command", async () => {
    const setError = vi.fn();
    const lock: StudioRasterExportIntentLock = { current: false };
    const runtimeDeferred = deferred<{
      createStudioRasterExportOrchestration: () => StudioRasterExportOrchestration;
    }>();
    const handleDownload = vi.fn(async () => undefined);
    const handleCopyToClipboard = vi.fn(async () => undefined);
    const runtime: StudioRasterExportOrchestration = {
      handleDownload,
      exportCurrentPageToRasterInterchange: vi.fn(async () => {
        throw new Error("not used");
      }),
      handleCopyToClipboard,
      handleDownloadAll: vi.fn(async () => undefined),
      handleCapturePagesForPreset: vi.fn(async () => []),
      handleCapturePagesForIndices: vi.fn(async () => []),
    };
    const loadRuntime = vi.fn(() => runtimeDeferred.promise);
    const controller = createStudioRasterExportIntentController(
      { setError } as unknown as Parameters<
        typeof createStudioRasterExportIntentController
      >[0],
      lock,
      loadRuntime,
    );

    const first = controller.handleDownload();
    expect(lock.current).toBe(true);
    expect(loadRuntime).toHaveBeenCalledTimes(1);

    await controller.handleCopyToClipboard();
    expect(setError).toHaveBeenLastCalledWith(
      "다른 내보내기 작업이 끝난 뒤 다시 시도해 주세요.",
    );
    expect(handleCopyToClipboard).not.toHaveBeenCalled();
    expect(loadRuntime).toHaveBeenCalledTimes(1);

    runtimeDeferred.resolve({
      createStudioRasterExportOrchestration: () => runtime,
    });
    await first;
    expect(handleDownload).toHaveBeenCalledTimes(1);
    expect(lock.current).toBe(false);

    await controller.handleCopyToClipboard();
    expect(handleCopyToClipboard).toHaveBeenCalledTimes(1);
  });

  it("captures both JSON files but keeps the first import exclusive until its async apply finishes", async () => {
    const setError = vi.fn();
    const setProjectArchiveBusy = vi.fn();
    const setProjectArchiveStatus = vi.fn();
    const firstTicket = { request: 1 };
    const secondTicket = { request: 2 };
    const captureStudioMutationTicket = vi
      .fn()
      .mockReturnValueOnce(firstTicket)
      .mockReturnValueOnce(secondTicket)
      .mockReturnValueOnce(secondTicket);
    const state: StudioProjectArchiveIntentState = {
      current: { busy: false, epoch: 0 },
    };
    const runtimeDeferred = deferred<{
      createStudioProjectArchiveOrchestration: () => StudioProjectArchiveOrchestration;
    }>();
    const importApplyDeferred = deferred<void>();
    const handleImportProject = vi
      .fn()
      .mockImplementationOnce(() => importApplyDeferred.promise)
      .mockResolvedValueOnce(undefined);
    const runtime: StudioProjectArchiveOrchestration = {
      handleExportProject: vi.fn(async () => undefined),
      handleExportProjectArchive: vi.fn(async () => undefined),
      handleImportProject,
      handleImportProjectArchive: vi.fn(async () => undefined),
    };
    const loadRuntime = vi.fn(() => runtimeDeferred.promise);
    const controller = createStudioProjectArchiveIntentController(
      {
        projectArchiveBusy: false,
        captureStudioMutationTicket,
        setError,
        setProjectArchiveBusy,
        setProjectArchiveStatus,
      } as unknown as Parameters<
        typeof createStudioProjectArchiveIntentController
      >[0],
      state,
      loadRuntime,
    );
    const firstFile = { name: "first.json" } as File;
    const secondFile = { name: "second.json" } as File;
    const firstEvent = projectFileEvent(firstFile);
    const secondEvent = projectFileEvent(secondFile);

    const first = controller.handleImportProject(firstEvent);
    expect(firstEvent.currentTarget.value).toBe("");
    expect(state.current).toEqual({ busy: true, epoch: 1 });
    expect(loadRuntime).toHaveBeenCalledTimes(1);

    await controller.handleImportProject(secondEvent);
    expect(secondEvent.currentTarget.value).toBe("");
    expect(captureStudioMutationTicket).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenLastCalledWith(
      "다른 프로젝트 센터이 끝난 뒤 다시 시도해 주세요.",
    );
    expect(state.current).toEqual({ busy: true, epoch: 1 });
    expect(loadRuntime).toHaveBeenCalledTimes(1);

    runtimeDeferred.resolve({
      createStudioProjectArchiveOrchestration: () => runtime,
    });
    await vi.waitFor(() => {
      expect(handleImportProject).toHaveBeenCalledWith(firstFile, firstTicket);
    });
    expect(state.current.busy).toBe(true);

    importApplyDeferred.resolve();
    await first;
    expect(state.current).toEqual({ busy: false, epoch: 1 });

    const retryEvent = projectFileEvent(secondFile);
    await controller.handleImportProject(retryEvent);
    expect(handleImportProject).toHaveBeenLastCalledWith(secondFile, secondTicket);
    expect(state.current).toEqual({ busy: false, epoch: 2 });
  });
});
