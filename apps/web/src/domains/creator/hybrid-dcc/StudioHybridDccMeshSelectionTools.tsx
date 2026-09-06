import { useEffect, useEffectEvent, useId, useState, type RefObject } from "react";

import {
  mutateStudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
} from "./studio-hybrid-dcc-component-selection";
import {
  planStudioHybridDccSelectionDispatch,
  resolveStudioHybridDccSelectionShortcut,
  runStudioHybridDccSelectionCommand,
  type StudioHybridDccSelectionCommand,
  type StudioHybridDccSelectionComponent,
} from "./studio-hybrid-dcc-selection-commands";
import { deriveStudioHybridDccViewportSnapshot, type StudioHybridDccViewportProps } from "./StudioHybridDccViewportCore";

interface Props extends StudioHybridDccViewportProps {
  readonly scopeRef: RefObject<HTMLDivElement | null>;
}
interface SavedSelection {
  readonly assetId: string;
  readonly meshRevision: number;
  readonly sourceHash: string;
  readonly mode: StudioHybridDccSelectionComponent;
  readonly ids: readonly number[];
}
const COMMANDS = [
  ["all", "전체 선택", "현재 점·선·면 모드의 모든 요소를 선택합니다."],
  ["none", "선택 해제", "점·선·면 선택을 모두 해제합니다."],
  ["invert", "선택 반전", "선택되지 않은 요소만 선택합니다."],
  ["grow", "선택 확장", "인접한 요소까지 한 단계 확장합니다."],
  ["shrink", "선택 축소", "선택 밖 요소와 인접한 요소를 제거합니다."],
  ["linked", "연결 영역 선택", "선택한 요소와 연결된 영역을 선택합니다."],
  ["boundary", "열린 경계 선택", "반대쪽 면이 없는 모서리와 해당 점·면을 선택합니다."],
  ["loose", "고립 정점 선택", "어떤 모서리에도 연결되지 않은 정점을 선택합니다."],
  ["path", "최단 연결 경로", "두 요소 사이의 위상상 최소 단계 경로입니다. 거리 기반 경로가 아닙니다."],
] as const satisfies readonly (readonly [StudioHybridDccSelectionCommand, string, string])[];
const CONTROL = "min-h-11 min-w-0 rounded-lg border border-line bg-card px-3 py-2 text-xs text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";

