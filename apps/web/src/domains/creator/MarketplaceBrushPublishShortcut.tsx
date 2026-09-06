import { useState, type ReactElement } from "react";

import { findStoredBrushSnapshotForMarketplace } from "./marketplace-brush-publish-snapshot";

import {
  createCreatorMarketplaceDraftFromBrushStudio,
  saveCreatorMarketplaceAuthoringDraft,
  stageCreatorMarketplaceAuthoringHandoff,
} from "@/shared/lib/creator-marketplace-authoring-workshop";

export const MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT =
  "toonspectrum:brush-studio-market-snapshot-request";
export const MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT =
  "toonspectrum:brush-studio-market-snapshot-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findStoredBrushSnapshot(): unknown {
  if (typeof window === "undefined") return null;
  try {
    return findStoredBrushSnapshotForMarketplace(window.localStorage);
  } catch {
    return null;
  }
}

async function requestLiveSnapshot(): Promise<unknown> {
  if (typeof window === "undefined") return null;
  const requestId = `market-brush-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return await new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(
        MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT,
        listener as EventListener,
      );
      resolve(null);
    }, 450);
    const listener = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return;
      if (event.detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(
        MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT,
        listener as EventListener,
      );
      resolve(event.detail.snapshot ?? null);
    };
    window.addEventListener(
      MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT,
      listener as EventListener,
    );
    window.dispatchEvent(
      new CustomEvent(MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT, {
        detail: { requestId },
      }),
    );
  });
}

export function MarketplaceBrushPublishShortcut({
  snapshot,
  snapshotProvider,
}: {
  snapshot?: unknown;
  snapshotProvider?: () => unknown | Promise<unknown>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("현재 브러시 원본을 보존해 등록합니다.");

  const publish = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage("현재 브러시 원본을 확인하는 중입니다.");
    try {
      const live = snapshotProvider ? await snapshotProvider() : await requestLiveSnapshot();
      const source = live ?? snapshot ?? findStoredBrushSnapshot() ?? {
        name: "Brush Studio brush",
        enginePrograms: [],
      };
      const draft = createCreatorMarketplaceDraftFromBrushStudio(source);
      saveCreatorMarketplaceAuthoringDraft(draft);
      stageCreatorMarketplaceAuthoringHandoff(draft);
      const target = new URL("/market/publish", window.location.origin);
      target.searchParams.set("source", "brush-studio");
      target.searchParams.set("resume", draft.resumeToken);
      target.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}`);
      window.location.assign(`${target.pathname}${target.search}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "마켓 게시 초안을 만들지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <aside
      data-testid="brush-studio-marketplace-shortcut"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-[195] max-w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card/95 p-3 shadow-xl backdrop-blur sm:bottom-5 sm:right-5"
      aria-label="브러시 마켓 등록"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-fg">마켓에 브러시 등록</strong>
          <p
            role="status"
            aria-atomic="true"
            aria-live="polite"
            className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-fg-2"
          >
            {message}
          </p>
        </div>
        <button
          type="button"
          data-testid="brush-studio-marketplace-publish"
          aria-busy={busy}
          onClick={() => void publish()}
          disabled={busy}
          className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-bold text-accent-fg disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "준비 중" : "등록 준비"}
        </button>
      </div>
    </aside>
  );
}
