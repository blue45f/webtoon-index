/**
 * StudioCustomFontsPanel — 사용자가 소유한 글꼴 파일을 가져와 보관·적용하는 패널.
 * Props로 목록을 주입하면 기존 controlled import/test seam으로 동작한다. Props가 없으면
 * 제품 SQLite canonical manifest + OPFS SHA-256 CAS를 직접 hydrate하고 저장한다.
 *
 * 브라우저 seam(document.fonts·FontFace)은 prop으로 주입 가능하다 — jsdom에는 FontFace가
 * 없으므로 테스트가 가짜 폰트 집합을 넣어 등록 성공/실패 경로를 그대로 검증한다.
 */
import { Type, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  addCustomFont,
  browserFontSet,
  CUSTOM_FONT_ACCEPT,
  CUSTOM_FONT_FORMAT_HELP,
  customFontCssValue,
  formatCustomFontBytes,
  MAX_CUSTOM_FONT_FILE_BYTES,
  MAX_CUSTOM_FONT_TOTAL_BYTES,
  registerStudioCustomFont,
  registerStudioCustomFonts,
  removeCustomFont,
  totalCustomFontBytes,
  type StudioCustomFont,
  type StudioFontFaceFactory,
  type StudioFontSetLike,
} from "./studio-custom-fonts";
import { STUDIO_EASE, STUDIO_FOCUS_RING, StudioEmptyState, StudioSectionHeader } from "./studio-panel-ui";

import type {
  StudioCustomFontPage,
  StudioCustomFontRepository,
} from "./studio-custom-font-sqlite-opfs-repository";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

function localizeText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  return t(key) === key ? fallback : t(key);
}

function interpolateText(message: string, values?: Record<string, string | number>): string {
  if (!values) return message;
  return Object.entries(values).reduce((memo, [key, value]) => memo.replaceAll(`{${key}}`, String(value)), message);
}

function tText(
  t: (key: string) => string,
  fallback: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  return interpolateText(localizeText(t, fallback, key), values);
}

export interface StudioCustomFontsPanelProps {
  /** 둘을 함께 주입할 때만 explicit controlled legacy/test seam으로 동작한다. */
  readonly fonts?: readonly StudioCustomFont[];
  readonly onFontsChange?: (fonts: StudioCustomFont[]) => void;
  /** 선택한 요소에 글꼴 적용 — 값은 customFontCssValue()가 만든 CSS font-family 문자열
   *  (StudioBrandKitPanel.onApplyFont와 완전히 동일한 규약). */
  readonly onApplyFont?: (cssValue: string) => void;
  /** 텍스트/말풍선이 선택돼 있어 적용이 의미 있는 상태인지. */
  readonly canApplyFont?: boolean;
  /** 테스트 주입 seam. 생략하면 document.fonts / window.FontFace. */
  readonly fontSet?: StudioFontSetLike | null;
  readonly createFontFace?: StudioFontFaceFactory | null;
  /** 실 SQLite/OPFS 테스트와 제품 경계 주입점. 생략하면 lazy product repository를 연다. */
  readonly repository?: StudioCustomFontRepository;
  readonly loadRepository?: () => Promise<StudioCustomFontRepository>;
}

type StudioCustomFontStorageState =
  | "loading"
  | "sqlite-opfs"
  | "memory-only"
  | "unavailable"
  | "controlled";

const PRODUCT_FONT_PAGE_SIZE = 32;

async function loadProductRepository(): Promise<StudioCustomFontRepository> {
  const module = await import("./studio-custom-font-sqlite-opfs-repository");
  return module.getProductStudioCustomFontRepository();
}

function storageErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code ?? "")
    : null;
}

