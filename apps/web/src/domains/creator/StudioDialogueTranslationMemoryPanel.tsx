import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Download,
  FileUp,
  HardDrive,
  Languages,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  createStudioTranslationMemoryEntry,
  exportStudioTranslationMemory,
  importStudioTranslationMemory,
  invalidateStudioTranslationMemoryEntry,
  loadStudioTranslationMemory,
  parseStudioTranslationMemoryGlossaryText,
  queryStudioTranslationMemory,
  saveStudioTranslationMemory,
  setStudioTranslationMemoryEntryStatus,
  STUDIO_TRANSLATION_MEMORY_MAX_ENTRIES,
  STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_BYTES,
  STUDIO_TRANSLATION_MEMORY_MAX_TRANSLATION_CHARS,
  upsertStudioTranslationMemoryEntry,
  type StudioTranslationMemoryEntry,
  type StudioTranslationMemoryGlossaryConflict,
  type StudioTranslationMemoryGlossaryRule,
  type StudioTranslationMemoryLoadResult,
  type StudioTranslationMemoryStatus,
  type StudioTranslationMemoryStorage,
} from "./studio-translation-memory";
import {
  createStudioTranslationMemorySqlitePersistence,
  type StudioTranslationMemoryPersistence,
} from "./studio-translation-memory-sqlite-persistence";

import { cx } from "@/shared/lib/cx";

export interface StudioDialogueTranslationMemoryPanelProps {
  readonly workScope: string;
  readonly sourceText: string;
  readonly speaker?: string;
  readonly sourceLocale: string;
  readonly targetLocale: string;
  readonly sourceRevision: string | number;
  readonly glossaryRules?: readonly StudioTranslationMemoryGlossaryRule[];
  /** Existing free-form glossary text can be passed without coupling the host to TM parsing. */
  readonly glossaryText?: string;
  readonly initialTranslation?: string;
  /**
   * Compatibility seam for tests/embeds. `undefined` uses shared V12 SQLite; `null` explicitly
   * selects memory-only mode. Product code must not pass the former localStorage authority.
   */
  readonly storage?: StudioTranslationMemoryStorage | null;
  /** Test seam for the async product authority; ignored when `storage` is explicitly provided. */
  readonly persistence?: StudioTranslationMemoryPersistence;
  readonly onReuse: (
    translation: string,
    entry: StudioTranslationMemoryEntry
  ) => void;
  readonly onClose?: () => void;
  readonly className?: string;
}

type PanelNotice = {
  readonly tone: "good" | "warn" | "bad";
  readonly message: string;
};

type TranslationMemoryAuthority =
  | {
      readonly kind: "sqlite";
      readonly persistence: StudioTranslationMemoryPersistence;
    }
  | {
      readonly kind: "storage-compat";
      readonly storage: StudioTranslationMemoryStorage;
    }
  | { readonly kind: "memory" };

const STATUS_LABEL: Record<StudioTranslationMemoryStatus, string> = {
  draft: "초안",
  reviewed: "검토됨",
  approved: "승인됨",
};

function statusClass(status: StudioTranslationMemoryStatus): string {
  if (status === "approved") {
    return "border-good/35 bg-good/10 text-good";
  }
  if (status === "reviewed") {
    return "border-accent/35 bg-accent-soft text-accent";
  }
  return "border-warn/35 bg-warn/10 text-warn";
}