/** Selection-only shell: uses the panel's functional callbacks, never edits geometry/history. */
export function StudioHybridDccMeshSelectionTools(props: Props) {
  const { workspace, componentSelection, scopeRef } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedSelection | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const record = workspace.activeAssetId ? workspace.session.state.geometry.records[workspace.activeAssetId] : null;
  const mode = componentSelection?.mode ?? "object";
  const blocked = props.editingDisabled || Boolean(props.onSculptStroke) || mode === "object"
    || !record || !props.onSelectComponent;
  const savedMatches = saved && record && saved.mode === mode && saved.assetId === record.assetId
    && saved.meshRevision === record.revision && saved.sourceHash === record.meshHash;

  const source = (): StudioHybridDccMeshSelectionSource => {
    if (blocked || !record || !componentSelection || componentSelection.mode === "object") {
      throw new Error("편집 가능한 오브젝트의 점·선·면 모드에서 사용하세요.");
    }
    const viewport = scopeRef.current?.querySelector('[data-studio-hybrid-dcc-viewport="true"]');
    if (viewport?.getAttribute("data-dragging") === "true" || viewport?.getAttribute("data-context-lost") === "true") {
      throw new Error("진행 중인 변형이나 그래픽 중단이 끝난 뒤 선택하세요.");
    }
    const provenance = componentSelection.provenance;
    if (provenance?.assetId !== record.assetId || provenance.meshRevision !== record.revision
      || provenance.sourceHash !== record.meshHash) {
      throw new Error("선택 원본이 변경되었습니다. 현재 메시에서 다시 선택하세요.");
    }
    const snapshot = deriveStudioHybridDccViewportSnapshot(workspace, componentSelection.mode);
    if (!snapshot.assets.some(({ assetId }) => assetId === record.assetId)) {
      throw new Error("숨겨졌거나 표시할 수 없는 메시에는 선택 명령을 적용하지 않습니다.");
    }
    return { assetId: record.assetId, mesh: record.mesh, meshRevision: record.revision, sourceHash: record.meshHash };
  };
  const apply = (selectionSource: StudioHybridDccMeshSelectionSource, ids: readonly number[]) => {
    if (!componentSelection || componentSelection.mode === "object" || !props.onSelectComponent) return;
    // Validate the full final selection, source hash and revision before invoking any callback.
    const checked = mutateStudioHybridDccComponentSelection(componentSelection, {
      mode: componentSelection.mode, operation: "replace", ids, source: selectionSource,
    });
    if (!checked.ok) throw new Error(checked.diagnostics.map(({ message }) => message).join(" · "));
    const steps = planStudioHybridDccSelectionDispatch(
      componentSelection.elementIds, checked.value.elementIds, Boolean(props.onClearComponentSelection),
    );
    if (steps.length === 0) { setNotice("선택 변경이 없습니다."); return; }
    // The shipping parent uses functional state updates, so React batches these in one event.
    // The bounded plan avoids unbounded O(selected × changes) immutable callback work.
    for (const step of steps) {
      if (step.operation === "clear") props.onClearComponentSelection?.();
      else props.onSelectComponent(selectionSource.assetId, componentSelection.mode, step.id, step.operation);
    }
    setNotice(`${checked.value.elementIds.length.toLocaleString("ko-KR")}개 요소 선택을 요청했습니다. 메시 원본은 변경하지 않습니다.`);
  };
  const run = (command: StudioHybridDccSelectionCommand) => {
    if (blocked) return;
    setError(""); setNotice("");
    try {
      const selectedSource = source();
      if (!componentSelection) return;
      const ids = runStudioHybridDccSelectionCommand(selectedSource.mesh, mode, componentSelection.elementIds, command);
      apply(selectedSource, ids);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "선택 명령을 실행하지 못했습니다."); setOpen(true); }
  };
  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || blocked || !scopeRef.current?.contains(target)) return;
    // Shortcuts belong to the renderer only; toolbar focus, text entry, and other workspaces win.
    const viewport = target.closest('[data-studio-hybrid-dcc-viewport="true"]');
    if (!viewport || viewport.getAttribute("data-dragging") === "true"
      || viewport.getAttribute("data-context-lost") === "true"
      || (!target.closest('[role="application"]') && target.tagName !== "CANVAS")
      || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    const command = resolveStudioHybridDccSelectionShortcut(event);
    if (!command) return;
    event.preventDefault();
    run(command);
  });
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const keyDown = (event: KeyboardEvent) => shortcut(event);
    scope.addEventListener("keydown", keyDown);
    return () => scope.removeEventListener("keydown", keyDown);
  }, [scopeRef]);

  return (
    <section className="mt-2 overflow-hidden rounded-xl border border-line bg-panel" aria-label="메시 선택 작업대">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>메시 선택 · 연결 영역 · 경계 · 최단 경로</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={id} hidden={!open} className="space-y-3 border-t border-line p-3">
        <p className="text-xs leading-relaxed text-fg-3">점은 모서리로, 선은 공유 정점으로, 면은 공유 모서리로 연결됩니다. 겹쳐 보이기만 하는 별도 부품은 연결하지 않습니다.</p>
        {blocked ? <p role="status" className="text-xs text-fg-3">오브젝트를 선택하고 1·2·3 키로 점·선·면 모드에 들어가세요. 읽기 전용·작업 중·조형 모드에서는 사용할 수 없습니다.</p> : null}
        <fieldset disabled={Boolean(blocked)} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <legend className="sr-only">메시 선택 명령</legend>
          {COMMANDS.map(([command, label, description]) => (
            <button key={command} type="button" className={CONTROL} title={description}
              disabled={(command === "loose" && mode !== "vertex") || (command === "path" && componentSelection?.elementIds.length !== 2)}
              onClick={() => run(command)}>{label}</button>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={CONTROL} disabled={Boolean(blocked)} onClick={() => {
            setError("");
            try {
              const selectedSource = source();
              if (!componentSelection || componentSelection.mode === "object") return;
              setSaved({ assetId: selectedSource.assetId, meshRevision: selectedSource.meshRevision,
                sourceHash: selectedSource.sourceHash, mode: componentSelection.mode, ids: [...componentSelection.elementIds] });
              setNotice("현재 선택을 기억했습니다. 같은 원본 버전과 선택 모드에서 복원할 수 있습니다.");
            } catch (problem) { setError(problem instanceof Error ? problem.message : "선택을 기억하지 못했습니다."); }
          }}>선택 기억</button>
          <button type="button" className={CONTROL} disabled={Boolean(blocked) || !savedMatches} onClick={() => {
            setError("");
            try { if (savedMatches && saved) apply(source(), saved.ids); }
            catch (problem) { setError(problem instanceof Error ? problem.message : "선택을 복원하지 못했습니다."); }
          }}>기억한 선택 복원</button>
          <span className="self-center text-xs tabular-nums text-fg-3">현재 {componentSelection?.elementIds.length ?? 0}개 선택</span>
        </div>
        {saved && !savedMatches ? <p className="text-xs text-fg-3">기억한 선택과 원본 버전 또는 모드가 달라 복원을 차단했습니다.</p> : null}
        <p className="text-[11px] leading-relaxed text-fg-3">캔버스: A 전체 · Alt+A 해제 · Ctrl+I 반전 · L 연결 · Ctrl+키패드 ± 확장/축소. 현재 연결 방식은 한 번에 최대 512개 변경을 지원하며 한도를 넘으면 일부만 선택하지 않고 중단합니다.</p>
        {error ? <p role="alert" className="text-xs text-fg-2">{error}</p> : null}
        {notice ? <p role="status" className="text-xs text-fg-2">{notice}</p> : null}
      </div>
    </section>
  );
}
