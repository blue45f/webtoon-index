import { useEffect, useRef, useState } from "react";

import {
  createEmptyStudioProductionBible,
  studioProductionBibleStorageKey,
  type StudioProductionBible,
  type StudioProductionBiblePersistenceResult,
  type StudioProductionBibleRepository,
} from "./studio-production-bible";
import { createStudioProductionBibleSqlitePersistence } from "./studio-production-bible-sqlite-persistence";
import {
  StudioProductionBiblePanel,
  type StudioProductionBibleLinkOption,
} from "./StudioProductionBiblePanel";

export interface StudioProductionBibleWorkspaceProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly userId?: string | null;
  readonly workId?: string | null;
  readonly remixId?: string | null;
  readonly characterOptions?: readonly StudioProductionBibleLinkOption[];
  readonly assetOptions?: readonly StudioProductionBibleLinkOption[];
  /** Test/custom-storage seam. Product default is shared V12 SQLite/OPFS only. */
  readonly repository?: StudioProductionBibleRepository;
}

const INITIAL_PERSISTENCE: StudioProductionBiblePersistenceResult = {
  bible: createEmptyStudioProductionBible(),
  backend: "unavailable",
  persisted: false,
  localOnly: true,
  warning: "SQLite/OPFS 저장 권위를 확인하고 있습니다.",
};

/**
 * Lazy host that keeps the production-bible core out of Studio's initial route chunk.
 * The document remains deliberately local-only until a server schema is explicitly introduced.
 * Shared V12 SQLite/OPFS is the sole product authority; legacy browser stores are never consulted.
 */
export function StudioProductionBibleWorkspace({
  open,
  onClose,
  userId,
  workId,
  remixId,
  characterOptions,
  assetOptions,
  repository,
}: StudioProductionBibleWorkspaceProps) {
  const [defaultRepository] = useState(
    () => createStudioProductionBibleSqlitePersistence()
  );
  const activeRepository = repository ?? defaultRepository;
  const storageKey = studioProductionBibleStorageKey({
    userId,
    workId,
    remixId,
  });
  const [bible, setBible] = useState<StudioProductionBible>(
    INITIAL_PERSISTENCE.bible
  );
  const [persistence, setPersistence] =
    useState<StudioProductionBiblePersistenceResult>(INITIAL_PERSISTENCE);
  const saveEpochRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const loadEpoch = ++saveEpochRef.current;
    setBible(INITIAL_PERSISTENCE.bible);
    setPersistence(INITIAL_PERSISTENCE);
    void activeRepository.load(storageKey).then(
      (result) => {
        if (!active || loadEpoch !== saveEpochRef.current) return;
        setBible(result.bible);
        setPersistence(result);
      },
      (error: unknown) => {
        if (!active || loadEpoch !== saveEpochRef.current) return;
        setPersistence({
          bible: createEmptyStudioProductionBible(),
          backend: "unavailable",
          persisted: false,
          localOnly: true,
          warning: `SQLite/OPFS 바이블 읽기에 실패했습니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    );
    return () => {
      active = false;
      saveEpochRef.current += 1;
    };
  }, [activeRepository, open, storageKey]);

  function changeBible(next: StudioProductionBible): void {
    setBible(next);
    const saveEpoch = ++saveEpochRef.current;
    void activeRepository.save(storageKey, next).then(
      (result) => {
        if (saveEpoch !== saveEpochRef.current) return;
        setPersistence(result);
      },
      (error: unknown) => {
        if (saveEpoch !== saveEpochRef.current) return;
        setPersistence({
          bible: next,
          backend: "memory",
          persisted: false,
          localOnly: true,
          warning: `SQLite/OPFS 저장에 실패해 변경을 세션 메모리에만 유지합니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    );
  }

  return (
    <StudioProductionBiblePanel
      open={open}
      onClose={onClose}
      bible={bible}
      onChange={changeBible}
      characterOptions={characterOptions}
      assetOptions={assetOptions}
      persistence={{
        backend: persistence.backend,
        persisted: persistence.persisted,
        ...(persistence.warning ? { warning: persistence.warning } : {}),
      }}
    />
  );
}
