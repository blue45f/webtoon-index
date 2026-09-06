/**
 * Studio VRM 모델 로딩·라이브러리 파일 처리.
 * `StudioVrmPoser.tsx`에서 그대로 옮겨온 요청 중재/설치 오케스트레이션이다(동작 동일).
 * 설치 자체(`installVrm`)와 요청 카운터/상태는 포저가 계속 소유하고, 여기에는 컨텍스트로
 * 주입된다 — 리프(studio-vrm-asset-runtime)는 여전히 React·영속·objectURL 을 모른다.
 */
import { disposeStudioVrmAsset as disposeVrm, loadStudioVrmAsset as loadVrmAsset } from "./studio-vrm-asset-runtime";
import { getErrorMessage, getVrmLoadErrorMessage } from "./studio-vrm-poser-helpers";
import {
  createUploadedVrmRecord,
  deleteStoredVrmModel,
  durableVrmLibraryEntry,
  ensureStoredVrmContentIdentity,
  getStoredVrmModel,
  isBundledVrmRightsBlocked,
  memoryVrmLibraryEntry,
  queryUploadedVrmLibraryEntriesPage,
  SAMPLE_VRM_ENTRIES,
  SAMPLE_VRM_ID,
  saveUploadedVrm,
  selectableSampleVrmUrl,
  type VrmLibraryEntry,
  type VrmStoredModelWithContentIdentity,
} from "./vrm-library";

import type { VRM } from "@pixiv/three-vrm";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";

/** `useRef` 결과를 그대로 받되 React 타입 버전에 묶이지 않는 구조적 별칭. */
type MutableRef<T> = { current: T };

export type StudioVrmModelLoadingContext = {
  activeModelId: string;
  activeModelIdRef: MutableRef<string>;
  broadcastPreviewActive: boolean;
  clearCurrentVrm: () => void;
  installVrm: (nextVrm: VRM, nextModelName: string, nextModelId: string) => void;
  libraryEntries: VrmLibraryEntry[];
  loadRequestRef: MutableRef<number>;
  memoryVrmModelsRef: MutableRef<Map<string, VrmStoredModelWithContentIdentity>>;
  modelLoadTargetIdRef: MutableRef<string | null>;
  rememberCharacterSelection: (modelId: string) => void;
  resetFullStateHistory: () => void;
  setActiveModelId: Dispatch<SetStateAction<string>>;
  setDeletingModelId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsUploading: Dispatch<SetStateAction<boolean>>;
  setLibraryEntries: Dispatch<SetStateAction<VrmLibraryEntry[]>>;
  setLibraryError: Dispatch<SetStateAction<string>>;
  setLibraryNextCursor: Dispatch<SetStateAction<string | null>>;
  setLibraryStatus: Dispatch<SetStateAction<"loading" | "ready" | "error">>;
  setStatus: Dispatch<SetStateAction<"empty" | "loading" | "ready" | "error">>;
  thumbnailRequestRef: MutableRef<number>;
};

export type StudioVrmModelLoading = {
  handleDeleteEntry: (entry: VrmLibraryEntry) => Promise<void>;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleGeneratedVrmFile: (file: File) => Promise<void>;
  handleSampleLoad: () => void;
  loadModelFromLibraryEntry: (entry: VrmLibraryEntry) => void;
};

