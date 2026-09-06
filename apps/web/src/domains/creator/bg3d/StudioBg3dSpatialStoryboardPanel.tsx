/**
 * Spatial editorial plan, not an immersive player. SVG is an explicitly labelled top-down map.
 * Selection is inert; only explicit commands use the canonical editor's undo/lock authority.
 */
import { useEffect, useId, useRef, useState } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import {
  buildSpatialStoryboardPlan,
  normalizeSpatialStoryboardSettings,
  parseSpatialStoryboardSettings,
  serializeSpatialStoryboardPlan,
  SPATIAL_STORYBOARD_DEFAULTS,
  SPATIAL_STORYBOARD_MAX_FILE_BYTES,
} from "./studio-bg3d-spatial-storyboard";

import type {
  SpatialStoryboardPanel,
  SpatialStoryboardSettings,
} from "./studio-bg3d-spatial-storyboard";

const BUTTON = "min-h-11 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const FIELD = "min-h-11 min-w-0 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const DIMENSIONS = [
  ["distanceMeters", "관람 거리 (m)", 0.75, 6, 0.05],
  ["panelWidthMeters", "컷 폭 (m)", 0.2, 2, 0.05],
  ["gapMeters", "컷 간격 (m)", 0.02, 0.5, 0.01],
  ["eyeHeightMeters", "컷 중심 높이 (m)", 0.8, 2, 0.05],
  ["maxArcDegrees", "배치 범위 (°)", 40, 140, 5],
] as const;

function PlanMap({ panels, selectedId }: {
  readonly panels: readonly SpatialStoryboardPanel[];
  readonly selectedId: string | null;
}) {
  const titleId = useId();
  // Uniform metric scale. Include the entire panel width and viewer, never stretch axes separately.
  const extentX = Math.max(1, ...panels.map((panel) => Math.abs(panel.position[0]) + panel.widthMeters / 2));
  const extentZ = Math.max(1, ...panels.map((panel) => Math.abs(panel.position[2]) + panel.widthMeters / 2));
  const scale = Math.min(136 / extentX, 148 / extentZ);
  const project = (x: number, z: number) => [160 + x * scale, 180 + z * scale] as const;
  return (
    <svg viewBox="0 0 320 215" role="img" aria-labelledby={titleId} className="w-full rounded-lg border border-line bg-card">
      <title id={titleId}>공간 콘티 위에서 본 배치도. 강조선과 번호는 선택 컷, 나머지 선은 같은 페이지의 컷입니다. 실제 장면 이미지가 아닙니다.</title>
      <path d="M160 20V180" stroke="currentColor" strokeDasharray="3 4" className="text-fg-3" opacity="0.3" />
      {panels.map((panel) => {
        const [x, z] = [panel.position[0], panel.position[2]];
        const yaw = panel.yawDegrees * Math.PI / 180;
        const dx = Math.cos(yaw) * panel.widthMeters / 2;
        const dz = -Math.sin(yaw) * panel.widthMeters / 2;
        const start = project(x - dx, z - dz);
        const end = project(x + dx, z + dz);
        const center = project(x, z);
        return (
          <g key={panel.shotId} className={selectedId === panel.shotId ? "text-accent" : "text-fg-3"}>
            <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke="currentColor" strokeWidth={selectedId === panel.shotId ? 5 : 3} />
            {selectedId === panel.shotId ? <text x={center[0]} y={center[1] - 8} textAnchor="middle" fontSize="11" fill="currentColor">{panel.order}</text> : null}
          </g>
        );
      })}
      <circle cx="160" cy="180" r="5" fill="currentColor" className="text-accent" />
      <text x="160" y="202" textAnchor="middle" fontSize="11" fill="currentColor" className="text-fg-3">관람자 · 정면은 위쪽 (−Z)</text>
    </svg>
  );
}

