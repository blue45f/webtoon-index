
import { createStudioAssetFavoriteId, type StudioAssetFavoriteId } from "../studio-asset-favorites";
import { loadStudioCanvasImageFile } from "../studio-legacy-editor-runtime-helpers";

import type { StudioAsset, StudioAssetWithContentHash } from "../studio-asset-library";
import type {
  ChangeEvent,
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

/**
 * 에셋 보관함 표면 상태 — StudioPage 의 `useState` 리터럴 유니온 그대로다. SQLite/OPFS 권위와
 * 현재 탭 메모리 폴백을 구분하는 값이라, 문자열을 넓히면 폴백 고지가 흐려진다.
 */
export type StudioAssetStorageState =
  | "idle"
  | "loading"
  | "sqlite-opfs"
  | "memory"
  | "unavailable";

/**
 * 커스텀 에셋 라이브러리 CRUD 배선 컨텍스트.
 *
 * 네 개의 세대·꼬리 ref(`assetHydrationGenerationRef` / `assetMemoryModeRef` /
 * `assetMutationGenerationRef` / `assetMutationTailRef`)는 값이 아니라 ref 로 주입한다 — 하이드레이션
 * 펜싱과 변이 직렬화가 렌더 사이에도 같은 셀을 읽어야 하기 때문이다. `setError` 는 StudioPage 에서
 * 이 배선보다 앞서 선언되므로 그대로 넘긴다(지연 클로저가 필요 없다).
 */
export interface StudioAssetLibraryMutationsContext {
  readonly assetHydrationGenerationRef: MutableRefObject<number>;
  readonly assetMemoryModeRef: MutableRefObject<boolean>;
  readonly assetMutationGenerationRef: MutableRefObject<number>;
  readonly assetMutationTailRef: MutableRefObject<Promise<void>>;
  readonly assetsRef: MutableRefObject<StudioAsset[]>;
  readonly editorMountedRef: MutableRefObject<boolean>;
  readonly removeAssetFavorite: (id: StudioAssetFavoriteId) => void;
  readonly replaceStudioAssets: (next: StudioAsset[]) => void;
  readonly setAssetStorageState: Dispatch<SetStateAction<StudioAssetStorageState>>;
  readonly setAssetsLoaded: Dispatch<SetStateAction<boolean>>;
  readonly setAssetsLoading: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
}

/** StudioPage 가 그대로 구조 분해해 쓰는 에셋 보관함 CRUD 표면. */
export interface StudioAssetLibraryMutations {
  readonly loadAssetsList: () => Promise<void>;
  readonly createValidatedMemoryAsset: (
    input: import("../studio-asset-library").StudioAssetSaveInput,
  ) => Promise<StudioAssetWithContentHash>;
  readonly canKeepAssetMutationInMemory: (cause: unknown) => Promise<boolean>;
  readonly enqueueAssetMutation: <T>(work: () => Promise<T>) => Promise<T>;
  readonly saveStudioAssetMutation: (
    input: import("../studio-asset-library").StudioAssetSaveInput,
  ) => Promise<StudioAssetWithContentHash>;
  readonly deleteStudioAssetMutation: (id: string) => Promise<void>;
  readonly renameStudioAssetMutation: (id: string, name: string) => Promise<void>;
  readonly onUploadAsset: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly onDeleteAsset: (id: string) => Promise<void>;
}

/**
 * 렌더마다 StudioPage 본문에서 호출되는 순수 팩토리(훅 아님). 함수 본문들은 StudioPage 에서 그대로
 * 옮겨 왔고(ZERO behavior change), 경계 테스트가 소스 텍스트를 스캔하므로 본문 들여쓰기·주석·문장
 * 순서를 추출 전과 동일하게 유지한다. 유일한 텍스트 차이는 동적 import 경로가 한 단계 위(`../`)를
 * 가리키는 것뿐이다 — 이 모듈이 studio-cuttoon-editor/ 하위에 있기 때문이다.
 */
export function createStudioAssetLibraryMutations(
  context: StudioAssetLibraryMutationsContext,
): StudioAssetLibraryMutations {
  const {
    assetHydrationGenerationRef,
    assetMemoryModeRef,
    assetMutationGenerationRef,
    assetMutationTailRef,
    assetsRef,
    editorMountedRef,
    removeAssetFavorite,
    replaceStudioAssets,
    setAssetStorageState,
    setAssetsLoaded,
    setAssetsLoading,
    setError,
  } = context;

  // 커스텀 에셋 라이브러리 목록 불러오기 및 관리
  const loadAssetsList = async () => {
    const generation = ++assetHydrationGenerationRef.current;
    if (assetMemoryModeRef.current) {
      setAssetsLoaded(true);
      setAssetsLoading(false);
      setAssetStorageState("memory");
      return;
    }
    setAssetsLoading(true);
    setAssetStorageState("loading");
    try {
      const { listAssets } = await import("../studio-asset-library");
      const list = await listAssets();
      if (!editorMountedRef.current || generation !== assetHydrationGenerationRef.current) return;
      replaceStudioAssets(list);
      setAssetStorageState("sqlite-opfs");
    } catch (err) {
      console.error("Failed to load custom assets:", err);
      if (!editorMountedRef.current || generation !== assetHydrationGenerationRef.current) return;
      const repositoryModule = await import("../studio-asset-library-sqlite-opfs-repository"
      ).catch(() => null);
      if (!editorMountedRef.current || generation !== assetHydrationGenerationRef.current) return;
      const failClosed = repositoryModule
        && err instanceof repositoryModule.StudioAssetLibraryRepositoryError
        && err.code === "corrupt";
      if (failClosed) {
        setAssetStorageState("unavailable");
        setError(`${err.message} 손상된 manifest나 누락된 blob을 일부만 불러오지 않았습니다.`);
      } else {
        assetMemoryModeRef.current = true;
        setAssetStorageState("memory");
        setError(`SQLite/OPFS 에셋 보관함을 열지 못해 현재 탭 메모리만 사용합니다. 새로고침하면 변경이 사라집니다: ${
          err instanceof Error ? err.message : String(err)
        }`);
      }
    } finally {
      if (editorMountedRef.current && generation === assetHydrationGenerationRef.current) {
        setAssetsLoaded(true);
        setAssetsLoading(false);
      }
    }
  };

  async function createValidatedMemoryAsset(
    input: import("../studio-asset-library").StudioAssetSaveInput,
  ): Promise<StudioAssetWithContentHash> {
    const assetLibrary = await import("../studio-asset-library");
    const actualHash = await assetLibrary.hashStudioAssetDataUrl(input.dataUrl);
    const expectedHash = assetLibrary.canonicalizeStudioAssetContentHash(input.contentHash);
    if (input.contentHash !== undefined && expectedHash !== actualHash) {
      throw new Error("제공된 contentHash가 실제 에셋 바이트 SHA-256과 일치하지 않습니다.");
    }
    return {
      ...assetLibrary.createAssetRecord({ ...input, contentHash: actualHash }),
      contentHash: actualHash,
    };
  }

  async function canKeepAssetMutationInMemory(cause: unknown): Promise<boolean> {
    const repositoryModule = await import("../studio-asset-library-sqlite-opfs-repository"
    ).catch(() => null);
    return repositoryModule === null
      || repositoryModule.isStudioAssetLibraryMemoryFallbackError(cause);
  }

  function enqueueAssetMutation<T>(work: () => Promise<T>): Promise<T> {
    const result = assetMutationTailRef.current.then(work, work);
    assetMutationTailRef.current = result.then(() => undefined, () => undefined);
    return result;
  }

  function saveStudioAssetMutation(
    input: import("../studio-asset-library").StudioAssetSaveInput,
  ): Promise<StudioAssetWithContentHash> {
    return enqueueAssetMutation(async () => {
      const generation = ++assetMutationGenerationRef.current;
      assetHydrationGenerationRef.current += 1;
      if (assetMemoryModeRef.current) {
        const saved = await createValidatedMemoryAsset(input);
        if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
          replaceStudioAssets([
            saved,
            ...assetsRef.current.filter(({ id }) => id !== saved.id),
          ]);
          setAssetsLoaded(true);
          setAssetsLoading(false);
          setAssetStorageState("memory");
        }
        return saved;
      }
      try {
        const { saveAsset } = await import("../studio-asset-library");
        const saved = await saveAsset(input);
        if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
          assetHydrationGenerationRef.current += 1;
          replaceStudioAssets([
            saved,
            ...assetsRef.current.filter(({ id }) => id !== saved.id),
          ]);
          setAssetsLoaded(true);
          setAssetsLoading(false);
          setAssetStorageState("sqlite-opfs");
        }
        return saved;
      } catch (cause) {
        if (!await canKeepAssetMutationInMemory(cause)) throw cause;
        const saved = await createValidatedMemoryAsset(input);
        assetMemoryModeRef.current = true;
        if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
          assetHydrationGenerationRef.current += 1;
          replaceStudioAssets([
            saved,
            ...assetsRef.current.filter(({ id }) => id !== saved.id),
          ]);
          setAssetsLoaded(true);
          setAssetsLoading(false);
          setAssetStorageState("memory");
          setError(`SQLite/OPFS 저장에 실패해 에셋을 현재 탭 메모리에만 유지합니다. 새로고침하면 사라집니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`);
        }
        return saved;
      }
    });
  }

  function deleteStudioAssetMutation(id: string): Promise<void> {
    return enqueueAssetMutation(async () => {
      const generation = ++assetMutationGenerationRef.current;
      assetHydrationGenerationRef.current += 1;
      if (!assetMemoryModeRef.current) {
        try {
          const { deleteAsset } = await import("../studio-asset-library");
          await deleteAsset(id);
          if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
            setAssetStorageState("sqlite-opfs");
          }
        } catch (cause) {
          if (!await canKeepAssetMutationInMemory(cause)) throw cause;
          if (!editorMountedRef.current || generation !== assetMutationGenerationRef.current) return;
          assetMemoryModeRef.current = true;
          setAssetStorageState("memory");
          setError(`SQLite/OPFS 삭제에 실패해 현재 탭 목록에서만 에셋을 숨깁니다. 새로고침하면 다시 나타날 수 있습니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`);
        }
      }
      if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
        replaceStudioAssets(assetsRef.current.filter((asset) => asset.id !== id));
        setAssetsLoaded(true);
        setAssetsLoading(false);
      }
    });
  }

  function renameStudioAssetMutation(id: string, name: string): Promise<void> {
    return enqueueAssetMutation(async () => {
      const generation = ++assetMutationGenerationRef.current;
      assetHydrationGenerationRef.current += 1;
      const assetLibrary = await import("../studio-asset-library");
      const normalizedName = assetLibrary.normalizeAssetName(name);
      if (!assetMemoryModeRef.current) {
        try {
          await assetLibrary.renameAsset(id, normalizedName);
          if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
            setAssetStorageState("sqlite-opfs");
          }
        } catch (cause) {
          if (!await canKeepAssetMutationInMemory(cause)) throw cause;
          if (!editorMountedRef.current || generation !== assetMutationGenerationRef.current) return;
          assetMemoryModeRef.current = true;
          setAssetStorageState("memory");
          setError(`SQLite/OPFS 이름 변경에 실패해 현재 탭 메모리에서만 반영합니다. 새로고침하면 사라집니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`);
        }
      }
      if (editorMountedRef.current && generation === assetMutationGenerationRef.current) {
        replaceStudioAssets(assetsRef.current.map((asset) =>
          asset.id === id ? { ...asset, name: normalizedName } : asset));
        setAssetsLoaded(true);
        setAssetsLoading(false);
      }
    });
  }

  async function onUploadAsset(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { src, width, height } = await loadStudioCanvasImageFile(file);
      await saveStudioAssetMutation({ name: file.name, dataUrl: src, width, height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "에셋 업로드 실패");
    } finally {
      e.target.value = "";
    }
  }

  async function onDeleteAsset(id: string) {
    try {
      await deleteStudioAssetMutation(id);
      removeAssetFavorite(createStudioAssetFavoriteId("local", id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "에셋 삭제 실패");
    }
  }

  return {
    loadAssetsList,
    createValidatedMemoryAsset,
    canKeepAssetMutationInMemory,
    enqueueAssetMutation,
    saveStudioAssetMutation,
    deleteStudioAssetMutation,
    renameStudioAssetMutation,
    onUploadAsset,
    onDeleteAsset,
  };
}