export function useStudioVrmModelLoading({
  activeModelId,
  activeModelIdRef,
  broadcastPreviewActive,
  clearCurrentVrm,
  installVrm,
  libraryEntries,
  loadRequestRef,
  memoryVrmModelsRef,
  modelLoadTargetIdRef,
  rememberCharacterSelection,
  resetFullStateHistory,
  setActiveModelId,
  setDeletingModelId,
  setError,
  setIsUploading,
  setLibraryEntries,
  setLibraryError,
  setLibraryNextCursor,
  setLibraryStatus,
  setStatus,
  thumbnailRequestRef,
}: StudioVrmModelLoadingContext): StudioVrmModelLoading {
  function beginModelLoad(nextModelId: string) {
    resetFullStateHistory();
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    thumbnailRequestRef.current += 1;
    setActiveModelId(nextModelId);
    setStatus("loading");
    setError("");
    clearCurrentVrm();
    modelLoadTargetIdRef.current = nextModelId;
    return requestId;
  }

  function handleLoadFailure(requestId: number, caughtError: unknown) {
    if (requestId !== loadRequestRef.current) return;
    modelLoadTargetIdRef.current = null;
    setError(getVrmLoadErrorMessage(caughtError));
    setStatus("error");
  }

  function loadModelFromUrl(url: string, nextModelName: string, revokeUrl: boolean, nextModelId = SAMPLE_VRM_ID) {
    const requestId = beginModelLoad(nextModelId);

    loadVrmAsset(url)
      .then((loadedVrm) => {
        if (requestId !== loadRequestRef.current) {
          disposeVrm(loadedVrm);
          return;
        }
        try {
          installVrm(loadedVrm, nextModelName, nextModelId);
        } catch (installError: unknown) {
          handleLoadFailure(requestId, installError);
        }
      })
      .catch((caughtError: unknown) => {
        handleLoadFailure(requestId, caughtError);
      })
      .finally(() => {
        if (revokeUrl) {
          URL.revokeObjectURL(url);
        }
      });
  }

  function loadModelFromLibraryEntry(entry: VrmLibraryEntry) {
    if (entry.source === "sample") {
      const sampleUrl = selectableSampleVrmUrl(entry.id);
      if (!sampleUrl) {
        const requestId = beginModelLoad(entry.id);
        handleLoadFailure(
          requestId,
          new Error(
            isBundledVrmRightsBlocked(entry.id)
              ? "이 번들 VRM은 재배포·상업 이용 권리가 확인되지 않아 불러올 수 없습니다."
              : "등록되지 않은 번들 VRM은 불러올 수 없습니다.",
          ),
        );
        return;
      }
      rememberCharacterSelection(entry.id);
      loadModelFromUrl(sampleUrl, entry.name, false, entry.id);
      return;
    }

    rememberCharacterSelection(entry.id);
    const requestId = beginModelLoad(entry.id);

    void (async () => {
      try {
        const storedModel = entry.source === "memory"
          ? memoryVrmModelsRef.current.get(entry.id) ?? null
          : await getStoredVrmModel(entry.id);
        if (requestId !== loadRequestRef.current) return;
        if (!storedModel) {
          throw new Error("저장된 VRM 파일을 찾지 못했습니다.");
        }

        const objectUrl = URL.createObjectURL(storedModel.blob);
        try {
          const loadedVrm = await loadVrmAsset(objectUrl);
          if (requestId !== loadRequestRef.current) {
            disposeVrm(loadedVrm);
            return;
          }
          installVrm(loadedVrm, storedModel.name, storedModel.id);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (caughtError: unknown) {
        handleLoadFailure(requestId, caughtError);
      }
    })();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (broadcastPreviewActive) {
      event.currentTarget.value = "";
      return;
    }
    const files = Array.from(event.currentTarget.files ?? []).filter((file) => /\.vrm$/i.test(file.name));
    event.currentTarget.value = "";
    if (files.length === 0) return;

    setIsUploading(true);
    setLibraryError("");

    try {
      const savedModels: VrmStoredModelWithContentIdentity[] = [];
      let memoryOnly = false;
      for (const file of files) {
        const validated = await ensureStoredVrmContentIdentity(createUploadedVrmRecord(file));
        try {
          const saved = await saveUploadedVrm(file);
          savedModels.push(saved as VrmStoredModelWithContentIdentity);
        } catch {
          memoryOnly = true;
          memoryVrmModelsRef.current.set(validated.id, validated);
          savedModels.push(validated);
        }
      }
      let firstPage: Awaited<ReturnType<typeof queryUploadedVrmLibraryEntriesPage>> = null;
      let refreshSucceeded = false;
      let refreshFailure: unknown;
      try {
        firstPage = await queryUploadedVrmLibraryEntriesPage();
        refreshSucceeded = true;
      } catch (caughtError: unknown) {
        refreshFailure = caughtError;
      }
      const durableEntries = refreshSucceeded
        ? [...SAMPLE_VRM_ENTRIES, ...(firstPage?.items ?? [])]
        : [...libraryEntries];
      const memoryEntries = [...memoryVrmModelsRef.current.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(memoryVrmLibraryEntry);
      const savedEntries = savedModels.map((record) => (
        memoryVrmModelsRef.current.has(record.id)
          ? memoryVrmLibraryEntry(record)
          : durableVrmLibraryEntry(record)
      ));
      const nextEntries = [...durableEntries];
      const retainedActive = libraryEntries.find(
        (entry) => entry.id === activeModelIdRef.current,
      );
      for (const entry of [
        ...(retainedActive ? [retainedActive] : []),
        ...savedEntries,
        ...memoryEntries,
      ]) {
        if (nextEntries.some((candidate) => (
          candidate.id === entry.id ||
          (candidate.contentHash && candidate.contentHash === entry.contentHash)
        ))) continue;
        nextEntries.push(entry);
      }
      setLibraryEntries(nextEntries);
      if (refreshSucceeded) {
        setLibraryNextCursor(firstPage?.nextCursor ?? null);
      }
      setLibraryStatus(memoryOnly || !refreshSucceeded ? "error" : "ready");
      if (memoryOnly) {
        setLibraryError(
          refreshSucceeded
            ? "SQLite/OPFS 저장에 실패해 선택한 VRM을 현재 탭 메모리에만 유지합니다. 새로고침하면 사라지며 프로젝트 삽입은 durable 저장 전까지 차단됩니다."
            : "일부 VRM은 현재 탭 메모리에만 유지되며, 저장된 라이브러리 새로고침에도 실패했습니다. 현재 목록과 페이지 위치를 보존했습니다. 다시 불러오기를 시도해 주세요.",
        );
      } else if (!refreshSucceeded) {
        setLibraryError(getErrorMessage(
          refreshFailure,
          "VRM 저장은 완료했지만 라이브러리 새로고침에 실패했습니다. 현재 목록과 페이지 위치를 보존했습니다.",
        ));
      }

      const firstUploadedEntry = nextEntries.find((entry) => entry.id === savedModels[0]?.id);
      if (firstUploadedEntry) {
        loadModelFromLibraryEntry(firstUploadedEntry);
      }
    } catch (caughtError: unknown) {
      setLibraryStatus("error");
      setLibraryError(getErrorMessage(caughtError, "VRM 파일을 라이브러리에 저장하지 못했습니다."));
    } finally {
      setIsUploading(false);
    }
  }

  function handleSampleLoad() {
    if (broadcastPreviewActive) return;
    loadModelFromLibraryEntry(SAMPLE_VRM_ENTRIES[0]);
  }

  async function handleGeneratedVrmFile(file: File) {
    setIsUploading(true);
    setLibraryError("");
    try {
      const validated = await ensureStoredVrmContentIdentity(createUploadedVrmRecord(file));
      let saved: VrmStoredModelWithContentIdentity;
      try {
        saved = await saveUploadedVrm(file) as VrmStoredModelWithContentIdentity;
      } catch {
        memoryVrmModelsRef.current.set(validated.id, validated);
        saved = validated;
      }
      const entry = memoryVrmModelsRef.current.has(saved.id)
        ? memoryVrmLibraryEntry(saved)
        : durableVrmLibraryEntry(saved);
      setLibraryEntries((current) => [
        entry,
        ...current.filter((candidate) => candidate.id !== entry.id),
      ]);
      loadModelFromLibraryEntry(entry);
    } catch (caughtError: unknown) {
      setLibraryStatus("error");
      setLibraryError(getErrorMessage(caughtError, "생성한 VRM을 라이브러리에 넣지 못했습니다."));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteEntry(entry: VrmLibraryEntry) {
    if (broadcastPreviewActive) return;
    if (entry.source === "sample") return;

    setDeletingModelId(entry.id);
    setLibraryError("");

    try {
      if (entry.source === "memory") memoryVrmModelsRef.current.delete(entry.id);
      else await deleteStoredVrmModel(entry.id);
      let firstPage: Awaited<ReturnType<typeof queryUploadedVrmLibraryEntriesPage>> = null;
      let refreshSucceeded = false;
      let refreshFailure: unknown;
      try {
        firstPage = await queryUploadedVrmLibraryEntriesPage();
        refreshSucceeded = true;
      } catch (caughtError: unknown) {
        refreshFailure = caughtError;
      }
      const durableEntries = refreshSucceeded
        ? [...SAMPLE_VRM_ENTRIES, ...(firstPage?.items ?? [])]
        : libraryEntries.filter((candidate) => candidate.id !== entry.id);
      const nextEntries = [...durableEntries];
      const retainedActive = libraryEntries.find((candidate) => (
        candidate.id === activeModelIdRef.current && candidate.id !== entry.id
      ));
      const memoryEntries = [...memoryVrmModelsRef.current.values()].map(
        memoryVrmLibraryEntry,
      );
      for (const candidate of [
        ...(retainedActive ? [retainedActive] : []),
        ...memoryEntries,
      ]) {
        if (nextEntries.some((current) => (
          current.id === candidate.id ||
          (current.contentHash && current.contentHash === candidate.contentHash)
        ))) continue;
        nextEntries.push(candidate);
      }
      setLibraryEntries(nextEntries);
      if (refreshSucceeded) {
        setLibraryNextCursor(firstPage?.nextCursor ?? null);
        setLibraryStatus("ready");
      } else {
        setLibraryStatus("error");
        setLibraryError(getErrorMessage(
          refreshFailure,
          "VRM 삭제는 완료했지만 라이브러리 새로고침에 실패했습니다. 삭제 항목만 제거하고 현재 목록과 페이지 위치를 보존했습니다.",
        ));
      }
      if (activeModelId === entry.id) {
        loadModelFromLibraryEntry(SAMPLE_VRM_ENTRIES[0]);
      }
    } catch (caughtError: unknown) {
      setLibraryStatus("error");
      setLibraryError(getErrorMessage(caughtError, "VRM을 삭제하지 못했습니다."));
    } finally {
      setDeletingModelId(null);
    }
  }

  return {
    handleDeleteEntry,
    handleFileChange,
    handleGeneratedVrmFile,
    handleSampleLoad,
    loadModelFromLibraryEntry,
  };
}
