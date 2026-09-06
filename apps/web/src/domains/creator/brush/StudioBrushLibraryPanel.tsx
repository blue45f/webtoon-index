// 브러시 라이브러리 패널 — OPFS SQLite를 제품 권위로 사용하고 StudioPage가 소유한 배열은
// 기존 데스크톱/모바일 소비자를 위한 controlled projection으로 갱신한다. 이름 붙은 브러시 설정을
// 저장·고정·복제·이름변경·안전 삭제하고,
// 앱 전용 JSON·Photoshop ABR·libmypaint MYB·Krita KPP 를 가져오고, 안전한 앱 전용 JSON으로
// 내보낸다. MYB/KPP 는 그릴 수 있는 범위만 등록하고 나머지는 경고로 노출한다
// (studio-brush-pack-import.ts).
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  LoaderCircle,
  Pencil,
  Pin,
  RefreshCw,
  Rows3,
  Save,
  Share2,
  Trash2,
  Upload,
  Waves,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { downloadBlob } from "../export/studio-export";
import { BRUSH_PRESETS } from "../studio-brush";
import { useStudioInspectorFocusScroll } from "../studio-inspector-focus-effect";

import { studioCoreBrushCatalogItemById } from "./studio-brush-catalog-core";
import {
  brushFileName,
  createBrush,
  importBrushFromJson,
  sanitizeBrushSnapshot,
  sortBrushesForLibrary,
  writeBrushJson,
  type DeletedBrushRecord,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  BrushLibraryRepositoryError,
  type BrushLibraryPage,
} from "./studio-brush-library-repository";
import {
  STUDIO_BRUSH_LIBRARY_CHANGED_EVENT,
  openProductBrushLibraryRepository,
  type ProductBrushLibraryAuthority,
  type ProductBrushLibraryRepository,
} from "./studio-brush-library-sqlite-repository";
import {
  STUDIO_BRUSH_PACK_ACCEPT,
  studioBrushPackFormatOf,
} from "./studio-brush-pack-format";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";
import {
  studioBrushPreviewDashArray,
  studioBrushPreviewDotCenters,
  studioBrushPreviewOpacity,
  studioBrushPreviewPathD,
  studioBrushPreviewRibbonD,
  studioBrushPreviewStrokeWidth,
} from "./studio-brush-visual";
import { STUDIO_STABILIZER_MODES } from "./studio-stroke-stabilizer";

import type {
  BrushLifecycleStage,
  BrushVariantGroup,
} from "./studio-brush-catalog-lifecycle";

import { cx } from "@/shared/lib/cx";

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const PREVIEW_SWATCH_MIN = 10;
const PREVIEW_SWATCH_MAX = 30;
const SAVED_PREVIEW_WIDTH = 84;
const SAVED_PREVIEW_HEIGHT = 28;

function brushPresetLabel(brushId: string): string {
  return BRUSH_PRESETS.find((preset) => preset.id === brushId)?.name ?? brushId;
}

function savedBrushPresetLabel(brush: StudioSavedBrush): string {
  const sourcePresetName = brush.sourcePresetName?.trim();
  if (sourcePresetName) return sourcePresetName;
  return studioBrushPackDescriptorById(brush.sourcePresetId)?.catalogName
    ?? brushPresetLabel(brush.brushId);
}

function stabilizerModeLabel(mode: StudioSavedBrush["stabilizerMode"]): string {
  return STUDIO_STABILIZER_MODES.find((candidate) => candidate.id === mode)?.label ?? mode;
}

function previewSize(strokeWidth: number): number {
  return Math.round(
    PREVIEW_SWATCH_MIN
      + (Math.min(48, Math.max(1, strokeWidth)) / 48) * (PREVIEW_SWATCH_MAX - PREVIEW_SWATCH_MIN)
  );
}

