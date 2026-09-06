import {
  ChevronDown,
  Clock3,
  Eye,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from "react";

import {
  createStudioEffectId,
  isStudioEffectFavorite,
  rememberStudioEffectRecent,
  normalizeStudioEffectFavoriteState,
  toggleStudioEffectFavorite,
  type StudioEffectFavoriteState,
} from "../studio-effect-favorites";
import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  studioSegmentChipClass,
} from "../studio-panel-ui";
import {
  acquireProductStudioUiPreferencesRepository,
  type StudioUiPreferencesRepository,
} from "../studio-ui-preferences-sqlite";
import { StudioCurvePanel } from "../StudioCurvePanel";
import { useStudioHistogramSource } from "../useStudioHistogramSource";
import { useStudioModalSheet } from "../useStudioModalSheet";

import {
  STUDIO_FILTER_DIALOG_CATALOG,
  searchStudioFilterDialogCatalog,
  studioFilterDialogPreviewStyle,
  studioFilterGroupLabel,
  type StudioFilterCatalogGroup,
  type StudioFilterDialogCatalogEntry,
} from "./studio-filter-catalog";
import {
  acquireProductFilterLibraryRepository,
  subscribeStudioFilterLibraryChanges,
  type ProductFilterLibraryAuthority,
  type ProductFilterLibraryRepository,
  type StudioFilterLibraryPage,
  type StudioFilterLibraryPreset,
} from "./studio-filter-library-sqlite-repository";
import {
  STUDIO_FILTER_LABELS,
  cloneStudioFilterDraft,
  createStudioFilterDraft,
  isStudioFilterPackDraft,
  studioFilterDraftToPatch,
  type StudioFilterDraft,
  type StudioFilterKind,
  type StudioFilterPackDraft,
} from "./studio-filter-menu";
import { STUDIO_FILTER_DIALOG_GROUP_ORDER } from "./studio-filter-menu-groups";
import {
  STUDIO_FILTER_PACK_DEFS,
  isStudioFilterPackKind,
  type StudioFilterPackValues,
} from "./studio-filter-pack";
import { isStudioFilterUnionWaveKind } from "./studio-filter-union-wave";

import type { ImageFilterFields } from "../render/studio-konva-filter-fields";
import type { CurvePoint, CurveRgbChannels } from "../studio-curves";
import type { StudioSelectionFilterMaskScope } from "../studio-selection-filter-mask-transaction";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

type FilterPatch = Partial<ImageFilterFields>;

const STUDIO_FILTER_LIBRARY_DIALOG_PAGE_SIZE = 128;

export type StudioFilterApplicationScope = "whole" | StudioSelectionFilterMaskScope;

type StudioFilterGalleryView =
  | "all"
  | "favorites"
  | "recent"
  | StudioFilterCatalogGroup;

/**
 * Must track the gallery grid's `grid-cols-2`: ArrowUp/ArrowDown move by exactly one visual row, so
 * a column count that disagrees with the class silently makes vertical arrows jump the wrong rows.
 */
const STUDIO_FILTER_GALLERY_COLUMNS = 2;

const STUDIO_FILTER_GALLERY_VIEWS: readonly {
  id: StudioFilterGalleryView;
  label: string;
}[] = [
  { id: "all", label: "전체" },
  { id: "favorites", label: "즐겨찾기" },
  { id: "recent", label: "최근" },
  ...STUDIO_FILTER_DIALOG_GROUP_ORDER.map((group) => ({
    id: group,
    label: studioFilterGroupLabel(group),
  })),
];

function studioFilterEffectId(kind: StudioFilterKind) {
  return createStudioEffectId("filter", kind);
}

function filterGalleryItems(
  query: string,
  view: StudioFilterGalleryView,
  favoriteState: StudioEffectFavoriteState,
): readonly StudioFilterDialogCatalogEntry[] {
  const searched = searchStudioFilterDialogCatalog(query);
  if (view === "all") return searched;
  if (view === "favorites") {
    return searched.filter((entry) =>
      isStudioEffectFavorite(favoriteState, studioFilterEffectId(entry.kind)),
    );
  }
  if (view === "recent") {
    const recentOrder = new Map(
      favoriteState.recent.map((effectId, index) => [effectId, index]),
    );
    return searched
      .filter((entry) => recentOrder.has(studioFilterEffectId(entry.kind)))
      .toSorted(
        (left, right) =>
          recentOrder.get(studioFilterEffectId(left.kind))! -
          recentOrder.get(studioFilterEffectId(right.kind))!,
      );
  }
  return searched.filter((entry) => entry.group === view);
}

interface StudioFilterDialogProps {
  activeKey: string;
  kind: StudioFilterKind;
  image: ImageFilterFields;
  /** 선택 이미지의 src — 있으면 색상 커브 위에 히스토그램을 그린다(페이지 합성 대상이면 생략). */
  imageSrc?: string | null;
  initialDraft?: StudioFilterDraft;
  rootRef: RefObject<HTMLElement | null>;
  targetKind?: "image" | "page-composite";
  mutationLocked?: boolean;
  mutationLockReason?: string;
  applying?: boolean;
  /** A usable pixel selection captured for this image-filter session. */
  selectionAvailable?: boolean;
  selectionFeatherPx?: number;
  selectionInverted?: boolean;
  onPreview: (patch: FilterPatch | null) => void;
  onApply: (
    patch: FilterPatch,
    draft: StudioFilterDraft,
    scope: StudioFilterApplicationScope,
  ) => void;
  onClose: () => void;
  /** Tests may inject a repository; product defaults to the shared OPFS SQLite runtime. */
  acquireFilterLibrary?: () => Promise<ProductFilterLibraryRepository>;
  /** Test seam; product defaults to the shared SQLite/OPFS UI-preference authority. */
  acquireUiPreferences?: () => Promise<StudioUiPreferencesRepository>;
}

interface NumberControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  autofocus?: boolean;
  onChange: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function committedNumberDraft(rawValue: string, fallback: number, min: number, max: number): number {
  const normalized = rawValue.trim().replace(",", ".");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return clamp(fallback, min, max);
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : clamp(fallback, min, max);
}

