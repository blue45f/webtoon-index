import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  CircleDot,
  Clock3,
  Eye,
  Flag,
  Lightbulb,
  Link2,
  Plus,
  Search,
  Target,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDeletePromisePayoffEntryRequest } from "./studio-destructive-command-catalog";
import {
  addStudioPromisePayoffEntry,
  diagnoseStudioPromisePayoffLedger,
  nextStudioPromisePayoffLinkId,
  patchStudioPromisePayoffEntry,
  removeStudioPromisePayoffEntry,
  searchStudioPromisePayoffLedger,
  setStudioPromisePayoffCurrentEpisode,
  studioPromisePayoffDeadlineState,
  studioPromisePayoffKindLabel,
  studioPromisePayoffSpoilerLabel,
  studioPromisePayoffStatusLabel,
  studioPromisePayoffUrgencyLabel,
  studioPromisePayoffVisibilityLabel,
  summarizeStudioPromisePayoffLedger,
  STUDIO_PROMISE_PAYOFF_KINDS,
  STUDIO_PROMISE_PAYOFF_MAX_LABEL_LENGTH,
  STUDIO_PROMISE_PAYOFF_MAX_LINKS,
  STUDIO_PROMISE_PAYOFF_MAX_OWNER_LENGTH,
  STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH,
  STUDIO_PROMISE_PAYOFF_MAX_TITLE_LENGTH,
  STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS,
  STUDIO_PROMISE_PAYOFF_STATUSES,
  STUDIO_PROMISE_PAYOFF_URGENCIES,
  STUDIO_PROMISE_PAYOFF_VISIBILITIES,
  type StudioPromisePayoffEntry,
  type StudioPromisePayoffEntryPatch,
  type StudioPromisePayoffFilter,
  type StudioPromisePayoffLedger,
  type StudioPromisePayoffStoryLink,
  type StudioPromisePayoffWarningSeverity,
} from "./studio-promise-payoff-ledger";

export interface StudioPromisePayoffSceneOption {
  readonly id: string;
  readonly label: string;
}

export interface StudioPromisePayoffLedgerPanelProps {
  readonly ledger: StudioPromisePayoffLedger;
  readonly onChange: (ledger: StudioPromisePayoffLedger) => void;
  readonly sceneOptions?: readonly StudioPromisePayoffSceneOption[];
}

type LedgerFilter = "all" | "unresolved" | "warning" | "payoff" | "intentional";
type StoryStage = "seed" | "foreshadow" | "payoff";

const CONTROL_CLASS =
  "mt-1.5 min-h-11 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const LABEL_CLASS = "block text-[0.7rem] font-semibold text-fg-2";

function deadlineCopy(entry: StudioPromisePayoffEntry, currentEpisode: number): string {
  const state = studioPromisePayoffDeadlineState(entry, currentEpisode);
  if (state === "closed") return "마감 닫힘";
  if (state === "unscheduled") return "회수 회차 미정";
  if (state === "overdue") return `${entry.dueEpisode}화 · 마감 지남`;
  if (state === "due-now") return `${entry.dueEpisode}화 · 이번 회차`;
  if (state === "due-soon") return `${entry.dueEpisode}화 · 곧 마감`;
  return `${entry.dueEpisode}화 예정`;
}

function deadlineTone(entry: StudioPromisePayoffEntry, currentEpisode: number): string {
  const state = studioPromisePayoffDeadlineState(entry, currentEpisode);
  if (state === "overdue") return "text-bad";
  if (state === "due-now" || state === "due-soon") return "text-warn";
  if (state === "closed") return "text-good";
  return "text-fg-3";
}

function warningTone(severity: StudioPromisePayoffWarningSeverity): string {
  if (severity === "critical") return "border-bad/35 bg-bad/10 text-bad";
  if (severity === "high") return "border-warn/35 bg-warn/10 text-warn";
  if (severity === "normal") return "border-cool/35 bg-cool/10 text-cool";
  return "border-line bg-card text-fg-3";
}

function filterContract(filter: LedgerFilter): StudioPromisePayoffFilter {
  if (filter === "unresolved") return { unresolvedOnly: true };
  if (filter === "warning") return { warningOnly: true };
  if (filter === "payoff") return { statuses: ["payoff"] };
  if (filter === "intentional") return { statuses: ["intentional-non-payoff"] };
  return {};
}

