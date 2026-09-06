import { useRef, type ChangeEvent } from "react";

import type {
  StudioProjectArchiveOrchestrationInput,
} from "./studio-project-archive-orchestration-runtime";

export interface StudioProjectArchiveOrchestration {
  readonly handleExportProject: () => Promise<void>;
  readonly handleExportProjectArchive: () => Promise<void>;
  readonly handleImportProject: (
    event: ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  readonly handleImportProjectArchive: (
    event: ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

type StudioProjectArchiveRuntimeModule = Pick<
  typeof import("./studio-page-orchestration-runtime"),
  "createStudioProjectArchiveOrchestration"
>;

export interface StudioProjectArchiveIntentState {
  readonly current: {
    busy: boolean;
    epoch: number;
  };
}

function loadStudioPageOrchestrationRuntime(): Promise<StudioProjectArchiveRuntimeModule> {
  return import("./studio-page-orchestration-runtime");
}

export function createStudioProjectArchiveIntentController(
  input: StudioProjectArchiveOrchestrationInput,
  operationStateRef: StudioProjectArchiveIntentState,
  loadRuntime: () => Promise<StudioProjectArchiveRuntimeModule> =
    loadStudioPageOrchestrationRuntime,
): StudioProjectArchiveOrchestration {
  const load = async () => {
    const { createStudioProjectArchiveOrchestration } = await loadRuntime();
    return createStudioProjectArchiveOrchestration(input);
  };
  const runExclusive = async (
    operation: (isCurrent: () => boolean) => Promise<void>,
  ): Promise<void> => {
    const state = operationStateRef.current;
    if (state.busy || input.projectArchiveBusy) {
      input.setError("다른 프로젝트 센터이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    state.busy = true;
    state.epoch += 1;
    const operationEpoch = state.epoch;
    const isCurrent = () =>
      state.busy && state.epoch === operationEpoch;
    try {
      await operation(isCurrent);
    } finally {
      if (state.epoch === operationEpoch) {
        state.busy = false;
      }
    }
  };

  return {
    handleExportProject: async () => {
      try {
        await runExclusive(async (isCurrent) => {
          const orchestration = await load();
          if (!isCurrent()) return;
          await orchestration.handleExportProject();
        });
      } catch (error) {
        input.setError(
          error instanceof Error ? error.message : "프로젝트 내보내기 도구를 불러오지 못했어요.",
        );
      }
    },
    handleExportProjectArchive: async () => {
      try {
        await runExclusive(async (isCurrent) => {
          input.setProjectArchiveBusy(true);
          input.setProjectArchiveStatus(null);
          try {
            const orchestration = await load();
            if (!isCurrent()) return;
            await orchestration.handleExportProjectArchive();
          } finally {
            input.setProjectArchiveBusy(false);
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "프로젝트 archive 도구를 불러오지 못했어요.";
        input.setProjectArchiveStatus({ tone: "bad", text: message });
        input.setError(message);
      }
    },
    handleImportProject: async (event) => {
      const file = event.currentTarget.files?.[0] ?? null;
      event.currentTarget.value = "";
      if (!file) return;
      const mutationTicket = input.captureStudioMutationTicket();
      try {
        await runExclusive(async (isCurrent) => {
          input.setProjectArchiveBusy(true);
          input.setProjectArchiveStatus(null);
          try {
            const orchestration = await load();
            if (!isCurrent()) return;
            await orchestration.handleImportProject(file, mutationTicket);
          } finally {
            input.setProjectArchiveBusy(false);
          }
        });
      } catch (error) {
        globalThis.alert(
          error instanceof Error ? error.message : "프로젝트 불러오기 도구를 불러오지 못했어요.",
        );
      }
    },
    handleImportProjectArchive: async (event) => {
      const file = event.currentTarget.files?.[0] ?? null;
      event.currentTarget.value = "";
      if (!file) return;
      const mutationTicket = input.captureStudioMutationTicket();
      try {
        await runExclusive(async (isCurrent) => {
          input.setProjectArchiveBusy(true);
          input.setProjectArchiveStatus(null);
          try {
            const orchestration = await load();
            if (!isCurrent()) return;
            await orchestration.handleImportProjectArchive(file, mutationTicket);
          } finally {
            input.setProjectArchiveBusy(false);
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "프로젝트 archive 도구를 불러오지 못했어요.";
        input.setProjectArchiveStatus({ tone: "bad", text: message });
        input.setError(message);
      }
    },
  };
}

/**
 * File capture stays synchronous, while canonical parsing, ZIP verification and 3D asset
 * restoration are fetched only after the artist explicitly chooses a project action.
 */
export function useStudioProjectArchiveOrchestration(
  input: StudioProjectArchiveOrchestrationInput,
): StudioProjectArchiveOrchestration {
  const operationStateRef = useRef({ busy: false, epoch: 0 });
  return createStudioProjectArchiveIntentController(input, operationStateRef);
}
