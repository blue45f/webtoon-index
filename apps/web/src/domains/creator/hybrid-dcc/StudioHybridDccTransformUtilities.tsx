import { useId, useMemo, useState } from "react";

import { hashStudioHybridDccObjectTransform, normalizeStudioHybridDccObjectTransform, type StudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";
import { parseStudioHybridDccPrecisionInput } from "./studio-hybrid-dcc-precision-input";
import { measureStudioHybridDccPrecisionBounds } from "./studio-hybrid-dcc-precision-transform";
import {
  alignStudioHybridDccObjectBounds,
  copyStudioHybridDccTransformPart,
  mirrorStudioHybridDccTransformLocal,
  resetStudioHybridDccTransformPart,
  type StudioHybridDccAlignAnchor,
  type StudioHybridDccTransformPart,
} from "./studio-hybrid-dcc-transform-utilities";
import { deriveStudioHybridDccViewportSnapshot, type StudioHybridDccViewportProps } from "./StudioHybridDccViewportCore";

const CONTROL = "min-h-9 min-w-0 rounded-lg border border-line bg-card px-2 text-xs text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed";
const PARTS = [["all", "전체 변환"], ["position", "위치"], ["rotationEulerRad", "회전"], ["scale", "크기"]] as const;
const ANCHORS = [["min", "최솟값"], ["center", "중심"], ["max", "최댓값"]] as const;

function UtilitiesEditor(props: StudioHybridDccViewportProps & {
  readonly copied: StudioHybridDccObjectTransform | null;
  readonly onCopy: (value: StudioHybridDccObjectTransform) => void;
}) {
  const { workspace, editingDisabled, onCommitAssetTransform, componentSelection, onSculptStroke, copied, onCopy } = props;
  const id = useId();
  const [part, setPart] = useState<StudioHybridDccTransformPart>("all");
  const [referenceId, setReferenceId] = useState("");
  const [axis, setAxis] = useState<0 | 1 | 2>(0);
  const [ownAnchor, setOwnAnchor] = useState<StudioHybridDccAlignAnchor>("center");
  const [referenceAnchor, setReferenceAnchor] = useState<StudioHybridDccAlignAnchor>("center");
  const [gap, setGap] = useState("0m");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const projection = useMemo(() => {
    try { return { snapshot: deriveStudioHybridDccViewportSnapshot(workspace), error: "" }; }
    catch (problem) { return { snapshot: null, error: problem instanceof Error ? problem.message : "메시를 읽지 못했습니다." }; }
  }, [workspace]);
  const assets = projection.snapshot?.assets ?? [];
  const selected = assets.find(({ assetId }) => assetId === workspace.activeAssetId);
  const transform = selected ? workspace.session.state.objectTransforms[selected.assetId] : null;
  const reference = assets.find(({ assetId }) => assetId === referenceId && assetId !== selected?.assetId);
  const unavailable = editingDisabled || !selected || !transform || !onCommitAssetTransform || Boolean(onSculptStroke)
    || (componentSelection !== undefined && componentSelection.mode !== "object");
  const commit = (make: () => StudioHybridDccObjectTransform) => {
    if (unavailable || !selected || !transform || !onCommitAssetTransform) return;
    setError("");
    try {
      const next = make();
      if (hashStudioHybridDccObjectTransform(next) === hashStudioHybridDccObjectTransform(transform)) {
        setNotice("이미 같은 변환입니다. 편집 기록을 추가하지 않았습니다.");
        return;
      }
      onCommitAssetTransform(selected.assetId, next);
      setNotice("변환 적용을 요청했습니다. 실행 결과는 편집기 상태에서 확인하세요.");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "변환 값을 확인하세요."); }
  };
  return (
    <div className="space-y-3 border-t border-line p-3">
      <p className="text-[11px] leading-relaxed text-fg-3">복사는 현재 작업대 메모리에만 보관합니다. 붙여넣기·초기화·반전·정렬은 기존 되돌리기 명령으로 적용하며 메시 원본을 굽지 않습니다.</p>
      {unavailable ? <p role="status" className="text-xs text-fg-3">편집 가능한 오브젝트 모드에서 사용할 수 있습니다.</p> : null}
      <fieldset disabled={unavailable} className="flex flex-wrap items-end gap-2">
        <legend className="sr-only">변환 복사와 초기화</legend>
        <div className="grid gap-1">
          <label htmlFor={`${id}-part`} className="text-[11px] text-fg-3">변환 항목</label>
          <select id={`${id}-part`} className={CONTROL} value={part} onChange={(event) => setPart(event.target.value as StudioHybridDccTransformPart)}>
            {PARTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="button" className={CONTROL} onClick={() => {
          if (!transform || unavailable) return;
          try { onCopy(normalizeStudioHybridDccObjectTransform(transform)); setError(""); setNotice("변환을 복사했습니다. 다른 오브젝트를 선택해 붙여넣으세요."); }
          catch (problem) { setError(problem instanceof Error ? problem.message : "복사하지 못했습니다."); }
        }}>변환 복사</button>
        <button type="button" className={CONTROL} disabled={!copied} onClick={() => commit(() => copyStudioHybridDccTransformPart(transform!, copied!, part))}>변환 붙여넣기</button>
        <button type="button" className={CONTROL} onClick={() => commit(() => resetStudioHybridDccTransformPart(transform!, part))}>선택 항목 초기화</button>
        {([0, 1, 2] as const).map((index) => <button key={index} type="button" className={CONTROL}
          onClick={() => commit(() => mirrorStudioHybridDccTransformLocal(transform!, index))}>로컬 {"XYZ"[index]} 반전</button>)}
      </fieldset>
      <form aria-label="오브젝트 간 정밀 정렬" onSubmit={(event) => {
        event.preventDefault();
        if (!reference || !selected || !transform) return;
        commit(() => {
          const referenceTransform = workspace.session.state.objectTransforms[reference.assetId];
          if (!referenceTransform) throw new Error("기준 오브젝트의 변환이 없습니다.");
          return alignStudioHybridDccObjectBounds(transform,
            measureStudioHybridDccPrecisionBounds(selected.positions, transform),
            measureStudioHybridDccPrecisionBounds(reference.positions, referenceTransform),
            axis, ownAnchor, referenceAnchor, parseStudioHybridDccPrecisionInput(gap, "length"));
        });
      }}>
        <fieldset disabled={unavailable} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <legend className="mb-2 text-xs font-semibold text-fg-2">다른 오브젝트에 정렬 · 월드 축</legend>
          <div className="grid gap-1"><label htmlFor={`${id}-reference`} className="text-[11px] text-fg-3">기준 오브젝트</label>
            <select id={`${id}-reference`} className={CONTROL} value={reference ? referenceId : ""} onChange={(event) => setReferenceId(event.target.value)}>
              <option value="">오브젝트 선택</option>
              {assets.filter(({ assetId }) => assetId !== selected?.assetId).map(({ assetId }) => <option key={assetId} value={assetId}>{assetId}</option>)}
            </select>
          </div>
          <div className="grid gap-1"><label htmlFor={`${id}-axis`} className="text-[11px] text-fg-3">정렬 축</label>
            <select id={`${id}-axis`} className={CONTROL} value={axis} onChange={(event) => setAxis(Number(event.target.value) as 0 | 1 | 2)}>
              <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
            </select>
          </div>
          <div className="grid gap-1"><label htmlFor={`${id}-own`} className="text-[11px] text-fg-3">선택 오브젝트 기준점</label>
            <select id={`${id}-own`} className={CONTROL} value={ownAnchor} onChange={(event) => setOwnAnchor(event.target.value as StudioHybridDccAlignAnchor)}>
              {ANCHORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid gap-1"><label htmlFor={`${id}-target`} className="text-[11px] text-fg-3">기준 오브젝트 기준점</label>
            <select id={`${id}-target`} className={CONTROL} value={referenceAnchor} onChange={(event) => setReferenceAnchor(event.target.value as StudioHybridDccAlignAnchor)}>
              {ANCHORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid gap-1"><label htmlFor={`${id}-gap`} className="text-[11px] text-fg-3">축 방향 간격 (m·cm·mm)</label>
            <input id={`${id}-gap`} className={CONTROL} value={gap} maxLength={96} onChange={(event) => setGap(event.target.value)} />
          </div>
          <button type="submit" className={`${CONTROL} self-end font-semibold`} disabled={!reference}>기준 오브젝트에 정렬</button>
        </fieldset>
      </form>
      <p className="text-[11px] text-fg-3">위에 놓기: Y축, 선택 최솟값 → 기준 최댓값. 간격은 월드 축의 양수 방향으로 더합니다. 경계 정렬이며 표면·충돌 스냅은 아닙니다.</p>
      {projection.error || error ? <p role="alert" className="text-xs text-fg-2">{projection.error || error}</p> : null}
      {notice ? <p role="status" className="text-xs text-fg-2">{notice}</p> : null}
    </div>
  );
}

export function StudioHybridDccTransformUtilities(props: StudioHybridDccViewportProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<StudioHybridDccObjectTransform | null>(null);
  const id = useId();
  return (
    <section className="mt-2 overflow-hidden rounded-xl border border-line bg-panel" aria-label="오브젝트 변환 도구함">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between px-3 text-left text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <span>변환 복사 · 초기화 · 반전 · 오브젝트 정렬</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={id} hidden={!open}>{open ? <UtilitiesEditor {...props} copied={copied} onCopy={setCopied} /> : null}</div>
    </section>
  );
}
