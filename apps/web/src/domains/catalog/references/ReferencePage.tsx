import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownToLine, ArrowRight, Bookmark, BookOpen, ChevronLeft, ChevronRight, Copy, ExternalLink, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { fetchReferenceResult } from "./reference-api";
import { clearReferenceDraft, readReferenceDrafts } from "./reference-drafts";
import {
  REFERENCE_ERROR_MESSAGE_KEYS, REFERENCE_FIELD_LABEL_KEYS, REFERENCE_GUIDE_SECTIONS, REFERENCE_JOURNEY_STEPS,
  REFERENCE_METADATA_FIELDS, REFERENCE_METADATA_LABEL_KEYS, REFERENCE_NOTICE_KEYS, REFERENCE_VIEW_TAB_KEYS, REFERENCE_VIEWS,
} from "./reference-i18n";
import { mutateReferenceNotes, readReferenceNotes, referenceCitation, referenceNotesBackup, referenceNotesMarkdown, REFERENCE_STORAGE_KEY } from "./reference-storage";
import { ReferenceImport } from "./ReferenceImport";
import { ReferenceNoteEditor } from "./ReferenceNoteEditor";

import type { ReferenceNotice, ReferenceView } from "./reference-i18n";
import type { ReferenceMutation, ReferenceMutationFailure, ReferenceMutationResult, ReferenceNote } from "./reference-storage";
import type { CommitReference } from "./ReferenceNoteEditor";
import type { ReferenceField, ReferenceItem, ReferenceQuery, ReferenceResult, ReferenceErrorCode } from "@/shared/lib/kmas-reference";
import type { FormEvent } from "react";

import { useT } from "@/shared/lib/i18n";
import { isReferenceField, parseReferenceQuery, ReferenceError, referenceSearchParams } from "@/shared/lib/kmas-reference";
import { apiPath } from "@/src/infrastructure/api";

import "./reference.css";

const FIELDS: ReferenceField[] = ["title", "illustrator", "writer", "publisher", "platform", "isbn"];
const GUIDE_URL = "https://www.kmas.or.kr/guide/openapi";
type OpenReference = (item: ReferenceItem, trigger: HTMLButtonElement, fromNotes?: boolean) => void;

function ErrorNotice({ code, retry }: { code: ReferenceErrorCode; retry?: () => void }) {
  const t = useT();
  return <div className="ref-notice ref-error" role="alert">
    <h3>{t("ref.errorTitle")}</h3><p>{t(REFERENCE_ERROR_MESSAGE_KEYS[code])}</p>
    <div className="ref-actions">
      {retry && code !== "KMAS_NOT_CONFIGURED" && <button type="button" className="ref-button" onClick={retry}>{t("ref.retry")}</button>}
      <a className="ref-text-link" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("ref.officialGuide")} <ExternalLink size={14} /></a>
    </div>
  </div>;
}

function SearchForm({ field, q, onSearch }: { field: ReferenceField; q: string; onSearch: (field: ReferenceField, q: string) => void }) {
  const t = useT();
  const [draftField, setDraftField] = useState(field);
  const [draft, setDraft] = useState(q);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(draftField, draft);
  };
  return <section className="ref-search-section" aria-labelledby="ref-search-heading">
    <h2 id="ref-search-heading">{t("ref.searchTitle")}</h2>
    <form className="ref-search-form" onSubmit={submit}>
      <label className="ref-field-select"><span>{t("ref.field")}</span>
        <select value={draftField} onChange={(event) => { if (isReferenceField(event.target.value)) setDraftField(event.target.value); }}>
          {FIELDS.map((value) => <option key={value} value={value}>{t(REFERENCE_FIELD_LABEL_KEYS[value])}</option>)}
        </select>
      </label>
      <label className="ref-search-input"><span>{t("ref.query")}</span>
        <input name="q" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={120} required
          type="search" autoComplete="off" placeholder={t("ref.placeholder")} aria-describedby="ref-search-help" />
      </label>
      <button type="submit" className="ref-button ref-primary"><Search size={18} aria-hidden="true" />{t("ref.search")}</button>
    </form>
    <p className="ref-small" id="ref-search-help">{t("ref.searchHelp")}</p>
    <div className="ref-suggestions"><span>{t("ref.suggestion")}</span>
      <button type="button" onClick={() => onSearch("title", "원피스")}>{t("ref.suggestionTitle")}</button>
      <button type="button" onClick={() => onSearch("publisher", "대원씨아이")}>{t("ref.suggestionPublisher")}</button>
      <button type="button" onClick={() => onSearch("platform", "네이버웹툰")}>{t("ref.suggestionPlatform")}</button>
    </div>
  </section>;
}

