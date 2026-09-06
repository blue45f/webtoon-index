import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Link2,
  Loader2,
  Palette,
  Pipette,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { loadImageFileForCanvas } from "./canvas/studio-canvas-image-io";
import {
  canonicalizeStudioAssetContentHash,
  ensureStudioAssetContentHash,
  listAssets,
  normalizeAssetName,
  saveAsset,
  type StudioAsset,
} from "./studio-asset-library";
import {
  addStudioReferenceBoardItem,
  createStudioReferenceBoardItem,
  removeStudioReferenceBoardItem,
  reorderStudioReferenceBoardItem,
  STUDIO_REFERENCE_BOARD_MAX_ITEMS,
  updateStudioReferenceBoardItem,
  type StudioReferenceBoardDocument,
  type StudioReferenceBoardItem,
  type StudioReferenceBoardItemView,
} from "./studio-reference-board";
import {
  extractStudioReferencePalette,
  isStudioReferenceLocalRasterDataUrl,
  loadStudioReferenceImageRaster,
  sampleStudioReferenceColorAtBoardPoint,
  studioReferenceItemFramePercent,
  type StudioReferenceImageRaster,
  type StudioReferencePoint,
} from "./studio-reference-color-sampler";
import {
  assertStudioReferenceGifSignature,
  assertStudioReferenceImportBatch,
  isStudioReferenceEditablePasteTarget,
  planStudioReferenceImports,
  STUDIO_REFERENCE_IMPORT_ACCEPT,
} from "./studio-reference-import";
import {
  clampReferencePanelRect,
  defaultReferencePanelSettings,
  dragReferencePanelRect,
  filterReferenceAssetsByName,
  resetReferencePanelSize,
  resizeReferencePanelRect,
  resolvePinnedAsset,
  type ReferencePanelSettings,
} from "./studio-reference-panel";
import {
  acquireProductStudioReferencePanelPreferencesRepository,
  type StudioReferencePanelPreferencesRepository,
} from "./studio-reference-panel-preferences-sqlite";
import { importStudioRemoteReferenceImage } from "./studio-remote-reference-image-client";

import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";

export interface StudioReferencePanelProps {
  open: boolean;
  onClose: () => void;
  /** Project-owned reference content and back-to-front z-order authority. */
  document: StudioReferenceBoardDocument;
  /** One durable project commit. Preview-only pointer/range updates never call this callback. */
  onChange: (next: StudioReferenceBoardDocument) => boolean | void;
  /** Optional Studio primary-color sink. Color inspection never mutates the reference document. */
  onPickColor?: (hex: string) => void;
  /** Test/runtime injection seam; product defaults to the shared SQLite/OPFS authority. */
  acquirePreferences?: () => Promise<StudioReferencePanelPreferencesRepository>;
}

type DragKind = "move" | "resize";
type PanelDragSession = {
  kind: DragKind;
  startRect: { x: number; y: number; width: number; height: number };
  startPointer: { x: number; y: number };
};
type ItemDragSession = {
  itemId: string;
  pointerId: number;
  startPointer: { x: number; y: number };
  startView: StudioReferenceBoardItemView;
  boardRect: DOMRect;
};
type LibraryStatus = "idle" | "loading" | "ready" | "error";
type ColorAnalysisStatus = "idle" | "loading" | "ready" | "error";
type ReferencePanelPreferencesAuthority = "loading" | "sqlite-opfs" | "memory-only";
type ReferenceColorRasterCache = {
  itemId: string;
  source: string;
  raster: StudioReferenceImageRaster;
};
type ReferenceImportTicket = {
  generation: number;
  document: StudioReferenceBoardDocument;
};

const CONTROL_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const ICON_BUTTON =
  "inline-grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function readViewport(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createReferenceItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `reference-${Date.now()}-${Math.random().toString(36).slice(2)}`; // NOSONAR S2245 — document identity, not a security token.
}

function assetMimeType(asset: StudioAsset): string | undefined {
  const match = /^data:([^;,]+)/iu.exec(asset.dataUrl);
  const mimeType = match?.[1]?.trim().toLowerCase();
  return mimeType?.startsWith("image/") ? mimeType : undefined;
}

function remoteReferenceAssetName(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const fileName = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    return normalizeAssetName(fileName || url.hostname || "원격 참고 이미지");
  } catch {
    return "원격 참고 이미지";
  }
}

function buildReferenceItem(asset: StudioAsset, itemCount: number, flipX = false): StudioReferenceBoardItem | null {
  const contentHash = canonicalizeStudioAssetContentHash(asset.contentHash);
  if (!contentHash) return null;
  const offsetColumn = itemCount % 5;
  const offsetRow = Math.floor(itemCount / 5) % 3;
  return createStudioReferenceBoardItem({
    id: createReferenceItemId(),
    asset: {
      sha256: contentHash,
      assetId: asset.id,
      name: asset.name,
      ...(assetMimeType(asset) ? { mimeType: assetMimeType(asset) } : {}),
      width: asset.width,
      height: asset.height,
    },
    view: {
      centerX: clampUnit(0.4 + offsetColumn * 0.05),
      centerY: clampUnit(0.4 + offsetRow * 0.08),
      zoom: 1,
      rotationDeg: 0,
      flipX,
      flipY: false,
      opacity: 1,
      grayscale: false,
    },
  });
}

/** SHA-256 is authoritative; assetId is only a device-local legacy lookup hint. */
function resolveReferenceAsset(item: StudioReferenceBoardItem, assets: readonly StudioAsset[]): StudioAsset | null {
  const byHash = assets.find(
    (asset) => canonicalizeStudioAssetContentHash(asset.contentHash) === item.asset.sha256
  );
  if (byHash) return byHash;
  if (!item.asset.assetId) return null;
  return assets.find((asset) => asset.id === item.asset.assetId) ?? null;
}

function referenceItemLabel(item: StudioReferenceBoardItem, asset: StudioAsset | null): string {
  return asset?.name ?? item.asset.name ?? "해석할 수 없는 참고 이미지";
}

