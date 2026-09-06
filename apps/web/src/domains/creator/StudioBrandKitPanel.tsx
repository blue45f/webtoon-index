// 브랜드 킷 패널 — "스타일" 툴바 그룹 팝오버 안에 서브탭 콘텐츠로 얹히는 컴포넌트.
// 팔레트(참조)·제목/본문 글꼴·로고를 하나의 이름 붙은 킷으로 저장·이름변경·삭제하고,
// 스와치/글꼴/로고를 각각 개별적으로 적용한다. StudioPaletteLibraryPanel과 동일한
// "라이브러리 매니저" 컨벤션 — 자체 useState로 목록을 소유하고 V12 SQLite repository를
// 통해 읽고/쓴다(캔버스 도구 패널처럼 모든 값을 prop으로 받는 얇은 패널과는 다른 컨벤션).
// 팝오버 위치·z-index·max-height는 호출부(StudioPage.tsx의 스타일 그룹 wrapper)가 담당한다 —
// 이 컴포넌트는 자체 fixed/absolute wrapper를 갖지 않는다(2026-07-05 툴바 그룹화로 이관).
import { ImagePlus, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import {
  BRAND_KIT_FONTS,
  createBrandKit,
  DEFAULT_BRAND_KIT_FONT,
  deleteBrandKitInMemory,
  renameBrandKitInMemory,
  resolveBrandKitPalette,
  upsertBrandKitInMemory,
  type BrandKit,
  type BrandKitLogo,
} from "./studio-brand-kit";
import {
  getProductStudioBrandKitSqliteRepository,
  StudioBrandKitSqliteRepositoryError,
} from "./studio-brand-kit-sqlite-repository";
import {
  buildGoogleFontCss2Url,
  filterStudioGoogleFonts,
  googleFontLinkId,
  resolveStudioGoogleFontFromCssValue,
  STUDIO_GOOGLE_FONTS,
  studioGoogleFontCssValue,
  type StudioGoogleFont,
  type StudioGoogleFontCategory,
} from "./studio-google-fonts";
import { downscaleImageFile } from "./studio-image-utils";
import { getProductStudioPaletteSqliteRepository } from "./studio-palette-sqlite-repository";
import { ensureStudioPresetFontsLoaded } from "./studio-preset-font-loading";

import type { StudioNamedPalette } from "./studio-palette-library";

import { cx } from "@/shared/lib/cx";

const MAX_LOGO_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — 다운스케일 전 원본 파일에 대한 저비용 가드(메인스레드 디코딩 지연 방지).
const LOGO_MAX_DIM = 320; // downscaleImageFile 최대 픽셀 변 — 로고는 작은 코너 장식이며 canonical SQLite payload 예산 안에 둔다.
const LOGO_QUALITY = 0.92;
const SWATCH_PREVIEW_COUNT = 8;

// ── Google Fonts 온디맨드 로드 ───────────────────────────────────────────────
// Google Fonts CSS2는 API 키가 필요 없는 완전 공개 엔드포인트다(과금·서버 비용 없음) — 다만
// 이 브라우저에서 fonts.googleapis.com/fonts.gstatic.com으로 실제 네트워크 요청이 나간다는
// 점은 그대로다(완전 오프라인은 아님). STUDIO_GOOGLE_FONTS 19종을 전부 한꺼번에 로드하지
// 않고, 사용자가 그 폰트를 처음 선택하는 순간에만 폰트 하나짜리 <link>를 주입한다.
//
// 캔버스(Konva)는 실제 DOM 텍스트가 아니라 <canvas> 위에 그려지므로, 브라우저의 지연 웹폰트
// 로딩 휴리스틱(렌더된 DOM 텍스트가 실제로 쓰는 문자 범위의 @font-face 블록만 내려받는 최적화)이
// 저절로 트리거된다는 보장이 없다. 한글 지원이 핵심 요건이라 CSS2 응답은 유니코드 범위별로
// 수십 개 @font-face로 쪼개져 있는데(용량 절약을 위한 구글 폰트 표준 관례), 이 패널의 버튼
// label처럼 라틴 문자로만 이뤄진 DOM 텍스트만으로는 한글 블록이 로드된다는 보장이 없다.
// 그래서 스타일시트 로드가 끝난 뒤 document.fonts.load(...)를 한글 샘플 문자열로 명시
// 호출해 필요한 블록을 강제로 내려받는다 — 이렇게 받아온 뒤에는 StudioPage.tsx가 이미
// 전역으로 구독 중인 document.fonts "loadingdone"(텍스트/말풍선 요소가 하나라도 있으면 항상
// 마운트돼 있다 — canApplyFont가 true인 시점엔 반드시 성립)이 캔버스 재도장(batchDraw)을
// 대신 처리하므로, 이 패널이 따로 stageRef를 받아 redraw할 필요는 없다.
const HANGUL_FONT_LOAD_SAMPLE = "가나다라 웹툰 대사 0123";

function triggerHangulFontLoad(font: StudioGoogleFont) {
  for (const weight of font.weights) {
    document.fonts.load(`${weight} 16px '${font.family}'`, HANGUL_FONT_LOAD_SAMPLE).catch(() => {
      // 오프라인·네트워크 실패 등 — 조용히 무시한다(브랜드 킷 자체 저장/적용 흐름은 폰트
      // 로드 성패와 무관하게 계속 동작해야 한다. 실패하면 폰트가 도착할 때까지 폴백 글꼴로 보일 뿐).
    });
  }
}

/** family에 해당하는 Google Font <link rel=stylesheet>를 아직 없으면 주입한다(id 가드로
 *  중복 주입 방지 — StudioPage.tsx STUDIO_FONTS_LINK_ID와 동일한 패턴). 이미 있으면 로드
 *  트리거만 재시도한다(멱등: 이미 받아온 굵기면 document.fonts.load가 즉시 resolve). */
function ensureGoogleFontLinkInjected(font: StudioGoogleFont): void {
  const id = googleFontLinkId(font.family);
  if (document.getElementById(id)) {
    triggerHangulFontLoad(font);
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = buildGoogleFontCss2Url(font.family, font.weights);
  link.addEventListener("load", () => triggerHangulFontLoad(font), { once: true });
  document.head.appendChild(link);
}

/** BrandKit.headingFont/bodyFont 같은 CSS font-family 문자열을 받아, 그게 이 카탈로그의
 *  Google Font를 가리키면 로드하고, 아니면(기존 9종 등) 아무 것도 하지 않는다. */
function ensureGoogleFontLoadedForCssValue(cssValue: string): void {
  const font = resolveStudioGoogleFontFromCssValue(cssValue);
  if (font) ensureGoogleFontLinkInjected(font);
}

const GOOGLE_FONT_CATEGORY_LABELS: Record<StudioGoogleFontCategory | "all", string> = {
  all: "전체",
  sans: "고딕",
  serif: "명조",
  display: "디스플레이",
  handwriting: "손글씨",
};
const GOOGLE_FONT_CATEGORIES: (StudioGoogleFontCategory | "all")[] = ["all", "sans", "serif", "display", "handwriting"];

interface GoogleFontPickerGridProps {
  /** 현재 선택된 CSS font-family 값(draftHeadingFont/draftBodyFont) — 활성 표시용. */
  value: string;
  /** 폰트를 고르면 호출 — 값은 studioGoogleFontCssValue()로 만든 CSS font-family 문자열.
   *  <link> 주입은 이 컴포넌트가 직접 처리하므로 호출측은 draft 상태만 갱신하면 된다. */
  onPick: (cssValue: string) => void;
}

/** 브랜드 킷 생성 폼의 제목/본문 글꼴 섹션에 덧붙는 Google Fonts 추가 선택지 그리드.
 *  StudioBrandKitPanel 내부 전용(모듈 밖으로 내보내지 않음) — 두 군데(제목/본문)에서
 *  독립된 검색어·카테고리 필터 상태를 갖도록 컴포넌트 레벨에서 재사용한다. */
function GoogleFontPickerGrid({ value, onPick }: GoogleFontPickerGridProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StudioGoogleFontCategory | "all">("all");
  const filtered = filterStudioGoogleFonts(STUDIO_GOOGLE_FONTS, { category, query });

  function handlePick(font: StudioGoogleFont) {
    ensureGoogleFontLinkInjected(font);
    onPick(studioGoogleFontCssValue(font));
  }

  return (
    <div className="mt-1.5 rounded-lg border border-line/70 bg-panel/60 p-1.5">
      <p className="mb-1 text-[0.6rem] font-medium text-fg-3">Google Fonts (한글 지원 {STUDIO_GOOGLE_FONTS.length}종)</p>
      <div className="mb-1 flex flex-wrap gap-0.5">
        {GOOGLE_FONT_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cx(
              "rounded px-1.5 py-0.5 text-[0.58rem] font-medium transition-colors",
              category === c ? "bg-accent text-on-accent" : "bg-panel text-fg-3 hover:bg-raised"
            )}
          >
            {GOOGLE_FONT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="폰트 이름 검색…"
        aria-label="Google Fonts 검색"
        className="mb-1 h-6 w-full rounded border border-line bg-panel px-1.5 text-[0.65rem] text-fg outline-none focus:border-accent"
      />
      <div className="grid max-h-24 grid-cols-2 gap-1 overflow-y-auto pr-0.5">
        {filtered.length === 0 ? (
          <p className="col-span-2 py-1 text-center text-[0.58rem] text-fg-3">일치하는 폰트가 없어요.</p>
        ) : (
          filtered.map((font) => {
            const cssValue = studioGoogleFontCssValue(font);
            const active = value === cssValue;
            return (
              <button
                key={font.family}
                type="button"
                onClick={() => handlePick(font)}
                style={{ fontFamily: cssValue }}
                title={font.family}
                className={cx(
                  "truncate rounded border px-1 py-1 text-[0.6rem] transition-colors",
                  active ? "border-accent bg-accent-soft/30 text-accent" : "border-line bg-panel text-fg-2 hover:bg-raised"
                )}
              >
                {font.family}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export interface StudioBrandKitPanelProps {
  /** 스와치 클릭 시 호출 — 전역 브러시/도형 색(StudioPage의 `color`)을 갱신.
   *  StudioPaletteLibraryPanel.onPickColor와 완전히 동일한 규약. */
  onPickColor: (hex: string) => void;
  /** 현재 텍스트/말풍선 요소가 선택되어 있어 글꼴을 적용할 수 있는지. false면 글꼴
   *  적용 버튼을 비활성화하고 안내 문구를 보여준다. */
  canApplyFont: boolean;
  /** 킷의 제목/본문 글꼴 중 하나를 현재 선택 요소에 적용 — 실제 patchEl(selected.id,{font})
   *  수행은 호출측(StudioPage.tsx) 책임. */
  onApplyFont: (font: string) => void;
  /** 킷의 로고를 문서 마스터 로고 슬롯에 적용(추가 또는 같은 자리 교체) — 실제
   *  ImageEl 구성 + setMaster(withMasterElements(...)) 수행은 호출측 책임. */
  onApplyLogo: (kit: BrandKit) => void;
  /** Test/embed seams. Product code leaves these undefined. */
  repository?: StudioBrandKitLibraryRepository;
  paletteRepository?: StudioBrandKitPaletteRepository;
}

export interface StudioBrandKitLibraryRepository {
  readonly authority?: "sqlite" | "injected";
  list(): Promise<BrandKit[]>;
  save(kit: BrandKit): Promise<BrandKit[]>;
  rename(id: string, name: string): Promise<BrandKit[]>;
  delete(id: string): Promise<BrandKit[]>;
  subscribe?(listener: () => void): () => void;
}

export interface StudioBrandKitPaletteRepository {
  readonly authority?: "sqlite" | "injected";
  list(): Promise<StudioNamedPalette[]>;
  subscribe?(listener: () => void): () => void;
}

const PRODUCT_REPOSITORY: StudioBrandKitLibraryRepository =
  getProductStudioBrandKitSqliteRepository();
const PRODUCT_PALETTE_REPOSITORY: StudioBrandKitPaletteRepository =
  getProductStudioPaletteSqliteRepository();

export function StudioBrandKitPanel({
  onPickColor,
  canApplyFont,
  onApplyFont,
  onApplyLogo,
  repository = PRODUCT_REPOSITORY,
  paletteRepository = PRODUCT_PALETTE_REPOSITORY,
}: StudioBrandKitPanelProps) {
  // 이 패널은 팝오버 안에서만 마운트되고(닫혀 있으면 `StudioFloatingToolPopover` 가 null 을
  // 돌려준다), 마운트되자마자 BRAND_KIT_FONTS 미리보기 버튼 18개를 각자 자기 글꼴로 그린다.
  // 즉 마운트 시점이 곧 "프리셋 목록을 열었다" 는 신호다 — 여기서 8종을 확보한다.
  // 스튜디오 로드 시점에는 문서가 실제로 쓰는 글꼴만 받으므로(studio-preset-font-loading.ts),
  // 이 호출이 없으면 미리보기가 계속 시스템 글꼴로 남는다.
  useEffect(() => {
    ensureStudioPresetFontsLoaded();
  }, []);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [palettes, setPalettes] = useState<StudioNamedPalette[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [storageState, setStorageState] = useState<
    "loading" | "sqlite" | "injected" | "memory" | "unavailable"
  >("loading");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPaletteId, setDraftPaletteId] = useState("");
  const [draftHeadingFont, setDraftHeadingFont] = useState(DEFAULT_BRAND_KIT_FONT);
  const [draftBodyFont, setDraftBodyFont] = useState(DEFAULT_BRAND_KIT_FONT);
  const [draftLogo, setDraftLogo] = useState<BrandKitLogo | null>(null);
  const [draftLogoBusy, setDraftLogoBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const mountedRef = useRef(true);
  const memoryModeRef = useRef(false);
  const mutationBusyRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const paletteLoadGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const kitsRef = useRef<BrandKit[]>([]);

  function replaceKits(next: BrandKit[]): void {
    kitsRef.current = next;
    setKits(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    memoryModeRef.current = false;

    const hydrate = async () => {
      const generation = ++loadGenerationRef.current;
      setStorageState("loading");
      try {
        const loaded = await repository.list();
        if (
          !active
          || !mountedRef.current
          || generation !== loadGenerationRef.current
          || memoryModeRef.current
        ) {
          return;
        }
        replaceKits(loaded);
        setError(null);
        setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      } catch (cause) {
        if (!active || !mountedRef.current || generation !== loadGenerationRef.current) return;
        setStorageState("unavailable");
        setError(`SQLite/OPFS 브랜드 킷을 열지 못했습니다: ${
          cause instanceof Error ? cause.message : String(cause)
        }. 기존 브라우저 키는 자동으로 읽지 않습니다.`);
      }
    };

    void hydrate();
    const unsubscribe = repository.subscribe?.(() => void hydrate());
    return () => {
      active = false;
      loadGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [repository]);

  useEffect(() => {
    let active = true;
    const hydratePalettes = async () => {
      const generation = ++paletteLoadGenerationRef.current;
      try {
        const loaded = await paletteRepository.list();
        if (!active || !mountedRef.current || generation !== paletteLoadGenerationRef.current) return;
        setPalettes(loaded);
      } catch (cause) {
        if (!active || !mountedRef.current || generation !== paletteLoadGenerationRef.current) return;
        setPalettes([]);
        setError(`연결할 SQLite 팔레트를 불러오지 못했습니다: ${
          cause instanceof Error ? cause.message : String(cause)
        }`);
      }
    };
    void hydratePalettes();
    const unsubscribe = paletteRepository.subscribe?.(() => void hydratePalettes());
    return () => {
      active = false;
      paletteLoadGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [paletteRepository]);

  // 저장된 킷 중 headingFont/bodyFont가 Google Font를 가리키면 패널이 열리자마자 미리 로드해
  // 둔다 — 그래야 "제목/본문 글꼴 적용" 버튼 자체의 미리보기 라벨(style={{fontFamily}})이
  // 클릭 전에도 실제 글꼴로 보인다(이전 세션에 저장해 이 페이지에서는 아직 한 번도 <link>를
  // 주입한 적 없는 킷일 수 있으므로). 기존 9종을 가리키는 값은 ensureGoogleFontLoadedForCssValue
  // 내부에서 조용히 no-op된다.
  useEffect(() => {
    for (const k of kits) {
      ensureGoogleFontLoadedForCssValue(k.headingFont);
      ensureGoogleFontLoadedForCssValue(k.bodyFont);
    }
  }, [kits]);

  async function commitMutation(
    persisted: () => Promise<BrandKit[]>,
    memoryUpdate: (current: readonly BrandKit[]) => BrandKit[],
  ): Promise<"durable" | "memory" | "rejected"> {
    if (mutationBusyRef.current) return "rejected";
    mutationBusyRef.current = true;
    const generation = ++mutationGenerationRef.current;
    loadGenerationRef.current += 1;
    setMutationBusy(true);
    setError(null);
    setDoneMsg(null);

    if (storageState === "memory") {
      try {
        replaceKits(memoryUpdate(kitsRef.current));
        return "memory";
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "브랜드 킷 변경을 적용하지 못했습니다.");
        return "rejected";
      } finally {
        mutationBusyRef.current = false;
        setMutationBusy(false);
      }
    }

    try {
      const next = await persisted();
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return "rejected";
      // A save can synchronously notify subscribers and start list() before the save promise
      // resolves. Fence that read so its late result cannot overwrite this mutation result.
      loadGenerationRef.current += 1;
      replaceKits(next);
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      return "durable";
    } catch (cause) {
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return "rejected";
      if (cause instanceof StudioBrandKitSqliteRepositoryError && cause.code !== "unavailable") {
        setError(`${cause.message} 항목을 줄이거나 데이터를 고친 뒤 다시 시도해 주세요.`);
        return "rejected";
      }
      try {
        replaceKits(memoryUpdate(kitsRef.current));
      } catch (validationError) {
        setError(validationError instanceof Error
          ? validationError.message
          : "브랜드 킷 변경을 적용하지 못했습니다.");
        return "rejected";
      }
      memoryModeRef.current = true;
      setStorageState("memory");
      setError(`SQLite/OPFS 저장에 실패해 변경을 현재 탭 메모리에만 유지합니다. 새로고침하면 사라집니다: ${
        cause instanceof Error ? cause.message : String(cause)
      }`);
      return "memory";
    } finally {
      if (mountedRef.current && generation === mutationGenerationRef.current) {
        mutationBusyRef.current = false;
        setMutationBusy(false);
      }
    }
  }

  function handleDelete(id: string): void {
    if (mutationBusyRef.current) return;
    void commitMutation(
      () => repository.delete(id),
      (current) => deleteBrandKitInMemory(current, id),
    );
  }

  function startRename(k: BrandKit) {
    if (mutationBusyRef.current) return;
    setRenamingId(k.id);
    setRenamingName(k.name);
  }

  function commitRename() {
    if (!renamingId || mutationBusyRef.current) return;
    const id = renamingId;
    const name = renamingName;
    setRenamingId(null);
    void commitMutation(
      () => repository.rename(id, name),
      (current) => renameBrandKitInMemory(current, id, name),
    );
  }

  function handleRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setRenamingId(null);
  }

  async function handleLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 시에도 onChange가 다시 발생하도록 즉시 리셋(StudioPaletteLibraryPanel과 동일한 file input 함정).
    if (!file) return;
    setError(null);
    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      setError("파일이 너무 커요. 8MB 이하 이미지만 로고로 쓸 수 있어요.");
      return;
    }
    setDraftLogoBusy(true);
    try {
      const scaled = await downscaleImageFile(file, LOGO_MAX_DIM, LOGO_QUALITY);
      setDraftLogo({ dataUrl: scaled.src, width: scaled.width, height: scaled.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "로고 이미지를 불러오지 못했어요.");
    } finally {
      if (mountedRef.current) setDraftLogoBusy(false);
    }
  }

  function handleCreate(): void {
    // createBrandKit은 절대 던지지 않으므로(§ 설계 의도) try/catch가 필요 없다 — createPalette류의
    // "직접 입력" 흐름과 달리 호출 자체는 항상 성공한다. 단, 버튼은 draftLogoBusy(로고
    // downscaleImageFile 진행 중)일 때는 비활성화된다 — 아니면 업로드 완료 전에 제출해
    // draftLogo가 아직 null인 채로 킷이 만들어져 로고가 조용히 누락되는 레이스가 있었다.
    const kit = createBrandKit({
      name: draftName,
      paletteId: draftPaletteId || null,
      headingFont: draftHeadingFont,
      bodyFont: draftBodyFont,
      logo: draftLogo,
    });
    void commitMutation(
      () => repository.save(kit),
      (current) => upsertBrandKitInMemory(current, kit),
    ).then((outcome) => {
      if (!mountedRef.current || outcome === "rejected") return;
      setDoneMsg(outcome === "durable"
        ? `"${kit.name}" 브랜드 킷을 만들었어요.`
        : `"${kit.name}" 브랜드 킷은 현재 탭 메모리에만 있습니다. 새로고침하면 사라집니다.`);
      setDraftName("");
      setDraftPaletteId("");
      setDraftHeadingFont(DEFAULT_BRAND_KIT_FONT);
      setDraftBodyFont(DEFAULT_BRAND_KIT_FONT);
      setDraftLogo(null);
      setCreatorOpen(false);
    });
  }

  function handleApplyLogo(k: BrandKit) {
    onApplyLogo(k);
    setError(null);
    setDoneMsg(`"${k.name}" 로고를 마스터에 적용했어요.`);
  }

  return (
    <div
      data-studio-brand-kit-authority={storageState}
      aria-busy={mutationBusy || storageState === "loading"}
    >
      <p className="mb-1.5 text-[0.66rem] font-medium text-fg-3">내 브랜드 킷 — 팔레트·글꼴·로고 묶음</p>

      <p className="mb-1.5 text-[0.6rem] font-semibold text-fg-3" aria-live="polite">
        {storageState === "loading"
          ? "SQLite/OPFS 브랜드 킷 확인 중"
          : storageState === "sqlite"
            ? "이 기기 SQLite/OPFS 저장"
            : storageState === "memory"
              ? "현재 탭 메모리 임시 · 새로고침 시 사라짐"
              : storageState === "unavailable"
                ? "SQLite/OPFS 사용 불가 · 저장되지 않음"
                : "주입 저장소"}
      </p>

      {error && (
        <p className="mb-1.5 text-[0.66rem] text-bad" role="alert">
          {error}
        </p>
      )}
      {doneMsg && !error && (
        <p className="mb-1.5 text-[0.66rem] text-good" role="status">
          {doneMsg}
        </p>
      )}

      <button
        type="button"
        onClick={() => setCreatorOpen((v) => !v)}
        aria-expanded={creatorOpen}
        className={cx(
          "mb-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[0.66rem] font-semibold transition-colors hover:bg-raised",
          creatorOpen ? "bg-raised text-fg-2" : "text-fg-3 hover:text-fg-2"
        )}
      >
        <Plus size={11} /> 새 브랜드 킷
      </button>

      {creatorOpen && (
        <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-line bg-card p-2">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="브랜드 킷 이름"
            className="h-7 rounded border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-accent"
          />

          <div>
            <p className="mb-1 text-[0.66rem] font-medium text-fg-3">팔레트</p>
            <select
              value={draftPaletteId}
              onChange={(e) => setDraftPaletteId(e.target.value)}
              aria-label="팔레트"
              className="h-7 w-full rounded border border-line bg-panel px-1.5 text-xs text-fg outline-none focus:border-accent"
            >
              <option value="">없음</option>
              {palettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.colors.length}색)
                </option>
              ))}
            </select>
            {palettes.length === 0 && (
              <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-3">
                저장된 팔레트가 없어요. 먼저 팔레트 탭에서 만들어보세요.
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 text-[0.66rem] font-medium text-fg-3">제목 글꼴</p>
            <div className="grid grid-cols-3 gap-1">
              {BRAND_KIT_FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setDraftHeadingFont(f.value)}
                  style={{ fontFamily: f.value }}
                  className={cx(
                    "truncate rounded border px-1 py-1 text-[0.6rem] transition-colors",
                    draftHeadingFont === f.value
                      ? "border-accent bg-accent-soft/30 text-accent"
                      : "border-line bg-panel text-fg-2 hover:bg-raised"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <GoogleFontPickerGrid value={draftHeadingFont} onPick={setDraftHeadingFont} />
          </div>

          <div>
            <p className="mb-1 text-[0.66rem] font-medium text-fg-3">본문 글꼴</p>
            <div className="grid grid-cols-3 gap-1">
              {BRAND_KIT_FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setDraftBodyFont(f.value)}
                  style={{ fontFamily: f.value }}
                  className={cx(
                    "truncate rounded border px-1 py-1 text-[0.6rem] transition-colors",
                    draftBodyFont === f.value
                      ? "border-accent bg-accent-soft/30 text-accent"
                      : "border-line bg-panel text-fg-2 hover:bg-raised"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <GoogleFontPickerGrid value={draftBodyFont} onPick={setDraftBodyFont} />
          </div>

          <div>
            <p className="mb-1 text-[0.66rem] font-medium text-fg-3">로고</p>
            {draftLogo ? (
              <div className="flex items-center gap-2">
                <img
                  src={draftLogo.dataUrl}
                  alt="로고 미리보기"
                  className="h-10 w-10 rounded border border-line bg-panel object-contain"
                />
                <button
                  type="button"
                  onClick={() => setDraftLogo(null)}
                  className="text-[0.66rem] font-medium text-fg-3 transition-colors hover:text-bad"
                >
                  제거
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-panel py-1.5 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised">
                <ImagePlus size={11} /> {draftLogoBusy ? "불러오는 중…" : "로고 이미지 선택"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFile}
                  disabled={draftLogoBusy || mutationBusy || storageState === "loading"}
                />
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={draftLogoBusy || mutationBusy || storageState === "loading"}
            title={draftLogoBusy ? "로고를 불러오는 중이에요. 잠시만 기다려주세요." : undefined}
            className="rounded-lg bg-accent py-1.5 text-[0.66rem] font-semibold text-on-accent transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {draftLogoBusy ? "로고 불러오는 중…" : "브랜드 킷 만들기"}
          </button>
        </div>
      )}

      {kits.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[0.66rem] leading-relaxed text-fg-3">
          저장된 브랜드 킷이 없어요. 이름과 팔레트·글꼴·로고를 골라 새로 만들어보세요.
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {kits.map((k) => {
            const resolvedPalette = resolveBrandKitPalette(k, palettes);
            return (
              <div key={k.id} className="rounded-lg border border-line bg-card px-2 py-1.5">
                <div className="flex items-center gap-1">
                  {renamingId === k.id ? (
                    <input
                      type="text"
                      value={renamingName}
                      onChange={(e) => setRenamingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={handleRenameKeyDown}
                      // eslint-disable-next-line jsx-a11y/no-autofocus -- inline rename field opens only on user action; focusing it immediately is correct edit-on-demand UX
                      autoFocus
                      className="min-w-0 flex-1 rounded border border-accent bg-panel px-1 py-0.5 text-xs text-fg outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={k.name}>
                      {k.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => startRename(k)}
                    aria-label={`${k.name} 이름 변경`}
                    title="이름 변경"
                    className="shrink-0 text-fg-3 transition-colors hover:text-accent"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(k.id)}
                    aria-label={`${k.name} 브랜드 킷 삭제`}
                    title="삭제"
                    className="shrink-0 text-fg-3 transition-colors hover:text-bad"
                  >
                    <X size={11} />
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {k.paletteId === null ? (
                    <span className="text-[0.6rem] text-fg-3">팔레트 없음</span>
                  ) : resolvedPalette ? (
                    <>
                      {resolvedPalette.colors.slice(0, SWATCH_PREVIEW_COUNT).map((hex, idx) => (
                        <button
                          key={`${hex}-${idx}`}
                          type="button"
                          onClick={() => onPickColor(hex)}
                          title={hex}
                          className="h-5 w-5 rounded border border-line"
                          style={{ background: hex }}
                        />
                      ))}
                      {resolvedPalette.colors.length > SWATCH_PREVIEW_COUNT && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded border border-line px-0.5 text-[0.55rem] font-medium text-fg-3">
                          +{resolvedPalette.colors.length - SWATCH_PREVIEW_COUNT}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[0.6rem] text-fg-3">삭제된 팔레트</span>
                  )}
                </div>

                <div className="mt-1.5 flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      ensureGoogleFontLoadedForCssValue(k.headingFont);
                      onApplyFont(k.headingFont);
                    }}
                    disabled={!canApplyFont}
                    title={canApplyFont ? "선택한 텍스트/말풍선에 적용" : "먼저 텍스트나 말풍선 요소를 선택하세요"}
                    style={{ fontFamily: k.headingFont }}
                    className="flex-1 truncate rounded border border-line bg-panel px-1.5 py-1 text-[0.6rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    제목 글꼴 적용
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      ensureGoogleFontLoadedForCssValue(k.bodyFont);
                      onApplyFont(k.bodyFont);
                    }}
                    disabled={!canApplyFont}
                    title={canApplyFont ? "선택한 텍스트/말풍선에 적용" : "먼저 텍스트나 말풍선 요소를 선택하세요"}
                    style={{ fontFamily: k.bodyFont }}
                    className="flex-1 truncate rounded border border-line bg-panel px-1.5 py-1 text-[0.6rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    본문 글꼴 적용
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  {k.logo ? (
                    <>
                      <img
                        src={k.logo.dataUrl}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded border border-line bg-panel object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => handleApplyLogo(k)}
                        className="flex-1 rounded border border-line bg-panel px-1.5 py-1 text-[0.6rem] font-medium text-fg-2 transition-colors hover:bg-raised"
                      >
                        로고를 마스터에 적용
                      </button>
                    </>
                  ) : (
                    <span className="text-[0.6rem] text-fg-3">로고 없음</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 space-y-0.5 border-t border-line/60 pt-1.5 text-[0.6rem] leading-snug text-fg-3">
        <p>브랜드 킷은 이 기기의 SQLite/OPFS에 저장돼요(다른 기기·계정과 공유되지 않아요).</p>
        <p>로고 적용은 문서 마스터에 저장되고, 실행취소(⌘Z)가 지원되지 않아요.</p>
        <p>팔레트가 삭제되면 이 킷의 팔레트 연결도 함께 끊겨요(로고·글꼴은 영향 없어요).</p>
        <p>Google Fonts는 처음 고를 때만 구글 서버에서 내려받아요(API 키·별도 비용 없음, 완전 오프라인은 아니에요).</p>
      </div>
    </div>
  );
}