function isEditableNumberDraft(rawValue: string): boolean {
  return /^-?(?:\d+)?(?:[.,]\d*)?$/.test(rawValue);
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  autofocus,
  onChange,
}: NumberControlProps): ReactElement {
  const id = `studio-filter-${label.replace(/\s+/g, "-")}`;
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const commitNumberDraft = (rawValue: string) => {
    const committed = committedNumberDraft(rawValue, value, min, max);
    setNumberDraft(null);
    if (committed !== value) onChange(committed);
  };
  const updateRange = (rawValue: string) => {
    const committed = clamp(Number(rawValue), min, max);
    setNumberDraft(null);
    onChange(committed);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-2 min-[420px]:grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)_5.5rem]">
      <label htmlFor={id} className="col-span-2 text-xs font-semibold text-fg-2 min-[420px]:col-span-1">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => updateRange(event.target.value)}
        // The unit lives in a plain span beside the numeric field, which no screen reader ties to
        // the slider — "반지름 24" alone does not say 24 of what.
        aria-valuetext={suffix ? `${value}${suffix}` : undefined}
        className="h-11 w-full cursor-pointer accent-accent sm:h-8 pointer-coarse:h-11"
        data-autofocus={autofocus ? "true" : undefined}
      />
      <label className="flex min-h-11 items-center rounded-xl border border-line bg-card px-2 focus-within:border-accent sm:min-h-10 pointer-coarse:min-h-11">
        <span className="sr-only">{label} 숫자</span>
        <input
          type="text"
          inputMode="decimal"
          value={numberDraft ?? String(value)}
          onFocus={(event) => setNumberDraft(event.currentTarget.value)}
          onChange={(event) => {
            if (isEditableNumberDraft(event.target.value)) setNumberDraft(event.target.value);
          }}
          onBlur={(event) => commitNumberDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitNumberDraft(event.currentTarget.value);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-right text-xs font-semibold tabular-nums text-fg outline-none"
          aria-label={`${label} 숫자`}
        />
        {suffix ? <span className="ml-1 text-[0.65rem] text-fg-3">{suffix}</span> : null}
      </label>
    </div>
  );
}

interface ColorControlProps {
  label: string;
  value: string;
  autofocus?: boolean;
  onChange: (value: string) => void;
}

