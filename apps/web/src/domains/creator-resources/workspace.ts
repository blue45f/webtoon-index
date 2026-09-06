import { useCallback, useEffect, useRef, useState } from "react";

import type { CreatorWorkspace } from "@/shared/lib/creator-resources";
import type { StoryDraft } from "@/shared/lib/creator-workspace-persistence";

import { emptyWorkspace } from "@/shared/lib/creator-resources";
import {
  browserWorkspaceLock, createCreatorWorkspaceStorage, CREATOR_WORKSPACE_EVENT,
  CREATOR_WORKSPACE_KEY, workspaceWriteError,
} from "@/shared/lib/creator-workspace-persistence";

function browserStore() {
  return createCreatorWorkspaceStorage({
    storage: () => window.localStorage,
    withLock: browserWorkspaceLock(typeof navigator !== "undefined" ? navigator.locks : undefined),
    notify: () => window.dispatchEvent(new Event(CREATOR_WORKSPACE_EVENT)),
  });
}
export function useCreatorWorkspace() {
  const [workspace, setWorkspace] = useState<CreatorWorkspace>(emptyWorkspace);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState<boolean | undefined>(undefined);
  const [pending, setPending] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      try { setWorkspace(browserStore().read()); setReadError(""); }
      catch { setReadError("저장 보드를 읽을 수 없습니다. 기존 데이터를 덮어쓰지 않으니 백업과 브라우저 저장소 설정을 확인하세요."); }
      setReady(true);
      setWritable(Boolean(navigator.locks?.request));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CREATOR_WORKSPACE_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(CREATOR_WORKSPACE_EVENT, sync);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CREATOR_WORKSPACE_EVENT, sync);
    };
  }, []);
  const perform = useCallback(async (operation: () => Promise<CreatorWorkspace>): Promise<boolean> => {
    setPending((count) => count + 1);
    setWriteError("");
    try {
      const committed = await operation();
      // Do not report an already successful write as a failed commit if a later read fails.
      if (mounted.current) {
        try { setWorkspace(browserStore().read()); }
        catch { setWorkspace(committed); setReadError("저장은 완료했지만 최신 보드를 다시 읽지 못했습니다."); }
      }
      return true;
    } catch (cause) {
      if (mounted.current) setWriteError(workspaceWriteError(cause));
      return false;
    } finally { if (mounted.current) setPending((count) => count - 1); }
  }, []);
  const update = useCallback((change: (value: CreatorWorkspace) => CreatorWorkspace) => perform(() => browserStore().update(change)), [perform]);
  const restore = useCallback((raw: string, mode: "merge" | "replace" = "merge", expectedRaw?: string | null) => perform(() => browserStore().restore(raw, mode, expectedRaw)), [perform]);
  const saveStory = useCallback((draft: StoryDraft) => perform(() => browserStore().saveStory(draft)), [perform]);
  const readSnapshot = useCallback(() => browserStore().readRaw(), []);
  const clearError = useCallback(() => setWriteError(""), []);
  return { workspace, update, restore, saveStory, clearError, readSnapshot, ready, writable, saving: pending > 0, error: writeError || readError };
}
export function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