function ReferenceCard({ item, index, saved, onSave, onOpen }: {
  item: ReferenceItem; index: number; saved: boolean; onSave: (item: ReferenceItem) => void; onOpen: OpenReference;
}) {
  const t = useT();
  return <article className="ref-card">
    <div className="ref-card-index"><span>{String(index + 1).padStart(2, "0")}</span><span>{item.genre || "KMAS"}</span>
      <button type="button" className="ref-icon-button" data-saved={saved || undefined}
        aria-label={`${t(saved ? "ref.saved" : "ref.save")}: ${item.title}`}
        onClick={(event) => saved ? onOpen(item, event.currentTarget) : onSave(item)}>
        <Bookmark size={19} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </div>
    <button type="button" className="ref-card-main" aria-label={`${t("ref.detail")}: ${item.title}`}
      onClick={(event) => onOpen(item, event.currentTarget)}>
      <h3>{item.title}</h3>{item.subtitle && <p className="ref-subtitle">{item.subtitle}</p>}
      <p className="ref-card-creators">{[item.writer, item.illustrator].filter((value, i, all) => value && all.indexOf(value) === i).join(" · ") || t("ref.missing")}</p>
      <span className="ref-card-detail">{t("ref.detail")}<ArrowRight size={16} aria-hidden="true" /></span>
    </button>
    <div className="ref-card-footer"><span>{item.publisher || item.platform || t("ref.missing")}</span>{item.age && <span>{item.age}</span>}</div>
  </article>;
}

type SearchState = { kind: "loading" } | { kind: "error"; code: ReferenceErrorCode } | { kind: "success"; data: ReferenceResult };
function SearchResults({ query, notes, onSave, onOpen, onPage }: {
  query: ReferenceQuery; notes: ReferenceNote[]; onSave: (item: ReferenceItem) => void; onOpen: OpenReference; onPage: (page: number) => void;
}) {
  const t = useT();
  const [state, setState] = useState<SearchState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { field, q, page } = query;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 12_000);
    const run = async () => {
      try {
        const data = await fetchReferenceResult(apiPath("/api/kmas/references"), { field, q, page }, controller.signal);
        if (active) setState({ kind: "success", data });
      } catch (error) {
        if (active) setState({ kind: "error", code: controller.signal.aborted ? "KMAS_TIMEOUT" : error instanceof ReferenceError ? error.code : "KMAS_UNAVAILABLE" });
      } finally {
        clearTimeout(timer);
      }
    };
    void run();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [field, q, page, attempt]);

  if (state.kind === "loading") return <section className="ref-result-section" aria-busy="true" aria-label={t("ref.results")}>
    <p role="status" className="ref-small">{t("ref.loading")}</p>
    <div className="ref-grid" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className="ref-skeleton"><span /><span /><span /></div>)}</div>
  </section>;
  if (state.kind === "error") return <ErrorNotice code={state.code} retry={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} />;
  const { data } = state;
  const pageText = `${t("ref.page")} ${page}`;
  return <section className="ref-result-section" aria-labelledby="ref-results-heading">
    <header className="ref-results-header"><div><p className="ref-eyebrow">SEARCH INDEX</p>
      <h2 id="ref-results-heading">{t("ref.results")} <span className="ref-result-count">{data.total === null ? t("ref.totalUnknown") : `${data.total.toLocaleString()} ${t("ref.countUnit")}`}</span></h2>
    </div><span className="ref-small">{pageText}</span></header>
    <p className="ref-small">{t("ref.pageScope")}</p>
    <p className="ref-small" role="status">{data.cached ? t("ref.cache") : t("ref.fetched")} · <time dateTime={data.fetchedAt}>{new Date(data.fetchedAt).toLocaleString()}</time></p>
    {data.items.length ? <div className="ref-grid">{data.items.map((item, index) => <ReferenceCard key={item.id} item={item} index={index}
      saved={notes.some((entry) => entry.item.id === item.id)} onSave={onSave} onOpen={onOpen} />)}</div>
      : <div className="ref-empty"><BookOpen size={30} aria-hidden="true" /><h3>{t("ref.noResults")}</h3><p>{t("ref.noResultsBody")}</p></div>}
    <nav className="ref-pagination" aria-label={t("ref.page")}>
      <button type="button" className="ref-button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} />{t("ref.previous")}</button>
      <span className="ref-small">{pageText}</span>
      <button type="button" className="ref-button" disabled={!data.hasNext || page >= 1000} onClick={() => onPage(page + 1)}>{t("ref.next")}<ChevronRight size={17} /></button>
    </nav>
  </section>;
}