export default function StudioBg3dSpatialStoryboardPanel() {
  const runtime = useStudioBg3dProSuiteRuntime();
  const [settings, setSettings] = useState<SpatialStoryboardSettings>(SPATIAL_STORYBOARD_DEFAULTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const importEpoch = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const enabled = runtime !== null && !runtime.disabled;
  // Invalidate delayed file reads on capture/restore locks and on unmount; no stale state writes.
  useEffect(() => () => { importEpoch.current += 1; }, [enabled]);
  const plan = buildSpatialStoryboardPlan(runtime?.productionShots ?? [], settings);
  const active = plan.panels.find((panel) => panel.shotId === selectedId) ?? plan.panels[0];
  const activeIndex = active ? plan.panels.indexOf(active) : -1;
  const page = active?.page ?? 0;
  const visiblePanels = plan.panels.filter((panel) => panel.page === page);

  function edit(next: Partial<SpatialStoryboardSettings>) {
    if (!enabled) return;
    importEpoch.current += 1;
    setSettings((current) => normalizeSpatialStoryboardSettings({ ...current, ...next }));
    setMessage("");
    setError("");
  }
  function run(action: () => void, notice: string) {
    if (!enabled) return;
    try { action(); setMessage(notice); setError(""); }
    catch { setError("편집 명령을 적용하지 못했습니다. 현재 장면 상태를 확인하세요."); }
  }
  async function importSettings(file: File) {
    if (!enabled) return;
    const epoch = ++importEpoch.current;
    try {
      if (file.size > SPATIAL_STORYBOARD_MAX_FILE_BYTES) throw new Error("계획 파일은 256KB 이하만 가져올 수 있습니다.");
      const next = parseSpatialStoryboardSettings(await file.text());
      if (epoch !== importEpoch.current) return;
      setSettings(next);
      setError("");
      setMessage("배치 설정만 가져왔습니다. 외부 컷·카메라·장면 데이터는 적용하지 않았습니다.");
    } catch {
      if (epoch === importEpoch.current) setError("올바른 공간 콘티 계획 v1 JSON 파일(256KB 이하)을 선택하세요.");
    }
  }
  function download() {
    if (!enabled || !plan.panels.length) return;
    let url: string | null = null;
    const anchor = document.createElement("a");
    try {
      url = URL.createObjectURL(new Blob([serializeSpatialStoryboardPlan(plan)], { type: "application/json" }));
      anchor.href = url;
      anchor.download = "toonstudio-spatial-storyboard.json";
      document.body.append(anchor);
      anchor.click();
      setError("");
      setMessage("계획 JSON 다운로드를 요청했습니다. 헤드셋 재생 파일이나 장면 백업은 아닙니다.");
    } catch { setError("계획 파일 다운로드를 시작하지 못했습니다."); }
    finally {
      anchor.remove();
      if (url) { const ownedUrl = url; setTimeout(() => URL.revokeObjectURL(ownedUrl), 1000); }
    }
  }

  return (
    <div className="space-y-3 pt-3" data-testid="studio-spatial-storyboard">
      <p className="text-xs leading-relaxed text-fg-3">저장된 3D 샷을 공간에 놓는 <strong className="text-fg">배치 계획</strong>입니다. 컷 이미지를 렌더링하거나 VR·AR 장면에 자동 배치하지 않습니다.</p>
      <PlanMap panels={visiblePanels} selectedId={active?.shotId ?? null} />
      <p className="text-xs text-fg-3">{plan.panels.length}컷 · {plan.pageCount ? page + 1 : 0}/{plan.pageCount}페이지 · 실제 크기의 비율로 표시한 평면도</p>
      {!plan.panels.length ? <p className="rounded-lg border border-line p-3 text-xs text-fg-2">현재 구도를 컷으로 저장하거나 기존 카메라 도구에서 샷을 추가하세요.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={BUTTON} disabled={!enabled || activeIndex <= 0} onClick={() => setSelectedId(plan.panels[activeIndex - 1]!.shotId)}>이전 컷 선택</button>
            <button type="button" className={BUTTON} disabled={!enabled || activeIndex >= plan.panels.length - 1} onClick={() => setSelectedId(plan.panels[activeIndex + 1]!.shotId)}>다음 컷 선택</button>
          </div>
          <ol className="max-h-52 space-y-1 overflow-y-auto" aria-label="현재 페이지의 공간 콘티 컷">
            {visiblePanels.map((panel) => (
              <li key={panel.shotId}>
                <button type="button" className={`${BUTTON} w-full text-left aria-pressed:border-accent aria-pressed:bg-accent-soft`} disabled={!enabled} aria-pressed={panel.shotId === active?.shotId} onClick={() => setSelectedId(panel.shotId)}>
                  <span className="block break-words">{panel.order}. {panel.label}</span>
                </button>
              </li>
            ))}
          </ol>
          {active ? <p className="break-words text-xs text-fg-3">선택 컷: X {active.position[0].toFixed(2)} · Y {active.position[1].toFixed(2)} · Z {active.position[2].toFixed(2)}m / 가로 {active.widthMeters.toFixed(2)} × 세로 {active.heightMeters.toFixed(2)}m</p> : null}
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={BUTTON} disabled={!enabled} onClick={() => run(() => runtime?.onCaptureCurrentShot(), "현재 구도 저장 명령을 전달했습니다. 저장된 샷 목록을 확인하세요.")}>현재 구도 컷 저장</button>
        <button type="button" className={BUTTON} disabled={!enabled || !active} onClick={() => {
          if (active && runtime?.productionShots.some((shot) => shot.id === active.shotId)) run(() => runtime.onApplyProductionShot(active.shotId), "선택 컷 적용 명령을 전달했습니다. 기존 편집기의 실행 취소 경로를 사용합니다.");
        }}>선택 컷을 편집기에 적용</button>
      </div>
      <p className="text-xs leading-relaxed text-fg-3">컷 선택만으로 카메라가 움직이지 않습니다. 위 적용 버튼은 저장된 샷의 구도와 표시 설정을 바꿉니다. 헤드셋 검토는 아래 기존 AR·VR 미리보기를 사용하세요.</p>
      <fieldset disabled={!enabled} className="grid grid-cols-2 gap-3 disabled:opacity-50">
        <legend className="mb-2 text-xs font-bold text-fg">공간 배치 설정</legend>
        <label className="min-w-0 space-y-1 text-xs text-fg-2">배치 방식
          <select className={FIELD} value={settings.layout} onChange={(event) => edit({ layout: event.target.value as SpatialStoryboardSettings["layout"] })}>
            <option value="focus">한 컷 집중</option><option value="arc">곡면 배치</option><option value="wall">평면 벽 배치</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-xs text-fg-2">읽기 방향
          <select className={FIELD} value={settings.direction} onChange={(event) => edit({ direction: event.target.value as SpatialStoryboardSettings["direction"] })}>
            <option value="ltr">왼쪽 → 오른쪽</option><option value="rtl">오른쪽 → 왼쪽</option>
          </select>
        </label>
        {DIMENSIONS.map(([key, label, min, max, step]) => (
          <label key={key} className="min-w-0 space-y-1 text-xs text-fg-2">{label} · {settings[key].toFixed(key === "maxArcDegrees" ? 0 : 2)}
            <input type="range" min={min} max={max} step={step} value={settings[key]} aria-label={label} onChange={(event) => edit({ [key]: Number(event.target.value) })} className="min-h-11 w-full accent-accent" />
          </label>
        ))}
        <label className="min-w-0 space-y-1 text-xs text-fg-2">컷 가로/세로 비율
          <input className={FIELD} type="number" min="0.5" max="2.4" step="0.01" value={settings.aspectRatio} onChange={(event) => { if (event.target.value) edit({ aspectRatio: Number(event.target.value) }); }} />
        </label>
      </fieldset>
      {plan.warnings.length ? <ul className="space-y-1 rounded-lg border border-line p-3 text-xs text-fg-2" aria-label="배치 검토 안내">{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      <p className="text-xs leading-relaxed text-fg-3">치수 경고는 편집 참고값이며 기기 호환성·가독성·안전 인증이 아닙니다. 설정은 도구를 닫으면 초기화됩니다. 유지하려면 계획 파일로 내보내세요.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={!enabled || !plan.panels.length} onClick={download}>계획 JSON 내보내기</button>
        <button type="button" className={BUTTON} disabled={!enabled} onClick={() => fileInput.current?.click()}>계획 설정 가져오기</button>
        <button type="button" className={BUTTON} disabled={!enabled} onClick={() => edit(SPATIAL_STORYBOARD_DEFAULTS)}>설정 초기화</button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="공간 콘티 계획 파일" className="hidden" disabled={!enabled} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importSettings(file);
        }} />
      </div>
      {!enabled ? <p role="status" className="text-xs text-fg-3">장면 연결 또는 편집 잠금 해제 후 사용할 수 있습니다.</p> : null}
      {message ? <p role="status" className="text-xs text-fg-2">{message}</p> : null}
      {error ? <p role="alert" className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