function ReferenceRangeControl({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  format,
  onPreview,
  onCommit,
  onCancel,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const editingRef = useRef(false);
  const startValueRef = useRef(value);

  useEffect(() => {
    if (editingRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  function beginEditing(): void {
    if (editingRef.current) return;
    editingRef.current = true;
    startValueRef.current = value;
  }

  function preview(next: number): void {
    beginEditing();
    draftRef.current = next;
    setDraft(next);
    onPreview(next);
  }

  function finish(): void {
    if (!editingRef.current) return;
    editingRef.current = false;
    const next = draftRef.current;
    if (next !== startValueRef.current) onCommit(next);
    else onCancel();
  }

  function rollback(): void {
    if (!editingRef.current) return;
    editingRef.current = false;
    const startValue = startValueRef.current;
    draftRef.current = startValue;
    setDraft(startValue);
    onCancel();
  }

  return (
    <label className="grid grid-cols-[3.25rem_minmax(4rem,1fr)_3rem] items-center gap-1.5 text-[0.65rem] text-fg-3">
      <span>{label}</span>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={draft}
        className="h-5 min-w-0 accent-accent"
        onPointerDown={beginEditing}
        onChange={(event) => preview(Number(event.target.value))}
        onPointerUp={finish}
        onPointerCancel={rollback}
        onLostPointerCapture={rollback}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          rollback();
        }}
        onKeyUp={finish}
        onBlur={finish}
      />
      <output className="text-right font-medium tabular-nums text-fg-2">{format(draft)}</output>
    </label>
  );
}

export function StudioReferencePanel({
  open,
  onClose,
  document,
  onChange,
  onPickColor,
  acquirePreferences = acquireProductStudioReferencePanelPreferencesRepository,
}: StudioReferencePanelProps): ReactElement | null {
  const [settings, setSettings] = useState<ReferencePanelSettings>(() =>
    typeof window === "undefined"
      ? defaultReferencePanelSettings(1280, 800)
      : defaultReferencePanelSettings(window.innerWidth, window.innerHeight));
  const [preferencesAuthority, setPreferencesAuthority] =
    useState<ReferencePanelPreferencesAuthority>("loading");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("idle");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [addingAssetId, setAddingAssetId] = useState<string | null>(null);
  const [importingFiles, setImportingFiles] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [importingRemote, setImportingRemote] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [dragPreview, setDragPreview] = useState<{ itemId: string; view: StudioReferenceBoardItemView } | null>(null);
  const [transformPreview, setTransformPreview] = useState<{ itemId: string; view: StudioReferenceBoardItemView } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [colorAnalysisStatus, setColorAnalysisStatus] = useState<ColorAnalysisStatus>("idle");
  const [colorAnalysisError, setColorAnalysisError] = useState<string | null>(null);
  const [colorAnalysisNonce, setColorAnalysisNonce] = useState(0);
  const [paletteColors, setPaletteColors] = useState<string[]>([]);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [colorInteractionStatus, setColorInteractionStatus] = useState<string | null>(null);

  const panelDragSessionRef = useRef<PanelDragSession | null>(null);
  const panelDragListenersRef = useRef<{ onMove: (event: PointerEvent) => void; onEnd: () => void } | null>(null);
  const itemDragSessionRef = useRef<ItemDragSession | null>(null);
  const dragPreviewRef = useRef<{ itemId: string; view: StudioReferenceBoardItemView } | null>(null);
  const settingsRef = useRef(settings);
  const settingsRevisionRef = useRef(0);
  const lastEnqueuedSettingsRevisionRef = useRef(0);
  const settingsHydratedRef = useRef(false);
  const settingsLoadedFromSqliteRef = useRef(false);
  const preferencesRepositoryRef = useRef<StudioReferencePanelPreferencesRepository | null>(null);
  const preferencesHydrationGenerationRef = useRef(0);
  const latestDocumentRef = useRef(document);
  const onChangeRef = useRef(onChange);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const legacyMigrationAttemptedRef = useRef(false);
  const colorRasterRef = useRef<ReferenceColorRasterCache | null>(null);
  const onPickColorRef = useRef(onPickColor);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropDepthRef = useRef(0);
  const importInFlightRef = useRef(false);
  const assetAddInFlightRef = useRef(false);
  const importFilesRef = useRef<(files: readonly File[]) => Promise<void>>(async () => undefined);
  const remoteImportAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const importGenerationRef = useRef(0);
  const importDocumentScopeRef = useRef(document);
  const importOpenScopeRef = useRef(open);
  const previousImportScopeRef = useRef({ open, document });
  settingsRef.current = settings;
  latestDocumentRef.current = document;
  onChangeRef.current = onChange;
  onPickColorRef.current = onPickColor;
  importDocumentScopeRef.current = document;
  importOpenScopeRef.current = open;

  const effectiveSelectedItem = document.items.find((item) => item.id === selectedItemId)
    ?? document.items.at(-1)
    ?? null;
  const effectiveSelectedId = effectiveSelectedItem?.id ?? null;
  const effectiveSelectedAsset = effectiveSelectedItem
    ? resolveReferenceAsset(effectiveSelectedItem, assets)
    : null;
  const selectedColorSource = effectiveSelectedAsset?.dataUrl ?? null;
  const colorPickingEnabled = typeof onPickColor === "function";

  function updateSettings(
    updater: (previous: ReferencePanelSettings) => ReferencePanelSettings,
  ): void {
    settingsRevisionRef.current += 1;
    setSettings((previous) => {
      const next = updater(previous);
      settingsRef.current = next;
      return next;
    });
  }

  function enqueueCurrentSettingsSave(reportFailure: boolean): void {
    const repository = preferencesRepositoryRef.current;
    const revision = settingsRevisionRef.current;
    if (
      repository === null
      || !settingsHydratedRef.current
      || revision <= lastEnqueuedSettingsRevisionRef.current
    ) {
      return;
    }
    lastEnqueuedSettingsRevisionRef.current = revision;
    void repository.save(settingsRef.current).catch(() => {
      if (reportFailure && mountedRef.current) {
        setPreferencesAuthority("memory-only");
      }
    });
  }

  function emitDocumentChange(next: StudioReferenceBoardDocument): boolean {
    if (next === latestDocumentRef.current) return true;
    const accepted = onChangeRef.current(next);
    if (accepted === false) return false;
    latestDocumentRef.current = next;
    return true;
  }

  function beginReferenceImport(): ReferenceImportTicket {
    const generation = importGenerationRef.current + 1;
    importGenerationRef.current = generation;
    return { generation, document: importDocumentScopeRef.current };
  }

  function isReferenceImportActive(ticket: ReferenceImportTicket): boolean {
    return mountedRef.current
      && importOpenScopeRef.current
      && importGenerationRef.current === ticket.generation
      && importDocumentScopeRef.current === ticket.document;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importGenerationRef.current += 1;
      importInFlightRef.current = false;
      assetAddInFlightRef.current = false;
      remoteImportAbortRef.current?.abort();
      remoteImportAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open || settingsHydratedRef.current) return;
    const generation = preferencesHydrationGenerationRef.current + 1;
    preferencesHydrationGenerationRef.current = generation;
    let cancelled = false;
    setPreferencesAuthority("loading");

    void acquirePreferences()
      .then(async (repository) => {
        const { w, h } = readViewport();
        const snapshot = await repository.load(w, h);
        if (cancelled || preferencesHydrationGenerationRef.current !== generation) return;
        preferencesRepositoryRef.current = repository;
        settingsHydratedRef.current = true;
        settingsLoadedFromSqliteRef.current = snapshot.persisted;
        if (settingsRevisionRef.current === 0) {
          settingsRef.current = snapshot.settings;
          setSettings(snapshot.settings);
        }
        setPreferencesAuthority("sqlite-opfs");
      })
      .catch(() => {
        if (cancelled || preferencesHydrationGenerationRef.current !== generation) return;
        settingsHydratedRef.current = true;
        preferencesRepositoryRef.current = null;
        setPreferencesAuthority("memory-only");
      });

    return () => {
      cancelled = true;
    };
  }, [acquirePreferences, open]);

  useEffect(() => {
    const previous = previousImportScopeRef.current;
    if (previous.open === open && previous.document === document) return;
    previousImportScopeRef.current = { open, document };
    const wasImporting = importInFlightRef.current;
    importGenerationRef.current += 1;
    importInFlightRef.current = false;
    assetAddInFlightRef.current = false;
    remoteImportAbortRef.current?.abort();
    remoteImportAbortRef.current = null;
    setAddingAssetId(null);
    setImportingFiles(false);
    setImportingRemote(false);
    if (wasImporting) setImportStatus(null);
  }, [document, open]);

  useEffect(() => {
    if (!open) return;
    const requestId = ++requestIdRef.current;
    setLibraryStatus("loading");
    setLibraryError(null);
    listAssets()
      .then((list) => {
        if (requestIdRef.current !== requestId) return;
        setAssets(list);
        setLibraryStatus("ready");
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setLibraryStatus("error");
        setLibraryError("에셋 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      });
    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [open, pickerOpen, refreshNonce]);

  useEffect(() => {
    colorRasterRef.current = null;
    setPaletteColors([]);
    setPickedColor(null);
    setColorInteractionStatus(null);
    setEyedropperActive(false);

    if (!open || !inspectorOpen || !colorPickingEnabled || !effectiveSelectedId) {
      setColorAnalysisStatus("idle");
      setColorAnalysisError(null);
      return;
    }
    if (!selectedColorSource) {
      setColorAnalysisStatus("error");
      setColorAnalysisError("원본 에셋을 찾을 수 없어 색상을 분석할 수 없습니다.");
      return;
    }
    if (!isStudioReferenceLocalRasterDataUrl(selectedColorSource)) {
      setColorAnalysisStatus("error");
      setColorAnalysisError("로컬 PNG, JPG, WebP 또는 GIF 참고 이미지에서만 색상을 추출할 수 있습니다.");
      return;
    }

    const controller = new AbortController();
    const itemId = effectiveSelectedId;
    const source = selectedColorSource;
    let cancelled = false;
    setColorAnalysisStatus("loading");
    setColorAnalysisError(null);

    void loadStudioReferenceImageRaster(source, { signal: controller.signal })
      .then((raster) => {
        if (cancelled) return;
        colorRasterRef.current = { itemId, source, raster };
        setPaletteColors(extractStudioReferencePalette(raster, { count: 6 }));
        setColorAnalysisStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setColorAnalysisStatus("error");
        setColorAnalysisError(
          error instanceof Error ? error.message : "참고 이미지 색상 분석에 실패했습니다."
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    colorAnalysisNonce,
    colorPickingEnabled,
    effectiveSelectedId,
    inspectorOpen,
    open,
    selectedColorSource,
  ]);

  // A SQLite-loaded v1 setting may carry one pinned image. Promote it once into an empty project
  // board, then clear the hint so a later intentional delete cannot resurrect the image. The
  // discarded localStorage authority is never probed.
  useEffect(() => {
    if (
      !open
      || libraryStatus !== "ready"
      || preferencesAuthority !== "sqlite-opfs"
      || !settingsLoadedFromSqliteRef.current
      || legacyMigrationAttemptedRef.current
      || settings.assetId === null
    ) {
      return;
    }
    legacyMigrationAttemptedRef.current = true;
    const legacyAsset = resolvePinnedAsset(assets, settings.assetId);
    const legacyFlip = settings.flipped;
    updateSettings((previous) => ({ ...previous, assetId: null, flipped: false }));
    if (!legacyAsset || latestDocumentRef.current.items.length > 0) return;

    const ticket = beginReferenceImport();
    void ensureStudioAssetContentHash(legacyAsset)
      .then((ensuredAsset) => {
        if (!isReferenceImportActive(ticket)) return;
        const current = latestDocumentRef.current;
        if (current.items.length > 0) return;
        const item = buildReferenceItem(ensuredAsset, 0, legacyFlip);
        if (!item) return;
        const next = addStudioReferenceBoardItem(current, item);
        if (next !== current) {
          const accepted = onChangeRef.current(next);
          if (accepted !== false) {
            latestDocumentRef.current = next;
            setSelectedItemId(item.id);
          }
        }
      })
      .catch(() => {
        if (!isReferenceImportActive(ticket)) return;
        setLibraryError("이전 참고 이미지의 콘텐츠 해시를 계산하지 못했습니다.");
      });
  }, [assets, libraryStatus, open, preferencesAuthority, settings.assetId, settings.flipped]);

  useEffect(() => {
    if (!open || preferencesAuthority !== "sqlite-opfs" || settingsRevisionRef.current === 0) {
      return;
    }
    const timer = setTimeout(() => {
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
      enqueueCurrentSettingsSave(true);
    }, 200);
    saveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
    };
  }, [open, preferencesAuthority, settings]);

  useEffect(() => {
    if (open) return;
    enqueueCurrentSettingsSave(true);
  }, [open]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      enqueueCurrentSettingsSave(false);
      void preferencesRepositoryRef.current?.flush().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const { w, h } = readViewport();
      updateSettings((previous) => ({ ...previous, ...clampReferencePanelRect(previous, w, h) }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = window.document.body.style.cursor;
    const previousUserSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = dragging === "resize" ? "nwse-resize" : "grabbing";
    window.document.body.style.userSelect = "none";
    return () => {
      window.document.body.style.cursor = previousCursor;
      window.document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  useEffect(() => {
    return () => {
      const listeners = panelDragListenersRef.current;
      if (!listeners) return;
      window.removeEventListener("pointermove", listeners.onMove);
      window.removeEventListener("pointerup", listeners.onEnd);
      window.removeEventListener("pointercancel", listeners.onEnd);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isStudioReferenceEditablePasteTarget(event.target)) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      let files = Array.from(clipboard.files);
      if (files.length === 0) {
        files = Array.from(clipboard.items)
          .filter((item) => item.kind === "file")
          .flatMap((item) => {
            const file = item.getAsFile();
            return file ? [file] : [];
          });
      }
      const plan = planStudioReferenceImports(files, STUDIO_REFERENCE_BOARD_MAX_ITEMS);
      if (plan.files.length === 0 && plan.overflow.length === 0) return;
      event.preventDefault();
      void importFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  function retryLoadAssets(): void {
    setRefreshNonce((nonce) => nonce + 1);
  }

  function beginPanelDrag(kind: DragKind, event: ReactPointerEvent): void {
    event.preventDefault();
    panelDragSessionRef.current = {
      kind,
      startRect: { x: settings.x, y: settings.y, width: settings.width, height: settings.height },
      startPointer: { x: event.clientX, y: event.clientY },
    };
    setDragging(kind);
    const onMove = (nextEvent: PointerEvent) => {
      const session = panelDragSessionRef.current;
      if (!session) return;
      const { w, h } = readViewport();
      const pointer = { x: nextEvent.clientX, y: nextEvent.clientY };
      const nextRect = session.kind === "move"
        ? dragReferencePanelRect(session.startRect, session.startPointer, pointer, w, h)
        : resizeReferencePanelRect(session.startRect, session.startPointer, pointer, w, h);
      updateSettings((previous) => ({ ...previous, ...nextRect }));
    };
    const onEnd = () => {
      panelDragSessionRef.current = null;
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      panelDragListenersRef.current = null;
    };
    panelDragListenersRef.current = { onMove, onEnd };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onEnd, { passive: true });
    window.addEventListener("pointercancel", onEnd, { passive: true });
  }

  function resizeByKeyboard(event: KeyboardEvent<HTMLButtonElement>): void {
    const step = event.shiftKey ? 32 : 16;
    const { w, h } = readViewport();
    let dw = 0;
    let dh = 0;
    if (event.key === "ArrowRight") dw = step;
    else if (event.key === "ArrowLeft") dw = -step;
    else if (event.key === "ArrowDown") dh = step;
    else if (event.key === "ArrowUp") dh = -step;
    else return;
    event.preventDefault();
    updateSettings((previous) => ({
      ...previous,
      ...resizeReferencePanelRect(previous, { x: 0, y: 0 }, { x: dw, y: dh }, w, h),
    }));
  }

  async function addAssetToBoard(asset: StudioAsset): Promise<void> {
    if (importInFlightRef.current || assetAddInFlightRef.current) return;
    if (latestDocumentRef.current.items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS) return;
    const ticket = beginReferenceImport();
    assetAddInFlightRef.current = true;
    setAddingAssetId(asset.id);
    setLibraryError(null);
    try {
      const ensuredAsset = await ensureStudioAssetContentHash(asset);
      if (!isReferenceImportActive(ticket)) return;
      setAssets((previous) => previous.map((candidate) => candidate.id === ensuredAsset.id ? ensuredAsset : candidate));
      const current = latestDocumentRef.current;
      const item = buildReferenceItem(ensuredAsset, current.items.length);
      if (!item) throw new Error("invalid reference item");
      const next = addStudioReferenceBoardItem(current, item);
      if (next === current) return;
      if (emitDocumentChange(next)) {
        setSelectedItemId(item.id);
        setInspectorOpen(false);
      }
    } catch {
      if (!isReferenceImportActive(ticket)) return;
      setLibraryError("이미지를 보드에 추가할 수 없습니다. 콘텐츠 해시 지원을 확인해 주세요.");
    } finally {
      if (importGenerationRef.current === ticket.generation && mountedRef.current) {
        assetAddInFlightRef.current = false;
        setAddingAssetId(null);
      }
    }
  }

  async function importRemoteReference(): Promise<void> {
    if (importInFlightRef.current || assetAddInFlightRef.current) return;
    if (latestDocumentRef.current.items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS) {
      setImportStatus(`참고 보드는 최대 ${STUDIO_REFERENCE_BOARD_MAX_ITEMS}개까지 추가할 수 있습니다.`);
      return;
    }
    const sourceUrl = remoteUrl.trim();
    if (!sourceUrl) {
      setImportStatus("가져올 공개 이미지 URL을 입력해 주세요.");
      return;
    }

    const ticket = beginReferenceImport();
    const controller = new AbortController();
    remoteImportAbortRef.current?.abort();
    remoteImportAbortRef.current = controller;
    importInFlightRef.current = true;
    setImportingRemote(true);
    setLibraryError(null);
    setImportStatus("공개 URL과 이미지 형식을 안전하게 확인하고 있습니다…");
    try {
      const imported = await importStudioRemoteReferenceImage(sourceUrl, controller.signal);
      if (!isReferenceImportActive(ticket)) return;
      const contentHash = `sha256:${imported.sha256}`;
      let asset = assets.find(
        (candidate) => canonicalizeStudioAssetContentHash(candidate.contentHash) === contentHash
      ) ?? null;
      if (!asset) {
        asset = await saveAsset({
          name: remoteReferenceAssetName(sourceUrl),
          dataUrl: imported.dataUrl,
          width: imported.width,
          height: imported.height,
          kind: "remote-reference",
          contentHash,
        });
        if (!isReferenceImportActive(ticket)) return;
        setAssets((current) => [asset!, ...current.filter((candidate) => candidate.id !== asset!.id)]);
        setLibraryStatus("ready");
      }

      if (!isReferenceImportActive(ticket)) return;
      const current = latestDocumentRef.current;
      const item = buildReferenceItem(asset, current.items.length);
      if (!item) throw new Error("원격 참고 이미지의 콘텐츠 식별자를 만들지 못했습니다.");
      const next = addStudioReferenceBoardItem(current, item);
      if (next === current) throw new Error("참고 보드에 이미지를 추가할 수 없습니다.");
      if (!emitDocumentChange(next)) {
        setImportStatus("현재 문서가 잠겨 있어 보드에는 추가하지 못했습니다. 이미지는 개인 에셋에 저장했습니다.");
        return;
      }
      setSelectedItemId(item.id);
      setInspectorOpen(false);
      setPickerOpen(false);
      setRemoteUrl("");
      setImportStatus(`${asset.name} 원격 참고 이미지를 추가했습니다.`);
    } catch (error: unknown) {
      if (!isReferenceImportActive(ticket)) return;
      setImportStatus(
        controller.signal.aborted
          ? "원격 참고 이미지 가져오기를 취소했습니다."
          : error instanceof Error
            ? error.message
            : "원격 참고 이미지를 가져오지 못했습니다."
      );
    } finally {
      if (remoteImportAbortRef.current === controller) remoteImportAbortRef.current = null;
      if (importGenerationRef.current === ticket.generation) {
        importInFlightRef.current = false;
        if (mountedRef.current) setImportingRemote(false);
      }
    }
  }

  async function importReferenceFiles(sourceFiles: readonly File[]): Promise<void> {
    if (importInFlightRef.current || assetAddInFlightRef.current) return;
    const remainingSlots = STUDIO_REFERENCE_BOARD_MAX_ITEMS - latestDocumentRef.current.items.length;
    const plan = planStudioReferenceImports(sourceFiles, remainingSlots);
    if (plan.files.length === 0) {
      if (plan.overflow.length > 0 || remainingSlots <= 0) {
        setImportStatus(`참고 보드는 최대 ${STUDIO_REFERENCE_BOARD_MAX_ITEMS}개까지 추가할 수 있습니다.`);
      } else if (sourceFiles.length > 0) {
        setImportStatus("PNG, JPG, WebP 또는 GIF 이미지 파일만 가져올 수 있습니다.");
      }
      return;
    }

    try {
      assertStudioReferenceImportBatch(plan.files);
    } catch (error: unknown) {
      setImportStatus(error instanceof Error ? error.message : "참고 이미지 안전 한도를 확인해 주세요.");
      return;
    }

    const ticket = beginReferenceImport();
    importInFlightRef.current = true;
    setImportingFiles(true);
    setImportStatus("참고 이미지를 안전하게 처리하고 있습니다…");
    setLibraryError(null);
    const savedAssets: StudioAsset[] = [];
    const failures: string[] = [];
    try {
      // Decode sequentially so a multi-file paste cannot retain several large rasters at once.
      for (const file of plan.files) {
        try {
          await assertStudioReferenceGifSignature(file);
          if (!isReferenceImportActive(ticket)) return;
          const image = await loadImageFileForCanvas(file);
          if (!isReferenceImportActive(ticket)) return;
          const asset = await saveAsset({
            name: normalizeAssetName(file.name),
            dataUrl: image.src,
            width: image.width,
            height: image.height,
          });
          if (!isReferenceImportActive(ticket)) return;
          savedAssets.push(asset);
        } catch (error: unknown) {
          if (!isReferenceImportActive(ticket)) return;
          failures.push(error instanceof Error ? error.message : `${file.name} 파일을 가져오지 못했습니다.`);
        }
      }

      if (!isReferenceImportActive(ticket)) return;
      if (savedAssets.length > 0) {
        const savedIds = new Set(savedAssets.map((asset) => asset.id));
        setAssets((previous) => [
          ...savedAssets,
          ...previous.filter((asset) => !savedIds.has(asset.id)),
        ]);
        setLibraryStatus("ready");
      }

      let next = latestDocumentRef.current;
      const addedItems: StudioReferenceBoardItem[] = [];
      for (const asset of savedAssets) {
        if (next.items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS) break;
        const item = buildReferenceItem(asset, next.items.length);
        if (!item) {
          failures.push(`${asset.name} 콘텐츠 식별자를 만들지 못했습니다.`);
          continue;
        }
        const withItem = addStudioReferenceBoardItem(next, item);
        if (withItem === next) continue;
        next = withItem;
        addedItems.push(item);
      }

      const accepted = addedItems.length === 0 || emitDocumentChange(next);
      if (accepted && addedItems.length > 0) {
        setSelectedItemId(addedItems.at(-1)?.id ?? null);
        setInspectorOpen(false);
        setPickerOpen(false);
      }

      const skippedCount = plan.unsupported.length
        + plan.overflow.length
        + Math.max(0, savedAssets.length - addedItems.length);
      if (!accepted) {
        setImportStatus("현재 문서가 잠겨 있어 보드에는 추가하지 못했습니다. 파일은 개인 에셋에 저장했습니다.");
      } else if (addedItems.length === 0) {
        setImportStatus(failures[0] ?? "가져올 수 있는 참고 이미지가 없습니다.");
      } else {
        const details = [
          `${addedItems.length}개 참고 이미지를 추가했습니다.`,
          failures.length > 0 ? `${failures.length}개 실패: ${failures[0]}` : null,
          skippedCount > 0 ? `${skippedCount}개는 형식 또는 보드 한도로 건너뛰었습니다.` : null,
        ].filter(Boolean);
        setImportStatus(details.join(" "));
      }
    } finally {
      if (importGenerationRef.current === ticket.generation) {
        importInFlightRef.current = false;
        if (mountedRef.current) setImportingFiles(false);
      }
    }
  }

  importFilesRef.current = importReferenceFiles;

  function beginFileDrop(event: ReactDragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    setDropActive(true);
  }

  function continueFileDrop(event: ReactDragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function leaveFileDrop(event: ReactDragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  }

  function finishFileDrop(event: ReactDragEvent<HTMLElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dropDepthRef.current = 0;
    setDropActive(false);
    void importReferenceFiles(Array.from(event.dataTransfer.files));
  }

  function applyReferenceColor(hex: string): void {
    const pickColor = onPickColorRef.current;
    if (!pickColor) return;
    pickColor(hex);
    setPickedColor(hex);
    setColorInteractionStatus(`${hex} 색상을 기본색으로 선택했습니다.`);
  }

  function sampleReferenceItemAtPoint(
    item: StudioReferenceBoardItem,
    view: StudioReferenceBoardItemView,
    board: HTMLElement,
    point: StudioReferencePoint
  ): void {
    const asset = resolveReferenceAsset(item, assets);
    const cache = colorRasterRef.current;
    if (
      !asset
      || !cache
      || cache.itemId !== item.id
      || cache.source !== asset.dataUrl
      || colorAnalysisStatus !== "ready"
    ) {
      setColorInteractionStatus("선택 이미지의 색상 분석이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    const boardRect = board.getBoundingClientRect();
    if (boardRect.width <= 0 || boardRect.height <= 0) {
      setColorInteractionStatus("참고 보드 크기를 확인하지 못했습니다.");
      return;
    }
    const displayWidth = item.asset.width ?? asset.width ?? cache.raster.width;
    const displayHeight = item.asset.height ?? asset.height ?? cache.raster.height;
    const framePercent = studioReferenceItemFramePercent(displayWidth, displayHeight);
    const hex = sampleStudioReferenceColorAtBoardPoint(cache.raster, point, {
      boardWidth: boardRect.width,
      boardHeight: boardRect.height,
      centerX: view.centerX,
      centerY: view.centerY,
      frameWidth: boardRect.width * framePercent.width / 100,
      frameHeight: boardRect.height * framePercent.height / 100,
      zoom: view.zoom,
      rotationDeg: view.rotationDeg,
      flipX: view.flipX,
      flipY: view.flipY,
    });
    if (!hex) {
      setColorInteractionStatus("투명 영역이거나 이미지 표시 범위 밖입니다. 이미지 안쪽을 선택해 주세요.");
      return;
    }
    applyReferenceColor(hex);
  }

  function sampleReferenceItemFromPointer(
    item: StudioReferenceBoardItem,
    view: StudioReferenceBoardItemView,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void {
    const board = event.currentTarget.closest<HTMLElement>("[data-reference-board-canvas]");
    if (!board) return;
    const rect = board.getBoundingClientRect();
    sampleReferenceItemAtPoint(item, view, board, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  function sampleReferenceItemFromKeyboard(
    item: StudioReferenceBoardItem,
    view: StudioReferenceBoardItemView,
    event: KeyboardEvent<HTMLButtonElement>
  ): void {
    if (event.key === "Escape" && eyedropperActive) {
      exitReferenceEyedropperFromKeyboard(event);
      return;
    }
    if (!eyedropperActive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    if (item.id !== effectiveSelectedId) {
      setSelectedItemId(item.id);
      setInspectorOpen(true);
      return;
    }
    const board = event.currentTarget.closest<HTMLElement>("[data-reference-board-canvas]");
    if (!board) return;
    const rect = board.getBoundingClientRect();
    sampleReferenceItemAtPoint(item, view, board, {
      x: view.centerX * rect.width,
      y: view.centerY * rect.height,
    });
  }

  function exitReferenceEyedropperFromKeyboard(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape" || !eyedropperActive) return;
    event.preventDefault();
    event.stopPropagation();
    setEyedropperActive(false);
    setColorInteractionStatus("참고 이미지 스포이드 모드를 종료했습니다.");
  }

  function beginItemDrag(
    item: StudioReferenceBoardItem,
    view: StudioReferenceBoardItemView,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void {
    if (event.button !== 0) return;
    if (eyedropperActive) {
      event.preventDefault();
      event.stopPropagation();
      if (item.id !== effectiveSelectedId) {
        setSelectedItemId(item.id);
        setInspectorOpen(true);
        return;
      }
      sampleReferenceItemFromPointer(item, view, event);
      return;
    }
    const board = event.currentTarget.closest<HTMLElement>("[data-reference-board-canvas]");
    if (!board) return;
    event.stopPropagation();
    setSelectedItemId(item.id);
    setTransformPreview(null);
    itemDragSessionRef.current = {
      itemId: item.id,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startView: item.view,
      boardRect: board.getBoundingClientRect(),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function previewItemDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    const session = itemDragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.stopPropagation();
    const width = Math.max(1, session.boardRect.width);
    const height = Math.max(1, session.boardRect.height);
    const view = {
      ...session.startView,
      centerX: clampUnit(session.startView.centerX + (event.clientX - session.startPointer.x) / width),
      centerY: clampUnit(session.startView.centerY + (event.clientY - session.startPointer.y) / height),
    };
    dragPreviewRef.current = { itemId: session.itemId, view };
    setDragPreview({ itemId: session.itemId, view });
  }

  function finishItemDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    const session = itemDragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.stopPropagation();
    const finalPreview = dragPreviewRef.current?.itemId === session.itemId
      ? dragPreviewRef.current.view
      : session.startView;
    itemDragSessionRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (
      finalPreview.centerX === session.startView.centerX
      && finalPreview.centerY === session.startView.centerY
    ) {
      return;
    }
    emitDocumentChange(updateStudioReferenceBoardItem(latestDocumentRef.current, session.itemId, {
      view: { centerX: finalPreview.centerX, centerY: finalPreview.centerY },
    }));
  }

  function cancelItemDrag(event?: ReactPointerEvent<HTMLButtonElement>): void {
    const session = itemDragSessionRef.current;
    if (!session || (event && event.pointerId !== session.pointerId)) return;
    event?.stopPropagation();
    itemDragSessionRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
  }

  function patchSelectedView(patch: Partial<StudioReferenceBoardItemView>): void {
    const itemId = effectiveSelectedItem?.id;
    if (!itemId) return;
    setTransformPreview(null);
    emitDocumentChange(updateStudioReferenceBoardItem(latestDocumentRef.current, itemId, { view: patch }));
  }

  function previewSelectedView(patch: Partial<StudioReferenceBoardItemView>): void {
    if (!effectiveSelectedItem) return;
    const base = transformPreview?.itemId === effectiveSelectedItem.id
      ? transformPreview.view
      : effectiveSelectedItem.view;
    setTransformPreview({ itemId: effectiveSelectedItem.id, view: { ...base, ...patch } });
  }

  function clearTransformPreview(): void {
    setTransformPreview(null);
  }

  if (!open) return null;

  const selectedIndex = effectiveSelectedId
    ? document.items.findIndex((item) => item.id === effectiveSelectedId)
    : -1;
  const selectedView = effectiveSelectedItem
    ? transformPreview?.itemId === effectiveSelectedItem.id
      ? transformPreview.view
      : effectiveSelectedItem.view
    : null;
  const filteredAssets = filterReferenceAssetsByName(assets, pickerQuery);
  const atItemLimit = document.items.length >= STUDIO_REFERENCE_BOARD_MAX_ITEMS;

  return (
    <div
      role="region"
      aria-label="포즈 참고 보드"
      data-studio-reference-preferences-authority={preferencesAuthority}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_36px_oklch(0.05_0.01_70/0.4)]"
      style={{ left: settings.x, top: settings.y, width: settings.width, height: settings.height }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={STUDIO_REFERENCE_IMPORT_ACCEPT}
        aria-label="참고 이미지 파일 선택"
        className="sr-only"
        disabled={addingAssetId !== null || importingFiles || importingRemote || atItemLimit}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importReferenceFiles(files);
        }}
      />
      <header
        className="flex shrink-0 cursor-grab items-center justify-between gap-1 border-b border-line bg-card px-2 py-1.5 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => beginPanelDrag("move", event)}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-fg">
          <Images size={13} className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">포즈 참고 보드</span>
          <span className="rounded-full border border-line bg-raised px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-fg-3">
            {document.items.length}/{STUDIO_REFERENCE_BOARD_MAX_ITEMS}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="선택 이미지 속성"
            title="선택 이미지 속성"
            aria-pressed={inspectorOpen}
            disabled={!effectiveSelectedItem}
            className={cx(ICON_BUTTON, "size-8", inspectorOpen && "border-accent/60 bg-accent-soft text-accent")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setTransformPreview(null);
              setInspectorOpen((value) => !value);
            }}
          >
            <SlidersHorizontal size={13} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="참고 이미지 추가"
            title={atItemLimit ? `최대 ${STUDIO_REFERENCE_BOARD_MAX_ITEMS}개까지 추가할 수 있어요.` : "참고 이미지 추가"}
            aria-pressed={pickerOpen}
            disabled={atItemLimit}
            className={cx(ICON_BUTTON, "size-8", pickerOpen && "border-accent/60 bg-accent-soft text-accent")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setPickerOpen((value) => !value);
              setTransformPreview(null);
              setInspectorOpen(false);
            }}
          >
            <ImagePlus size={13} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="포즈 참고 보드 닫기"
            title="닫기"
            className={cx(ICON_BUTTON, "size-8")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </header>

      {preferencesAuthority === "memory-only" ? (
        <p
          role="status"
          aria-live="polite"
          className="shrink-0 border-b border-warning/30 bg-warning/10 px-2 py-1 text-[0.61rem] leading-relaxed text-warning"
        >
          참고 보드 배치 설정은 현재 세션 메모리에서만 유지됩니다.
        </p>
      ) : null}

      <div
        data-testid="reference-board-dropzone"
        className="relative min-h-0 flex-1 overflow-hidden bg-[oklch(0.14_0.008_70)]"
        onDragEnter={beginFileDrop}
        onDragOver={continueFileDrop}
        onDragLeave={leaveFileDrop}
        onDrop={finishFileDrop}
      >
        {dropActive ? (
          <div
            role="status"
            className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-panel/90 p-4 text-center text-xs font-bold text-accent"
          >
            PNG · JPG · WebP · GIF를 놓아 참고 보드에 추가
          </div>
        ) : null}
        {importStatus && !dropActive ? (
          <p
            role="status"
            className="absolute left-2 right-2 top-2 z-40 rounded-lg border border-line bg-panel/95 px-2 py-1.5 text-[0.62rem] leading-relaxed text-fg-2 shadow-lg"
          >
            {importingFiles || importingRemote ? <Loader2 size={11} className="mr-1 inline animate-spin text-accent" aria-hidden /> : null}
            {importStatus}
          </p>
        ) : null}
        <div
          data-reference-board-canvas="true"
          data-testid="reference-board-canvas"
          className="absolute inset-0 bottom-12 overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.35 0.012 68 / 0.16) 1px, transparent 1px), linear-gradient(90deg, oklch(0.35 0.012 68 / 0.16) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            setSelectedItemId(null);
            setInspectorOpen(false);
          }}
        >
          {document.items.length === 0 ? (
            <div className="grid h-full place-items-center p-4 text-center">
              <div>
                <ImageIcon className="mx-auto text-fg-3" size={23} aria-hidden />
                <p className="mt-2 text-[0.72rem] font-semibold text-fg">함께 볼 참고 이미지를 모아보세요</p>
                <p className="mx-auto mt-1 max-w-[28ch] text-[0.65rem] leading-relaxed text-fg-3">
                  여러 이미지를 겹쳐 배치하고 크기·각도·투명도를 비교할 수 있어요.
                </p>
                <button
                  type="button"
                  className={cx(CONTROL_BUTTON, "mt-3 border-accent/60 bg-accent text-on-accent hover:bg-accent-2")}
                  onClick={() => setPickerOpen(true)}
                >
                  <ImagePlus size={13} aria-hidden /> 이미지 추가
                </button>
              </div>
            </div>
          ) : null}

          {document.items.map((item) => {
            const asset = resolveReferenceAsset(item, assets);
            const isSelected = item.id === effectiveSelectedId;
            const view = dragPreview?.itemId === item.id
              ? dragPreview.view
              : transformPreview?.itemId === item.id
                ? transformPreview.view
                : item.view;
            const width = item.asset.width ?? asset?.width ?? 1;
            const height = item.asset.height ?? asset?.height ?? 1;
            const framePercent = studioReferenceItemFramePercent(width, height);
            const label = referenceItemLabel(item, asset);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`${label} ${eyedropperActive && isSelected ? "색상 추출" : "이동 및 선택"}`}
                aria-pressed={isSelected}
                title={asset
                  ? eyedropperActive && isSelected
                    ? `${label} — 클릭해서 원본 색상 추출`
                    : `${label} — 드래그해서 이동`
                  : `${label} — 원본 에셋을 찾을 수 없음`}
                className={cx(
                  "absolute grid touch-none select-none place-items-center border bg-card/20 p-0 outline-none",
                  eyedropperActive && isSelected && "cursor-crosshair",
                  isSelected
                    ? "border-accent shadow-[0_0_0_1px_oklch(0.72_0.185_42/0.35)]"
                    : "border-transparent hover:border-line-strong focus-visible:border-accent"
                )}
                style={{
                  left: `${view.centerX * 100}%`,
                  top: `${view.centerY * 100}%`,
                  width: `${framePercent.width}%`,
                  height: `${framePercent.height}%`,
                  opacity: view.opacity,
                  filter: view.grayscale ? "grayscale(1)" : undefined,
                  transform: `translate(-50%, -50%) rotate(${view.rotationDeg}deg) scale(${view.zoom * (view.flipX ? -1 : 1)}, ${view.zoom * (view.flipY ? -1 : 1)})`,
                  transformOrigin: "center",
                }}
                onPointerDown={(event) => beginItemDrag(item, view, event)}
                onPointerMove={previewItemDrag}
                onPointerUp={finishItemDrag}
                onPointerCancel={cancelItemDrag}
                onLostPointerCapture={cancelItemDrag}
                onKeyDown={(event) => sampleReferenceItemFromKeyboard(item, view, event)}
              >
                {asset ? (
                  <img
                    src={asset.dataUrl}
                    alt=""
                    draggable={false}
                    className="pointer-events-none h-full w-full object-contain"
                  />
                ) : (
                  <span className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-line bg-card/90 p-2 text-center text-[0.55rem] leading-tight text-fg-3">
                    <AlertTriangle size={14} className="text-warn" aria-hidden />
                    원본 없음
                  </span>
                )}
                {asset?.kind === "ai" ? (
                  <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-accent px-1 py-0.5 text-[0.48rem] font-bold text-on-accent">
                    <Sparkles size={7} aria-hidden /> AI
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-label="참고 이미지 레이어 (뒤에서 앞으로)"
          className="absolute inset-x-0 bottom-0 flex h-12 items-center gap-1 overflow-x-auto border-t border-line bg-card px-2"
        >
          {document.items.length === 0 ? (
            <span className="text-[0.62rem] text-fg-3">이미지를 추가하면 레이어가 여기에 표시됩니다.</span>
          ) : document.items.map((item, index) => {
            const asset = resolveReferenceAsset(item, assets);
            const label = referenceItemLabel(item, asset);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === effectiveSelectedId}
                aria-label={`레이어 ${index + 1}: ${label}`}
                title={`${index + 1}. ${label}`}
                className={cx(
                  "relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                  item.id === effectiveSelectedId ? "border-accent" : "border-line hover:border-line-strong"
                )}
                onClick={() => {
                  setSelectedItemId(item.id);
                  setPickerOpen(false);
                }}
              >
                {asset ? (
                  <img src={asset.dataUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <AlertTriangle size={13} className="text-warn" aria-hidden />
                )}
                <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-panel/90 px-1 text-[0.45rem] tabular-nums text-fg-2">
                  {index + 1}
                </span>
              </button>
            );
          })}
        </div>

        {pickerOpen ? (
          <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-panel p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[0.72rem] font-bold text-fg">보드에 이미지 추가</p>
              <button
                type="button"
                className="text-[0.68rem] font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setPickerOpen(false)}
              >
                보드로 돌아가기
              </button>
            </div>
            <button
              type="button"
              className={cx(
                CONTROL_BUTTON,
                "mb-1.5 w-full shrink-0 border-accent/60 bg-accent text-on-accent hover:bg-accent-2"
              )}
              disabled={addingAssetId !== null || importingFiles || importingRemote || atItemLimit}
              onClick={() => fileInputRef.current?.click()}
            >
              {importingFiles
                ? <Loader2 size={13} className="animate-spin" aria-hidden />
                : <Upload size={13} aria-hidden />}
              내 기기에서 가져오기
            </button>
            <p className="mb-2 text-center text-[0.56rem] text-fg-3">
              여러 파일 선택 · 보드로 드롭 · 이미지 붙여넣기 지원
            </p>
            <form
              className="mb-2 rounded-lg border border-line bg-card/70 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void importRemoteReference();
              }}
            >
              <label htmlFor="studio-reference-remote-url" className="mb-1 flex items-center gap-1 text-[0.62rem] font-semibold text-fg-2">
                <Link2 size={11} aria-hidden /> 공개 이미지 URL
              </label>
              <div className="flex gap-1">
                <input
                  id="studio-reference-remote-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={remoteUrl}
                  maxLength={2048}
                  disabled={addingAssetId !== null || importingFiles || importingRemote || atItemLimit}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                  placeholder="https://example.com/reference.jpg"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-[0.65rem] text-fg outline-none placeholder:text-fg-3 focus:border-accent/60 disabled:opacity-45"
                />
                {importingRemote ? (
                  <button
                    type="button"
                    className={cx(ICON_BUTTON, "size-9 border-bad/40 text-bad")}
                    onClick={() => remoteImportAbortRef.current?.abort()}
                    aria-label="URL 이미지 가져오기 취소"
                  >
                    <X size={13} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!remoteUrl.trim() || addingAssetId !== null || importingFiles || atItemLimit}
                    className={cx(CONTROL_BUTTON, "h-9 min-h-9 shrink-0 border-line bg-panel px-2 text-fg-2 hover:border-accent/50 hover:text-accent")}
                  >
                    <Link2 size={12} aria-hidden /> 가져오기
                  </button>
                )}
              </div>
              <p className="mt-1 text-[0.54rem] leading-relaxed text-fg-3">
                서버가 공개 HTTP(S) 주소와 최대 3MB 이미지만 확인하며, 내부망·비공개 주소로 향하는 위험한 리디렉션은 차단합니다.
              </p>
            </form>
            <label className="relative mb-2 block shrink-0">
              <Search size={12} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-3" />
              <input
                type="search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder={`이름으로 찾기 (${assets.length}개)`}
                aria-label="에셋 이름 검색"
                className="h-8 w-full rounded-lg border border-line bg-card pl-7 pr-2 text-[0.7rem] text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {libraryStatus === "loading" ? (
                <div className="space-y-1.5" aria-label="에셋 목록 불러오는 중">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="h-14 animate-pulse rounded-lg border border-line bg-card" />
                  ))}
                </div>
              ) : libraryStatus === "error" ? (
                <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                  <AlertTriangle className="text-warn" size={17} aria-hidden />
                  <p className="text-[0.68rem] leading-relaxed text-fg-3">{libraryError}</p>
                  <button
                    type="button"
                    className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised")}
                    onClick={retryLoadAssets}
                  >
                    다시 시도
                  </button>
                </div>
              ) : assets.length === 0 ? (
                <p className="px-3 py-7 text-center text-[0.68rem] leading-relaxed text-fg-3">
                  저장된 에셋이 없어요. 위 버튼에서 바로 가져오거나 보드에 파일을 놓아 주세요.
                </p>
              ) : filteredAssets.length === 0 ? (
                <p className="px-3 py-7 text-center text-[0.68rem] text-fg-3">
                  &ldquo;{pickerQuery}&rdquo;와 일치하는 에셋이 없어요.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {filteredAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      aria-label={`${asset.name} 보드에 추가`}
                      title={`${asset.name} 보드에 추가`}
                      disabled={
                        atItemLimit ||
                        addingAssetId !== null ||
                        importingFiles ||
                        importingRemote
                      }
                      className="group relative flex h-16 items-center justify-center overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-45"
                      onClick={() => void addAssetToBoard(asset)}
                    >
                      <img src={asset.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-panel/90 px-1 py-0.5 text-[0.5rem] text-fg-2">
                        {asset.name}
                      </span>
                      {addingAssetId === asset.id ? (
                        <Loader2 size={16} className="absolute animate-spin text-accent" aria-hidden />
                      ) : null}
                      {asset.kind === "ai" ? (
                        <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[0.45rem] font-bold text-on-accent">
                          <Sparkles size={6} aria-hidden /> AI
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {libraryError && libraryStatus !== "error" ? (
                <p role="status" className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-2 py-1.5 text-[0.65rem] leading-relaxed text-warn">
                  {libraryError}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {inspectorOpen && effectiveSelectedItem && selectedView ? (
          <div className="absolute inset-x-0 bottom-12 z-20 max-h-[58%] overflow-y-auto border-t border-line bg-panel/95 p-2 shadow-[0_-8px_22px_oklch(0.08_0.01_70/0.35)]">
            <div className="mb-2 flex items-center gap-1">
              <p className="mr-auto min-w-0 truncate text-[0.68rem] font-semibold text-fg">
                {referenceItemLabel(effectiveSelectedItem, resolveReferenceAsset(effectiveSelectedItem, assets))}
              </p>
              <button
                type="button"
                aria-label="한 단계 뒤로"
                title="한 단계 뒤로"
                disabled={selectedIndex <= 0}
                className={cx(ICON_BUTTON, "size-7")}
                onClick={() => emitDocumentChange(reorderStudioReferenceBoardItem(document, effectiveSelectedItem.id, selectedIndex - 1))}
              >
                <ChevronLeft size={12} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="한 단계 앞으로"
                title="한 단계 앞으로"
                disabled={selectedIndex < 0 || selectedIndex >= document.items.length - 1}
                className={cx(ICON_BUTTON, "size-7")}
                onClick={() => emitDocumentChange(reorderStudioReferenceBoardItem(document, effectiveSelectedItem.id, selectedIndex + 1))}
              >
                <ChevronRight size={12} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="좌우 반전"
                title="좌우 반전"
                aria-pressed={selectedView.flipX}
                className={cx(ICON_BUTTON, "size-7", selectedView.flipX && "border-accent/60 bg-accent-soft text-accent")}
                onClick={() => patchSelectedView({ flipX: !selectedView.flipX })}
              >
                <FlipHorizontal2 size={12} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="상하 반전"
                title="상하 반전"
                aria-pressed={selectedView.flipY}
                className={cx(ICON_BUTTON, "size-7", selectedView.flipY && "border-accent/60 bg-accent-soft text-accent")}
                onClick={() => patchSelectedView({ flipY: !selectedView.flipY })}
              >
                <FlipVertical2 size={12} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={selectedView.grayscale ? "원본 색상으로 보기" : "흑백으로 보기"}
                title="흑백 보기"
                aria-pressed={selectedView.grayscale}
                className={cx(ICON_BUTTON, "size-7", selectedView.grayscale && "border-accent/60 bg-accent-soft text-accent")}
                onClick={() => patchSelectedView({ grayscale: !selectedView.grayscale })}
              >
                <span className="size-3 rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="선택 이미지 삭제"
                title="선택 이미지 삭제"
                className={cx(ICON_BUTTON, "size-7 hover:border-bad/50 hover:bg-bad/10 hover:text-bad")}
                onClick={() => {
                  const next = removeStudioReferenceBoardItem(document, effectiveSelectedItem.id);
                  if (emitDocumentChange(next)) {
                    setSelectedItemId(null);
                    setTransformPreview(null);
                    setInspectorOpen(false);
                  }
                }}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
            <div className="space-y-1.5">
              <ReferenceRangeControl
                label="크기"
                ariaLabel="선택 이미지 크기"
                value={selectedView.zoom * 100}
                min={5}
                max={3200}
                step={5}
                format={(value) => `${Math.round(value)}%`}
                onPreview={(value) => previewSelectedView({ zoom: value / 100 })}
                onCommit={(value) => patchSelectedView({ zoom: value / 100 })}
                onCancel={clearTransformPreview}
              />
              <ReferenceRangeControl
                label="회전"
                ariaLabel="선택 이미지 회전"
                value={selectedView.rotationDeg}
                min={-180}
                max={179}
                step={1}
                format={(value) => `${Math.round(value)}°`}
                onPreview={(value) => previewSelectedView({ rotationDeg: value })}
                onCommit={(value) => patchSelectedView({ rotationDeg: value })}
                onCancel={clearTransformPreview}
              />
              <ReferenceRangeControl
                label="불투명도"
                ariaLabel="선택 이미지 불투명도"
                value={selectedView.opacity * 100}
                min={0}
                max={100}
                step={1}
                format={(value) => `${Math.round(value)}%`}
                onPreview={(value) => previewSelectedView({ opacity: value / 100 })}
                onCommit={(value) => patchSelectedView({ opacity: value / 100 })}
                onCancel={clearTransformPreview}
              />
            </div>
            {colorPickingEnabled ? (
              <section aria-label="선택 참고 이미지 색상" className="mt-2 border-t border-line pt-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-[0.68rem] font-semibold text-fg">
                    <Palette size={13} className="shrink-0 text-accent" aria-hidden />
                    주요 색상
                  </span>
                  <button
                    type="button"
                    aria-label={eyedropperActive ? "참고 이미지 스포이드 끄기" : "참고 이미지 스포이드 켜기"}
                    aria-pressed={eyedropperActive}
                    disabled={colorAnalysisStatus !== "ready"}
                    className={cx(
                      CONTROL_BUTTON,
                      "min-h-11 border-line bg-card px-2 text-fg-2 hover:bg-raised",
                      eyedropperActive && "border-accent/60 bg-accent-soft text-accent"
                    )}
                    onClick={() => {
                      setEyedropperActive((current) => {
                        const next = !current;
                        setColorInteractionStatus(
                          next
                            ? "선택 이미지에서 색을 누르세요. Enter 또는 Space는 이미지 중앙 색을 선택합니다."
                            : "참고 이미지 스포이드 모드를 종료했습니다."
                        );
                        return next;
                      });
                    }}
                    onKeyDown={exitReferenceEyedropperFromKeyboard}
                  >
                    <Pipette size={13} aria-hidden /> 스포이드
                  </button>
                </div>

                {colorAnalysisStatus === "loading" ? (
                  <div role="status" className="mt-2 flex min-h-11 items-center gap-2 text-[0.65rem] text-fg-3">
                    <Loader2 size={14} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
                    선택 이미지의 색상을 분석하는 중…
                  </div>
                ) : null}

                {colorAnalysisStatus === "error" && colorAnalysisError ? (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p role="alert" className="text-[0.64rem] leading-relaxed text-warn">
                        {colorAnalysisError}
                      </p>
                      {selectedColorSource && isStudioReferenceLocalRasterDataUrl(selectedColorSource) ? (
                        <button
                          type="button"
                          className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          onClick={() => setColorAnalysisNonce((nonce) => nonce + 1)}
                        >
                          <RefreshCw size={12} aria-hidden /> 다시 분석
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {colorAnalysisStatus === "ready" && paletteColors.length > 0 ? (
                  <div role="group" aria-label="추출된 주요 색상" className="mt-2 flex flex-wrap gap-1.5">
                    {paletteColors.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`${hex} 색상 선택`}
                        aria-pressed={pickedColor === hex}
                        title={`${hex} 기본색으로 선택`}
                        className={cx(
                          "relative grid size-11 place-items-center rounded-lg border bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          pickedColor === hex ? "border-accent" : "border-line hover:border-line-strong"
                        )}
                        onClick={() => applyReferenceColor(hex)}
                        onKeyDown={exitReferenceEyedropperFromKeyboard}
                      >
                        <span
                          className="size-7 rounded-md border border-line/70"
                          style={{ backgroundColor: hex }}
                          aria-hidden
                        />
                        {pickedColor === hex ? (
                          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-accent text-on-accent">
                            <Check size={10} aria-hidden />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                {colorAnalysisStatus === "ready" && paletteColors.length === 0 ? (
                  <p role="status" className="mt-2 text-[0.64rem] leading-relaxed text-fg-3">
                    불투명한 픽셀이 없어 추출할 주요 색상이 없습니다.
                  </p>
                ) : null}

                {colorAnalysisStatus === "ready" ? (
                  <p className="mt-2 text-[0.61rem] leading-relaxed text-fg-3">
                    색상 분석은 이 브라우저에서만 실행됩니다. 흑백 보기 중에도 원본 이미지 색상을 선택합니다.
                  </p>
                ) : null}
                {colorInteractionStatus ? (
                  <p role="status" aria-live="polite" className="mt-1 text-[0.62rem] leading-relaxed text-fg-2">
                    {colorInteractionStatus}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="패널 크기 조절 (방향키로도 조절 가능, 더블클릭으로 기본 크기)"
        title="드래그해서 크기 조절 (더블클릭: 기본 크기)"
        className="absolute bottom-0 right-0 z-30 size-4 cursor-nwse-resize border-none bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        style={{
          touchAction: "none",
          clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
          backgroundColor: "oklch(0.55 0.01 70 / 0.35)",
        }}
        onPointerDown={(event) => beginPanelDrag("resize", event)}
        onKeyDown={resizeByKeyboard}
        onDoubleClick={() => {
          const { w, h } = readViewport();
          updateSettings((previous) => ({ ...previous, ...resetReferencePanelSize(previous, w, h) }));
        }}
      />
    </div>
  );
}