function ReferenceGuide() {
  const t = useT();
  return <section className="ref-guide" aria-labelledby="ref-guide-heading"><p className="ref-eyebrow">SOURCE & METHOD</p>
    <h2 id="ref-guide-heading">{t("ref.guideTitle")}</h2>
    {REFERENCE_GUIDE_SECTIONS.map(({ title, body }, index) => <article key={title}>
      <span className="ref-guide-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div><h3>{t(title)}</h3><p>{t(body)}</p></div>
    </article>)}
    <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="ref-text-link">{t("ref.officialGuide")}<ExternalLink size={15} /></a>
  </section>;
}

function ReferenceDetails({ item, fromNotes, note, onCommit, onRemove, onNotice, onDirty, onDraftChange, saving }: {
  item: ReferenceItem; fromNotes: boolean; note?: ReferenceNote; onCommit: CommitReference;
  onRemove: (expected: ReferenceNote) => Promise<void>; onNotice: (notice: ReferenceNotice) => void;
  onDirty: (dirty: boolean) => void; onDraftChange: () => void; saving: boolean;
}) {
  const t = useT();
  const [confirmRemove, setConfirmRemove] = useState<ReferenceNote | null>(null);
  const citation = referenceCitation(item);
  const copy = async () => {
    try { await navigator.clipboard.writeText(citation); onNotice("copied"); }
    catch { onNotice("copyFailed"); }
  };
  return <>
    <p className="ref-eyebrow">KMAS / REFERENCE</p><Dialog.Title className="ref-dialog-title">{item.title}</Dialog.Title>
    <Dialog.Description className="ref-small">{t("ref.detailsDescription")}</Dialog.Description>
    <dl className="ref-metadata">{REFERENCE_METADATA_FIELDS.map((key) => <div key={key}><dt>{t(REFERENCE_METADATA_LABEL_KEYS[key])}</dt><dd>{item[key] || t("ref.missing")}</dd></div>)}</dl>
    <section className="ref-synopsis"><h3>{t("ref.outline")}</h3><p>{item.outline || t(fromNotes ? "ref.noStoredOutline" : "ref.noOutline")}</p></section>
    <ReferenceNoteEditor key={item.id} item={item} note={note} onCommit={onCommit} onDirty={onDirty} onDraftChange={onDraftChange} saving={saving} />
    <div className="ref-actions"><button type="button" className="ref-button" onClick={() => { void copy(); }}><Copy size={16} />{t("ref.copy")}</button>
      {note && <button type="button" className="ref-button ref-danger" disabled={saving} onClick={() => { if (confirmRemove) { void onRemove(confirmRemove); } else if (note) setConfirmRemove(note); }}>{t(confirmRemove ? "ref.confirmRemove" : "ref.remove")}</button>}
      {confirmRemove && <button type="button" className="ref-button" onClick={() => setConfirmRemove(null)}>{t("ref.cancel")}</button>}
    </div>
    <p className="ref-citation">{citation}</p>
  </>;
}