export function StudioCustomFontsPanel({
  fonts,
  onFontsChange,
  onApplyFont,
  canApplyFont = false,
  fontSet,
  createFontFace,
  repository,
  loadRepository,
}: StudioCustomFontsPanelProps) {
  const controlled = fonts !== undefined && onFontsChange !== undefined;
  const [productFonts, setProductFonts] = useState<StudioCustomFont[]>([]);
  const [storageState, setStorageState] = useState<StudioCustomFontStorageState>(
    controlled ? "controlled" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [nextPageCursor, setNextPageCursor] = useState<string | null>(null);
  const [productTotalEntries, setProductTotalEntries] = useState(0);
  const [productTotalBytes, setProductTotalBytes] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const repositoryRef = useRef<StudioCustomFontRepository | null>(repository ?? null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const hydrationGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const t = useT();

  const activeFonts: readonly StudioCustomFont[] = controlled ? (fonts ?? []) : productFonts;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pageAbortRef.current?.abort();
      pageAbortRef.current = null;
      hydrationGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (controlled) {
      setStorageState("controlled");
      return;
    }
    const generation = ++hydrationGenerationRef.current;
    pageAbortRef.current?.abort();
    const controller = new AbortController();
    pageAbortRef.current = controller;
    busyRef.current = false;
    setPageBusy(false);
    setStorageState("loading");
    setError(null);
    const resolveRepository = repository
      ? Promise.resolve(repository)
      : (loadRepository ?? loadProductRepository)();
    void resolveRepository.then(async (resolved) => {
      const page = await resolved.page({
        pageSize: PRODUCT_FONT_PAGE_SIZE,
        signal: controller.signal,
      });
      const registrations = await registerStudioCustomFonts(
        page.fonts,
        fontSet === undefined ? browserFontSet() : fontSet,
        createFontFace === undefined ? undefined : createFontFace,
      );
      if (!mountedRef.current || generation !== hydrationGenerationRef.current) return;
      repositoryRef.current = resolved;
      setProductFonts([...page.fonts]);
      setNextPageCursor(page.nextCursor);
      setProductTotalEntries(page.totalEntries);
      setProductTotalBytes(page.totalBytes);
      setStorageState("sqlite-opfs");
      const failures = registrations.filter((result) => result.status === "failed");
      if (failures.length > 0) {
        setNotice(
          `${page.fonts.length}개 글꼴의 OPFS 무결성은 확인했지만 ${failures.length}개는 `
          + "이 브라우저 FontFace에 등록하지 못했어요.",
        );
      }
    }).catch((cause: unknown) => {
      if (!mountedRef.current || generation !== hydrationGenerationRef.current) return;
      repositoryRef.current = null;
      const code = storageErrorCode(cause);
      if (code === "unavailable" || code === "quota-exceeded") {
        setStorageState("memory-only");
        setNotice("SQLite/OPFS를 열지 못해 현재 탭 메모리만 사용합니다. 새로고침하면 사라져요.");
        return;
      }
      setStorageState("unavailable");
      setError(
        "사용자 글꼴 manifest 또는 OPFS blob의 무결성을 확인하지 못해 일부 항목을 표시하지 않았습니다.",
      );
    });
    return () => controller.abort();
  }, [controlled, createFontFace, fontSet, loadRepository, repository]);

  function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = mutationTailRef.current.then(task, task);
    mutationTailRef.current = run.then(() => undefined, () => undefined);
    return run;
  }

  async function registerPage(page: StudioCustomFontPage): Promise<number> {
    const knownIds = new Set(activeFonts.map(({ id }) => id));
    const registrations = await registerStudioCustomFonts(
      page.fonts.filter(({ id }) => !knownIds.has(id)),
      fontSet === undefined ? browserFontSet() : fontSet,
      createFontFace === undefined ? undefined : createFontFace,
    );
    return registrations.filter(({ status }) => status === "failed").length;
  }

  async function loadNextProductPage() {
    const durableRepository = repositoryRef.current;
    const cursor = nextPageCursor;
    if (!durableRepository || !cursor || pageBusy || busyRef.current || storageState !== "sqlite-opfs") {
      return;
    }
    const generation = hydrationGenerationRef.current;
    pageAbortRef.current?.abort();
    const controller = new AbortController();
    pageAbortRef.current = controller;
    busyRef.current = true;
    setPageBusy(true);
    setError(null);
    try {
      const page = await durableRepository.page({
        pageSize: PRODUCT_FONT_PAGE_SIZE,
        cursor,
        signal: controller.signal,
      });
      const failures = await registerPage(page);
      if (!mountedRef.current || generation !== hydrationGenerationRef.current) return;
      // Keep one CAS-hydrated page resident. Traversal intent replaces the viewport instead of
      // gradually reconstructing the former unbounded list() heap.
      setProductFonts([...page.fonts]);
      setNextPageCursor(page.nextCursor);
      setProductTotalEntries(page.totalEntries);
      setProductTotalBytes(page.totalBytes);
      if (failures > 0) {
        setNotice(`${page.fonts.length}개를 더 확인했지만 ${failures}개는 FontFace에 등록하지 못했어요.`);
      }
    } catch (cause) {
      if (!mountedRef.current || generation !== hydrationGenerationRef.current) return;
      if (storageErrorCode(cause) === "aborted") return;
      setError(
        storageErrorCode(cause) === "invalid-cursor"
          ? "글꼴 보관함이 바뀌어 목록 cursor가 만료됐어요. 패널을 다시 열어주세요."
          : "사용자 글꼴 다음 page를 안전하게 읽지 못했습니다.",
      );
    } finally {
      if (mountedRef.current && generation === hydrationGenerationRef.current) {
        busyRef.current = false;
        setPageBusy(false);
      }
      if (pageAbortRef.current === controller) pageAbortRef.current = null;
    }
  }

  const productPaged = !controlled && storageState === "sqlite-opfs";
  const usedBytes = productPaged ? productTotalBytes : totalCustomFontBytes(activeFonts);
  const totalEntries = productPaged ? productTotalEntries : activeFonts.length;
  const usedPercent = Math.min(100, Math.round((usedBytes / MAX_CUSTOM_FONT_TOTAL_BYTES) * 100));

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일 재선택에도 onChange가 다시 발생하도록 즉시 리셋.
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // 예산을 넘는 파일은 통째로 메모리에 올리기 전에 거절한다.
      if (file.size > MAX_CUSTOM_FONT_FILE_BYTES) {
        setError(
          tText(
            t,
            `글꼴 파일이 ${formatCustomFontBytes(file.size)}로 한 개당 `
            + `${formatCustomFontBytes(MAX_CUSTOM_FONT_FILE_BYTES)} 한도를 넘었어요. `
            + "필요한 굵기만 서브셋한 WOFF2로 변환해 주세요.",
            "studio.customFonts.fileTooLarge",
            {
              selectedFileSize: formatCustomFontBytes(file.size),
              limitSize: formatCustomFontBytes(MAX_CUSTOM_FONT_FILE_BYTES),
            },
          ),
        );
        return;
      }
      if (file.size > MAX_CUSTOM_FONT_TOTAL_BYTES - usedBytes) {
        setError(
          `보관함 용량이 ${formatCustomFontBytes(usedBytes)}/`
          + `${formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES)}라 `
          + `${formatCustomFontBytes(file.size)}를 더 담을 수 없어요.`,
        );
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const register = (font: StudioCustomFont) => registerStudioCustomFont(
        font,
        fontSet === undefined ? browserFontSet() : fontSet,
        createFontFace === undefined ? undefined : createFontFace,
      );
      let storedFont: StudioCustomFont;
      let nextFonts: StudioCustomFont[];
      let registrationStatus: "ok" | "unsupported" = "ok";

      if (controlled) {
        const result = addCustomFont(activeFonts, { fileName: file.name, bytes });
        if (result.status === "rejected") {
          setError(result.message);
          return;
        }
        const registered = await register(result.font);
        if (registered.status === "failed") {
          setError(registered.message);
          return;
        }
        registrationStatus = registered.status;
        storedFont = result.font;
        nextFonts = result.fonts;
        onFontsChange?.(nextFonts);
      } else if (storageState === "unavailable" || storageState === "loading") {
        setError(
          storageState === "loading"
            ? "사용자 글꼴 SQLite/OPFS 보관함을 확인하는 중이에요. 잠시 뒤 다시 시도해주세요."
            : "사용자 글꼴 저장소 무결성을 확인할 수 없어 가져오기를 중단했습니다.",
        );
        return;
      } else if (storageState === "memory-only" || !repositoryRef.current) {
        const result = addCustomFont(activeFonts, { fileName: file.name, bytes });
        if (result.status === "rejected") {
          setError(result.message);
          return;
        }
        const registered = await register(result.font);
        if (registered.status === "failed") {
          setError(registered.message);
          return;
        }
        registrationStatus = registered.status;
        storedFont = result.font;
        nextFonts = result.fonts;
        if (mountedRef.current) setProductFonts(nextFonts);
      } else {
        const generation = ++mutationGenerationRef.current;
        const durableRepository = repositoryRef.current;
        try {
          const saved = await enqueueMutation(() => durableRepository.save({
            fileName: file.name,
            bytes,
          }));
          const registered = await register(saved);
          if (registered.status === "failed") {
            await enqueueMutation(() => durableRepository.delete(saved.id)).catch(() => undefined);
            setError(registered.message);
            return;
          }
          registrationStatus = registered.status;
          if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
          const refreshed = await durableRepository.page({ pageSize: PRODUCT_FONT_PAGE_SIZE });
          if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
          storedFont = saved;
          const byId = new Map(refreshed.fonts.map((font) => [font.id, font]));
          byId.set(saved.id, saved);
          nextFonts = [...byId.values()];
          setProductFonts(nextFonts);
          setNextPageCursor(refreshed.nextCursor);
          setProductTotalEntries(refreshed.totalEntries);
          setProductTotalBytes(refreshed.totalBytes);
        } catch (cause) {
          if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
          const code = storageErrorCode(cause);
          if (code === "unavailable" || code === "quota-exceeded") {
            // A paged durable library does not have every family resident, so synthesizing a
            // memory-only entry here could collide with an off-page CSS family. Preserve the
            // canonical library and report the failed write instead.
            setError(
              code === "quota-exceeded"
                ? "기기 저장 공간이 부족해 글꼴을 담지 않았어요. 기존 보관함은 그대로 유지됩니다."
                : "SQLite/OPFS 저장을 완료하지 못해 글꼴을 담지 않았어요. 기존 보관함은 그대로 유지됩니다.",
            );
            return;
          }
          setStorageState("unavailable");
          setError(
            "사용자 글꼴 manifest 또는 OPFS blob이 손상되어 가져오기를 중단했습니다. 일부 데이터로 덮어쓰지 않았습니다.",
          );
          return;
        }
      }
      setNotice(
        storageState === "memory-only"
          ? `“${storedFont.family}” 글꼴은 현재 탭 메모리에만 담았어요. 새로고침하면 사라져요.`
          : registrationStatus === "unsupported"
          ? tText(
            t,
            `“${storedFont.family}” 글꼴을 담았어요. 이 브라우저는 미리보기를 지원하지 않아요.`,
            "studio.customFonts.noticeUnsupported",
            { fontName: storedFont.family },
          )
          : tText(
            t,
            `“${storedFont.family}” 글꼴을 담았어요. (${formatCustomFontBytes(storedFont.byteLength)})`,
            "studio.customFonts.noticeUploaded",
            {
              fontName: storedFont.family,
              size: formatCustomFontBytes(storedFont.byteLength),
            },
          ),
      );
    } catch {
      setError(tText(
        t,
        "글꼴 파일을 읽지 못했어요. 파일이 손상됐는지 확인해주세요.",
        "studio.customFonts.readFailed",
      ));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleDelete(font: StudioCustomFont) {
    if (busyRef.current) return;
    setError(null);
    setNotice(null);
    if (controlled) {
      onFontsChange?.(removeCustomFont(activeFonts, font.id));
      return;
    }
    if (storageState === "memory-only") {
      setProductFonts((current) => removeCustomFont(current, font.id));
      setNotice("현재 탭 메모리에서만 지웠어요. 이 상태는 새로고침 후 유지되지 않습니다.");
      return;
    }
    const durableRepository = repositoryRef.current;
    if (!durableRepository || storageState !== "sqlite-opfs") {
      setError("사용자 글꼴 SQLite/OPFS 저장소를 사용할 수 없어 삭제하지 않았습니다.");
      return;
    }
    const generation = ++mutationGenerationRef.current;
    busyRef.current = true;
    setBusy(true);
    void enqueueMutation(async () => {
      await durableRepository.delete(font.id);
      return durableRepository.page({ pageSize: PRODUCT_FONT_PAGE_SIZE });
    }).then(async (page) => {
      const failures = await registerPage(page);
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
      setProductFonts([...page.fonts]);
      setNextPageCursor(page.nextCursor);
      setProductTotalEntries(page.totalEntries);
      setProductTotalBytes(page.totalBytes);
      setNotice(`“${font.family}” 글꼴을 SQLite/OPFS 보관함에서 삭제했어요.`);
      if (failures > 0) {
        setNotice(`글꼴을 삭제했지만 새 page의 ${failures}개는 FontFace에 등록하지 못했어요.`);
      }
    }).catch((cause: unknown) => {
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
      if (storageErrorCode(cause) !== "corrupt") {
        setError("사용자 글꼴을 기기 보관함에서 삭제하지 못해 목록을 유지했습니다.");
      } else {
        setStorageState("unavailable");
        setError("사용자 글꼴 저장소 무결성 오류로 삭제를 중단했습니다.");
      }
    }).finally(() => {
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
      busyRef.current = false;
      setBusy(false);
    });
  }

  return (
    <section
      aria-label={t("studio.customFonts.title")}
      aria-busy={busy || pageBusy || storageState === "loading"}
      data-studio-custom-font-authority={storageState}
    >
      <StudioSectionHeader
        title={t("studio.customFonts.title")}
        description={tText(
          t,
          `보유한 ${CUSTOM_FONT_FORMAT_HELP} 파일을 담아 레터링·효과음에 씁니다.`,
          "studio.customFonts.description",
          { format: CUSTOM_FONT_FORMAT_HELP },
        )}
      />

      <p className="mb-2 text-[0.6rem] font-semibold text-fg-3" aria-live="polite">
        {storageState === "loading"
          ? "SQLite/OPFS 사용자 글꼴 확인 중"
          : storageState === "sqlite-opfs"
            ? "이 기기 SQLite manifest · OPFS SHA-256 원본 저장"
            : storageState === "memory-only"
              ? "현재 탭 메모리 임시 · 새로고침 시 사라짐"
              : storageState === "unavailable"
                ? "저장소 무결성 확인 실패 · 가져오기 중단"
                : "주입된 controlled 보관함"}
      </p>

      <label
        className={cn(
          "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.72rem] font-semibold text-fg-2",
          STUDIO_EASE,
          "hover:bg-raised focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
          (busy || pageBusy || storageState === "loading" || storageState === "unavailable")
            && "pointer-events-none cursor-wait opacity-55",
        )}
      >
        <Upload size={14} aria-hidden />
        {busy ? t("studio.customFonts.importing") : t("studio.customFonts.importButton")}
        <input
          type="file"
          accept={CUSTOM_FONT_ACCEPT}
          aria-label={t("studio.customFonts.importAria")}
          className="sr-only"
          disabled={busy || pageBusy || storageState === "loading" || storageState === "unavailable"}
          onChange={(event) => void handleImportFile(event)}
        />
      </label>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2 text-[0.72rem] text-fg-3">
          <span>
            {tText(
              t,
              `${formatCustomFontBytes(usedBytes)} / ${formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES)} 사용`,
              "studio.customFonts.usage",
              {
                used: formatCustomFontBytes(usedBytes),
                max: formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES),
              },
            )}
          </span>
          <span className="tabular-nums">
            {tText(
              t,
              `총 ${totalEntries.toLocaleString("ko-KR")}개`,
              "studio.customFonts.storageCountUnbounded",
              { count: totalEntries },
            )}
          </span>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-label={t("studio.customFonts.storageAria")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPercent}
          aria-valuetext={`${formatCustomFontBytes(usedBytes)} / ${formatCustomFontBytes(MAX_CUSTOM_FONT_TOTAL_BYTES)}`}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="mt-2 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-2 text-[0.72rem] leading-relaxed text-bad"
        >
          {error}
        </p>
      )}
      {!error && notice && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 rounded-lg border border-good/35 bg-good/10 px-2.5 py-2 text-[0.72rem] leading-relaxed text-fg"
        >
          {notice}
        </p>
      )}

      {activeFonts.length === 0 ? (
        <div className="mt-2">
          <StudioEmptyState
            icon={<Type size={18} aria-hidden />}
            title={t("studio.customFonts.emptyTitle")}
            description={tText(
              t,
              `라이선스를 가진 ${CUSTOM_FONT_FORMAT_HELP} 파일을 담으면 대사·효과음에 바로 쓸 수 있어요.`,
              "studio.customFonts.emptyDescription",
              { format: CUSTOM_FONT_FORMAT_HELP },
            )}
          />
        </div>
      ) : (
        <div className="mt-2">
          <ul
            className="max-h-72 space-y-1.5 overflow-y-auto pr-1"
            aria-label={productPaged
              ? `담은 글꼴 총 ${totalEntries.toLocaleString("ko-KR")}개 중 ${activeFonts.length.toLocaleString("ko-KR")}개 표시`
              : tText(
                t,
                `담은 글꼴 ${activeFonts.length}개`,
                "studio.customFonts.listAria",
                { count: activeFonts.length },
              )}
          >
            {activeFonts.map((font) => (
            <li key={font.id} className="rounded-lg border border-line bg-card px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-xs font-medium text-fg"
                    style={{ fontFamily: customFontCssValue(font) }}
                    title={font.family}
                  >
                    {font.family}
                  </span>
                  <span className="block truncate text-[0.7rem] text-fg-3" title={font.fileName}>
                    {font.fileName || t("studio.customFonts.unknownFileName")} · {formatCustomFontBytes(font.byteLength)}
                  </span>
                </span>
                {onApplyFont && (
                  <button
                    type="button"
                    onClick={() => onApplyFont(customFontCssValue(font))}
                    disabled={!canApplyFont || busy || pageBusy}
                    aria-label={tText(t, `${font.family} 글꼴 적용`, "studio.customFonts.applyAria", { fontName: font.family })}
                    title={canApplyFont
                      ? t("studio.customFonts.applyToText")
                      : t("studio.customFonts.selectTextFirst")}
                    className={cn(
                      "min-h-11 shrink-0 rounded-lg border border-line px-2.5 text-[0.72rem] font-semibold text-fg-2",
                      STUDIO_EASE,
                      STUDIO_FOCUS_RING,
                      "hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    {t("studio.customFonts.apply")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(font)}
                  disabled={busy || pageBusy}
                  aria-label={tText(t, `${font.family} 글꼴 삭제`, "studio.customFonts.deleteAria", { fontName: font.family })}
                  title={t("studio.customFonts.delete")}
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3",
                    STUDIO_EASE,
                    "hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-bad disabled:cursor-wait disabled:opacity-45",
                  )}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            </li>
            ))}
          </ul>
          {nextPageCursor && (
            <button
              type="button"
              className={cn(
                "mt-2 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                "hover:bg-raised disabled:cursor-wait disabled:opacity-50",
              )}
              disabled={pageBusy || busy}
              onClick={() => void loadNextProductPage()}
            >
              {pageBusy
                ? "글꼴 더 불러오는 중"
                : `글꼴 더 보기 (${activeFonts.length.toLocaleString("ko-KR")}/${totalEntries.toLocaleString("ko-KR")})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