// 듀오톤 등 색상 파라미터용 — 네이티브 색상 피커 + 현재 헥스 값 표시.
function ColorControl({ label, value, autofocus, onChange }: ColorControlProps): ReactElement {
  const id = `studio-filter-${label.replace(/\s+/g, "-")}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-2">
      <label htmlFor={id} className="text-xs font-semibold text-fg-2">
        {label}
      </label>
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-2 focus-within:border-accent sm:min-h-10 pointer-coarse:min-h-11">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          data-autofocus={autofocus ? "true" : undefined}
          aria-label={label}
        />
        <span className="min-w-0 flex-1 text-right text-xs font-semibold tabular-nums text-fg">
          {value}
        </span>
      </label>
    </div>
  );
}

interface FilterPackControlsProps {
  draft: StudioFilterPackDraft;
  onChange: (values: StudioFilterPackValues) => void;
}

// 필터 팩 종류 — studio-filter-pack의 파라미터 스키마로 컨트롤을 데이터 기반 렌더링.
function FilterPackControls({ draft, onChange }: FilterPackControlsProps): ReactElement {
  const def = STUDIO_FILTER_PACK_DEFS[draft.kind];
  const setValue = (key: string, value: number | string) => {
    onChange({ ...draft.values, [key]: value });
  };
  return (
    <>
      {def.params.map((param, index) => {
        if (param.control === "color") {
          const raw = draft.values[param.key];
          const fallback = def.defaults[param.key];
          return (
            <ColorControl
              key={param.key}
              label={param.label}
              value={typeof raw === "string" ? raw : String(fallback)}
              autofocus={index === 0}
              onChange={(value) => setValue(param.key, value)}
            />
          );
        }
        const raw = draft.values[param.key];
        const fallback = def.defaults[param.key];
        return (
          <NumberControl
            key={param.key}
            label={param.label}
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            {...(param.suffix ? { suffix: param.suffix } : {})}
            value={typeof raw === "number" ? raw : Number(fallback)}
            autofocus={index === 0}
            onChange={(value) => setValue(param.key, value)}
          />
        );
      })}
    </>
  );
}

function defaultDraft(kind: StudioFilterKind): StudioFilterDraft {
  return createStudioFilterDraft(kind, {});
}

/** 상단 메뉴·툴바처럼 원고 단축키를 삼키는 표면. 여기로 포커스를 돌려주면 ⌘Z가 죽는다. */
const STUDIO_SHORTCUT_BOUNDARY_SELECTOR =
  "[data-studio-shortcut-boundary='true'], [aria-modal='true']";

/** 스크림 자체의 페인트 — 위치는 밴드마다 인라인 style이 정한다. */
const STUDIO_FILTER_SCRIM_PAINT =
  "absolute bg-[oklch(0.08_0.01_70/0.78)] backdrop-blur-sm";

interface StudioFilterPreviewCutout {
  height: number;
  left: number;
  top: number;
  width: number;
}

function sameCutout(
  left: StudioFilterPreviewCutout | null,
  right: StudioFilterPreviewCutout | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** 뷰포트 좌표 사각형을 정수 px로 스냅한다(서브픽셀 잔상 방지). */
function cutoutFromRect(rect: DOMRect): StudioFilterPreviewCutout | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const top = Math.floor(rect.top);
  const left = Math.floor(rect.left);
  return {
    height: Math.ceil(rect.bottom) - top,
    left,
    top,
    width: Math.ceil(rect.right) - left,
  };
}

/**
 * 캔버스 구멍을 뺀 스크림 밴드(위/아래/왼/오른). 모달 바깥이 비활성이라는 신호는 그대로 두면서
 * 풀해상도로 계산된 미리보기를 아티스트가 실제로 볼 수 있게 캔버스 영역만 칠하지 않는다.
 */
function studioFilterScrimBands(
  cutout: StudioFilterPreviewCutout,
): readonly { key: string; style: CSSProperties }[] {
  const bottom = cutout.top + cutout.height;
  const right = cutout.left + cutout.width;
  return [
    { key: "top", style: { top: 0, left: 0, right: 0, height: Math.max(0, cutout.top) } },
    { key: "bottom", style: { top: Math.max(0, bottom), left: 0, right: 0, bottom: 0 } },
    {
      key: "left",
      style: {
        top: Math.max(0, cutout.top),
        left: 0,
        width: Math.max(0, cutout.left),
        height: cutout.height,
      },
    },
    {
      key: "right",
      style: {
        top: Math.max(0, cutout.top),
        left: Math.max(0, right),
        right: 0,
        height: cutout.height,
      },
    },
  ].filter((band) => band.style.height !== 0 && band.style.width !== 0);
}

type StudioFilterDialogOffset = { x: number; y: number };

/**
 * Where the artist last parked the panel, remembered for the whole studio session.
 *
 * The dialog is centred, so it lands squarely on the part of the page it is previewing — exactly the
 * pixels the artist opened it to judge. Desktop paint apps solve this by letting the panel be moved,
 * and the position has to survive closing and reopening or it has to be re-dragged for every filter.
 * It is deliberately not persisted to disk: a remembered offset from another window size would drop
 * the panel somewhere unhelpful, and the clamp below only guards the current viewport.
 */
let studioFilterDialogOffset: StudioFilterDialogOffset = { x: 0, y: 0 };

/**
 * Keeps the whole panel on screen — 적용 and 취소 included. Letting only the header stay reachable
 * would be enough to drag it back, but an artist who parks the panel low and then reaches for 적용
 * should not have to first discover that the button fell off the bottom edge. When the panel is
 * larger than the viewport it pins to the top-left margin instead, and its own scroll takes over.
 */
function clampStudioFilterDialogOffset(
  offset: StudioFilterDialogOffset,
  current: StudioFilterDialogOffset,
  rect: { top: number; left: number; width: number; height: number },
  viewport: { width: number; height: number },
): StudioFilterDialogOffset {
  const margin = 12;
  const restingLeft = rect.left - current.x;
  const restingTop = rect.top - current.y;
  const minX = margin - restingLeft;
  const maxX = viewport.width - margin - rect.width - restingLeft;
  const minY = margin - restingTop;
  const maxY = viewport.height - margin - rect.height - restingTop;
  return {
    x: Math.min(Math.max(offset.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(offset.y, minY), Math.max(minY, maxY)),
  };
}

export function StudioFilterDialog({
  activeKey,
  kind,
  image,
  imageSrc,
  initialDraft,
  rootRef,
  targetKind = "image",
  mutationLocked = false,
  mutationLockReason,
  applying = false,
  selectionAvailable = false,
  selectionFeatherPx = 0,
  selectionInverted = false,
  onPreview,
  onApply,
  onClose,
  acquireFilterLibrary = acquireProductFilterLibraryRepository,
  acquireUiPreferences = acquireProductStudioUiPreferencesRepository,
}: StudioFilterDialogProps): ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  // 히스토그램 원본 — src 키 LRU 캐시(디코드는 다이얼로그 세션당 최대 1회).
  const histogramSource = useStudioHistogramSource(imageSrc);
  const [activeKind, setActiveKind] = useState<StudioFilterKind>(kind);
  const [draft, setDraft] = useState<StudioFilterDraft>(() =>
    initialDraft && initialDraft.kind === kind
      ? cloneStudioFilterDraft(initialDraft)
      : createStudioFilterDraft(kind, image),
  );
  const canUseSelectionScope = targetKind === "image" && selectionAvailable;
  const [applicationScope, setApplicationScope] = useState<StudioFilterApplicationScope>(
    () => canUseSelectionScope ? "inside" : "whole",
  );
  const [previewEnabled, setPreviewEnabled] = useState(true);
  // Held down, the canvas drops back to the untouched page so the artist can see what the filter is
  // actually costing. Separate from `previewEnabled` because it must never survive the pointer.
  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [dialogOffset, setDialogOffset] = useState<StudioFilterDialogOffset>(
    () => studioFilterDialogOffset,
  );
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const galleryToggleRef = useRef<HTMLButtonElement>(null);
  const galleryPickPendingFocusRef = useRef(false);
  // Announced only after a gallery pick. The dialog's own title changes too, but a title is not a
  // live region, so nothing told a screen reader that the filter under the sliders is now different.
  const [galleryPickAnnouncement, setGalleryPickAnnouncement] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState("");
  const [galleryView, setGalleryView] = useState<StudioFilterGalleryView>("all");
  const [galleryFocusKind, setGalleryFocusKind] = useState<StudioFilterKind | null>(null);
  const [effectFavoriteState, setEffectFavoriteState] = useState(() =>
    rememberStudioEffectRecent(
      normalizeStudioEffectFavoriteState(),
      studioFilterEffectId(kind),
    ),
  );
  const effectFavoriteStateRef = useRef(effectFavoriteState);
  const effectPreferenceDirtyRef = useRef(false);
  const effectPreferenceRepositoryRef = useRef<StudioUiPreferencesRepository | null>(null);
  const effectPreferenceMountedRef = useRef(true);
  const [effectPreferenceAuthority, setEffectPreferenceAuthority] = useState<
    "loading" | "sqlite-opfs" | "memory-only"
  >("loading");
  const [installedCreatorPresets, setInstalledCreatorPresets] = useState<
    readonly StudioFilterLibraryPreset[]
  >([]);
  const [filterLibraryCursor, setFilterLibraryCursor] = useState<
    StudioFilterLibraryPage["nextCursor"]
  >(null);
  const [filterLibraryHasMore, setFilterLibraryHasMore] = useState(false);
  const [filterLibraryTotalCount, setFilterLibraryTotalCount] = useState(0);
  const [filterLibraryPageLoading, setFilterLibraryPageLoading] = useState(false);
  const filterLibraryProductRef = useRef<ProductFilterLibraryRepository | null>(null);
  const filterLibraryQueryGenerationRef = useRef(0);
  const [filterLibraryAuthority, setFilterLibraryAuthority] = useState<
    ProductFilterLibraryAuthority | "loading" | "error"
  >("loading");
  const installedPackPresets = isStudioFilterPackKind(activeKind)
    ? installedCreatorPresets.filter((preset) => preset.engine === activeKind)
    : [];
  const visibleGalleryItems = filterGalleryItems(
    galleryQuery,
    galleryView,
    effectFavoriteState,
  );
  /**
   * The one card that carries the grid's tab stop. Search re-filters on every keystroke, so the
   * remembered card disappears constantly — falling back to the active filter and then to the first
   * result keeps the grid tabbable instead of stranding it with no reachable entry at all.
   */
  const rovingGalleryKind =
    visibleGalleryItems.some((entry) => entry.kind === galleryFocusKind)
      ? galleryFocusKind
      : visibleGalleryItems.some((entry) => entry.kind === activeKind)
        ? activeKind
        : visibleGalleryItems[0]?.kind ?? null;
  const reportPreview = useEffectEvent(onPreview);
  // 미리보기가 켜져 있을 때 스크림에서 제외할 캔버스 영역(뷰포트 좌표). 측정 불가면 null → 통짜 스크림.
  const [previewCutout, setPreviewCutout] = useState<StudioFilterPreviewCutout | null>(null);

  useEffect(() => {
    effectPreferenceMountedRef.current = true;
    return () => {
      effectPreferenceMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void acquireUiPreferences()
      .then(async (repository) => {
        effectPreferenceRepositoryRef.current = repository;
        const loaded = await repository.loadEffectFavorites();
        const hydrated = effectPreferenceDirtyRef.current
          ? effectFavoriteStateRef.current
          : rememberStudioEffectRecent(loaded, studioFilterEffectId(kind));
        if (!effectPreferenceDirtyRef.current && active) {
          effectFavoriteStateRef.current = hydrated;
          setEffectFavoriteState(hydrated);
        }
        await repository.saveEffectFavorites(hydrated);
        if (active) setEffectPreferenceAuthority("sqlite-opfs");
      })
      .catch(() => {
        if (active) setEffectPreferenceAuthority("memory-only");
      });
    return () => {
      active = false;
    };
  }, [acquireUiPreferences, kind]);

  useEffect(() => {
    let active = true;
    const generation = filterLibraryQueryGenerationRef.current + 1;
    filterLibraryQueryGenerationRef.current = generation;
    async function loadInstalledPresets(): Promise<void> {
      if (!isStudioFilterPackKind(activeKind)) {
        setInstalledCreatorPresets([]);
        setFilterLibraryCursor(null);
        setFilterLibraryHasMore(false);
        setFilterLibraryTotalCount(0);
        return;
      }
      setFilterLibraryAuthority("loading");
      try {
        const product = await acquireFilterLibrary();
        const page = await product.repository.query({
          cursor: null,
          engine: activeKind,
          limit: STUDIO_FILTER_LIBRARY_DIALOG_PAGE_SIZE,
        });
        if (!active || filterLibraryQueryGenerationRef.current !== generation) return;
        filterLibraryProductRef.current = product;
        setInstalledCreatorPresets(page.items);
        setFilterLibraryCursor(page.nextCursor);
        setFilterLibraryHasMore(page.hasMore);
        setFilterLibraryTotalCount(page.totalCount);
        setFilterLibraryAuthority(product.authority);
      } catch {
        if (!active || filterLibraryQueryGenerationRef.current !== generation) return;
        setInstalledCreatorPresets([]);
        setFilterLibraryCursor(null);
        setFilterLibraryHasMore(false);
        setFilterLibraryTotalCount(0);
        setFilterLibraryAuthority("error");
      }
    }
    void loadInstalledPresets();
    const unsubscribe = subscribeStudioFilterLibraryChanges(() => {
      void loadInstalledPresets();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [acquireFilterLibrary, activeKind]);

  async function loadMoreInstalledFilterPresets(): Promise<void> {
    if (
      filterLibraryPageLoading
      || !filterLibraryHasMore
      || filterLibraryCursor === null
      || !isStudioFilterPackKind(activeKind)
    ) return;
    const product = filterLibraryProductRef.current;
    if (!product) return;
    const generation = filterLibraryQueryGenerationRef.current;
    setFilterLibraryPageLoading(true);
    try {
      const page = await product.repository.query({
        cursor: filterLibraryCursor,
        engine: activeKind,
        limit: STUDIO_FILTER_LIBRARY_DIALOG_PAGE_SIZE,
      });
      if (filterLibraryQueryGenerationRef.current !== generation) return;
      setInstalledCreatorPresets((current) => {
        const ids = new Set(current.map((preset) => preset.id));
        return [...current, ...page.items.filter((preset) => !ids.has(preset.id))];
      });
      setFilterLibraryCursor(page.nextCursor);
      setFilterLibraryHasMore(page.hasMore);
      setFilterLibraryTotalCount(page.totalCount);
    } catch {
      if (filterLibraryQueryGenerationRef.current === generation) {
        setFilterLibraryAuthority("error");
      }
    } finally {
      if (filterLibraryQueryGenerationRef.current === generation) {
        setFilterLibraryPageLoading(false);
      }
    }
  }

  useStudioModalSheet({
    activeKey,
    dialogRef,
    onDismiss: onClose,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    /**
     * 이 다이얼로그는 상단 메뉴에서 열리고, 메뉴 트리거는 단축키 경계 안에 있다. 기본 복귀 규칙대로
     * 트리거로 포커스를 돌려주면 이미 닫힌 메뉴가 키보드 소유권을 쥐고 적용 직후 ⌘Z가 통째로 막힌다.
     * 모달은 "연 자리"로 돌아가야 하고 여기서 그 자리는 작업 캔버스다.
     */
    resolveReturnFocus: () => {
      const root = rootRef.current;
      const ownerDocument = root?.ownerDocument ?? globalThis.document ?? null;
      if (!ownerDocument) return null;
      const launcher = ownerDocument.activeElement;
      const launcherSwallowsShortcuts =
        launcher !== null &&
        typeof (launcher as HTMLElement).closest === "function" &&
        (launcher as HTMLElement).closest(STUDIO_SHORTCUT_BOUNDARY_SELECTOR) !== null;
      if (!launcherSwallowsShortcuts) return null;
      return (root ?? ownerDocument).querySelector<HTMLElement>(
        "[data-studio-canvas-viewport]",
      );
    },
    rootRef,
  });

  useEffect(() => {
    if (!previewEnabled) {
      setPreviewCutout(null);
      return;
    }
    const root = rootRef.current;
    const ownerDocument = root?.ownerDocument ?? globalThis.document ?? null;
    const view = ownerDocument?.defaultView ?? null;
    const viewport = (root ?? ownerDocument)?.querySelector<HTMLElement>(
      "[data-studio-canvas-viewport]",
    );
    if (!view || !viewport) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const next = cutoutFromRect(viewport.getBoundingClientRect());
      setPreviewCutout((current) => (sameCutout(current, next) ? current : next));
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = view.requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof view.ResizeObserver === "function" ? new view.ResizeObserver(schedule) : null;
    observer?.observe(viewport);
    view.addEventListener("resize", schedule);
    view.addEventListener("scroll", schedule, true);
    return () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      observer?.disconnect();
      view.removeEventListener("resize", schedule);
      view.removeEventListener("scroll", schedule, true);
    };
  }, [previewEnabled, rootRef]);

  useEffect(() => {
    let frameId: number | null = null;
    frameId = requestAnimationFrame(() => {
      reportPreview(
        previewEnabled && !comparingOriginal ? studioFilterDraftToPatch(draft) : null,
      );
    });
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [comparingOriginal, draft, previewEnabled]);

  useEffect(() => {
    if (!galleryPickPendingFocusRef.current) return;
    galleryPickPendingFocusRef.current = false;
    // Choosing a filter collapses the gallery, which unmounts the card that had focus. The browser
    // then drops focus to <body>: the next Tab restarts from the top of the page, and a screen
    // reader is left outside the dialog with no word that the filter changed. Hand focus to the
    // browse toggle, which sits right where the gallery was and is what the artist would reopen.
    galleryToggleRef.current?.focus({ preventScroll: true });
  }, [activeKind]);

  useEffect(() => {
    if (!comparingOriginal) return;
    const view = dialogRef.current?.ownerDocument.defaultView ?? null;
    if (!view) return;
    // The hold happens on a control inside a focus-trapped modal, where neither pointer capture nor
    // the button's own blur survives the press — the modal takes focus back and the hold ended on
    // the very next frame, so the canvas never actually reverted. Whatever ends the press instead
    // reaches the window: the release, a cancelled pointer, or focus leaving the tab mid-hold.
    const release = () => setComparingOriginal(false);
    const releaseOnKey = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") release();
    };
    view.addEventListener("pointerup", release);
    view.addEventListener("pointercancel", release);
    view.addEventListener("keyup", releaseOnKey);
    view.addEventListener("blur", release);
    return () => {
      view.removeEventListener("pointerup", release);
      view.removeEventListener("pointercancel", release);
      view.removeEventListener("keyup", releaseOnKey);
      view.removeEventListener("blur", release);
    };
  }, [comparingOriginal]);

  useEffect(() => {
    if (!canUseSelectionScope && applicationScope !== "whole") {
      setApplicationScope("whole");
    }
  }, [applicationScope, canUseSelectionScope]);

  useEffect(() => () => reportPreview(null), []);

  const updateEffectFavoriteState = (
    update: (current: StudioEffectFavoriteState) => StudioEffectFavoriteState,
  ): void => {
    const next = update(effectFavoriteStateRef.current);
    effectFavoriteStateRef.current = next;
    effectPreferenceDirtyRef.current = true;
    setEffectFavoriteState(next);
    const save = effectPreferenceRepositoryRef.current
      ? effectPreferenceRepositoryRef.current.saveEffectFavorites(next)
      : acquireUiPreferences().then((repository) => {
          effectPreferenceRepositoryRef.current = repository;
          return repository.saveEffectFavorites(next);
        });
    void save
      .then(() => {
        if (effectPreferenceMountedRef.current) setEffectPreferenceAuthority("sqlite-opfs");
      })
      .catch(() => {
        if (effectPreferenceMountedRef.current) setEffectPreferenceAuthority("memory-only");
      });
  };

  const title = STUDIO_FILTER_LABELS[activeKind];
  const commitDialogOffset = (next: StudioFilterDialogOffset) => {
    const node = dialogRef.current;
    const view = node?.ownerDocument.defaultView ?? null;
    const clamped = node && view
      ? clampStudioFilterDialogOffset(next, studioFilterDialogOffset, node.getBoundingClientRect(), {
        width: view.innerWidth,
        height: view.innerHeight,
      })
      : next;
    studioFilterDialogOffset = clamped;
    setDialogOffset(clamped);
  };
  const startDialogDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX - dialogOffset.x,
      y: event.clientY - dialogOffset.y,
    };
  };
  const moveDialogDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    commitDialogOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y });
  };
  const endDialogDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  /** Arrow keys move the panel and Enter re-centres it, so the handle is not pointer-only. */
  const nudgeDialogWithKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitDialogOffset({ x: 0, y: 0 });
      return;
    }
    const step = event.shiftKey ? 48 : 12;
    const delta =
      event.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight"
          ? { x: step, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -step }
            : event.key === "ArrowDown"
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    commitDialogOffset({ x: dialogOffset.x + delta.x, y: dialogOffset.y + delta.y });
  };
  const reclampDialogOffset = useEffectEvent(() => {
    commitDialogOffset(studioFilterDialogOffset);
  });

  useEffect(() => {
    const node = dialogRef.current;
    const view = node?.ownerDocument.defaultView ?? null;
    if (!node || !view) return;
    // Opening the gallery roughly doubles the panel's height, and the window can be resized under a
    // parked panel. Either can push 적용 past an edge, so re-clamp rather than strand the button.
    const observer =
      typeof view.ResizeObserver === "function"
        ? new view.ResizeObserver(() => reclampDialogOffset())
        : null;
    observer?.observe(node);
    const onResize = () => reclampDialogOffset();
    view.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      view.removeEventListener("resize", onResize);
    };
  }, []);

  const resetDraft = () => {
    if (applying) return;
    setDraft(defaultDraft(activeKind));
  };
  const selectGalleryFilter = (nextKind: StudioFilterKind) => {
    if (applying) return;
    setActiveKind(nextKind);
    setDraft(createStudioFilterDraft(nextKind, image));
    updateEffectFavoriteState((current) =>
      rememberStudioEffectRecent(current, studioFilterEffectId(nextKind)),
    );
    setGalleryOpen(false);
    setGalleryFocusKind(nextKind);
    galleryPickPendingFocusRef.current = true;
    setGalleryPickAnnouncement(`${STUDIO_FILTER_LABELS[nextKind]} 필터로 바꿨습니다`);
  };
  /** Roving focus inside the category radiogroup — one tab stop, arrows to move between chips. */
  const moveGalleryViewWithKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? -1 : null;
    if (step === 0 && jump === null) return;
    event.preventDefault();
    const views = STUDIO_FILTER_GALLERY_VIEWS;
    const current = views.findIndex((view) => view.id === galleryView);
    const nextIndex = jump === null
      ? (current + step + views.length) % views.length
      : jump === 0 ? 0 : views.length - 1;
    const next = views[nextIndex];
    if (!next) return;
    setGalleryView(next.id);
    // The handler sits on each radio rather than the group, because a keydown on a container that
    // is not itself focusable is a listener nothing can ever reach by keyboard.
    event.currentTarget.parentElement
      ?.querySelector<HTMLElement>(`[data-studio-filter-gallery-view="${next.id}"]`)
      ?.focus({ preventScroll: false });
  };
  /**
   * Arrow movement inside the card grid, so the gallery costs one tab stop instead of one per card.
   * Left/Right wrap along reading order, matching the category radiogroup the artist just came from.
   * Up/Down clamp instead: the grid scrolls, and wrapping ArrowDown off the bottom row would
   * teleport the focus two dozen rows up rather than doing the harmless nothing a clamp does.
   */
  const moveGalleryCardWithKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const lastIndex = visibleGalleryItems.length - 1;
    if (lastIndex < 0) return;
    const columns = STUDIO_FILTER_GALLERY_COLUMNS;
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    else if (event.key === "ArrowLeft") nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    else if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + columns, lastIndex);
    else if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - columns, 0);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    else return;
    const next = visibleGalleryItems[nextIndex];
    if (!next) return;
    event.preventDefault();
    setGalleryFocusKind(next.kind);
    const nextCard = event.currentTarget
      .closest("[data-studio-filter-gallery-grid]")
      ?.querySelector<HTMLButtonElement>(`[data-studio-filter-gallery-card="${next.kind}"]`);
    nextCard?.focus({ preventScroll: true });
    // jsdom has no scrollIntoView; the optional call keeps the unit tests on the real handler.
    nextCard?.scrollIntoView?.({ block: "nearest" });
  };

  const toggleGalleryFavorite = (nextKind: StudioFilterKind) => {
    updateEffectFavoriteState((current) =>
      toggleStudioEffectFavorite(current, studioFilterEffectId(nextKind)),
    );
  };
  const lockMessage =
    mutationLockReason ??
    "선택한 이미지 또는 문서가 잠겨 있어 적용할 수 없습니다. 잠금을 해제하면 현재 미리보기 값을 적용할 수 있습니다.";
  const descriptionId = "studio-filter-dialog-description";
  const compositeNoticeId = "studio-filter-composite-notice";
  const lockMessageId = "studio-filter-lock-message";
  const describedBy = [
    descriptionId,
    targetKind === "page-composite" ? compositeNoticeId : null,
    mutationLocked ? lockMessageId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-2 sm:p-4">
      {/*
        스크림은 페인트만 밴드로 쪼갠다 — 클릭 캐처는 여전히 화면 전체를 덮는 이 버튼 하나이므로
        캔버스 구멍을 클릭해도 예전과 똑같이 다이얼로그가 닫히고, 뒤 캔버스로 입력이 새지 않는다.
      */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        data-studio-filter-preview-cutout={previewCutout ? "true" : undefined}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      >
        {previewCutout ? (
          <>
            {studioFilterScrimBands(previewCutout).map((band) => (
              <span key={band.key} className={STUDIO_FILTER_SCRIM_PAINT} style={band.style} />
            ))}
            <span
              className="absolute rounded-sm ring-1 ring-accent/45"
              style={{
                top: previewCutout.top,
                left: previewCutout.left,
                width: previewCutout.width,
                height: previewCutout.height,
              }}
            />
          </>
        ) : (
          <span className={cn(STUDIO_FILTER_SCRIM_PAINT, "inset-0")} />
        )}
      </button>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-filter-dialog-title"
        aria-describedby={describedBy}
        aria-busy={applying || undefined}
        data-studio-shortcut-boundary="true"
        data-studio-ui-preferences-authority={effectPreferenceAuthority}
        tabIndex={-1}
        className="relative flex max-h-[min(86dvh,42rem)] w-[min(34rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel text-fg shadow-2xl"
        // `translate`, not `transform`: the shared modal entrance animation is `both`-filled, so it
        // holds `transform: translate3d(0,0,0)` for the life of the dialog and would silently win.
        style={
          dialogOffset.x === 0 && dialogOffset.y === 0
            ? undefined
            : { translate: `${dialogOffset.x}px ${dialogOffset.y}px` }
        }
      >
        <header
          onPointerDown={startDialogDrag}
          onPointerMove={moveDialogDrag}
          onPointerUp={endDialogDrag}
          onPointerCancel={endDialogDrag}
          className="flex shrink-0 touch-none select-none items-center gap-3 border-b border-line px-4 py-3"
        >
          <span
            role="button"
            tabIndex={0}
            aria-label="필터 창 옮기기 — 끌어서 이동, 방향키로 미세 이동, Enter로 가운데 정렬"
            onKeyDown={nudgeDialogWithKey}
            className={cn(
              "grid size-9 shrink-0 cursor-grab place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent active:cursor-grabbing",
              STUDIO_FOCUS_RING,
            )}
          >
            <SlidersHorizontal size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="studio-filter-dialog-title" className="truncate text-sm font-bold tracking-tight text-fg">
              {title}
            </h2>
            <p id={descriptionId} className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-3">
              {targetKind === "page-composite"
                ? "현재 보이는 페이지를 편집 가능한 합성 레이어로 만들고, 원본 레이어를 보존한 채 필터를 적용합니다."
                : "선택한 이미지 레이어에 비파괴 필터로 적용합니다."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${title} 닫기`}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised hover:text-fg sm:size-10 pointer-coarse:size-11",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]">
          <div className="space-y-4">
            {effectPreferenceAuthority === "memory-only" ? (
              <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[0.65rem] text-fg-2">
                즐겨찾기와 최근 필터는 저장소를 다시 연결하기 전까지 이번 탭에서만 유지됩니다.
              </p>
            ) : null}
            {/*
              A live region by attribute rather than role="status": the memory-only preferences
              warning below already owns that role, and a second one made "the dialog's status"
              ambiguous to anything querying by role. aria-live + aria-atomic is what role="status"
              resolves to anyway, so screen-reader behaviour is unchanged.
            */}
            <p aria-live="polite" aria-atomic="true" className="sr-only">
              {galleryPickAnnouncement}
            </p>
            <section
              aria-label="필터 갤러리"
              className="min-w-0 overflow-hidden rounded-xl border border-line bg-card/45"
            >
              <button
                ref={galleryToggleRef}
                type="button"
                aria-expanded={galleryOpen}
                aria-controls="studio-filter-gallery-content"
                onClick={() => setGalleryOpen((open) => !open)}
                className={cn(
                  "flex min-h-11 w-full min-w-0 items-center gap-2 px-3 text-left text-xs font-semibold text-fg hover:bg-raised",
                  STUDIO_EASE,
                  STUDIO_FOCUS_RING,
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <SlidersHorizontal size={15} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">다른 필터 둘러보기</span>
                  <span className="block truncate text-[0.62rem] font-normal text-fg-3">
                    {STUDIO_FILTER_DIALOG_CATALOG.length}개 필터 · 용도별 분류, 검색, 즐겨찾기
                  </span>
                </span>
                <ChevronDown
                  size={17}
                  aria-hidden
                  className={cn(
                    "shrink-0 transition-transform duration-150",
                    galleryOpen && "rotate-180",
                  )}
                />
              </button>

              {galleryOpen ? (
                <div
                  id="studio-filter-gallery-content"
                  className="min-w-0 space-y-2.5 border-t border-line p-2.5"
                >
                  <label className="relative block min-w-0">
                    <span className="sr-only">필터 검색</span>
                    <Search
                      size={15}
                      aria-hidden
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                    />
                    <input
                      type="search"
                      value={galleryQuery}
                      onChange={(event) => setGalleryQuery(event.target.value)}
                      placeholder="이름·효과로 검색 (예: 빛줄기, 선화 정리)"
                      autoComplete="off"
                      className={cn(
                        "min-h-11 w-full min-w-0 rounded-xl border border-line bg-panel pl-9 pr-3 text-xs text-fg outline-none placeholder:text-fg-3 hover:border-line-strong focus:border-accent",
                        STUDIO_EASE,
                        STUDIO_FOCUS_RING,
                      )}
                    />
                  </label>

                  <p className="text-[0.65rem] leading-relaxed text-fg-3">
                    카드 이미지는 효과 예시입니다. 실제 결과는 선택 후 작업 이미지의 미리보기에서 확인하세요.
                  </p>

                  {/*
                    A radiogroup, not independent toggle buttons: exactly one category is ever active, and
                    aria-pressed on each described nine independent on/off switches. Radio semantics
                    also make the whole strip one tab stop with arrow keys inside it, instead of nine
                    stops the artist tabs through on the way to the filters.
                  */}
                  <div
                    role="radiogroup"
                    aria-label="필터 분류"
                    className="flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]"
                  >
                    {STUDIO_FILTER_GALLERY_VIEWS.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        role="radio"
                        aria-checked={galleryView === view.id}
                        tabIndex={galleryView === view.id ? 0 : -1}
                        data-studio-filter-gallery-view={view.id}
                        onKeyDown={moveGalleryViewWithKey}
                        onClick={() => setGalleryView(view.id)}
                        className={cn(
                          "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border px-3 text-[0.68rem] font-semibold",
                          galleryView === view.id
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-panel text-fg-2 hover:border-line-strong hover:bg-raised",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                        )}
                      >
                        {view.id === "favorites" ? <Star size={12} aria-hidden /> : null}
                        {view.id === "recent" ? <Clock3 size={12} aria-hidden /> : null}
                        {view.label}
                      </button>
                    ))}
                  </div>

                  <p className="text-[0.62rem] text-fg-3" aria-live="polite">
                    {visibleGalleryItems.length}개 필터
                  </p>

                  {visibleGalleryItems.length > 0 ? (
                    <>
                    {/*
                      A group, not a listbox: an option may not own focusable descendants and every
                      card owns its 즐겨찾기 toggle, so listbox semantics would either strand the star
                      or produce an invalid tree. Roving tabindex gives the same one-stop behaviour.
                    */}
                    <p id="studio-filter-gallery-keys" className="sr-only">
                      방향키로 필터 카드를 옮기고, Tab으로 즐겨찾기 버튼에 갑니다.
                    </p>
                    <div
                      data-studio-filter-gallery-grid="true"
                      role="group"
                      aria-label="필터 카드"
                      aria-describedby="studio-filter-gallery-keys"
                      className="grid max-h-[min(44dvh,24rem)] min-w-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]"
                    >
                      {visibleGalleryItems.map((entry, entryIndex) => {
                        const selected = entry.kind === activeKind;
                        const favorite = isStudioEffectFavorite(
                          effectFavoriteState,
                          studioFilterEffectId(entry.kind),
                        );
                        const entryTitle = STUDIO_FILTER_LABELS[entry.kind];
                        return (
                          <div
                            key={entry.kind}
                            className={cn(
                              "relative min-w-0 overflow-hidden rounded-xl border bg-panel",
                              selected
                                ? "border-accent ring-1 ring-accent/35"
                                : "border-line hover:border-line-strong",
                              STUDIO_EASE,
                            )}
                          >
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-label={`${entryTitle} 필터 선택`}
                              data-studio-filter-gallery-card={entry.kind}
                              tabIndex={entry.kind === rovingGalleryKind ? 0 : -1}
                              onFocus={() => setGalleryFocusKind(entry.kind)}
                              onKeyDown={(event) => moveGalleryCardWithKey(event, entryIndex)}
                              onClick={() => selectGalleryFilter(entry.kind)}
                              className={cn(
                                "block min-h-24 w-full min-w-0 p-1.5 text-left",
                                STUDIO_FOCUS_RING,
                              )}
                            >
                              <span
                                aria-hidden
                                className="relative block h-12 w-full overflow-hidden rounded-lg border border-white/10"
                                style={studioFilterDialogPreviewStyle(entry)}
                              >
                                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[0.55rem] font-semibold text-white">
                                  {studioFilterGroupLabel(entry.group)}
                                </span>
                              </span>
                              <span className="mt-1.5 block truncate pr-8 text-[0.68rem] font-bold text-fg">
                                {entryTitle}
                              </span>
                              <span className="mt-0.5 block overflow-hidden text-[0.58rem] leading-tight text-fg-3 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                                {entry.description}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-pressed={favorite}
                              // The name stays put and aria-pressed carries the state. Swapping the
                              // name too announced "즐겨찾기 해제, pressed" — the undo action
                              // described as already done.
                              aria-label={`${entryTitle} 즐겨찾기`}
                              // One Tab from the card you are on; every other star is reached by
                              // arrowing to its card first. No arrow handler here on purpose —
                              // arrowing off a star would have to guess between the next card's star
                              // and its select button, and buys nothing over that single Tab.
                              tabIndex={entry.kind === rovingGalleryKind ? 0 : -1}
                              onClick={() => toggleGalleryFavorite(entry.kind)}
                              className={cn(
                                "absolute right-1 top-1 grid size-11 place-items-center rounded-lg border border-white/20 bg-black/55 text-white shadow-sm hover:bg-black/75",
                                favorite && "text-[oklch(0.83_0.16_80)]",
                                STUDIO_EASE,
                                STUDIO_FOCUS_RING,
                              )}
                            >
                              <Star size={15} fill={favorite ? "currentColor" : "none"} aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    </>
                  ) : (
                    <div
                      role="status"
                      className="grid min-h-24 place-items-center rounded-xl border border-dashed border-line px-3 text-center text-xs text-fg-3"
                    >
                      검색 또는 분류에 맞는 필터가 없습니다.
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {targetKind === "page-composite" ? (
              <p
                id={compositeNoticeId}
                role="note"
                className="rounded-lg border border-accent/25 bg-accent-soft/55 px-3 py-2 text-[0.7rem] leading-relaxed text-fg-2"
              >
                <strong className="font-semibold text-fg">원본은 그대로 유지됩니다.</strong>{" "}
                적용 후 실행 취소 한 번으로 새 합성 레이어만 제거할 수 있습니다.
              </p>
            ) : null}

            {isStudioFilterPackDraft(draft) ? (
              <>
                <p
                  role={filterLibraryAuthority === "error" ? "alert" : "status"}
                  data-studio-filter-library-authority={filterLibraryAuthority}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-[0.64rem] font-semibold",
                    filterLibraryAuthority === "error"
                      ? "border-bad/30 bg-bad/10 text-bad"
                      : "border-line bg-card/70 text-fg-3",
                  )}
                >
                  {filterLibraryAuthority === "sqlite"
                    ? `${filterLibraryTotalCount}개 · 무제한 · 로컬 SQL`
                    : filterLibraryAuthority === "memory-session"
                      ? `${filterLibraryTotalCount}개 · 비영속 메모리 세션 · 브라우저 종료 시 사라짐`
                      : filterLibraryAuthority === "error"
                        ? "필터 카탈로그 SQL을 읽지 못했습니다. 기존 데이터로 조용히 강등하지 않았습니다."
                        : "로컬 SQL 필터 카탈로그 연결 중…"}
                </p>
                {installedPackPresets.length > 0 ? (
                  <section
                    aria-label="설치한 Creator Pack 필터 프리셋"
                    className="rounded-lg border border-accent/25 bg-accent-soft/35 p-2.5"
                  >
                    <p className="text-[0.68rem] font-bold text-fg">
                      {filterLibraryAuthority === "memory-session"
                        ? "현재 세션 Creator Pack 필터 프리셋"
                        : "설치한 Creator Pack 필터 프리셋"}
                    </p>
                    <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">
                      {filterLibraryAuthority === "memory-session"
                        ? "현재 세션에만 유지됩니다. 선택하면 비파괴 미리보기에 즉시 반영됩니다."
                        : "선택하면 현재 다이얼로그 값과 비파괴 미리보기에 즉시 반영됩니다."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {installedPackPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setDraft({
                            kind: preset.engine,
                            values: { ...preset.values },
                          })}
                          className={cn(
                            "min-h-11 rounded-lg border border-line bg-card px-3 text-[0.68rem] font-semibold text-fg-2 hover:border-accent/45 hover:bg-raised",
                            STUDIO_EASE,
                            STUDIO_FOCUS_RING,
                          )}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                    {filterLibraryHasMore ? (
                      <button
                        type="button"
                        disabled={filterLibraryPageLoading}
                        onClick={() => void loadMoreInstalledFilterPresets()}
                        className={cn(
                          "mt-2 min-h-11 rounded-lg border border-line bg-card px-3 text-[0.68rem] font-semibold text-fg-2 hover:border-accent/45 hover:bg-raised disabled:cursor-wait disabled:opacity-60",
                          STUDIO_EASE,
                          STUDIO_FOCUS_RING,
                        )}
                      >
                        {filterLibraryPageLoading
                          ? "프리셋 불러오는 중…"
                          : `더 불러오기 (${installedCreatorPresets.length}/${filterLibraryTotalCount})`}
                      </button>
                    ) : null}
                  </section>
                ) : null}
                {isStudioFilterUnionWaveKind(draft.kind) ? (
                  <p
                    role="note"
                    className="rounded-lg border border-line bg-card/70 px-3 py-2 text-[0.68rem] leading-relaxed text-fg-3"
                  >
                    가장자리는 반복 없이 고정해 빈 틈을 막고, 투명도는 원본 그대로
                    보존합니다. 같은 시드는 언제나 같은 결과를 만듭니다.
                  </p>
                ) : null}
                <FilterPackControls
                  draft={draft}
                  onChange={(values) => setDraft({ ...draft, values })}
                />
              </>
            ) : null}

            {draft.kind === "gaussian-blur" ? (
              <NumberControl
                label="반지름"
                min={1}
                max={40}
                value={draft.radius}
                suffix="px"
                autofocus
                onChange={(radius) => setDraft({ ...draft, radius })}
              />
            ) : null}

            {draft.kind === "motion-blur" ? (
              <>
                <NumberControl
                  label="거리"
                  min={1}
                  max={40}
                  value={draft.distance}
                  suffix="px"
                  autofocus
                  onChange={(distance) => setDraft({ ...draft, distance })}
                />
                <NumberControl
                  label="각도"
                  min={-180}
                  max={180}
                  value={draft.angle}
                  suffix="°"
                  onChange={(angle) => setDraft({ ...draft, angle })}
                />
              </>
            ) : null}

            {draft.kind === "hue-saturation-brightness" ? (
              <>
                <NumberControl
                  label="색조"
                  min={-180}
                  max={180}
                  value={draft.hue}
                  suffix="°"
                  autofocus
                  onChange={(hue) => setDraft({ ...draft, hue })}
                />
                <NumberControl
                  label="채도"
                  min={-100}
                  max={100}
                  value={draft.saturation}
                  suffix="%"
                  onChange={(saturation) => setDraft({ ...draft, saturation })}
                />
                <NumberControl
                  label="밝기/명도"
                  min={-80}
                  max={80}
                  value={draft.brightness}
                  suffix="%"
                  onChange={(brightness) => setDraft({ ...draft, brightness })}
                />
              </>
            ) : null}

            {draft.kind === "brightness-contrast" ? (
              <>
                <NumberControl
                  label="명도"
                  min={-80}
                  max={80}
                  value={draft.brightness}
                  suffix="%"
                  autofocus
                  onChange={(brightness) => setDraft({ ...draft, brightness })}
                />
                <NumberControl
                  label="대비"
                  min={-80}
                  max={80}
                  value={draft.contrast}
                  suffix="%"
                  onChange={(contrast) => setDraft({ ...draft, contrast })}
                />
              </>
            ) : null}

            {draft.kind === "color-curves" ? (
              <StudioCurvePanel
                histogramSource={histogramSource}
                points={draft.curve}
                channels={draft.curveCh}
                onChange={(curve: CurvePoint[]) => setDraft({ ...draft, curve })}
                onChannelsChange={(curveCh: CurveRgbChannels) => setDraft({ ...draft, curveCh })}
                onReset={resetDraft}
              />
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
            <button
              type="button"
              disabled={applying}
              onClick={resetDraft}
              className={buttonClass({
                size: "sm",
                variant: "quiet",
                className: "min-h-11 sm:min-h-8 pointer-coarse:min-h-11",
              })}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              기본값
            </button>
            {/*
              Judging a filter means seeing what it replaced. Toggling 캔버스 미리보기 off and on
              costs two clicks and loses the moment of comparison, so this reverts the canvas only
              for as long as the control is held — pointer or key — and never leaves it reverted.
            */}
            <button
              type="button"
              disabled={applying || !previewEnabled}
              aria-pressed={comparingOriginal}
              title="누르고 있는 동안 원본을 보여줍니다"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                setComparingOriginal(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                setComparingOriginal(true);
              }}
              className={buttonClass({
                size: "sm",
                variant: comparingOriginal ? "outline" : "quiet",
                className: "min-h-11 select-none sm:min-h-8 pointer-coarse:min-h-11",
              })}
            >
              <Eye className="size-3.5" aria-hidden />
              원본 비교
            </button>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-xs font-semibold text-fg-2 hover:bg-raised">
              <input
                type="checkbox"
                checked={previewEnabled}
                onChange={(event) => setPreviewEnabled(event.target.checked)}
                className="size-4 accent-accent"
              />
              캔버스 미리보기
            </label>
          </div>
        </div>

        <footer className="shrink-0 border-t border-line bg-card/35 px-4 py-3">
          {canUseSelectionScope ? (
            <fieldset
              disabled={mutationLocked || applying}
              className="mb-3 min-w-0 space-y-1.5"
              aria-describedby="studio-filter-selection-scope-note"
            >
              <legend className="text-[0.68rem] font-bold text-fg-2">적용 범위</legend>
              <div className="grid min-w-0 grid-cols-3 gap-1.5">
                {([
                  ["whole", "전체 이미지"],
                  ["inside", "선택 안"],
                  ["outside", "선택 밖"],
                ] as const).map(([scope, label]) => (
                  <label
                    key={scope}
                    className={cn(
                      studioSegmentChipClass(applicationScope === scope),
                      "min-h-11 min-w-0 cursor-pointer justify-center px-2 text-center disabled:pointer-events-none",
                      (mutationLocked || applying) && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <input
                      type="radio"
                      name="studio-filter-application-scope"
                      value={scope}
                      checked={applicationScope === scope}
                      disabled={mutationLocked || applying}
                      onChange={() => setApplicationScope(scope)}
                      className="sr-only"
                    />
                    <span className="truncate">{label}</span>
                  </label>
                ))}
              </div>
              <p
                id="studio-filter-selection-scope-note"
                className="text-[0.66rem] leading-relaxed text-fg-3"
              >
                현재 선택{selectionInverted ? "(반전)" : ""}
                {selectionFeatherPx > 0 ? ` · 페더 ${selectionFeatherPx}px` : ""}를 마스크로
                저장합니다. 미리보기는 필터 값 확인을 위해 전체 이미지로 보이며, 적용 뒤에는
                필터 마스크에 계속 칠할 수 있어요.
              </p>
            </fieldset>
          ) : null}
          {mutationLocked ? (
            <p
              id={lockMessageId}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="mb-2 rounded-xl border border-warn/35 bg-warn/10 px-3 py-2 text-[0.7rem] font-semibold leading-relaxed text-warn"
            >
              {lockMessage}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={buttonClass({
                variant: "ghost",
                className: "min-h-11 sm:min-h-10 pointer-coarse:min-h-11",
              })}
            >
              취소
            </button>
            <button
              type="button"
              disabled={mutationLocked || applying}
              aria-busy={applying || undefined}
              aria-describedby={mutationLocked ? lockMessageId : undefined}
              onClick={() => {
                if (mutationLocked || applying) return;
                onApply(
                  studioFilterDraftToPatch(draft),
                  cloneStudioFilterDraft(draft),
                  applicationScope,
                );
              }}
              className={buttonClass({
                variant: "solid",
                className: "min-h-11 sm:min-h-10 pointer-coarse:min-h-11",
              })}
            >
              {applying
                ? "적용 중…"
                : applicationScope === "inside"
                  ? "선택 안에 적용"
                  : applicationScope === "outside"
                    ? "선택 밖에 적용"
                    : "적용"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
