import { useId, useMemo, useState } from "react";

import { hashStudioHybridDccObjectTransform, type StudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";
import { parseStudioHybridDccPrecisionInput } from "./studio-hybrid-dcc-precision-input";
import {
  alignStudioHybridDccPrecisionBounds,
  applyStudioHybridDccPrecisionCommand,
  measureStudioHybridDccPrecisionBounds,
  snapStudioHybridDccPrecisionToGrid,
  type StudioHybridDccPrecisionAxis,
  type StudioHybridDccPrecisionKind,
} from "./studio-hybrid-dcc-precision-transform";
import { deriveStudioHybridDccViewportSnapshot, type StudioHybridDccViewportProps } from "./StudioHybridDccViewportCore";

const CONTROL = "min-h-9 min-w-0 rounded-lg border border-line bg-card px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";
const DEFAULTS = { translate: "10cm", rotate: "15deg", scale: "110%", dimension: "1m" } as const;
const format = (value: number) => Number(value.toPrecision(7)).toLocaleString("ko-KR", { maximumFractionDigits: 7 });

function PrecisionEditor(props: StudioHybridDccViewportProps) {
  const { workspace, editingDisabled, componentSelection, onCommitAssetTransform, onSculptStroke } = props;
  const id = useId();
  const [kind, setKind] = useState<StudioHybridDccPrecisionKind>("translate");
  const [axis, setAxis] = useState<StudioHybridDccPrecisionAxis>("x");
  const [space, setSpace] = useState<"world" | "local">("world");
  const [amount, setAmount] = useState<string>(DEFAULTS.translate);
  const [pivotMode, setPivotMode] = useState<"object" | "center" | "world" | "custom">("object");
  const [pivotFields, setPivotFields] = useState<[string, string, string]>(["0", "0", "0"]);
  const [grid, setGrid] = useState("10cm");
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const measurement = useMemo(() => {
    try {
      const assetId = workspace.activeAssetId;
      if (!assetId) return { error: "3D 화면에서 오브젝트를 선택하세요." };
      const transform = workspace.session.state.objectTransforms[assetId];
      if (!transform) return { error: "선택한 오브젝트에 저장된 변환이 없습니다." };
      const asset = deriveStudioHybridDccViewportSnapshot(workspace).assets.find((item) => item.assetId === assetId);
      if (!asset) return { error: "숨겨졌거나 표시할 수 없는 오브젝트는 정밀 편집할 수 없습니다." };
      return { assetId, transform, bounds: measureStudioHybridDccPrecisionBounds(asset.positions, transform) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "메시를 측정하지 못했습니다." };
    }
  }, [workspace]);
  const unavailable = measurement.error
    ?? (editingDisabled ? "다른 편집이 완료된 뒤 적용하세요." : undefined)
    ?? (componentSelection && componentSelection.mode !== "object" ? "오브젝트 모드에서 사용하세요. 메시 요소는 변경하지 않습니다." : undefined)
    ?? (onSculptStroke ? "조형 모드에서는 오브젝트 정밀 변환을 잠시 사용할 수 없습니다." : undefined)
    ?? (!onCommitAssetTransform ? "이 화면은 읽기 전용입니다." : undefined);
  const candidate = (() => {
    if (!measurement.transform || !measurement.bounds) return { error: measurement.error };
    try {
      const bounds = measurement.bounds;
      const pivot: readonly [number, number, number] | undefined = kind === "translate" || pivotMode === "object" ? undefined
        : pivotMode === "world" ? [0, 0, 0]
          : pivotMode === "center" ? [
              (bounds.min[0] + bounds.max[0]) / 2,
              (bounds.min[1] + bounds.max[1]) / 2,
              (bounds.min[2] + bounds.max[2]) / 2,
            ] : [
              parseStudioHybridDccPrecisionInput(pivotFields[0], "length"),
              parseStudioHybridDccPrecisionInput(pivotFields[1], "length"),
              parseStudioHybridDccPrecisionInput(pivotFields[2], "length"),
            ];
      const value = parseStudioHybridDccPrecisionInput(amount, kind === "rotate" ? "angle" : kind === "scale" ? "scalar" : "length");
      return { transform: applyStudioHybridDccPrecisionCommand(measurement.transform, {
        kind, axis, space, value, pivot,
      }, bounds) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "변환 값을 확인하세요." };
    }
  })();
  const commit = (create: () => StudioHybridDccObjectTransform) => {
    if (unavailable || !measurement.assetId || !measurement.transform || !onCommitAssetTransform) return;
    setActionError("");
    try {
      const next = create();
      if (hashStudioHybridDccObjectTransform(next) === hashStudioHybridDccObjectTransform(measurement.transform)) {
        setFeedback("변경할 값이 없습니다.");
        return;
      }
      onCommitAssetTransform(measurement.assetId, next);
      setFeedback("변환을 요청했습니다. 실행 결과는 편집기 상태와 되돌리기 기록에서 확인하세요.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "변환을 적용하지 못했습니다.");
    }
  };
  const changeKind = (next: StudioHybridDccPrecisionKind) => {
    setKind(next);
    setAmount(DEFAULTS[next]);
    setAxis(next === "scale" ? "all" : "x");
    setSpace(next === "scale" ? "local" : "world");
    setActionError("");
  };
  return (
    <div className="space-y-3 border-t border-line p-3" data-studio-hybrid-dcc-precision-editor="true">
      <p className="text-[11px] leading-relaxed text-fg-3" id={`${id}-help`}>
        단위 수식 예: 1m+25cm · 90deg/2 · 110%. 이동은 거리, 회전은 증분, 크기는 배율입니다.
        목표 치수는 월드 경계 기준이며 비율을 유지합니다. 원본 메시를 굽지 않고 기존 되돌리기 명령으로 적용합니다.
      </p>
      {unavailable ? <p role="status" className="text-xs text-fg-3">{unavailable}</p> : null}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (candidate.transform) commit(() => candidate.transform!);
      }} aria-label="정밀 오브젝트 변환" aria-describedby={`${id}-help`}>
        <fieldset disabled={Boolean(unavailable)} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <legend className="sr-only">정밀 변환 설정</legend>
          <div className="grid gap-1">
            <label htmlFor={`${id}-kind`} className="text-[11px] text-fg-2">정밀 작업</label>
            <select id={`${id}-kind`} className={CONTROL} value={kind} onChange={(event) => changeKind(event.target.value as StudioHybridDccPrecisionKind)}>
              <option value="translate">거리 이동</option><option value="rotate">각도 회전</option>
              <option value="scale">배율 조절</option><option value="dimension">목표 치수 맞춤</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${id}-axis`} className="text-[11px] text-fg-2">정밀 변환 축</label>
            <select id={`${id}-axis`} className={CONTROL} value={axis} onChange={(event) => setAxis(event.target.value as StudioHybridDccPrecisionAxis)}>
              <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
              {kind === "scale" ? <option value="all">XYZ 균일</option> : null}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${id}-space`} className="text-[11px] text-fg-2">정밀 좌표계</label>
            <select id={`${id}-space`} className={CONTROL} value={space} disabled={kind === "dimension" || kind === "scale"} onChange={(event) => setSpace(event.target.value as "world" | "local")}>
              <option value="world">월드 축</option><option value="local">로컬 축</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${id}-amount`} className="text-[11px] text-fg-2">{kind === "scale" ? "배율 수식" : kind === "rotate" ? "각도 수식" : "길이 수식"}</label>
            <input id={`${id}-amount`} className={CONTROL} value={amount} maxLength={96} autoComplete="off" spellCheck={false}
              aria-invalid={Boolean(candidate.error)} aria-describedby={candidate.error ? `${id}-error` : `${id}-help`}
              onChange={(event) => { setAmount(event.target.value); setActionError(""); }} />
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${id}-pivot`} className="text-[11px] text-fg-2">변환 피벗</label>
            <select id={`${id}-pivot`} className={CONTROL} value={pivotMode} disabled={kind === "translate"}
              onChange={(event) => setPivotMode(event.target.value as typeof pivotMode)}>
              <option value="object">오브젝트 원점</option><option value="center">표시 메시 중심</option>
              <option value="world">월드 원점</option><option value="custom">사용자 피벗</option>
            </select>
          </div>
          <button type="submit" className={`${CONTROL} self-end bg-accent-soft font-semibold text-accent`} disabled={Boolean(candidate.error) || !candidate.transform}>
            정밀 변환 적용
          </button>
        </fieldset>
        {pivotMode === "custom" && kind !== "translate" ? (
          <fieldset disabled={Boolean(unavailable)} className="mt-2 grid grid-cols-3 gap-2">
            <legend className="mb-1 text-[11px] text-fg-3">사용자 피벗 · 월드 좌표 (m)</legend>
            {([0, 1, 2] as const).map((index) => (
              <div className="grid gap-1" key={index}>
                <label htmlFor={`${id}-pivot-${index}`} className="text-[11px] text-fg-2">피벗 {"XYZ"[index]}</label>
                <input id={`${id}-pivot-${index}`} className={CONTROL} value={pivotFields[index]} maxLength={96} autoComplete="off"
                  onChange={(event) => {
                  const value = event.target.value;
                  setPivotFields((previous) => {
                    const next: [string, string, string] = [...previous];
                    next[index] = value;
                    return next;
                  });
                }} />
              </div>
            ))}
          </fieldset>
        ) : null}
      </form>
      {candidate.error && !unavailable ? <p id={`${id}-error`} role="alert" className="text-xs text-fg-2">{candidate.error}</p> : null}
      {candidate.transform && !unavailable ? (
        <output className="block rounded-lg bg-raised px-2 py-1.5 font-mono text-[10px] text-fg-2" aria-live="polite" aria-label="정밀 변환 결과 미리보기">
          위치 [{candidate.transform.position.map(format).join(", ")}] m · 회전 [{candidate.transform.rotationEulerRad.map((value) => format(value * 180 / Math.PI)).join(", ")}] ° · 크기 [{candidate.transform.scale.map(format).join(", ")}]
        </output>
      ) : null}
      <fieldset disabled={Boolean(unavailable)} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
        <legend className="sr-only">정밀 배치</legend>
        <div className="grid gap-1">
          <label htmlFor={`${id}-grid`} className="text-[11px] text-fg-2">월드 그리드 간격</label>
          <input id={`${id}-grid`} className={`${CONTROL} w-28`} value={grid} maxLength={96} onChange={(event) => setGrid(event.target.value)} />
        </div>
        <button type="button" className={CONTROL} onClick={() => commit(() => snapStudioHybridDccPrecisionToGrid(measurement.transform!, parseStudioHybridDccPrecisionInput(grid, "length")))}>
          그리드에 정렬
        </button>
        <button type="button" className={CONTROL} onClick={() => commit(() => alignStudioHybridDccPrecisionBounds(measurement.transform!, measurement.bounds!, "ground"))}>
          바닥 Y=0에 놓기
        </button>
        <button type="button" className={CONTROL} onClick={() => commit(() => alignStudioHybridDccPrecisionBounds(measurement.transform!, measurement.bounds!, "center"))}>
          메시 중심을 원점으로
        </button>
        {measurement.bounds ? <span className="text-[10px] text-fg-3" aria-label="현재 표시 메시 치수">
          XYZ {measurement.bounds.max.map((value, index) => format(value - measurement.bounds!.min[index]!)).join(" × ")} m
        </span> : null}
      </fieldset>
      {actionError ? <p role="alert" className="text-xs text-fg-2">{actionError}</p> : null}
      {feedback ? <p role="status" className="text-[11px] text-fg-3">{feedback}</p> : null}
    </div>
  );
}

export function StudioHybridDccPrecisionTools(props: StudioHybridDccViewportProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="mt-2 overflow-hidden rounded-xl border border-line bg-panel" aria-label="정밀 변환 작업대">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>정밀 변환 · 피벗 · 치수 · 배치</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={id} hidden={!open}>
        {open ? <PrecisionEditor key={props.workspace.activeAssetId ?? "no-selection"} {...props} /> : null}
      </div>
    </section>
  );
}