function parseEpisode(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

interface StoryLinkEditorProps {
  readonly stage: StoryStage;
  readonly heading: string;
  readonly link: StudioPromisePayoffStoryLink;
  readonly sceneOptions: readonly StudioPromisePayoffSceneOption[];
  readonly onChange: (link: StudioPromisePayoffStoryLink) => void;
  readonly onRemove: () => void;
}

function StoryLinkEditor({
  stage,
  heading,
  link,
  sceneOptions,
  onChange,
  onRemove,
}: StoryLinkEditorProps) {
  const prefix = `promise-payoff-${link.id}`;
  return (
    <div
      data-studio-promise-payoff-link={stage}
      className="border-t border-line py-3 first:border-t-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-md ${
            stage === "seed"
              ? "bg-cool/12 text-cool"
              : stage === "payoff"
                ? "bg-good/12 text-good"
                : "bg-accent-soft text-accent"
          }`}
        >
          {stage === "seed"
            ? <CircleDot size={13} aria-hidden />
            : stage === "payoff"
              ? <Target size={13} aria-hidden />
              : <Lightbulb size={13} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-fg">{heading}</p>
          <p className="truncate font-mono text-[0.58rem] text-fg-3">{link.id}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${heading} 연결 삭제`}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className={LABEL_CLASS} htmlFor={`${prefix}-episode`}>
          회차
          <input
            id={`${prefix}-episode`}
            type="number"
            min={1}
            inputMode="numeric"
            value={link.episode}
            onChange={(event) =>
              onChange({
                ...link,
                episode: parseEpisode(event.target.value, link.episode),
              })}
            className={CONTROL_CLASS}
          />
        </label>
        <label className={LABEL_CLASS} htmlFor={`${prefix}-scene`}>
          장면 바이블
          <select
            id={`${prefix}-scene`}
            value={link.sceneId ?? ""}
            onChange={(event) => {
              const sceneId = event.target.value;
              const { sceneId: _sceneId, ...rest } = link;
              onChange(sceneId ? { ...rest, sceneId } : rest);
            }}
            className={CONTROL_CLASS}
          >
            <option value="">연결 안 함</option>
            {sceneOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS} htmlFor={`${prefix}-page`}>
          페이지 ID
          <input
            id={`${prefix}-page`}
            type="text"
            value={link.pageId ?? ""}
            placeholder="page-1"
            onChange={(event) => {
              const pageId = event.target.value;
              const { pageId: _pageId, ...rest } = link;
              onChange(pageId ? { ...rest, pageId } : rest);
            }}
            className={`${CONTROL_CLASS} font-mono text-xs`}
          />
        </label>
        <label className={LABEL_CLASS} htmlFor={`${prefix}-frame`}>
          컷 ID
          <input
            id={`${prefix}-frame`}
            type="text"
            value={link.frameId ?? ""}
            placeholder="frame-12"
            onChange={(event) => {
              const frameId = event.target.value;
              const { frameId: _frameId, ...rest } = link;
              onChange(frameId ? { ...rest, frameId } : rest);
            }}
            className={`${CONTROL_CLASS} font-mono text-xs`}
          />
        </label>
      </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-2">
        <label className={LABEL_CLASS} htmlFor={`${prefix}-label`}>
          표시 이름
          <input
            id={`${prefix}-label`}
            type="text"
            maxLength={STUDIO_PROMISE_PAYOFF_MAX_LABEL_LENGTH}
            value={link.label}
            placeholder="예: 7화 · 시계 문양 재등장"
            onChange={(event) => onChange({ ...link, label: event.target.value })}
            className={CONTROL_CLASS}
          />
        </label>
        <label className={LABEL_CLASS} htmlFor={`${prefix}-note`}>
          장면에서 전달할 단서
          <input
            id={`${prefix}-note`}
            type="text"
            maxLength={STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH}
            value={link.note}
            placeholder="독자가 무엇을 보고 기억해야 하는지"
            onChange={(event) => onChange({ ...link, note: event.target.value })}
            className={CONTROL_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

export function StudioPromisePayoffLedgerPanel({
  ledger,
  onChange,
  sceneOptions = [],
}: StudioPromisePayoffLedgerPanelProps) {
  const [requestedEntryId, setRequestedEntryId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const summary = summarizeStudioPromisePayoffLedger(ledger);
  const warnings = diagnoseStudioPromisePayoffLedger(ledger);
  const visibleEntries = searchStudioPromisePayoffLedger(ledger, {
    ...filterContract(filter),
    query,
  });
  const selectedEntry =
    visibleEntries.find(({ id }) => id === requestedEntryId)
    ?? visibleEntries[0]
    ?? null;
  const selectedWarnings = selectedEntry
    ? warnings.filter(({ entryId }) => entryId === selectedEntry.id)
    : [];

  function applyChange(next: StudioPromisePayoffLedger, nextId?: string): void {
    try {
      onChange(next);
      if (nextId) setRequestedEntryId(nextId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "약속 원장을 저장하지 못했어요.");
    }
  }

  function addEntry(): void {
    try {
      const next = addStudioPromisePayoffEntry(ledger);
      const added = next.entries.find(
        ({ id }) => !ledger.entries.some((candidate) => candidate.id === id)
      );
      applyChange(next, added?.id);
      setFilter("all");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "약속을 추가하지 못했어요.");
    }
  }

  function patchEntry(patch: StudioPromisePayoffEntryPatch): void {
    if (!selectedEntry) return;
    applyChange(patchStudioPromisePayoffEntry(ledger, selectedEntry.id, patch));
  }

  function deleteEntry(): void {
    if (!selectedEntry) return;
    void (async () => {
      if (
        !(await confirmStudioDestructiveAction(
          studioDeletePromisePayoffEntryRequest(
            selectedEntry.title || selectedEntry.id
          )
        ))
      ) return;
      const nextId = visibleEntries.find(({ id }) => id !== selectedEntry.id)?.id ?? null;
      setRequestedEntryId(nextId);
      applyChange(removeStudioPromisePayoffEntry(ledger, selectedEntry.id));
    })();
  }

  function newLink(stage: StoryStage): StudioPromisePayoffStoryLink {
    if (!selectedEntry) throw new Error("먼저 약속 항목을 선택하세요.");
    return {
      id: nextStudioPromisePayoffLinkId(selectedEntry, stage),
      episode: ledger.currentEpisode,
      label: "",
      note: "",
    };
  }

  function setSingleLink(
    stage: "seed" | "payoff",
    link: StudioPromisePayoffStoryLink | null
  ): void {
    patchEntry(stage === "seed" ? { seed: link } : { payoff: link });
  }

  function patchForeshadow(link: StudioPromisePayoffStoryLink): void {
    if (!selectedEntry) return;
    patchEntry({
      foreshadows: selectedEntry.foreshadows.map((candidate) =>
        candidate.id === link.id ? link : candidate
      ),
    });
  }

  function removeForeshadow(linkId: string): void {
    if (!selectedEntry) return;
    patchEntry({
      foreshadows: selectedEntry.foreshadows.filter(({ id }) => id !== linkId),
    });
  }

  const filters: readonly [LedgerFilter, string][] = [
    ["all", `전체 ${summary.total}`],
    ["unresolved", `미회수 ${summary.unresolved}`],
    ["warning", `경고 ${summary.warningEntries}`],
    ["payoff", `회수 ${summary.paidOff}`],
    ["intentional", `의도 미회수 ${summary.intentionalNonPayoff}`],
  ];

  return (
    <section
      aria-label="약속과 회수 원장"
      data-studio-promise-payoff-ledger="true"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid shrink-0 grid-cols-2 border-b border-line bg-card/20 sm:grid-cols-4 xl:grid-cols-6">
        <div className="border-b border-r border-line px-3 py-2.5 sm:border-b-0">
          <p className="text-[0.62rem] font-semibold text-fg-3">현재 작업</p>
          <label className="mt-0.5 flex items-center gap-1 text-sm font-bold text-fg">
            <span className="sr-only">현재 작업 회차</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label="현재 작업 회차"
              value={ledger.currentEpisode}
              onChange={(event) => {
                const episode = parseEpisode(event.target.value, ledger.currentEpisode);
                if (episode === ledger.currentEpisode) return;
                try {
                  applyChange(setStudioPromisePayoffCurrentEpisode(ledger, episode));
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "현재 회차를 바꾸지 못했어요."
                  );
                }
              }}
              className="min-h-11 w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums outline-none hover:border-line focus:border-accent"
            />
            화
          </label>
        </div>
        {[
          ["열린 약속", summary.unresolved, "text-fg"],
          ["곧 마감", summary.dueSoon + summary.dueNow, "text-warn"],
          ["기한 초과", summary.overdue, "text-bad"],
          ["회수 완료", summary.paidOff, "text-good"],
          ["검토 필요", summary.warningEntries, "text-cool"],
        ].map(([label, count, tone]) => (
          <div key={label} className="border-b border-r border-line px-3 py-2.5 last:border-r-0 sm:border-b-0">
            <p className="text-[0.62rem] font-semibold text-fg-3">{label}</p>
            <p className={`mt-0.5 text-sm font-bold tabular-nums ${tone}`}>{count}</p>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="shrink-0 border-b border-line bg-bad/10 px-4 py-2 text-xs text-bad">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="flex max-h-[42vh] min-h-0 flex-col border-b border-line bg-card/35 md:max-h-none md:border-b-0 md:border-r">
          <div className="shrink-0 space-y-2 border-b border-line p-3">
            <label className="relative block">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                aria-hidden
              />
              <span className="sr-only">약속 원장 검색</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="제목·담당자·회차·컷 검색"
                className="min-h-11 w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-xs text-fg outline-none placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
            <div
              role="tablist"
              aria-label="약속 원장 필터"
              className="flex gap-1 overflow-x-auto pb-0.5"
            >
              {filters.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => setFilter(id)}
                  className={`min-h-11 shrink-0 rounded-lg border px-3 text-[0.68rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    filter === id
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={addEntry}
              className={`${BUTTON_CLASS} w-full border-accent bg-accent text-on-accent hover:bg-accent-hover`}
            >
              <Plus size={14} aria-hidden />
              새 약속 등록
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleEntries.length === 0 ? (
              <div className="grid min-h-36 place-items-center border border-dashed border-line px-4 text-center">
                <div>
                  <BookOpenCheck size={22} className="mx-auto text-fg-3" aria-hidden />
                  <p className="mt-2 text-xs font-bold text-fg-2">
                    {ledger.entries.length === 0
                      ? "첫 약속을 실제 컷과 연결하세요"
                      : "조건에 맞는 약속이 없어요"}
                  </p>
                  <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
                    첫 등장, 중간 단서, 회수 장면을 한 원장에서 추적합니다.
                  </p>
                </div>
              </div>
            ) : (
              <ol aria-label="약속 원장 항목" className="space-y-1">
                {visibleEntries.map((entry) => {
                  const selected = selectedEntry?.id === entry.id;
                  const entryWarnings = warnings.filter(({ entryId }) => entryId === entry.id);
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        onClick={() => {
                          setRequestedEntryId(entry.id);
                          setError(null);
                        }}
                        className={`flex min-h-14 w-full items-start gap-2 border-l-2 px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                          selected
                            ? "border-l-accent bg-accent-soft/20"
                            : "border-l-transparent hover:bg-raised"
                        }`}
                      >
                        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${
                          selected ? "bg-accent text-on-accent" : "bg-raised text-fg-3"
                        }`}>
                          <Flag size={13} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-fg">
                              {entry.title || "이름 없는 약속"}
                            </span>
                            {entryWarnings.length > 0 && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.6rem] font-bold text-warn">
                                <AlertTriangle size={10} aria-hidden />
                                {entryWarnings.length}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.62rem] text-fg-3">
                            <span>{studioPromisePayoffKindLabel(entry.kind)}</span>
                            <span>{studioPromisePayoffStatusLabel(entry.status)}</span>
                            <span className={deadlineTone(entry, ledger.currentEpisode)}>
                              {deadlineCopy(entry, ledger.currentEpisode)}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto overscroll-contain">
          {!selectedEntry ? (
            <div className="grid min-h-full place-items-center px-5 py-12 text-center">
              <div className="max-w-md">
                <span className="mx-auto grid size-12 place-items-center rounded-lg border border-line bg-card text-fg-3">
                  <Target size={22} aria-hidden />
                </span>
                <h3 className="mt-3 text-sm font-bold text-fg">독자에게 건 약속을 잊지 마세요</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-3">
                  복선·미스터리·퀘스트의 첫 장면과 중간 단서, 회수 컷을 연결하면 마감이 다가올 때 로컬 규칙이 알려 줍니다.
                </p>
                <button
                  type="button"
                  onClick={addEntry}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Plus size={14} aria-hidden />
                  첫 약속 등록
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex min-w-0 flex-wrap items-start gap-3 border-b border-line pb-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Flag size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-bold text-fg">
                      {selectedEntry.title || "이름 없는 약속"}
                    </h3>
                    <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] font-semibold text-fg-3">
                      {studioPromisePayoffKindLabel(selectedEntry.kind)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold ${
                      studioPromisePayoffDeadlineState(
                        selectedEntry,
                        ledger.currentEpisode
                      ) === "overdue"
                        ? "border-bad/35 bg-bad/10 text-bad"
                        : "border-line bg-card text-fg-3"
                    }`}>
                      {deadlineCopy(selectedEntry, ledger.currentEpisode)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[0.62rem] text-fg-3">
                    안정 ID · {selectedEntry.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={deleteEntry}
                  className={`${BUTTON_CLASS} border-bad/30 bg-bad/10 text-bad hover:bg-bad/15`}
                >
                  <Trash2 size={13} aria-hidden />
                  삭제
                </button>
              </div>

              {selectedWarnings.length > 0 && (
                <section aria-labelledby={`promise-${selectedEntry.id}-warnings`} className="border-b border-line py-4">
                  <h4
                    id={`promise-${selectedEntry.id}-warnings`}
                    className="flex items-center gap-1.5 text-xs font-bold text-warn"
                  >
                    <AlertTriangle size={13} aria-hidden />
                    회수 검토 {selectedWarnings.length}건
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {selectedWarnings.map((warning) => (
                      <li
                        key={`${warning.code}:${warning.message}`}
                        className={`border-l-2 px-2 py-1.5 text-[0.68rem] leading-relaxed ${warningTone(warning.severity)}`}
                      >
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby={`promise-${selectedEntry.id}-identity`} className="py-4">
                <h4 id={`promise-${selectedEntry.id}-identity`} className="text-xs font-bold text-fg">
                  약속 정의
                </h4>
                <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                  이야기 의미만 기록하고 장면의 시각 기준은 기존 Production Bible 항목을 연결합니다.
                </p>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-title`}>
                    제목
                    <input
                      id={`promise-${selectedEntry.id}-title`}
                      type="text"
                      maxLength={STUDIO_PROMISE_PAYOFF_MAX_TITLE_LENGTH}
                      value={selectedEntry.title}
                      onChange={(event) => patchEntry({ title: event.target.value })}
                      placeholder="예: 1화의 깨진 시계"
                      className={CONTROL_CLASS}
                    />
                  </label>
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-owner`}>
                    담당 작가·편집자
                    <input
                      id={`promise-${selectedEntry.id}-owner`}
                      type="text"
                      maxLength={STUDIO_PROMISE_PAYOFF_MAX_OWNER_LENGTH}
                      value={selectedEntry.owner}
                      onChange={(event) => patchEntry({ owner: event.target.value })}
                      placeholder="담당자 표시 이름"
                      className={CONTROL_CLASS}
                    />
                  </label>
                </div>
                <label className={`${LABEL_CLASS} mt-3`} htmlFor={`promise-${selectedEntry.id}-summary`}>
                  독자에게 건 약속
                  <textarea
                    id={`promise-${selectedEntry.id}-summary`}
                    rows={3}
                    maxLength={STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH}
                    value={selectedEntry.summary}
                    onChange={(event) => patchEntry({ summary: event.target.value })}
                    placeholder="독자가 무엇을 궁금해하고, 회수 때 무엇을 이해해야 하는지"
                    className={`${CONTROL_CLASS} resize-y`}
                  />
                </label>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-kind`}>
                    유형
                    <select
                      id={`promise-${selectedEntry.id}-kind`}
                      value={selectedEntry.kind}
                      onChange={(event) =>
                        patchEntry({
                          kind: event.target.value as StudioPromisePayoffEntry["kind"],
                        })}
                      className={CONTROL_CLASS}
                    >
                      {STUDIO_PROMISE_PAYOFF_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {studioPromisePayoffKindLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-status`}>
                    진행 상태
                    <select
                      id={`promise-${selectedEntry.id}-status`}
                      value={selectedEntry.status}
                      onChange={(event) =>
                        patchEntry({
                          status: event.target.value as StudioPromisePayoffEntry["status"],
                        })}
                      className={CONTROL_CLASS}
                    >
                      {STUDIO_PROMISE_PAYOFF_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {studioPromisePayoffStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-urgency`}>
                    긴급도
                    <select
                      id={`promise-${selectedEntry.id}-urgency`}
                      value={selectedEntry.urgency}
                      onChange={(event) =>
                        patchEntry({
                          urgency: event.target.value as StudioPromisePayoffEntry["urgency"],
                        })}
                      className={CONTROL_CLASS}
                    >
                      {STUDIO_PROMISE_PAYOFF_URGENCIES.map((urgency) => (
                        <option key={urgency} value={urgency}>
                          {studioPromisePayoffUrgencyLabel(urgency)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-due`}>
                    회수 예정 회차
                    <input
                      id={`promise-${selectedEntry.id}-due`}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={selectedEntry.dueEpisode ?? ""}
                      onChange={(event) =>
                        patchEntry({
                          dueEpisode: event.target.value
                            ? parseEpisode(
                                event.target.value,
                                selectedEntry.dueEpisode ?? ledger.currentEpisode
                              )
                            : null,
                        })}
                      placeholder="미정"
                      className={CONTROL_CLASS}
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-visibility`}>
                    공개 범위
                    <select
                      id={`promise-${selectedEntry.id}-visibility`}
                      value={selectedEntry.visibility}
                      onChange={(event) =>
                        patchEntry({
                          visibility: event.target.value as StudioPromisePayoffEntry["visibility"],
                        })}
                      className={CONTROL_CLASS}
                    >
                      {STUDIO_PROMISE_PAYOFF_VISIBILITIES.map((visibility) => (
                        <option key={visibility} value={visibility}>
                          {studioPromisePayoffVisibilityLabel(visibility)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLASS} htmlFor={`promise-${selectedEntry.id}-spoiler`}>
                    스포일러 등급
                    <select
                      id={`promise-${selectedEntry.id}-spoiler`}
                      value={selectedEntry.spoilerLevel}
                      onChange={(event) =>
                        patchEntry({
                          spoilerLevel: event.target.value as StudioPromisePayoffEntry["spoilerLevel"],
                        })}
                      className={CONTROL_CLASS}
                    >
                      {STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {studioPromisePayoffSpoilerLabel(level)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end gap-2 pb-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    <Eye size={14} className="shrink-0" aria-hidden />
                    공개 범위와 스포일러 등급은 서버 권한이 아니라 로컬 편집 가이드입니다.
                  </div>
                </div>

                {selectedEntry.status === "intentional-non-payoff" && (
                  <label
                    className={`${LABEL_CLASS} mt-3`}
                    htmlFor={`promise-${selectedEntry.id}-non-payoff`}
                  >
                    의도적 미회수 사유
                    <textarea
                      id={`promise-${selectedEntry.id}-non-payoff`}
                      rows={2}
                      maxLength={STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH}
                      value={selectedEntry.intentionalNonPayoffReason}
                      onChange={(event) =>
                        patchEntry({ intentionalNonPayoffReason: event.target.value })}
                      placeholder="열린 결말, 다음 시즌 이월 등 편집 판단의 근거"
                      className={`${CONTROL_CLASS} resize-y`}
                    />
                  </label>
                )}
              </section>

              <section aria-labelledby={`promise-${selectedEntry.id}-links`} className="border-t border-line py-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 id={`promise-${selectedEntry.id}-links`} className="text-xs font-bold text-fg">
                      실제 에피소드·컷 연결
                    </h4>
                    <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                      약속 → 중간 단서 → 회수 순서를 실제 장면·페이지·컷 ID로 고정합니다.
                    </p>
                  </div>
                  <span className="inline-flex min-h-7 items-center gap-1 rounded-md border border-good/30 bg-good/10 px-2 text-[0.62rem] font-semibold text-good">
                    <Link2 size={11} aria-hidden />
                    로컬 결정 규칙
                  </span>
                </div>

                <div className="mt-3">
                  {selectedEntry.seed ? (
                    <StoryLinkEditor
                      stage="seed"
                      heading="첫 약속"
                      link={selectedEntry.seed}
                      sceneOptions={sceneOptions}
                      onChange={(link) => setSingleLink("seed", link)}
                      onRemove={() => setSingleLink("seed", null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSingleLink("seed", newLink("seed"))}
                      className={`${BUTTON_CLASS} w-full border-dashed border-cool/45 bg-cool/5 text-cool hover:bg-cool/10`}
                    >
                      <CircleDot size={13} aria-hidden />
                      첫 약속 회차·컷 연결
                    </button>
                  )}

                  <div className="border-t border-line py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Lightbulb size={14} className="text-accent" aria-hidden />
                      <p className="min-w-0 flex-1 text-xs font-bold text-fg">
                        중간 단서 {selectedEntry.foreshadows.length}
                      </p>
                      <button
                        type="button"
                        disabled={
                          selectedEntry.foreshadows.length
                          >= STUDIO_PROMISE_PAYOFF_MAX_LINKS
                        }
                        onClick={() =>
                          patchEntry({
                            foreshadows: [
                              ...selectedEntry.foreshadows,
                              newLink("foreshadow"),
                            ],
                            status:
                              selectedEntry.status === "seed"
                                ? "foreshadow"
                                : selectedEntry.status,
                          })}
                        className={`${BUTTON_CLASS} border-line bg-card text-fg-2 hover:bg-raised hover:text-fg`}
                      >
                        <Plus size={13} aria-hidden />
                        단서 추가
                      </button>
                    </div>
                    {selectedEntry.foreshadows.length === 0 && (
                      <p className="mt-2 border-l-2 border-line px-3 py-2 text-[0.68rem] leading-relaxed text-fg-3">
                        중간 단서가 없으면 장기 연재에서 첫 약속과 회수 사이의 맥락을 놓치기 쉽습니다.
                      </p>
                    )}
                    {selectedEntry.foreshadows.map((link, index) => (
                      <StoryLinkEditor
                        key={link.id}
                        stage="foreshadow"
                        heading={`중간 단서 ${index + 1}`}
                        link={link}
                        sceneOptions={sceneOptions}
                        onChange={patchForeshadow}
                        onRemove={() => removeForeshadow(link.id)}
                      />
                    ))}
                  </div>

                  {selectedEntry.payoff ? (
                    <StoryLinkEditor
                      stage="payoff"
                      heading="회수 장면"
                      link={selectedEntry.payoff}
                      sceneOptions={sceneOptions}
                      onChange={(link) => setSingleLink("payoff", link)}
                      onRemove={() => setSingleLink("payoff", null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSingleLink("payoff", newLink("payoff"))}
                      className={`${BUTTON_CLASS} w-full border-dashed border-good/45 bg-good/5 text-good hover:bg-good/10`}
                    >
                      <Target size={13} aria-hidden />
                      회수 예정 회차·컷 연결
                    </button>
                  )}
                </div>
              </section>

              <footer className="flex flex-wrap items-center gap-2 border-t border-line py-4 text-[0.68rem] leading-relaxed text-fg-3">
                <Clock3 size={13} aria-hidden />
                현재 회차와 회수 예정 회차만 비교하며 시간·네트워크·AI를 사용하지 않습니다.
                {selectedEntry.status === "payoff" && (
                  <span className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md border border-good/30 bg-good/10 px-2 font-semibold text-good">
                    <CheckCircle2 size={12} aria-hidden />
                    회수 완료
                  </span>
                )}
              </footer>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