export function ReferencePage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [storage, setStorage] = useState(readReferenceNotes);
  const [draftStorage, setDraftStorage] = useState(readReferenceDrafts);
  const refreshDrafts = useCallback(() => setDraftStorage(readReferenceDrafts()), []);
  const [notice, setNotice] = useState<ReferenceNotice | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ item: ReferenceItem; fromNotes: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const saving = pendingWrites > 0;
  const [dirty, setDirty] = useState(false);
  const view = params.get("view") === "notes" ? "notes" : params.get("view") === "guide" ? "guide" : "search";
  const field = isReferenceField(params.get("field")) ? params.get("field") as ReferenceField : "title";
  const q = params.get("q") ?? "";
  let query: ReferenceQuery | null = null;
  let invalid = false;
  if (params.has("q")) {
    try { query = parseReferenceQuery({ field: params.get("field") ?? "title", q, page: params.get("page") ?? "1" }); }
    catch { invalid = true; }
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === REFERENCE_STORAGE_KEY || event.key === null) {
        const next = readReferenceNotes();
        setStorage((previous) => next.unavailable ? { ...previous, unavailable: true } : next);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const search = (nextField: ReferenceField, nextQ: string) => {
    setParams({ field: nextField, q: nextQ.trim(), page: "1" });
  };
  const switchView = (nextView: ReferenceView) => {
    const next = new URLSearchParams(params);
    if (nextView === "search") next.delete("view"); else next.set("view", nextView);
    setParams(next);
  };
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  const runMutation = async (mutation: ReferenceMutation, success: ReferenceNotice): Promise<ReferenceMutationResult> => {
    setPendingWrites((count) => count + 1);
    const result = await mutateReferenceNotes(mutation);
    setPendingWrites((count) => count - 1);
    if (result.ok) {
      const latest = readReferenceNotes();
      setStorage(latest.unavailable ? { notes: result.notes, unavailable: true } : latest);
      setNotice(success);
    } else {
      if (result.notes) setStorage({ notes: result.notes, unavailable: false });
      else if (result.reason === "storage") setStorage((previous) => ({ ...previous, unavailable: true }));
      const message: Record<ReferenceMutationFailure, ReferenceNotice> = {
        conflict: "noteConflict", storage: "storageWriteWarning", limit: "limit", unsupported: "lockUnavailable", invalid: "invalidBackup",
      };
      setNotice(message[result.reason]);
    }
    return result;
  };
  const commit: CommitReference = async (item, text, expected) => {
    const result = await runMutation({ kind: "save", item, note: text, expected }, expected ? "noteSavedNotice" : "savedNotice");
    return result.ok ? result.notes.find((entry) => entry.item.id === item.id) ?? null : null;
  };
  const remove = async (expected: ReferenceNote) => {
    const result = await runMutation({ kind: "remove", id: expected.item.id, expected }, "removedNotice");
    if (result.ok) {
      const cleared = clearReferenceDraft(expected.item.id);
      refreshDrafts();
      if (!cleared.ok) setNotice("draftCleanupFailed");
      setSelected(null); setDirty(false);
    }
  };
  const open: OpenReference = (item, trigger, fromNotes = false) => {
    triggerRef.current = trigger;
    setNotice(null);
    setSelected({ item, fromNotes });
  };
  const exportNotes = (format: "markdown" | "json" = "markdown") => {
    try {
      const content = format === "json" ? referenceNotesBackup(storage.notes) : referenceNotesMarkdown(storage.notes);
      const blob = new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `toonstudio-reference-notes-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "md"}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice("exportFailed"); }
  };
  const closeDetails = () => {
    if (saving || (dirty && !window.confirm(t("ref.unsavedClose")))) return;
    setSelected(null);
    setDirty(false);
  };
  const filtered = storage.notes.filter(({ item, note }) => `${item.title} ${item.writer} ${item.illustrator} ${item.publisher} ${note}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="ref-library">
    <header className="ref-hero"><div>
      <div className="ref-hero-top"><span className="ref-source-badge"><BookOpen size={15} aria-hidden="true" />{t("ref.source")}</span><span className="ref-eyebrow">{t("ref.eyebrow")}</span></div>
      <h1>{t("ref.title")}<br /><span>{t("ref.titleAccent")}</span></h1>
      <p className="ref-intro">{t("ref.intro")}</p>
      <Link to="/studio" className="ref-text-link">{t("ref.studio")}<ArrowRight size={17} aria-hidden="true" /></Link>
    </div><aside className="ref-journey" aria-label={t("ref.journeyTitle")}>
      <p className="ref-eyebrow">FIELD NOTES / 01—03</p>
      {REFERENCE_JOURNEY_STEPS.map(({ title, body }, index) => <div key={title}><span className="ref-step-number" aria-hidden="true">0{index + 1}</span><div><h2>{t(title)}</h2><p>{t(body)}</p></div></div>)}
    </aside></header>
    <nav className="ref-tabs" aria-label={t("ref.nav")}>
      {REFERENCE_VIEWS.map((key) => <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => switchView(key)}>
        {t(REFERENCE_VIEW_TAB_KEYS[key])}{key === "notes" && <span className="ref-tab-count">{storage.notes.length}</span>}
      </button>)}
    </nav>
    {storage.unavailable && <p className="ref-notice" role="alert">{t("ref.storageWarning")}</p>}
    {notice && !selected && <p className="ref-notice" role="status">{t(REFERENCE_NOTICE_KEYS[notice])}</p>}
    {view === "search" && <>
      <SearchForm key={`${field}:${q}`} field={field} q={q} onSearch={search} />
      {invalid ? <ErrorNotice code="INVALID_QUERY" /> : query ? <SearchResults key={referenceSearchParams(query).toString()} query={query} notes={storage.notes}
        onSave={(item) => { void runMutation({ kind: "bookmark", item }, "savedNotice"); }} onOpen={open} onPage={(page) => { const next = new URLSearchParams(params); next.set("page", String(page)); setParams(next); }} />
        : <section className="ref-empty ref-start"><p className="ref-eyebrow">{t("ref.emptyTag")}</p><BookOpen size={34} aria-hidden="true" /><h2>{t("ref.emptyTitle")}</h2><p>{t("ref.emptyBody")}</p></section>}
    </>}
    {view === "notes" && <section className="ref-notebook" aria-labelledby="ref-notes-heading">
      <div className="ref-results-header"><div><p className="ref-eyebrow">PERSONAL RESEARCH</p><h2 id="ref-notes-heading">{t("ref.notesTitle")}</h2><p className="ref-small">{t("ref.noteHelp")}</p></div>
        <div className="ref-actions">
          <button type="button" className="ref-button" disabled={!storage.notes.length || saving} onClick={() => exportNotes()}><ArrowDownToLine size={17} />{t("ref.export")}</button>
          <button type="button" className="ref-button" disabled={!storage.notes.length || saving} onClick={() => exportNotes("json")}>{t("ref.backup")}</button>

        </div></div>
      <p className="ref-small">{t("ref.backupHelp")}</p>
      <ReferenceImport current={storage.notes} busy={saving} unavailable={storage.unavailable}
        onImport={(notes) => runMutation({ kind: "import", notes }, "importedNotice")} />
      {draftStorage.drafts.length > 0 && <section className="ref-draft-shelf" aria-labelledby="ref-drafts-heading">
        <h3 id="ref-drafts-heading">{t("ref.draftsTitle")}</h3><p className="ref-small">{t("ref.draftsHelp")}</p>
        <div className="ref-note-list">{draftStorage.drafts.map(({ item, note }) => <article key={item.id}>
          <div><h3>{item.title}</h3><p className="ref-note-preview">{note}</p></div>
          <button type="button" className="ref-button" onClick={(event) => open(item, event.currentTarget, true)}
            aria-label={`${t("ref.recoverDraft")}: ${item.title}`}>{t("ref.recoverDraft")}</button>
        </article>)}</div>
      </section>}
      {storage.notes.length > 0 && <label className="ref-notes-filter"><span>{t("ref.notesFilter")}</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} maxLength={120} /></label>}
      {!storage.notes.length ? <div className="ref-empty"><Bookmark size={30} aria-hidden="true" /><h3>{t("ref.notesEmpty")}</h3><p>{t("ref.notesEmptyBody")}</p><button className="ref-button" type="button" onClick={() => switchView("search")}>{t("ref.searchTab")}<ArrowRight size={16} /></button></div>
        : filtered.length ? <div className="ref-note-list">{filtered.map(({ item, note, savedAt }) => <article key={item.id}>
          <div><p className="ref-small">{item.genre || "KMAS"} · <time dateTime={savedAt}>{new Date(savedAt).toLocaleDateString()}</time></p><h3>{item.title}</h3><p className="ref-note-preview">{note || t("ref.noNote")}</p></div>
          <button type="button" className="ref-button" onClick={(event) => open(item, event.currentTarget, true)} aria-label={`${t("ref.edit")}: ${item.title}`}>{t("ref.edit")}<ArrowRight size={16} /></button>
        </article>)}</div> : <p className="ref-empty">{t("ref.notesNoMatch")}</p>}
    </section>}
    {view === "guide" && <ReferenceGuide />}
    <footer className="ref-source-footer"><p>{t("ref.attribution")}</p><a href={GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("ref.officialGuide")}<ExternalLink size={13} aria-hidden="true" /></a></footer>
    <Dialog.Root open={selected !== null} onOpenChange={(opened) => { if (!opened) closeDetails(); }}>
      <Dialog.Portal><Dialog.Overlay className="ref-dialog-overlay" /><Dialog.Content className="ref-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); (triggerRef.current?.isConnected ? triggerRef.current : document.getElementById("main-content"))?.focus(); }}>
        <Dialog.Close className="ref-icon-button ref-dialog-close" aria-label={t("ref.close")}><X size={21} /></Dialog.Close>
        {selected && <ReferenceDetails key={selected.item.id} item={selected.item} fromNotes={selected.fromNotes}
          note={storage.notes.find((entry) => entry.item.id === selected.item.id)} onCommit={commit} onNotice={setNotice} onDirty={setDirty} onDraftChange={refreshDrafts} saving={saving}
          onRemove={remove} />}
        {notice && <p className="ref-notice" role="status" data-reference-status>{t(REFERENCE_NOTICE_KEYS[notice])}</p>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