function SavedBrushStrokePreview({ brush }: { brush: StudioSavedBrush }) {
  const sourceDescriptor = studioBrushPackDescriptorById(brush.sourcePresetId);
  const catalogItem = studioCoreBrushCatalogItemById(
    brush.sourcePresetId ?? brush.brushId
  ) ?? studioCoreBrushCatalogItemById(brush.brushId);
  const style = sourceDescriptor?.previewStyle ?? catalogItem?.previewStyle ?? "solid";
  const weight = Math.min(1, Math.max(0.18, brush.strokeWidth / 36));
  const strokeWidth = studioBrushPreviewStrokeWidth(weight, style);
  const path = studioBrushPreviewPathD(style, SAVED_PREVIEW_WIDTH, SAVED_PREVIEW_HEIGHT);
  const ribbon = studioBrushPreviewRibbonD(
    style,
    SAVED_PREVIEW_WIDTH,
    SAVED_PREVIEW_HEIGHT,
    weight
  );
  const dash = studioBrushPreviewDashArray(style);
  const opacity = studioBrushPreviewOpacity(brush.brushOpacity);
  const dotStyle = style === "dashed" ? "texture" : style;
  const dots = studioBrushPreviewDotCenters(dotStyle, 36, 16).map((dot) => ({
    x: 4 + dot.x * ((SAVED_PREVIEW_WIDTH - 8) / 36),
    y: 3 + dot.y * ((SAVED_PREVIEW_HEIGHT - 6) / 16),
    r: dot.r * Math.min(
      (SAVED_PREVIEW_WIDTH - 8) / 36,
      (SAVED_PREVIEW_HEIGHT - 6) / 16
    ),
  }));
  const diffuse = style === "soft" || style === "glow" || style === "neon";

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${SAVED_PREVIEW_WIDTH} ${SAVED_PREVIEW_HEIGHT}`}
      data-studio-saved-brush-preview={style}
      data-studio-saved-brush-preview-opacity={opacity}
      className="h-9 w-24 shrink-0"
    >
      <rect
        x={0.5}
        y={0.5}
        width={(SAVED_PREVIEW_WIDTH - 1) / 2}
        height={SAVED_PREVIEW_HEIGHT - 1}
        rx={5}
        fill="oklch(0.9 0.008 70)"
      />
      <rect
        x={SAVED_PREVIEW_WIDTH / 2}
        y={0.5}
        width={(SAVED_PREVIEW_WIDTH - 1) / 2}
        height={SAVED_PREVIEW_HEIGHT - 1}
        rx={5}
        fill="oklch(0.19 0.009 68)"
      />
      <rect
        x={0.5}
        y={0.5}
        width={SAVED_PREVIEW_WIDTH - 1}
        height={SAVED_PREVIEW_HEIGHT - 1}
        rx={5}
        fill="none"
        stroke="oklch(0.42 0.013 64 / 0.7)"
      />
      {dots.length > 0 ? (
        <g fill={brush.color} opacity={opacity}>
          {dots.map((dot, index) => (
            <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />
          ))}
        </g>
      ) : (
        <>
          {diffuse ? (
            <path
              d={path}
              fill="none"
              stroke={brush.color}
              strokeWidth={strokeWidth * 2.1}
              strokeLinecap="round"
              opacity={opacity * 0.18}
            />
          ) : null}
          {ribbon ? (
            <path d={ribbon} fill={brush.color} opacity={opacity} />
          ) : (
            <path
              d={path}
              fill="none"
              stroke={brush.color}
              strokeWidth={strokeWidth}
              strokeLinecap={brush.tipRoundness < 0.35 ? "butt" : "round"}
              strokeLinejoin="round"
              strokeDasharray={dash}
              opacity={opacity}
            />
          )}
        </>
      )}
    </svg>
  );
}

const storageErrorMessage = "브러시를 이 브라우저에 저장하지 못했어요. 저장소 권한이나 여유 공간을 확인해주세요.";
const storageQuotaMessage = "브러시 개수 제한은 없지만 이 기기의 저장 공간이 부족해 저장하지 못했어요. 불필요한 파일을 정리한 뒤 다시 시도해주세요.";
const libraryUnreadableMessage = "저장된 브러시 데이터를 안전하게 읽지 못해 변경을 막았어요. 브라우저 저장 데이터를 백업한 뒤 복구해주세요.";
const BRUSH_LIBRARY_PRODUCT_PAGE_SIZE = 256;

function brushLibraryAuthorityLabel(
  authority: ProductBrushLibraryAuthority | "loading" | "error",
  displayedTotal: string,
): string {
  if (authority === "sqlite") {
    return `저장·가져오기·공유·재적용 · ${displayedTotal}개 · 무제한 · 로컬 SQL`;
  }
  if (authority === "memory-session") {
    return `세션 편집·가져오기·공유·재적용 · ${displayedTotal}개 · 비영속 메모리 · 브라우저 종료 시 사라짐`;
  }
  if (authority === "error") {
    return "브러시 카탈로그를 사용할 수 없습니다 · 저장되지 않음";
  }
  return "로컬 SQL 브러시 카탈로그 연결 중…";
}

function brushMutationMessage(
  authority: ProductBrushLibraryAuthority,
  durable: string,
  session: string,
): string {
  return authority === "sqlite"
    ? durable
    : `${session} 브라우저를 닫으면 사라져요.`;
}

type BrushExposureTier = "core" | "all" | "experimental";

/**
 * 노출 단계·변형군 거버넌스 API. `studio-brush-catalog-lifecycle` 는 전체 카탈로그를 정적으로
 * 끌고 오는 모듈이라 패널 청크에 싣지 않고 마운트 뒤 지연 로드한 결과만 여기 담는다.
 * 로드 전/실패 시 핵심·실험 보기는 fail closed 로 잠기고(무필터 노출 금지), 격리 제외는
 * zero-import 격리 원장으로 항상 동기 적용된다.
 */
interface BrushExposureGovernance {
  stageOf: (presetId: unknown) => BrushLifecycleStage | null;
  variantGroupOf: (presetId: unknown) => BrushVariantGroup | null;
}

const EXPOSURE_TIER_OPTIONS: readonly {
  id: BrushExposureTier;
  label: string;
  title: string;
}[] = [
  { id: "core", label: "핵심", title: "기본 셸프에 노출되는 핵심 프리셋으로 저장한 브러시만 보기" },
  { id: "all", label: "전체", title: "격리 프리셋을 제외한 모든 저장 브러시 보기" },
  { id: "experimental", label: "실험", title: "실험 단계 프리셋으로 저장한 브러시만 보기" },
];

/** 저장 브러시의 노출 판정 기준 프리셋 id — 원본 프리셋이 있으면 그쪽, 없으면 런타임 브러시. */
function savedBrushExposurePresetId(brush: StudioSavedBrush): string {
  return brush.sourcePresetId ?? brush.brushId;
}

function brushCatalogPresetLabel(presetId: string): string {
  return studioBrushPackDescriptorById(presetId)?.catalogName
    ?? studioCoreBrushCatalogItemById(presetId)?.name
    ?? brushPresetLabel(presetId);
}

export interface StudioBrushLibraryPanelProps {
  currentSnapshot: StudioBrushSnapshot;
  brushes: StudioSavedBrush[];
  activeBrushId?: string | null;
  onBrushesChange: (brushes: StudioSavedBrush[]) => void;
  onApplyBrush: (brush: StudioSavedBrush) => void;
  onBrushDeleted: (deleted: DeletedBrushRecord) => void;
  /** 테스트/호스트 주입 seam. 제품 기본은 공유 OPFS SQLite 런타임이다. */
  repositoryFactory?: () => Promise<ProductBrushLibraryRepository>;
}

export function StudioBrushLibraryPanel({
  currentSnapshot,
  brushes,
  activeBrushId = null,
  onBrushesChange,
  onApplyBrush,
  onBrushDeleted,
  repositoryFactory = openProductBrushLibraryRepository,
}: StudioBrushLibraryPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState<"stroke" | "text">("stroke");
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  // 노출 단계 필터는 이 컴포넌트 상태로만 유지한다(이번 슬라이스는 비영속, 기본은 전체).
  const [exposureTier, setExposureTier] = useState<BrushExposureTier>("all");
  const [exposureGovernance, setExposureGovernance] =
    useState<BrushExposureGovernance | null>(null);
  const [exposureGovernanceFailed, setExposureGovernanceFailed] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const [repositoryAuthority, setRepositoryAuthority] = useState<
    ProductBrushLibraryAuthority | "loading" | "error"
  >("loading");
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageCursor, setPageCursor] = useState<BrushLibraryPage["nextCursor"]>(null);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(brushes.length);
  const saveTriggerRef = useRef<HTMLButtonElement>(null);
  const renameReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const mutationClockRef = useRef<() => number>(Date.now);
  const pageGenerationRef = useRef(0);
  const loadedDepthRef = useRef(BRUSH_LIBRARY_PRODUCT_PAGE_SIZE);
  const brushesRef = useRef(brushes);
  brushesRef.current = brushes;
  const orderedBrushes = sortBrushesForLibrary(brushes);
  // 격리 프리셋은 어떤 보기의 새 목록에도 나타나지 않는다 — 노출 제거일 뿐, 저장 데이터와
  // 문서 재생·메타데이터 해석은 그대로다(studio-brush-quarantine.ts 의 USED_PRESET_DATA_PRESERVED).
  const freshBrushes = orderedBrushes.filter(
    (brush) => !isStudioBrushQuarantinedPresetId(savedBrushExposurePresetId(brush)),
  );
  const visibleBrushes = exposureTier === "all"
    ? freshBrushes
    : exposureGovernance === null
      ? []
      : freshBrushes.filter(
          (brush) =>
            exposureGovernance.stageOf(savedBrushExposurePresetId(brush)) === exposureTier,
        );
  const savedSiblingByPresetId = new Map<string, StudioSavedBrush>();
  for (const brush of freshBrushes) {
    const presetId = savedBrushExposurePresetId(brush);
    if (!savedSiblingByPresetId.has(presetId)) savedSiblingByPresetId.set(presetId, brush);
  }
  const exposureEmptyMessage = exposureTier !== "all" && exposureGovernanceFailed
    ? "브러시 노출 단계 정보를 불러오지 못해 이 보기를 열 수 없어요. 전체 보기를 이용해 주세요."
    : exposureTier !== "all" && exposureGovernance === null
      ? "브러시 노출 단계 정보를 불러오는 중이에요…"
      : exposureTier === "core"
        ? "핵심 단계 프리셋으로 저장한 브러시가 없어요."
        : exposureTier === "experimental"
          ? "실험 단계 프리셋으로 저장한 브러시가 없어요."
          : "격리된 프리셋으로 저장한 브러시는 새 목록에 표시하지 않아요.";
  const displayedTotal = totalCount === null
    ? `${brushes.length}${hasMorePages ? "+" : ""}`
    : String(totalCount);

  const pageRequest = useCallback((cursor: string | null, limit: number) => {
    return {
      cursor,
      limit,
      ...(deferredSearchQuery ? { search: deferredSearchQuery } : {}),
      ...(pinnedOnly ? { pinned: true } : {}),
    };
  }, [deferredSearchQuery, pinnedOnly]);

  // 그리기 ▸ 내 브러시 메뉴 항목이 인스펙터를 열고 이 목록까지 스크롤한다.
  useStudioInspectorFocusScroll("brush.saved-library", sectionRef);

  useEffect(() => {
    let active = true;
    const generation = ++pageGenerationRef.current;
    setPageLoading(true);
    const repositoryPromise = repositoryFactory();
    void repositoryPromise
      .then(async (product) => {
        const page = await product.repository.query(
          pageRequest(null, BRUSH_LIBRARY_PRODUCT_PAGE_SIZE),
        );
        if (!active || generation !== pageGenerationRef.current) return;
        const stored = [...page.items];
        loadedDepthRef.current = Math.max(BRUSH_LIBRARY_PRODUCT_PAGE_SIZE, stored.length);
        setError(null);
        setRepositoryAuthority(product.authority);
        setPageCursor(page.nextCursor);
        setHasMorePages(page.hasMore);
        setTotalCount(page.totalCount ?? null);
        onBrushesChange(stored);
      })
      .catch((caught: unknown) => {
        if (!active || generation !== pageGenerationRef.current) return;
        setRepositoryAuthority("error");
        setError(
          caught instanceof BrushLibraryRepositoryError
            && (caught.code === "corrupt" || caught.code === "unsupported-version")
            ? libraryUnreadableMessage
            : storageErrorMessage,
        );
      })
      .finally(() => {
        if (active && generation === pageGenerationRef.current) setPageLoading(false);
      });
    return () => {
      active = false;
      if (generation === pageGenerationRef.current) pageGenerationRef.current += 1;
    };
  }, [onBrushesChange, pageRequest, repositoryFactory]);

  useEffect(() => {
    const handleLibraryChange = () => {
      setRepositoryBusy(true);
      void productRepository()
        .then((product) => refreshFromRepository(product))
        .catch(setRepositoryError)
        .finally(() => setRepositoryBusy(false));
    };
    globalThis.addEventListener?.(STUDIO_BRUSH_LIBRARY_CHANGED_EVENT, handleLibraryChange);
    return () => {
      globalThis.removeEventListener?.(STUDIO_BRUSH_LIBRARY_CHANGED_EVENT, handleLibraryChange);
    };
  });

  // 수명주기 거버넌스는 마운트 뒤 한 번 지연 로드한다. 실패는 조용히 삼키지 않고
  // exposureGovernanceFailed 로 남겨 핵심·실험 보기를 명시적 안내와 함께 잠근다(fail closed).
  useEffect(() => {
    let active = true;
    void import("./studio-brush-catalog-lifecycle")
      .then((lifecycle) => {
        if (!active) return;
        setExposureGovernance({
          stageOf: lifecycle.brushLifecycleStageOf,
          variantGroupOf: lifecycle.brushVariantGroupOf,
        });
      })
      .catch(() => {
        if (active) setExposureGovernanceFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function productRepository(): Promise<ProductBrushLibraryRepository> {
    return repositoryFactory();
  }

  function variantSiblingEntries(
    brush: StudioSavedBrush,
    group: BrushVariantGroup,
  ): readonly { presetId: string; label: string; savedSibling: StudioSavedBrush | null }[] {
    const selfPresetId = savedBrushExposurePresetId(brush);
    return group.memberPresetIds
      .filter((presetId) =>
        presetId !== selfPresetId && !isStudioBrushQuarantinedPresetId(presetId))
      .map((presetId) => {
        const savedSibling = savedSiblingByPresetId.get(presetId) ?? null;
        return {
          presetId,
          label: brushCatalogPresetLabel(presetId),
          savedSibling: savedSibling !== null && savedSibling.id === brush.id
            ? null
            : savedSibling,
        };
      });
  }

  function setRepositoryError(caught: unknown): void {
    if (caught instanceof BrushLibraryRepositoryError && caught.code === "quota-exceeded") {
      setError(storageQuotaMessage);
      setDoneMsg(null);
      return;
    }
    if (
      caught instanceof BrushLibraryRepositoryError
      && (
        caught.code === "corrupt"
        || caught.code === "unsupported-version"
        || caught.code === "read-error"
      )
    ) {
      setError(libraryUnreadableMessage);
    } else {
      setError(storageErrorMessage);
    }
    setDoneMsg(null);
  }

  async function refreshFromRepository(
    product: ProductBrushLibraryRepository,
  ): Promise<StudioSavedBrush[]> {
    const generation = ++pageGenerationRef.current;
    const retainedDepth = Math.max(
      BRUSH_LIBRARY_PRODUCT_PAGE_SIZE,
      loadedDepthRef.current,
      brushesRef.current.length,
    );
    const page = await product.repository.query(pageRequest(null, retainedDepth));
    if (generation !== pageGenerationRef.current) return brushesRef.current;
    const stored = [...page.items];
    loadedDepthRef.current = retainedDepth;
    onBrushesChange(stored);
    setError(null);
    setRepositoryAuthority(product.authority);
    setPageCursor(page.nextCursor);
    setHasMorePages(page.hasMore);
    setTotalCount(page.totalCount ?? null);
    return stored;
  }

  async function handleLoadMore(): Promise<void> {
    if (!hasMorePages || pageCursor === null || pageLoading || repositoryBusy) return;
    const generation = ++pageGenerationRef.current;
    setError(null);
    setPageLoading(true);
    try {
      const product = await productRepository();
      const page = await product.repository.query(
        pageRequest(pageCursor, BRUSH_LIBRARY_PRODUCT_PAGE_SIZE),
      );
      if (generation !== pageGenerationRef.current) return;
      const merged = new Map(
        brushesRef.current.map((brush) => [brush.id, brush] as const),
      );
      for (const brush of page.items) merged.set(brush.id, brush);
      const stored = [...merged.values()];
      loadedDepthRef.current = Math.max(loadedDepthRef.current, stored.length);
      onBrushesChange(stored);
      setRepositoryAuthority(product.authority);
      setPageCursor(page.nextCursor);
      setHasMorePages(page.hasMore);
      setTotalCount(page.totalCount ?? null);
    } catch (caught) {
      if (generation === pageGenerationRef.current) setRepositoryError(caught);
    } finally {
      if (generation === pageGenerationRef.current) setPageLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setDoneMsg(null);
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const deleted = await product.repository.delete(id);
      if (!deleted) return;
      await refreshFromRepository(product);
      onBrushDeleted(deleted);
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function handleTogglePinned(id: string) {
    setError(null);
    setDoneMsg(null);
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const brush = await product.repository.getById(id);
      if (!brush) return;
      await product.repository.put({ ...brush, pinned: !brush.pinned });
      await refreshFromRepository(product);
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function handleOverwrite(brush: StudioSavedBrush) {
    setError(null);
    setDoneMsg(null);
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const existing = await product.repository.getById(brush.id);
      if (!existing) return;
      const { snapshot } = sanitizeBrushSnapshot(currentSnapshot);
      await product.repository.put({
        ...existing,
        ...snapshot,
        updatedAt: mutationClockRef.current(),
      });
      await refreshFromRepository(product);
      setDoneMsg(brushMutationMessage(
        product.authority,
        `"${brush.name}" 브러시를 지금 설정으로 덮어썼어요.`,
        `"${brush.name}" 브러시를 현재 세션 설정으로 바꿨어요.`,
      ));
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function handleDuplicate(id: string) {
    setError(null);
    setDoneMsg(null);
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const duplicated = await product.repository.duplicate(id);
      if (!duplicated) return;
      await refreshFromRepository(product);
      setDoneMsg(brushMutationMessage(
        product.authority,
        `"${duplicated.name}" 브러시를 복제했어요.`,
        `"${duplicated.name}" 브러시를 현재 세션에서 복제했어요.`,
      ));
      setError(null);
      setRenamingId(duplicated.id);
      setRenamingName(duplicated.name);
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
    }
  }

  function startRename(brush: StudioSavedBrush, trigger: HTMLButtonElement) {
    renameReturnFocusRef.current = trigger;
    setRenamingId(brush.id);
    setRenamingName(brush.name);
  }

  function finishRenameFocus() {
    globalThis.requestAnimationFrame?.(() => {
      if (renameReturnFocusRef.current?.isConnected) {
        renameReturnFocusRef.current.focus({ preventScroll: true });
      }
      renameReturnFocusRef.current = null;
    });
  }

  async function commitRename(restoreFocus = false) {
    if (!renamingId) return;
    setError(null);
    setDoneMsg(null);
    const id = renamingId;
    const name = renamingName.trim();
    setRenamingId(null);
    if (!name) {
      if (restoreFocus) finishRenameFocus();
      return;
    }
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const brush = await product.repository.getById(id);
      if (brush) {
        await product.repository.put({
          ...brush,
          name,
          updatedAt: mutationClockRef.current(),
        });
        await refreshFromRepository(product);
      }
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
      if (restoreFocus) finishRenameFocus();
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void commitRename(true);
    else if (event.key === "Escape") {
      setRenamingId(null);
      finishRenameFocus();
    }
  }

  async function storeNewBrush(
    brush: StudioSavedBrush,
    successMessage: (authority: ProductBrushLibraryAuthority) => string,
  ): Promise<boolean> {
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      await product.repository.put(brush);
      await refreshFromRepository(product);
      setError(null);
      setDoneMsg(successMessage(product.authority));
      return true;
    } catch (caught) {
      setRepositoryError(caught);
      return false;
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function handleSaveCurrent() {
    const created = createBrush(newName, currentSnapshot);
    if (!await storeNewBrush(created, (authority) => brushMutationMessage(
      authority,
      `"${created.name}" 브러시를 저장했어요.`,
      `"${created.name}" 브러시를 현재 세션에 보관했어요.`,
    ))) return;
    setNewName("");
    setCreatorOpen(false);
    globalThis.requestAnimationFrame?.(() => saveTriggerRef.current?.focus({ preventScroll: true }));
  }

  /** Engine-neutral external presets commit to SQLite or the explicitly labelled session. */
  async function importBrushProgramFile(
    file: File,
    format: "myb" | "kpp" | "sut" | "sutg" | "bundle",
  ) {
    setImporting(true);
    setRepositoryBusy(true);
    try {
      const {
        importAndCommitStudioBrushProgramFile,
        studioBrushPackFormatLabel,
        studioBrushPackImportNotes,
      } = await import( "./studio-brush-pack-import");
      const product = await productRepository();
      const committed = await importAndCommitStudioBrushProgramFile(
        file,
        format,
        product.repository,
      );
      await refreshFromRepository(product);
      const label = studioBrushPackFormatLabel(format);
      const imported = committed.saved.savedCount;
      const skipped = committed.saved.skippedDuplicateCount;
      const onlyBrush = imported === 1 ? committed.materialized[0] : undefined;
      const details = [product.authority === "sqlite"
        ? onlyBrush
          ? `${label} 브러시 "${onlyBrush.name}"을(를) SQLite 내 브러시에 저장했어요.`
          : `${label}에서 브러시 ${imported}개를 SQLite 내 브러시에 저장했어요.`
        : onlyBrush
          ? `${label} 브러시 "${onlyBrush.name}"을(를) 현재 비영속 세션에 추가했어요.`
          : `${label}에서 브러시 ${imported}개를 현재 비영속 세션에 추가했어요.`];
      if (skipped > 0) details.push(`중복 ID ${skipped}개는 건너뛰었어요.`);
      if (product.authority === "memory-session") {
        details.push("브라우저를 닫으면 사라지므로 필요한 브러시는 파일로 내보내 주세요.");
      }
      details.push(...studioBrushPackImportNotes(committed.result));
      setError(null);
      setDoneMsg(details.join(" "));
    } catch (caught) {
      if (caught instanceof BrushLibraryRepositoryError) setRepositoryError(caught);
      else setError(
        caught instanceof Error ? caught.message : "브러시 프리셋 파일을 가져오지 못했어요.",
      );
    } finally {
      setImporting(false);
      setRepositoryBusy(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setDoneMsg(null);
    const format = studioBrushPackFormatOf(file.name, file.type);
    if (
      format === "myb"
      || format === "kpp"
      || format === "sut"
      || format === "sutg"
      || format === "bundle"
    ) {
      await importBrushProgramFile(file, format);
      return;
    }
    if (format === "abr") {
      setImporting(true);
      try {
        const { importStudioAbrFile } = await import("../studio-abr-import-client");
        const result = await importStudioAbrFile(file, {
          executionBackend: "worker",
        });
        const imported = result.brushes.map((candidate) => createBrush(candidate.name, candidate.snapshot));
        const product = await productRepository();
        const saved = await product.repository.putMany(imported);
        await refreshFromRepository(product);
        const details = [`ABR에서 브러시 ${saved.savedCount}개를 가져왔어요.`];
        if (product.authority === "memory-session") {
          details.push("현재 비영속 세션에만 추가했으며 브라우저를 닫으면 사라져요.");
        }
        const skipped = result.skippedBrushCount + saved.skippedDuplicateCount;
        if (skipped > 0) details.push(`${skipped}개는 펜촉 누락 또는 중복 ID라 건너뛰었어요.`);
        if (result.approximatedBrushCount > 0) {
          details.push(`${result.approximatedBrushCount}개의 Photoshop 전용 효과는 가장 가까운 Studio 다이내믹스로 변환했어요.`);
        }
        setDoneMsg(details.join(" "));
      } catch (caught) {
        if (caught instanceof BrushLibraryRepositoryError) setRepositoryError(caught);
        else setError(caught instanceof Error ? caught.message : "ABR 브러시 팩을 가져오지 못했어요.");
      } finally {
        setImporting(false);
      }
      return;
    }
    if (format !== "json") {
      setError("브러시 파일 형식을 알아보지 못했어요. .abr · .myb · .kpp · .sut · .sutg · .bundle · .json 파일을 선택해 주세요.");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError("파일이 너무 커요. 2MB 이하 브러시 설정(.json) 파일만 가져올 수 있어요.");
      return;
    }
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const text = loadEvent.target?.result;
      if (typeof text !== "string") {
        setError("브러시 설정 파일을 읽지 못했어요.");
        setImporting(false);
        return;
      }
      try {
        const fallbackName = file.name.replace(/\.json$/i, "");
        const { brush: imported, adjustedFields } = importBrushFromJson(text, fallbackName);
        const parts = [`"${imported.name}" 브러시를 가져왔어요.`];
        if (adjustedFields.length > 0) {
          parts.push(`일부 값(${adjustedFields.join(", ")})은 안전 범위로 보정했어요.`);
        }
        await storeNewBrush(imported, (authority) => authority === "sqlite"
          ? parts.join(" ")
          : `${parts.join(" ")} 현재 비영속 세션에만 추가했으며 브라우저를 닫으면 사라져요.`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "브러시 설정 파일을 가져오지 못했어요.");
      } finally {
        setImporting(false);
      }
    };
    reader.onerror = () => {
      setError("브러시 설정 파일을 읽지 못했어요.");
      setImporting(false);
    };
    reader.readAsText(file);
  }

  function handleExport(brush: StudioSavedBrush) {
    downloadBlob(
      new Blob([writeBrushJson(brush)], { type: "application/json;charset=utf-8" }),
      brushFileName(brush)
    );
  }

  async function handleShare(brush: StudioSavedBrush) {
    setError(null);
    setDoneMsg(null);
    const file = new File(
      [writeBrushJson(brush)],
      brushFileName(brush),
      { type: "application/json;charset=utf-8" }
    );
    const canShareFile =
      typeof navigator.share === "function"
      && (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }));
    if (!canShareFile) {
      downloadBlob(file, file.name);
      setDoneMsg(`공유 시트를 지원하지 않아 "${brush.name}" 파일을 내려받았어요.`);
      return;
    }
    try {
      await navigator.share({
        title: `${brush.name} · ToonSpectrum 브러시`,
        text: "이 브러시 설정을 ToonSpectrum에서 가져올 수 있어요.",
        files: [file],
      });
      setDoneMsg(`"${brush.name}" 브러시를 공유했어요.`);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("브러시 공유를 열지 못했어요. 내보내기로 파일을 저장해 다시 시도해 주세요.");
    }
  }

  async function handleApplySavedBrush(brush: StudioSavedBrush): Promise<void> {
    setError(null);
    setRepositoryBusy(true);
    try {
      const product = await productRepository();
      const used = await product.repository.put({
        ...brush,
        lastUsedAt: mutationClockRef.current(),
      });
      await refreshFromRepository(product);
      onApplyBrush(used);
    } catch (caught) {
      setRepositoryError(caught);
    } finally {
      setRepositoryBusy(false);
    }
  }

  return (
    <section
      ref={sectionRef}
      className="space-y-2 border-t border-line/35 pt-2"
      aria-label="내 브러시"
      data-studio-brush-library-scope="saved"
      data-studio-brush-surface-role="user-library-management"
      data-studio-brush-library-authority={repositoryAuthority}
      data-studio-brush-library-loaded-count={brushes.length}
      data-studio-brush-exposure-tier={exposureTier}
      aria-busy={repositoryBusy || pageLoading || repositoryAuthority === "loading"}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[0.68rem] font-semibold text-fg-2">내 브러시 · 사용자 설정</p>
          <p className="text-[0.6rem] tabular-nums text-fg-3">
            {brushLibraryAuthorityLabel(repositoryAuthority, displayedTotal)}
          </p>
        </div>
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[0.62rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-within:outline focus-within:outline-2 focus-within:outline-accent lg:min-h-8">
          {importing
            ? <LoaderCircle size={12} className="animate-spin" aria-hidden />
            : <Upload size={12} aria-hidden />}
          {importing ? "변환 중…" : "가져오기"}
          <input
            type="file"
            accept={STUDIO_BRUSH_PACK_ACCEPT}
            aria-label="브러시 설정 · Photoshop ABR · Clip Studio SUT/SUTG · libmypaint MYB · Krita KPP/번들 가져오기"
            className="sr-only"
            disabled={importing}
            onChange={handleImportFile}
          />
        </label>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="이름·프리셋 검색"
          aria-label="내 브러시 검색"
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent lg:h-8"
        />
        <button
          type="button"
          aria-label="고정 브러시만 보기"
          aria-pressed={pinnedOnly}
          onClick={() => setPinnedOnly((active) => !active)}
          className={cx(
            "flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line px-2 text-[0.62rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8",
            pinnedOnly ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-raised hover:text-fg",
          )}
        >
          <Pin size={12} className={pinnedOnly ? "fill-current" : undefined} aria-hidden />
          고정만
        </button>
      </div>

      {error ? <p className="text-[0.64rem] leading-relaxed text-bad" role="alert">{error}</p> : null}
      {doneMsg && !error ? <p className="text-[0.64rem] leading-relaxed text-good" role="status">{doneMsg}</p> : null}

      <button
        ref={saveTriggerRef}
        type="button"
        onClick={() => setCreatorOpen((open) => !open)}
        aria-expanded={creatorOpen}
        disabled={repositoryAuthority === "loading" || repositoryAuthority === "error"}
        className={cx(
          "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-[0.68rem] font-semibold transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-9",
          creatorOpen ? "bg-raised text-fg" : "text-fg-2"
        )}
      >
        <Save size={13} aria-hidden />
        {repositoryAuthority === "sqlite"
          ? "현재 브러시 저장"
          : repositoryAuthority === "memory-session"
            ? "현재 브러시 세션에 보관"
            : "브러시 카탈로그 준비 중"}
      </button>
      {creatorOpen ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-card p-2">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="브러시 이름"
            aria-label="새 브러시 이름"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- 명시적 저장 동작 뒤 열리는 짧은 이름 입력 단계다.
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleSaveCurrent();
              else if (event.key === "Escape") {
                setCreatorOpen(false);
                globalThis.requestAnimationFrame?.(() => saveTriggerRef.current?.focus({ preventScroll: true }));
              }
            }}
            className="h-11 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-accent lg:h-8"
          />
          <button type="button" onClick={() => void handleSaveCurrent()} className="min-h-11 rounded-lg bg-accent text-[0.68rem] font-semibold text-on-accent hover:bg-accent-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-8">
            {repositoryAuthority === "sqlite" ? "저장" : "세션에 보관"}
          </button>
        </div>
      ) : null}

      {orderedBrushes.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 text-[0.62rem] font-semibold text-fg-3">노출</span>
          <div
            role="group"
            aria-label="브러시 노출 단계 필터"
            className="grid min-w-0 flex-1 grid-cols-3 rounded-xl border border-line bg-card p-0.5"
          >
            {EXPOSURE_TIER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.title}
                aria-pressed={exposureTier === option.id}
                data-studio-brush-exposure-tier-option={option.id}
                onClick={() => setExposureTier(option.id)}
                className={cx(
                  "flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2 text-[0.62rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8",
                  exposureTier === option.id
                    ? "bg-raised text-fg"
                    : "text-fg-3 hover:bg-raised/70 hover:text-fg"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {orderedBrushes.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 text-[0.62rem] font-semibold text-fg-3">표시</span>
          <div
            role="group"
            aria-label="내 브러시 표시 방식"
            className="grid min-w-0 flex-1 grid-cols-2 rounded-xl border border-line bg-card p-0.5"
          >
            <button
              type="button"
              title="내 브러시 획 미리보기"
              aria-label="내 브러시 획 미리보기"
              aria-pressed={viewMode === "stroke"}
              data-studio-saved-brush-view-option="stroke"
              onClick={() => setViewMode("stroke")}
              className={cx(
                "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-[0.62rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8",
                viewMode === "stroke"
                  ? "bg-raised text-fg"
                  : "text-fg-3 hover:bg-raised/70 hover:text-fg"
              )}
            >
              <Waves size={13} strokeWidth={1.8} aria-hidden />
              획
            </button>
            <button
              type="button"
              title="내 브러시 이름 목록"
              aria-label="내 브러시 이름 목록"
              aria-pressed={viewMode === "text"}
              data-studio-saved-brush-view-option="text"
              onClick={() => setViewMode("text")}
              className={cx(
                "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-[0.62rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8",
                viewMode === "text"
                  ? "bg-raised text-fg"
                  : "text-fg-3 hover:bg-raised/70 hover:text-fg"
              )}
            >
              <Rows3 size={13} strokeWidth={1.8} aria-hidden />
              목록
            </button>
          </div>
        </div>
      ) : null}

      {orderedBrushes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[0.64rem] leading-relaxed text-fg-3">
          {repositoryAuthority === "sqlite"
            ? "현재 펜 설정을 저장하면 모바일에서도 바로 꺼내 쓸 수 있어요."
            : repositoryAuthority === "memory-session"
              ? "현재 펜 설정을 이 세션에 보관할 수 있어요. 브라우저를 닫기 전에 파일로 내보내 주세요."
              : "브러시 카탈로그를 준비하고 있어요."}
        </p>
      ) : (
        <>
          {visibleBrushes.length === 0 ? (
            <p
              data-studio-brush-exposure-empty={exposureTier}
              className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[0.64rem] leading-relaxed text-fg-3"
            >
              {exposureEmptyMessage}
            </p>
          ) : (
          <ul
            data-studio-saved-brush-view={viewMode}
            className={cx(
              "lg:max-h-80 lg:overflow-y-auto lg:pr-1",
              viewMode === "stroke" ? "space-y-1.5" : "space-y-1"
            )}
          >
            {visibleBrushes.map((brush) => {
            const variantGroup =
              exposureGovernance?.variantGroupOf(savedBrushExposurePresetId(brush)) ?? null;
            const variantSiblings =
              variantGroup === null ? [] : variantSiblingEntries(brush, variantGroup);
            return (
            <li
              key={brush.id}
              className={cx(
                "rounded-xl border bg-card p-2 transition-colors",
                activeBrushId === brush.id ? "border-accent/70 bg-accent-soft/20" : "border-line"
              )}
            >
              <div className="mb-1.5 flex min-h-8 items-center gap-1">
                {renamingId === brush.id ? (
                  <input
                    type="text"
                    value={renamingName}
                    onChange={(event) => setRenamingName(event.target.value)}
                    aria-label={`${brush.name} 새 이름`}
                    onBlur={() => void commitRename(false)}
                    onKeyDown={handleRenameKeyDown}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- 사용자가 복제/이름 변경을 요청한 직후의 인라인 편집이다.
                    autoFocus
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-accent bg-panel px-2 py-1 text-[0.7rem] text-fg outline-none lg:min-h-8"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-fg" title={brush.name}>
                    {brush.name}
                  </span>
                )}
                {activeBrushId === brush.id ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.55rem] font-bold text-accent">
                    <Check size={10} strokeWidth={3} aria-hidden /> 사용 중
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleTogglePinned(brush.id)}
                  aria-label={`${brush.name} ${brush.pinned ? "고정 해제" : "빠른 선반에 고정"}`}
                  aria-pressed={brush.pinned}
                  title={brush.pinned ? "고정 해제" : "빠른 선반에 고정"}
                  className={cx(
                    "grid size-11 shrink-0 place-items-center rounded-lg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:size-8",
                    brush.pinned ? "text-accent" : "text-fg-3"
                  )}
                >
                  <Pin size={14} className={brush.pinned ? "fill-current" : undefined} aria-hidden />
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleApplySavedBrush(brush)}
                aria-pressed={activeBrushId === brush.id}
                aria-label={`${brush.name} 브러시 적용, ${savedBrushPresetLabel(brush)}, ${brush.strokeWidth}px, ${Math.round(brush.brushOpacity * 100)}퍼센트`}
                className={cx(
                  "flex w-full items-center gap-2 rounded-lg border border-line/60 bg-panel/50 px-2 text-left transition-colors hover:border-accent hover:bg-accent-soft/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  viewMode === "stroke" ? "min-h-16" : "min-h-12"
                )}
              >
                {viewMode === "stroke" ? (
                  <SavedBrushStrokePreview brush={brush} />
                ) : (
                  <span
                    className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-[linear-gradient(135deg,#f8fafc_0_50%,#242936_50%_100%)] p-px"
                    style={{
                      width: previewSize(brush.strokeWidth),
                      height: previewSize(brush.strokeWidth),
                    }}
                    aria-hidden
                  >
                    <span
                      className="block size-full rounded-full"
                      style={{
                        background: brush.color,
                        opacity: brush.brushOpacity,
                      }}
                    />
                  </span>
                )}
                <span className="min-w-0 flex-1 text-[0.62rem] leading-snug text-fg-3">
                  <span className="block truncate text-fg-2">{savedBrushPresetLabel(brush)} · {brush.strokeWidth}px · {Math.round(brush.brushOpacity * 100)}%</span>
                  {viewMode === "stroke" ? (
                    <>
                      <span className="block">{stabilizerModeLabel(brush.stabilizerMode)} {brush.stabilizer} · 후보정 {brush.postCorrection}</span>
                      {brush.brushId === "calligraphy" ? <span className="block">촉 {Math.round(brush.tipAngle)}° · 원형도 {Math.round(brush.tipRoundness * 100)}%</span> : null}
                    </>
                  ) : null}
                </span>
              </button>

              {variantGroup !== null && variantSiblings.length > 0 ? (
                <details
                  className="group mt-1.5 border-t border-line/50 pt-1.5"
                  data-studio-brush-variant-group={variantGroup.id}
                >
                  <summary
                    title={`${variantGroup.intent} · 형제 프리셋: ${variantSiblings
                      .map((entry) => entry.label)
                      .join(", ")}`}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      event.preventDefault();
                      const details = event.currentTarget.parentElement;
                      if (details instanceof HTMLDetailsElement) details.open = false;
                      event.currentTarget.focus({ preventScroll: true });
                    }}
                    className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-[0.62rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8 [&::-webkit-details-marker]:hidden"
                  >
                    <span>변형군 · 형제 {variantSiblings.length}종</span>
                    <ChevronDown
                      size={13}
                      className="transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <ul
                    aria-label={`${brush.name} 변형군 형제 프리셋`}
                    className="flex flex-wrap gap-1 pt-1"
                  >
                    {variantSiblings.map((entry) => {
                      const sibling = entry.savedSibling;
                      return (
                        <li key={entry.presetId}>
                          {sibling ? (
                            <button
                              type="button"
                              onClick={() => void handleApplySavedBrush(sibling)}
                              aria-label={`${entry.label} 변형 브러시 적용 · 저장 브러시 ${sibling.name}`}
                              className="flex min-h-11 items-center rounded-lg border border-line px-2 text-[0.6rem] font-medium text-fg-2 transition-colors hover:border-accent hover:bg-accent-soft/30 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8"
                            >
                              {entry.label}
                            </button>
                          ) : (
                            <span
                              title="이 변형 프리셋으로 저장한 브러시가 없어요 — 브러시 카탈로그에서 선택할 수 있어요"
                              className="flex min-h-11 items-center rounded-lg border border-dashed border-line/60 px-2 text-[0.6rem] text-fg-3 lg:min-h-8"
                            >
                              {entry.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}

              <details className="group mt-1.5 border-t border-line/50 pt-1.5">
                <summary
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    const details = event.currentTarget.parentElement;
                    if (details instanceof HTMLDetailsElement) details.open = false;
                    event.currentTarget.focus({ preventScroll: true });
                  }}
                  className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-[0.62rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8 [&::-webkit-details-marker]:hidden"
                >
                  <span>관리 · 덮어쓰기, 복제, 공유</span>
                  <ChevronDown
                    size={13}
                    className="transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="grid grid-cols-3 gap-1 pt-1 sm:grid-cols-6">
                <button type="button" onClick={() => void handleOverwrite(brush)} aria-label={`${brush.name} 브러시를 지금 설정으로 덮어쓰기`} title={repositoryAuthority === "sqlite" ? "지금 설정으로 덮어쓰기 (같은 브러시에 저장)" : "지금 설정으로 덮어쓰기 (현재 세션에만 반영)"} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <RefreshCw size={12} aria-hidden /> 덮어쓰기
                </button>
                <button type="button" onClick={() => void handleDuplicate(brush.id)} aria-label={`${brush.name} 복제`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <Copy size={12} aria-hidden /> 복제
                </button>
                <button type="button" onClick={(event) => startRename(brush, event.currentTarget)} aria-label={`${brush.name} 이름 변경`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <Pencil size={12} aria-hidden /> 이름
                </button>
                <button type="button" onClick={() => handleExport(brush)} aria-label={`${brush.name} 내보내기`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <Download size={12} aria-hidden /> 내보내기
                </button>
                <button type="button" onClick={() => void handleShare(brush)} aria-label={`${brush.name} 브러시 공유`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <Share2 size={12} aria-hidden /> 공유
                </button>
                <button type="button" onClick={() => void handleDelete(brush.id)} aria-label={`${brush.name} 브러시 삭제`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg text-[0.6rem] font-medium text-fg-3 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:min-h-8">
                  <Trash2 size={12} aria-hidden /> 삭제
                </button>
                </div>
              </details>
            </li>
            );
            })}
          </ul>
          )}
          {hasMorePages ? (
            <button
              type="button"
              disabled={pageLoading || repositoryBusy}
              onClick={() => void handleLoadMore()}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 lg:min-h-9"
            >
              {pageLoading ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}
              {pageLoading ? "불러오는 중…" : `더 불러오기 (${brushes.length}/${displayedTotal})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