function conflictList(
  conflicts: readonly StudioTranslationMemoryGlossaryConflict[]
) {
  if (conflicts.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.65rem] leading-relaxed text-warn"
    >
      <p className="flex items-center gap-1 font-semibold">
        <AlertTriangle size={12} aria-hidden />
        용어집 충돌 {conflicts.length}건
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.kind}:${conflict.sourceTerm}:${conflict.expectedTargets.join("|")}`}
          >
            {conflict.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TranslationMemoryMatchCard({
  label,
  entry,
  stale,
  conflicts,
  reusable,
  fuzzyScore,
  onReuse,
  onEdit,
  onReview,
  onApprove,
  onInvalidate,
}: {
  readonly label: string;
  readonly entry: StudioTranslationMemoryEntry;
  readonly stale: boolean;
  readonly conflicts: readonly StudioTranslationMemoryGlossaryConflict[];
  readonly reusable: boolean;
  readonly fuzzyScore?: number;
  readonly onReuse: () => void;
  readonly onEdit: () => void;
  readonly onReview?: () => void;
  readonly onApprove?: () => void;
  readonly onInvalidate?: () => void;
}) {
  return (
    <article className="space-y-2 rounded-xl border border-line bg-card/70 p-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.68rem] font-semibold text-fg">{label}</span>
        {fuzzyScore === undefined ? null : (
          <span className="rounded-full border border-line bg-panel px-1.5 py-0.5 text-[0.6rem] text-fg-3">
            {Math.round(fuzzyScore * 100)}% 유사
          </span>
        )}
        <span
          className={cx(
            "rounded-full border px-1.5 py-0.5 text-[0.6rem] font-semibold",
            statusClass(entry.status)
          )}
        >
          {STATUS_LABEL[entry.status]}
        </span>
        {stale ? (
          <span className="rounded-full border border-bad/35 bg-bad/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-bad">
            원문 변경 · 재검토 필요
          </span>
        ) : null}
      </div>

      <div className="grid gap-1.5 text-[0.67rem] leading-relaxed">
        <p className="rounded-lg bg-panel/70 px-2 py-1.5 text-fg-3">
          <span className="font-semibold text-fg-2">원문</span>
          <span className="ml-1.5 whitespace-pre-wrap">{entry.sourceText}</span>
        </p>
        <p className="rounded-lg border border-line/70 bg-panel px-2 py-1.5 text-fg">
          <span className="font-semibold text-accent">번역</span>
          <span className="ml-1.5 whitespace-pre-wrap">{entry.translation}</span>
        </p>
      </div>

      {conflictList(conflicts)}

      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={onReuse}
          disabled={!reusable}
          title={
            reusable
              ? "현재 대사 번역으로 명시적으로 재사용"
              : "원문 변경 또는 용어집 충돌을 먼저 검토하세요."
          }
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-accent px-2.5 text-[0.68rem] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RotateCcw size={12} aria-hidden />
          번역 재사용
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-[0.68rem] font-medium text-fg-2 transition-colors hover:bg-raised"
        >
          <PencilLine size={12} aria-hidden />
          편집란에 복사
        </button>
        {onReview && entry.status === "draft" ? (
          <button
            type="button"
            onClick={onReview}
            disabled={stale}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-[0.68rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check size={12} aria-hidden />
            검토 완료
          </button>
        ) : null}
        {onApprove && entry.status !== "approved" ? (
          <button
            type="button"
            onClick={onApprove}
            disabled={stale || conflicts.length > 0}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-good/35 bg-good/10 px-2.5 text-[0.68rem] font-semibold text-good transition-colors hover:bg-good/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <BadgeCheck size={12} aria-hidden />
            승인
          </button>
        ) : null}
        {onInvalidate ? (
          <button
            type="button"
            onClick={onInvalidate}
            disabled={entry.stale}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-bad/30 bg-bad/5 px-2.5 text-[0.68rem] font-medium text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            무효화
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function StudioDialogueTranslationMemoryPanel({
  workScope,
  sourceText,
  speaker = "",
  sourceLocale,
  targetLocale,
  sourceRevision,
  glossaryRules,
  glossaryText = "",
  initialTranslation = "",
  storage,
  persistence,
  onReuse,
  onClose,
  className,
}: StudioDialogueTranslationMemoryPanelProps) {
  const resolvedGlossaryRules =
    glossaryRules ?? parseStudioTranslationMemoryGlossaryText(glossaryText);
  const importInputId = useId();
  const [authority] = useState<TranslationMemoryAuthority>(() => {
    if (storage === null) return { kind: "memory" };
    if (storage !== undefined) {
      return { kind: "storage-compat", storage };
    }
    return {
      kind: "sqlite",
      persistence:
        persistence ?? createStudioTranslationMemorySqlitePersistence(),
    };
  });
  const [library, setLibrary] = useState<StudioTranslationMemoryLoadResult>(() => {
    if (authority.kind === "storage-compat") {
      return loadStudioTranslationMemory(authority.storage);
    }
    if (authority.kind === "memory") {
      return loadStudioTranslationMemory(null);
    }
    return { entries: [], status: "empty" };
  });
  const [hydrating, setHydrating] = useState(authority.kind === "sqlite");
  const [persistenceBusy, setPersistenceBusy] = useState(false);
  const [translationDraft, setTranslationDraft] = useState(initialTranslation);
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const mountedRef = useRef(true);
  const entriesRef = useRef(library.entries);
  const hydrationGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    if (authority.kind !== "sqlite") {
      return () => {
        mountedRef.current = false;
      };
    }

    const generation = ++hydrationGenerationRef.current;
    void authority.persistence
      .load()
      .then((loaded) => {
        if (
          !mountedRef.current
          || generation !== hydrationGenerationRef.current
        ) {
          return;
        }
        entriesRef.current = loaded.entries;
        setLibrary(loaded);
        setHydrating(false);
      })
      .catch((error: unknown) => {
        if (
          !mountedRef.current
          || generation !== hydrationGenerationRef.current
        ) {
          return;
        }
        setLibrary({
          entries: [],
          status: "unavailable",
          error: `SQLite 번역 메모리를 읽지 못했습니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        setHydrating(false);
      });

    return () => {
      mountedRef.current = false;
      hydrationGenerationRef.current += 1;
    };
  }, [authority]);

  const query = {
    workScope,
    sourceText,
    speaker,
    sourceLocale,
    targetLocale,
    sourceRevision,
  };
  const matches = queryStudioTranslationMemory(
    library.entries,
    query,
    resolvedGlossaryRules
  );

  function commitEntries(
    next: readonly StudioTranslationMemoryEntry[],
    successMessage: string,
    allowInvalidRecovery = false,
  ): void {
    if (hydrating) {
      setNotice({
        tone: "warn",
        message: "SQLite 번역 메모리를 불러온 뒤 저장할 수 있습니다.",
      });
      return;
    }
    if (library.status === "invalid" && !allowInvalidRecovery) {
      setNotice({
        tone: "bad",
        message:
          "손상된 저장 데이터를 덮어쓰지 않았습니다. 검증된 JSON을 명시적으로 가져와 복구하세요.",
      });
      return;
    }

    entriesRef.current = next;
    if (authority.kind === "sqlite") {
      const generation = ++saveGenerationRef.current;
      pendingWritesRef.current += 1;
      setPersistenceBusy(true);
      setLibrary({ entries: next, status: "ok" });
      setNotice({
        tone: "good",
        message: `${successMessage} SQLite에 저장 중입니다.`,
      });

      const write = writeQueueRef.current.then(() =>
        authority.persistence.save(next)
      );
      writeQueueRef.current = write.then(
        () => undefined,
        () => undefined,
      );
      void write
        .then((saved) => {
          if (!mountedRef.current || generation !== saveGenerationRef.current) {
            return;
          }
          setLibrary((current) => ({
            entries: current.entries,
            status: saved.ok ? "ok" : "unavailable",
            error: saved.error,
          }));
          setNotice({
            tone: saved.ok ? "good" : "warn",
            message: saved.ok
              ? successMessage
              : `${successMessage} ${saved.error ?? "현재 탭에서만 유지됩니다."}`,
          });
        })
        .catch((error: unknown) => {
          if (!mountedRef.current || generation !== saveGenerationRef.current) {
            return;
          }
          const message = `SQLite 번역 메모리 저장을 완료하지 못했습니다: ${
            error instanceof Error ? error.message : String(error)
          }`;
          setLibrary((current) => ({
            entries: current.entries,
            status: "unavailable",
            error: message,
          }));
          setNotice({ tone: "warn", message: `${successMessage} ${message}` });
        })
        .finally(() => {
          pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
          if (mountedRef.current && pendingWritesRef.current === 0) {
            setPersistenceBusy(false);
          }
        });
      return;
    }

    const saved = saveStudioTranslationMemory(
      authority.kind === "storage-compat" ? authority.storage : null,
      next,
    );
    setLibrary({
      entries: next,
      status: saved.ok ? "ok" : "unavailable",
      error: saved.error,
    });
    setNotice({
      tone: saved.ok ? "good" : "warn",
      message: saved.ok
        ? successMessage
        : `${successMessage} ${saved.error ?? "현재 탭에서만 유지됩니다."}`,
    });
  }

  function saveDraft(): void {
    const created = createStudioTranslationMemoryEntry({
      ...query,
      translation: translationDraft,
      status: "draft",
      glossaryRules: resolvedGlossaryRules,
    });
    if (!created.ok) {
      setNotice({ tone: "bad", message: created.error });
      return;
    }
    const entry = matches.exact
      ? { ...created.entry, createdAt: matches.exact.entry.createdAt }
      : created.entry;
    const next = upsertStudioTranslationMemoryEntry(entriesRef.current, entry);
    commitEntries(next, "번역 초안을 저장했습니다.");
    setTranslationDraft("");
  }

  function changeStatus(
    entry: StudioTranslationMemoryEntry,
    status: StudioTranslationMemoryStatus
  ): void {
    const next = setStudioTranslationMemoryEntryStatus(
      entriesRef.current,
      entry.id,
      status
    );
    if (next === library.entries) {
      setNotice({
        tone: "warn",
        message: "원문 변경 또는 용어집 충돌을 해소한 뒤 승인할 수 있습니다.",
      });
      return;
    }
    commitEntries(
      next,
      status === "approved"
        ? "번역을 승인했습니다."
        : "번역을 검토됨 상태로 변경했습니다."
    );
  }

  function invalidate(entry: StudioTranslationMemoryEntry): void {
    const next = invalidateStudioTranslationMemoryEntry(
      entriesRef.current,
      entry.id
    );
    commitEntries(next, "번역을 무효화하고 재검토 대상으로 표시했습니다.");
  }

  function reuse(
    entry: StudioTranslationMemoryEntry,
    reusable: boolean
  ): void {
    if (!reusable) {
      setNotice({
        tone: "warn",
        message: "원문 변경 또는 용어집 충돌을 먼저 검토하세요.",
      });
      return;
    }
    onReuse(entry.translation, entry);
    setNotice({
      tone: "good",
      message: "선택한 번역을 현재 대사에 재사용했습니다.",
    });
  }

  async function importFile(file: File): Promise<void> {
    if (file.size > STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_BYTES) {
      setNotice({
        tone: "bad",
        message: `가져오기 파일은 ${(STUDIO_TRANSLATION_MEMORY_MAX_IMPORT_BYTES / 1_000_000).toFixed(1)}MB 이하여야 합니다.`,
      });
      return;
    }
    setImportBusy(true);
    try {
      const imported = importStudioTranslationMemory(
        await file.text(),
        entriesRef.current,
      );
      if (!imported.ok) {
        setNotice({ tone: "bad", message: imported.error });
        return;
      }
      commitEntries(
        imported.entries,
        `${imported.accepted.toLocaleString("ko-KR")}개 항목을 가져왔습니다. 중복 ${imported.duplicates.toLocaleString("ko-KR")}개·제외 ${(
          imported.rejected + imported.truncated
        ).toLocaleString("ko-KR")}개.`,
        true,
      );
    } catch {
      setNotice({
        tone: "bad",
        message: "번역 메모리 파일을 읽지 못했습니다.",
      });
    } finally {
      setImportBusy(false);
    }
  }

  function downloadExport(): void {
    const exported = exportStudioTranslationMemory(library.entries);
    if (!exported.ok) {
      setNotice({ tone: "bad", message: exported.error });
      return;
    }
    if (
      typeof URL.createObjectURL !== "function"
      || typeof document === "undefined"
    ) {
      setNotice({
        tone: "warn",
        message: "이 브라우저에서는 JSON 파일 다운로드를 시작할 수 없습니다.",
      });
      return;
    }
    const url = URL.createObjectURL(
      new Blob([exported.json], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "toonspectrum-translation-memory-v1.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({
      tone: "good",
      message: `${(exported.bytes / 1_000).toFixed(1)}KB JSON을 내보냈습니다.`,
    });
  }

  const storageUnavailable =
    library.status === "unavailable" || authority.kind === "memory";

  return (
    <section
      aria-label="대사 번역 메모리"
      data-studio-translation-memory="local-only"
      data-studio-translation-memory-authority={authority.kind}
      aria-busy={hydrating || persistenceBusy}
      className={cx(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-xl backdrop-blur",
        className
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-line/70 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <Languages size={15} className="text-accent" aria-hidden />
            번역 메모리
          </h2>
          <p className="mt-0.5 text-[0.63rem] leading-relaxed text-fg-3">
            작품·화자·언어쌍이 같은 번역을 안전하게 재사용합니다.
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="번역 메모리 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div
          className={cx(
            "rounded-xl border px-2.5 py-2 text-[0.65rem] leading-relaxed",
            storageUnavailable
              ? "border-warn/35 bg-warn/10 text-warn"
              : library.status === "invalid"
                ? "border-bad/35 bg-bad/10 text-bad"
                : "border-line bg-card/60 text-fg-3"
          )}
        >
          <p className="flex items-center gap-1 font-semibold">
            <HardDrive size={12} aria-hidden />
            {hydrating
              ? "SQLite 번역 메모리 불러오는 중"
              : storageUnavailable
                ? "현재 탭 메모리에서만 유지"
                : library.status === "invalid"
                  ? "SQLite 저장 데이터 손상"
                : persistenceBusy
                  ? "SQLite/OPFS에 저장 중"
                  : authority.kind === "sqlite"
                    ? "SQLite/OPFS에 로컬 저장"
                    : "호스트 로컬 저장소 사용"}
          </p>
          <p className="mt-0.5">
            서버·팀원·다른 기기에는 자동 동기화하지 않습니다.
            {hydrating
              ? " 기존 저장 데이터를 확인하기 전에는 쓰기를 시작하지 않습니다."
              : storageUnavailable
              ? " 새로고침하면 사라질 수 있습니다."
              : " 필요하면 JSON으로 직접 옮기세요."}
          </p>
          {library.error ? <p className="mt-1">{library.error}</p> : null}
        </div>

        <section
          aria-label="현재 대사 번역 메모리 조건"
          className="rounded-xl border border-line bg-card/45 p-2.5"
        >
          <div className="flex flex-wrap items-center gap-1.5 text-[0.62rem] text-fg-3">
            <span
              className="max-w-full truncate rounded-full bg-panel px-2 py-1"
              title={`작품 범위: ${workScope}`}
            >
              작품 {workScope || "미지정"}
            </span>
            <span className="rounded-full bg-panel px-2 py-1">
              {sourceLocale} → {targetLocale}
            </span>
            <span className="rounded-full bg-panel px-2 py-1">
              화자 {speaker.trim() || "미지정"}
            </span>
            <span className="rounded-full bg-panel px-2 py-1">
              리비전 {String(sourceRevision)}
            </span>
          </div>
          <p className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap text-[0.69rem] leading-relaxed text-fg">
            {sourceText || "원문이 없습니다."}
          </p>
        </section>

        {matches.exact ? (
          <section aria-label="정확히 일치하는 번역">
            <TranslationMemoryMatchCard
              label="정확히 일치"
              entry={matches.exact.entry}
              stale={matches.exact.stale}
              conflicts={matches.exact.glossaryConflicts}
              reusable={matches.exact.reusable}
              onReuse={() =>
                reuse(matches.exact!.entry, matches.exact!.reusable)
              }
              onEdit={() =>
                setTranslationDraft(matches.exact!.entry.translation)
              }
              onReview={() =>
                changeStatus(matches.exact!.entry, "reviewed")
              }
              onApprove={() =>
                changeStatus(matches.exact!.entry, "approved")
              }
              onInvalidate={() => invalidate(matches.exact!.entry)}
            />
          </section>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[0.67rem] leading-relaxed text-fg-3">
            이 조건과 정확히 일치하는 로컬 번역이 없습니다.
          </p>
        )}

        {matches.fuzzy.length > 0 ? (
          <section aria-label="유사 번역 제안" className="space-y-2">
            <div className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent-soft px-2.5 py-2 text-[0.64rem] leading-relaxed text-fg-2">
              <ShieldCheck
                size={13}
                className="mt-0.5 shrink-0 text-accent"
                aria-hidden
              />
              <p>
                유사 번역은 <strong>자동 적용하지 않습니다.</strong> 원문과
                말투를 직접 비교한 뒤 재사용하세요.
              </p>
            </div>
            {matches.fuzzy.map((suggestion) => (
              <TranslationMemoryMatchCard
                key={suggestion.entry.id}
                label="유사 제안"
                entry={suggestion.entry}
                stale={false}
                conflicts={suggestion.glossaryConflicts}
                reusable={suggestion.reusable}
                fuzzyScore={suggestion.score}
                onReuse={() =>
                  reuse(suggestion.entry, suggestion.reusable)
                }
                onEdit={() =>
                  setTranslationDraft(suggestion.entry.translation)
                }
              />
            ))}
          </section>
        ) : null}

        <section
          aria-label="번역 메모리 초안 저장"
          className="space-y-2 rounded-xl border border-line bg-card/45 p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`${importInputId}-draft`}
              className="text-[0.68rem] font-semibold text-fg"
            >
              번역문 초안
            </label>
            <span className="text-[0.6rem] tabular-nums text-fg-4">
              {translationDraft.length.toLocaleString("ko-KR")} /{" "}
              {STUDIO_TRANSLATION_MEMORY_MAX_TRANSLATION_CHARS.toLocaleString(
                "ko-KR"
              )}
            </span>
          </div>
          <textarea
            id={`${importInputId}-draft`}
            value={translationDraft}
            onChange={(event) =>
              setTranslationDraft(
                event.target.value.slice(
                  0,
                  STUDIO_TRANSLATION_MEMORY_MAX_TRANSLATION_CHARS
                )
              )
            }
            rows={3}
            placeholder="검토할 번역문을 입력하세요."
            className="w-full resize-y rounded-xl border border-line bg-panel px-2.5 py-2 text-[0.7rem] leading-relaxed text-fg outline-none placeholder:text-fg-4 focus:border-accent"
          />
          <button
            type="button"
            onClick={saveDraft}
            disabled={
              !sourceText.trim()
              || !translationDraft.trim()
              || hydrating
              || library.status === "invalid"
            }
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check size={13} aria-hidden />
            {matches.exact
              ? "수정본을 초안으로 저장"
              : "번역을 초안으로 저장"}
          </button>
        </section>

        {notice ? (
          <p
            role={notice.tone === "bad" ? "alert" : "status"}
            className={cx(
              "rounded-xl border px-2.5 py-2 text-[0.65rem] leading-relaxed",
              notice.tone === "good"
                ? "border-good/35 bg-good/10 text-good"
                : notice.tone === "bad"
                  ? "border-bad/35 bg-bad/10 text-bad"
                  : "border-warn/35 bg-warn/10 text-warn"
            )}
          >
            {notice.message}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-line/70 bg-card/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.62rem] tabular-nums text-fg-3">
            로컬 항목 {library.entries.length.toLocaleString("ko-KR")} /{" "}
            {STUDIO_TRANSLATION_MEMORY_MAX_ENTRIES.toLocaleString("ko-KR")}
          </p>
          <div className="flex gap-1.5">
            <input
              id={importInputId}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={importBusy || hydrating}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importFile(file);
              }}
            />
            <label
              htmlFor={importInputId}
              aria-disabled={importBusy || hydrating}
              className={cx(
                "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.67rem] font-medium text-fg-2 transition-colors hover:bg-raised",
                (importBusy || hydrating) && "pointer-events-none opacity-50"
              )}
            >
              <FileUp size={12} aria-hidden />
              {importBusy ? "가져오는 중…" : "JSON 가져오기"}
            </label>
            <button
              type="button"
              onClick={downloadExport}
              disabled={library.entries.length === 0}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.67rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download size={12} aria-hidden />
              JSON 내보내기
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
