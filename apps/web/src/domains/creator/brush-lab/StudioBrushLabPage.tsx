import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router-dom";

import { normalizeStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import { STUDIO_BRUSH_MIX_TRAIT_SECTIONS, stabilizeStudioBrushMixQuality } from "../brush/studio-brush-engine-mix";
import { sanitizeBrushSnapshot } from "../brush/studio-brush-library";
import { materializeStudioBrushCatalogSelection } from "../brush/studio-brush-selection";
import { StudioBrushEngineStackPanel, StudioBrushSaveAsCustomControls, StudioBrushWatercolorProgramControls } from "../brush/StudioBrushEngineMixer";
import { StudioBrushEngineProgramControls } from "../brush/StudioBrushEngineProgramControls";
import { StudioBrushDynamicsPreview, StudioBrushStudio } from "../brush/StudioBrushStudio";
import { BRUSH_PRESETS, resolveStudioBrushRenderFamily } from "../studio-brush";
import { STUDIO_FOCUS_RING } from "../studio-panel-ui";

import { BRUSH_LAB_SLOT_IDS, commitBrushLabHistory, createBrushLabRecipe, generateBrushLabVariants, moveBrushLabHistory, updateBrushLabSlot } from "./brush-lab-recipe";
import { brushLabDocumentFromSelection, brushLabSnapshotKey, canComposeBrushLabTraits, compileBrushLabRecipe, createInitialBrushLabDocument, readBrushLabAuthoringFile, readBrushLabJson, writeBrushLabAuthoringFile, writeBrushLabJson } from "./brush-lab-runtime";
import { BRUSH_LAB_WORKSPACE_KIND, BRUSH_LAB_WORKSPACE_MAX_BYTES } from "./brush-lab-workspace";

import type { BrushLabHistory, BrushLabRecipe } from "./brush-lab-recipe";
import type { BrushLabDocument, BrushLabSourceCache } from "./brush-lab-runtime";
import type { NormalizedStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import type { StudioBrushSnapshot } from "../brush/studio-brush-library";

const BUTTON = `min-h-11 rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 ${STUDIO_FOCUS_RING}`;
const INPUT = `min-h-11 w-full min-w-0 rounded-xl border border-line bg-card px-3 text-sm text-fg ${STUDIO_FOCUS_RING}`;
const CARD = "min-w-0 rounded-2xl border border-line bg-card/45 p-4";
const SESSION_DRAFT_PREFIX = "toonstudio-brush-lab:session:";
interface CatalogItem { id: string; name: string }
interface Candidate { recipe: BrushLabRecipe; document: BrushLabDocument }
interface BrushLabSessionDraft { document: BrushLabDocument; reference: BrushLabDocument; recipe: BrushLabRecipe }
const CORE_ITEMS: CatalogItem[] = BRUSH_PRESETS.filter((item) => item.operation === "paint").map(({ id, name }) => ({ id, name }));

function readSessionDraft(key: string): BrushLabSessionDraft | null {
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    if (!raw) return null;
    const result = readBrushLabAuthoringFile(raw);
    return { document: result.document, reference: result.reference, recipe: result.recipe };
  } catch {
    return null;
  }
}

function TraitPreview({ document }: { document: BrushLabDocument }) {
  if (!canComposeBrushLabTraits(document)) return <p className="rounded-xl border border-line p-4 text-xs leading-relaxed text-fg-3">이 매체의 물성은 공통 입자 미리보기로 재현하지 않습니다. 저장 후 실제 캔버스에서 확인하세요.</p>;
  return <StudioBrushDynamicsPreview settings={document.snapshot.brushDynamics} strokeWidth={document.snapshot.strokeWidth} color={document.snapshot.color} />;
}

export function StudioBrushLabPage() {
  const params = useParams<{ workId?: string; sourceWorkId?: string }>();
  const scope = params.workId ? `work:${params.workId}` : params.sourceWorkId ? `remix:${params.sourceWorkId}` : "draft";
  const sessionDraftKey = `${SESSION_DRAFT_PREFIX}${encodeURIComponent(scope)}`;
  const [initialDraft] = useState(() => readSessionDraft(sessionDraftKey));
  const initialDocument = initialDraft?.document ?? createInitialBrushLabDocument();
  const [history, setHistory] = useState<BrushLabHistory<BrushLabDocument>>(() => ({ past: [], present: initialDocument, future: [] }));
  const document = history.present;
  const snapshot = document.snapshot;
  const [reference, setReference] = useState(initialDraft?.reference ?? initialDocument);
  const [recipe, setRecipe] = useState(() => initialDraft?.recipe ?? createBrushLabRecipe(initialDocument.carrierId));
  const [items, setItems] = useState(CORE_ITEMS);
  const [query, setQuery] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [mutationCount, setMutationCount] = useState(2);
  const [candidateCount, setCandidateCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState(initialDraft ? "이전 세션의 브러시 제작 초안을 복구했습니다." : "소스를 선택하지 않은 속성은 현재 설정을 유지합니다.");
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState(initialDraft ? "자동 복구된 초안입니다. 작업 파일로도 백업할 수 있습니다." : "");
  const [dirty, setDirty] = useState(false);
  const request = useRef(0);
  const epoch = useRef(0);
  const [editingEpoch, setEditingEpoch] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const portable = canComposeBrushLabTraits(document);
  const family = resolveStudioBrushRenderFamily(snapshot.brushId);
  const filtered = items.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const editorHref = params.workId
    ? `/studio/work/${encodeURIComponent(params.workId)}/canvas`
    : params.sourceWorkId
      ? `/studio/remix/${encodeURIComponent(params.sourceWorkId)}/canvas`
      : "/studio";

  useEffect(() => {
    mounted.current = true;
    const ownedUrls = urls.current;
    const ownedTimers = timers.current;
    const invalidate = () => {
      request.current += 1;
      controller.current?.abort();
    };
    return () => {
      mounted.current = false;
      invalidate();
      for (const url of ownedUrls) URL.revokeObjectURL(url);
      for (const timer of ownedTimers) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError("");
    void import("../brush/studio-brush-catalog").then((catalog) => {
      if (!active) return;
      const merged = new Map(CORE_ITEMS.map((item) => [item.id, item]));
      for (const item of catalog.STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS) merged.set(item.id, { id: item.id, name: item.name });
      setItems([...merged.values()]);
    }).catch(() => { if (active) setCatalogError("확장 카탈로그를 불러오지 못했습니다. 기본 브러시는 사용할 수 있습니다."); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [catalogRevision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      try {
        globalThis.sessionStorage.setItem(sessionDraftKey, writeBrushLabAuthoringFile(document, reference, recipe));
        setDraftStatus("이 세션의 브러시 제작 초안을 자동 저장했습니다.");
      } catch {
        setDraftStatus("자동 초안 저장을 사용할 수 없습니다. 작업 파일 저장을 이용해 주세요.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirty, document, reference, recipe, sessionDraftKey]);

  function invalidate() {
    request.current++; controller.current?.abort(); controller.current = null;
    setBusy(false); setCandidates([]); setError(""); setProgress("");
  }
  function commit(next: BrushLabDocument) {
    invalidate(); epoch.current++; setEditingEpoch(epoch.current);
    setHistory((current) => commitBrushLabHistory(current, next));
    setRecipe((current) => ({ ...createBrushLabRecipe(next.carrierId, current.seed), slots: current.slots.map((slot) => ({ ...slot, sourceId: null, locked: next.carrierId === current.carrierId && slot.locked })) }));
    setDirty(true);
  }
  function patch(values: Partial<StudioBrushSnapshot>) {
    if (editingEpoch !== epoch.current) return;
    invalidate();
    setHistory((current) => commitBrushLabHistory(current, { ...current.present, snapshot: sanitizeBrushSnapshot({ ...current.present.snapshot, ...values }).snapshot }));
    if ("brushDynamics" in values) setRecipe((current) => ({ ...current, slots: current.slots.map((slot) => ({ ...slot, sourceId: null })) }));
    setDirty(true);
  }
  function changeRecipe(next: BrushLabRecipe) { invalidate(); setRecipe(next); setDirty(true); }
  function move(direction: "undo" | "redo") {
    invalidate(); epoch.current++; setEditingEpoch(epoch.current);
    const next = moveBrushLabHistory(history, direction);
    setHistory(next); setRecipe(createBrushLabRecipe(next.present.carrierId, recipe.seed)); setDirty(true);
    setMessage(direction === "undo" ? "이전 브러시로 되돌렸습니다." : "브러시 변경을 다시 적용했습니다.");
  }
  function active(token: number) { return mounted.current && token === request.current; }
  async function run(task: (token: number, signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const owned = new AbortController(); controller.current = owned;
    const token = ++request.current;
    setBusy(true); setError(""); setProgress("");
    try { await task(token, owned.signal); }
    catch (reason) { if (active(token)) setError(reason instanceof Error ? reason.message : "작업을 완료하지 못했습니다."); }
    finally { if (active(token)) { setBusy(false); setProgress(""); controller.current = null; } }
  }
  async function selectCarrier(id: string, dynamics?: NormalizedStudioBrushDynamicsSettings) {
    await run(async (token) => {
      const selection = await materializeStudioBrushCatalogSelection(id);
      if (!selection) throw new Error("선택한 캐리어를 찾을 수 없습니다.");
      const next = brushLabDocumentFromSelection(selection, snapshot);
      if (!active(token)) return;
      commit(dynamics ? { ...next, snapshot: { ...next.snapshot, brushDynamics: dynamics } } : next);
      setMessage("기본 도포 방식을 변경했습니다. 이전 물성 프로그램은 초기화했으며 되돌리기로 복구할 수 있습니다.");
    });
  }
  async function applyRecipe() {
    await run(async (token, signal) => {
      const next = await compileBrushLabRecipe(recipe, document, signal);
      if (!active(token)) return;
      if (brushLabSnapshotKey(next) === brushLabSnapshotKey(document)) { setMessage("현재 설정과 동일한 조합입니다."); return; }
      commit(next); setMessage("선택한 속성을 적용했습니다. 결과를 새 기준으로 사용하며, 소스 선택은 비웠습니다.");
    });
  }
  async function generate() {
    await run(async (token, signal) => {
      const plans = generateBrushLabVariants(recipe, filtered.map((item) => item.id), candidateCount, mutationCount);
      const seen = new Set([brushLabSnapshotKey(document)]);
      const cache: BrushLabSourceCache = new Map();
      const next: Candidate[] = [];
      let rejected = 0;
      for (const [index, plan] of plans.entries()) {
        if (!active(token)) return;
        setProgress(`후보 ${index + 1}/${plans.length} 확인 중`);
        try {
          const candidate = await compileBrushLabRecipe(plan, document, signal, cache);
          const key = brushLabSnapshotKey(candidate);
          if (!seen.has(key)) { seen.add(key); next.push({ recipe: plan, document: candidate }); }
        } catch (reason) { if (signal.aborted) throw reason; rejected++; }
      }
      if (!active(token)) return;
      setCandidates(next);
      setMessage(next.length ? `${next.length}개의 서로 다른 설정 후보를 만들었습니다. 제외 ${rejected}개. 시각적 차이와 품질은 별도로 확인하세요.` : "새 후보가 없습니다. 잠금을 풀거나 소스 검색 범위를 넓혀 보세요.");
    });
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    await run(async (token) => {
      if (file.size > BRUSH_LAB_WORKSPACE_MAX_BYTES) throw new Error("브러시 JSON은 1MB, 제작 작업 파일은 3MB 이하만 가져올 수 있습니다.");
      const text = await file.text();
      const shape: unknown = JSON.parse(text);
      const isWorkspace = shape !== null && typeof shape === "object" && "kind" in shape && shape.kind === BRUSH_LAB_WORKSPACE_KIND;
      if (isWorkspace) {
        const result = readBrushLabAuthoringFile(text);
        if (!active(token)) return;
        commit(result.document); setReference(result.reference); setRecipe(result.recipe);
        setMessage(`브러시·A 기준·소스·잠금·시드를 복원했습니다.${result.adjustedFields.length ? ` 보정: ${result.adjustedFields.join(", ")}` : ""}`);
      } else {
        const result = readBrushLabJson(text);
        if (!active(token)) return;
        commit(result.document);
        setMessage(result.adjustedFields.length ? `브러시를 가져왔습니다. 보정: ${result.adjustedFields.join(", ")}` : "브러시와 엔진 프로그램을 가져왔습니다. 내 브러시 저장은 별도입니다.");
      }
    });
  }
  function exportFile(workspace: boolean) {
    try {
      const text = workspace ? writeBrushLabAuthoringFile(document, reference, recipe) : writeBrushLabJson(document);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); urls.current.add(url);
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = workspace ? "toonstudio-brush-workspace.brushlab.json" : "toonstudio-custom-brush.json";
      window.document.body.append(anchor); anchor.click(); anchor.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); timers.current.delete(timer); }, 10000); timers.current.add(timer);
      setMessage(workspace ? "작업 파일 다운로드를 요청했습니다. 소스·잠금·시드·A/B 기준을 포함합니다. 브라우저에서 저장을 확인하세요." : "완성 브러시 JSON 다운로드를 요청했습니다. 엔진 프로그램을 포함하며, 소스·잠금은 작업 파일로 보관하세요.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "내보내기에 실패했습니다."); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] bg-bg-2 px-4 py-6 text-fg sm:px-6" data-testid="studio-brush-lab">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-widest text-accent">TOONSTUDIO / BRUSH LAB</p><h1 className="mt-2 text-3xl font-bold tracking-tight">브러시 스튜디오</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-3">기본 도포 방식을 고르고 촉·질감·반응·물성을 조합하세요. 마음에 드는 속성은 잠그고 새로운 변형을 탐색합니다.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => fileInput.current?.click()}>파일 가져오기</button>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => exportFile(true)}>작업 파일 저장</button>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => exportFile(false)}>브러시 내보내기</button>
          <a className={BUTTON} href="/studio/brushes" target="_blank" rel="noopener noreferrer">내 브러시 ↗</a>
          <a className={BUTTON} href={editorHref} target="_blank" rel="noopener noreferrer">캔버스 열기 ↗</a>
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" aria-label="브러시 또는 제작 작업 JSON 파일" onChange={(event) => void importFile(event)} />
        </div>
      </header>
      <p className="mb-2 text-xs leading-relaxed text-fg-3">독립 제작실 /studio/brush-lab · 기존 /studio/brushes 작업 화면은 유지됩니다. 내 브러시 저장은 제품 라이브러리, 작업 파일은 제작 상태 백업입니다.</p>
      {draftStatus ? <p className="mb-4 text-xs leading-relaxed text-fg-3" role="status">{draftStatus}</p> : <div className="mb-4" />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card p-3 text-sm">
        <p role="status" aria-live="polite">{busy ? progress || "조합을 확인하고 있습니다…" : message}</p>
        {busy ? <button type="button" className={BUTTON} onClick={() => { invalidate(); setMessage("작업을 취소했습니다. 현재 브러시는 유지됩니다."); }}>작업 취소</button> : null}
      </div>
      {error ? <p role="alert" className="mb-4 rounded-xl border border-warn/40 p-3 text-sm text-warn">{error}</p> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className={CARD} aria-label="기본 도포 방식과 탐색 조건">
          <h2 className="text-base font-bold">01 / 기본 도포 방식</h2><p className="mt-1 text-xs leading-relaxed text-fg-3">캐리어가 실제 도포 엔진을 결정합니다. 새 기본값으로 바꾸어도 되돌릴 수 있습니다.</p>
          <label className="mt-4 block text-xs font-semibold">카탈로그 검색<input className={`${INPUT} mt-2`} value={query} disabled={busy} onChange={(event) => { invalidate(); setQuery(event.currentTarget.value); }} placeholder="수채, 잉크, 연필…" /></label>
          <label className="mt-3 block text-xs font-semibold">캐리어 선택<select className={`${INPUT} mt-2`} value={document.carrierId} disabled={busy} onChange={(event) => void selectCarrier(event.currentTarget.value)}>
            {!filtered.some((item) => item.id === document.carrierId) ? <option value={document.carrierId}>{document.name} (현재)</option> : null}
            {filtered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <p className="mt-2 text-xs text-fg-3">검색 결과 {filtered.length}개 / 카탈로그 {items.length}개{catalogLoading ? " · 확장 목록 로딩 중" : ""}</p>
          {catalogError ? <div className="mt-3 text-xs text-warn" role="alert"><p>{catalogError}</p><button type="button" className={`${BUTTON} mt-2`} onClick={() => setCatalogRevision((value) => value + 1)}>목록 다시 불러오기</button></div> : null}
          <div className="mt-5 border-t border-line pt-4"><h3 className="text-sm font-bold">변형 탐색</h3>
            <label className="mt-3 block text-xs font-semibold">재현 시드<input type="number" min={0} max={4294967295} step={1} className={`${INPUT} mt-2`} disabled={busy} value={recipe.seed} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) changeRecipe({ ...recipe, seed: value }); }} /></label>
            <label className="mt-3 block text-xs font-semibold">후보당 바꿀 속성 수<select className={`${INPUT} mt-2`} value={mutationCount} disabled={busy} onChange={(event) => { invalidate(); setMutationCount(Number(event.currentTarget.value)); }}>{[1, 2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}개</option>)}</select></label>
            <label className="mt-3 block text-xs font-semibold">최대 후보 수<select className={`${INPUT} mt-2`} value={candidateCount} disabled={busy} onChange={(event) => { invalidate(); setCandidateCount(Number(event.currentTarget.value)); }}>{[4, 8, 12].map((count) => <option key={count} value={count}>{count}개</option>)}</select></label>
            <p className="mt-3 text-xs leading-relaxed text-fg-3">검색 결과 중 ID 순 최대 256개 소스에서 생성합니다. 같은 생성기 버전·기준·소스·시드는 같은 결과를 냅니다. 잠금과 소스가 소진된 속성은 유지합니다.</p>
            <button type="button" className={`${BUTTON} mt-3 w-full`} disabled={busy || !portable || !filtered.length || recipe.slots.every((slot) => slot.locked)} onClick={() => void generate()}>잠금 유지 · 변형 생성</button>
          </div>
        </aside>
        <div className="min-w-0 space-y-4">
          <section className={CARD} aria-labelledby="brush-lab-composition-heading">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="brush-lab-composition-heading" className="text-base font-bold">02 / 속성 조합</h2><span className="text-xs text-fg-3">{recipe.slots.filter((slot) => slot.locked).length}/8 잠금</span></div>
            <p className="mt-2 text-xs leading-relaxed text-fg-3">각 행에서 다른 브러시의 속성만 가져옵니다. 선택만으로 덮어쓰지 않으며, 잠금은 변형 생성에서 해당 소스를 고정합니다.</p>
            {!portable ? <p className="mt-3 rounded-xl border border-warn/40 p-3 text-xs text-warn">이 캐리어는 공통 입자 속성 조합 대상이 아닙니다. 유화·수채 물성 프로그램을 사용하거나 잉크 입자·에어브러시·드라이 미디어 캐리어를 선택하세요.</p> : null}
            <fieldset disabled={busy || !portable} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2"><legend className="sr-only">속성별 소스</legend>
              {BRUSH_LAB_SLOT_IDS.map((id) => { const slot = recipe.slots.find((item) => item.id === id)!; const definition = STUDIO_BRUSH_MIX_TRAIT_SECTIONS.find((item) => item.id === id)!;
                return <div key={id} className="min-w-0 rounded-xl border border-line bg-bg-2/50 p-3"><div className="flex items-center justify-between gap-2"><label htmlFor={`brush-lab-${id}`} className="text-xs font-bold">{definition.label}</label><button type="button" className={`min-h-11 min-w-11 rounded-lg border border-line px-2 text-xs ${STUDIO_FOCUS_RING}`} aria-label={`${definition.label} 잠금`} aria-pressed={slot.locked} onClick={() => changeRecipe(updateBrushLabSlot(recipe, id, { locked: !slot.locked }))}>{slot.locked ? "잠김" : "잠금"}</button></div>
                  <select id={`brush-lab-${id}`} className={`${INPUT} mt-2`} value={slot.sourceId ?? ""} onChange={(event) => changeRecipe(updateBrushLabSlot(recipe, id, { sourceId: event.currentTarget.value || null }))}><option value="">현재 설정 유지</option>
                    {slot.sourceId && !filtered.some((item) => item.id === slot.sourceId) ? <option value={slot.sourceId}>{items.find((item) => item.id === slot.sourceId)?.name ?? slot.sourceId} (선택됨)</option> : null}
                    {filtered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select><p className="mt-2 text-xs leading-relaxed text-fg-3">{definition.description}</p></div>;
              })}
            </fieldset>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy || !portable || recipe.slots.every((slot) => slot.sourceId === null)} onClick={() => void applyRecipe()}>선택한 속성 적용</button><button type="button" className={BUTTON} disabled={busy} onClick={() => changeRecipe(createBrushLabRecipe(document.carrierId, recipe.seed))}>소스·잠금 초기화</button></div>
          </section>
          <section className={CARD} aria-labelledby="brush-lab-preview-heading">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="brush-lab-preview-heading" className="text-base font-bold">03 / 설정 비교</h2><button type="button" className={BUTTON} disabled={busy} onClick={() => { setReference(document); setDirty(true); }}>현재 설정을 A로 고정</button></div>
            <p className="my-3 text-xs leading-relaxed text-fg-3">공통 도장·펜촉·동역학만 비교합니다. 전체 불투명도·유화 릴리프·수채 정착·최종 합성은 실제 캔버스에서 확인해야 합니다.</p>
            <div className="grid gap-3 sm:grid-cols-2"><div><h3 className="mb-2 text-xs font-semibold">A · {reference.name}</h3><TraitPreview document={reference} /></div><div><h3 className="mb-2 text-xs font-semibold">B · {document.name}</h3><TraitPreview document={document} /></div></div>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy || !history.past.length} onClick={() => move("undo")}>되돌리기</button><button type="button" className={BUTTON} disabled={busy || !history.future.length} onClick={() => move("redo")}>다시 적용</button><button type="button" className={BUTTON} disabled={busy} onClick={() => { commit(reference); setMessage("비교 기준 A를 복원했습니다."); }}>A 복원</button></div>
            <p className="mt-3 text-xs text-fg-3">기록은 방향별 최대 24단계, 합계 직렬화 추정 2MiB까지 보관합니다. 큰 팁은 단계 수가 줄어들며 현재 브러시는 유지됩니다. 실제 메모리 측정값은 아닙니다.</p>
          </section>
          {candidates.length ? <section className={CARD} aria-labelledby="brush-lab-candidates-heading"><h2 id="brush-lab-candidates-heading" className="text-base font-bold">변형 후보 · 선택 전에는 적용하지 않음</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{candidates.map((candidate, index) => <article className="min-w-0 rounded-xl border border-line p-3" key={index}><h3 className="mb-2 text-sm font-semibold">후보 {index + 1}</h3><TraitPreview document={candidate.document} /><p className="my-2 text-xs text-fg-3">{candidate.recipe.slots.filter((slot) => slot.sourceId).map((slot) => STUDIO_BRUSH_MIX_TRAIT_SECTIONS.find((item) => item.id === slot.id)?.label).join(" · ")}</p><button type="button" className={`${BUTTON} w-full`} disabled={busy} onClick={() => { commit(candidate.document); setMessage(`후보 ${index + 1}을 적용했습니다.`); }}>이 후보 사용</button></article>)}</div></section> : null}
        </div>
        <aside className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-1" aria-label="물성 프로그램과 저장">
          <section className={CARD}><h2 className="text-base font-bold">상세 편집과 물성</h2><fieldset disabled={busy} className="mt-3 space-y-3"><legend className="sr-only">현재 브러시 설정</legend>
            <label className="block text-xs font-semibold">표시·내보내기 이름<input className={`${INPUT} mt-2`} maxLength={120} value={document.name} onChange={(event) => { const name = event.currentTarget.value; invalidate(); setHistory((current) => commitBrushLabHistory(current, { ...current.present, name })); setDirty(true); }} /></label>
            <label className="block text-xs font-semibold">굵기 · {snapshot.strokeWidth}px<input className="mt-2 min-h-11 w-full accent-accent" type="range" min={1} max={80} step={1} value={snapshot.strokeWidth} onChange={(event) => patch({ strokeWidth: Number(event.currentTarget.value) })} /></label>
            <label className="block text-xs font-semibold">전체 불투명도 · {Math.round(snapshot.brushOpacity * 100)}%<input className="mt-2 min-h-11 w-full accent-accent" type="range" min={0.05} max={1} step={0.01} value={snapshot.brushOpacity} onChange={(event) => patch({ brushOpacity: Number(event.currentTarget.value) })} /></label>
            <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-semibold">색상<input type="color" className="h-11 w-16 rounded-lg" value={snapshot.color} onChange={(event) => patch({ color: event.currentTarget.value })} /></label>
            <StudioBrushStudio key={editingEpoch} brushId={snapshot.brushId} strokeWidth={snapshot.strokeWidth} color={snapshot.color} currentSnapshot={snapshot} settings={snapshot.brushDynamics}
              onSettingsChange={(settings) => patch({ brushDynamics: settings })} onSelectDynamicsPreset={(id, settings) => { if (editingEpoch === epoch.current) void selectCarrier(id, settings); }}
              useVelocityPressure={snapshot.useVelocityPressure} onUseVelocityPressureChange={(value) => patch({ useVelocityPressure: value })}
              velocitySensitivity={snapshot.velocitySensitivity} onVelocitySensitivityChange={(value) => patch({ velocitySensitivity: value })}
              pressureCurve={snapshot.pressureCurve} onPressureCurveChange={(value) => patch({ pressureCurve: value })} pressureMinSize={snapshot.pressureMinSize} onPressureMinSizeChange={(value) => patch({ pressureMinSize: value })}
              tiltEnabled={snapshot.tiltEnabled} onTiltEnabledChange={(value) => patch({ tiltEnabled: value })} tipAngle={snapshot.tipAngle} onTipAngleChange={(value) => patch({ tipAngle: value })} tipRoundness={snapshot.tipRoundness} onTipRoundnessChange={(value) => patch({ tipRoundness: value })}
              onEngineProgramsChange={(enginePrograms) => patch({ enginePrograms })} onRestoreDefaults={(transaction, direction) => patch(direction === "undo" ? transaction.before : transaction.after)} />
            {family === "oil" ? <StudioBrushEngineProgramControls brushId={snapshot.brushId} programSet={snapshot.enginePrograms} onChange={(enginePrograms) => patch({ enginePrograms })} /> : null}
            <StudioBrushWatercolorProgramControls brushId={snapshot.brushId} programSet={snapshot.enginePrograms} onChange={(enginePrograms) => patch({ enginePrograms })} />
          </fieldset></section>
          <section className={CARD}><h2 className="mb-3 text-base font-bold">실행 구성과 예상 비용</h2><p className="mb-3 text-xs leading-relaxed text-fg-3">설정 기반 추정치이며 기기 프레임 시간이나 실제 화질을 측정한 벤치마크가 아닙니다.</p><StudioBrushEngineStackPanel brushId={snapshot.brushId} settings={snapshot.brushDynamics} enginePrograms={snapshot.enginePrograms} /><button type="button" className={`${BUTTON} mt-3 w-full`} disabled={busy || !portable} onClick={() => { patch({ brushDynamics: normalizeStudioBrushDynamicsSettings(stabilizeStudioBrushMixQuality(snapshot.brushDynamics)) }); setMessage("보수적 안정화를 적용했습니다. 되돌리기로 원래 표현을 복구할 수 있습니다."); }}>보수적 안정화 적용</button></section>
          <StudioBrushSaveAsCustomControls key={document.carrierId} snapshot={snapshot} baseBrushName={document.name} />
          <p className="px-2 text-xs leading-relaxed text-fg-3">내 브러시는 기존 제품 저장소를 사용합니다. 세션 보관 안내가 나오면 파일로 백업하세요. 제작실은 새 GPU·p5·WASM 백엔드를 선택해 실행하는 화면이 아닙니다.</p>
        </aside>
      </div>
    </main>
  );
}