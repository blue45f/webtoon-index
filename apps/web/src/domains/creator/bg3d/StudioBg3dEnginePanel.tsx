import { CheckCircle2, Cpu, Loader2, TriangleAlert, Zap } from "lucide-react";
import { useId } from "react";

import {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";
import {
  STUDIO_BG3D_ENGINE_PREFERENCE_LABELS,
  STUDIO_BG3D_ENGINE_PREFERENCES,
  type StudioBg3dEngineBackend,
  type StudioBg3dEnginePreference,
  type StudioBg3dEngineSelectionPlan,
} from "./studio-bg3d-engine-selection";

import type { StudioBg3dInAppBrowserProfile } from "./studio-bg3d-inapp-browser";

export interface StudioBg3dEnginePanelProps {
  readonly plan: StudioBg3dEngineSelectionPlan;
  readonly preference: StudioBg3dEnginePreference;
  readonly inApp: StudioBg3dInAppBrowserProfile;
  readonly probing: boolean;
  readonly deviceLostMessage: string | null;
  /** Smoothed viewport frame time, or null while it would be misleading. */
  readonly frameTimeMs: number | null;
  readonly onPreferenceChange: (preference: StudioBg3dEnginePreference) => void;
}

const BACKEND_LABELS: Readonly<Record<StudioBg3dEngineBackend, string>> = Object.freeze({
  webgpu: "WebGPU",
  webgl2: "WebGL2",
});

const PREFERENCE_HINTS: Readonly<Record<StudioBg3dEnginePreference, string>> = Object.freeze({
  webgpu: "차세대 엔진을 명시적으로 사용합니다. 실패해도 다른 엔진으로 바뀌지 않습니다.",
  webgl2: "독립된 WebGL2 엔진을 명시적으로 사용합니다.",
});

/**
 * Engine status and selection for the 3D background editor.
 *
 * Everything the artist sees here is derived from the same plan the renderer actually used, so the
 * badge can never disagree with the selected engine. An unavailable selection stays visible and
 * selected, while both buttons remain manual choices; no control implies an automatic fallback.
 */
export function StudioBg3dEnginePanel({
  plan,
  preference,
  inApp,
  probing,
  deviceLostMessage,
  frameTimeMs,
  onPreferenceChange,
}: StudioBg3dEnginePanelProps) {
  const headingId = useId();
  const statusId = useId();
  const hintId = useId();
  const activeLabel = BACKEND_LABELS[plan.backend];
  // Without a number the engine choice is unfalsifiable to the artist: both options just say
  // "3D". One smoothed frame time makes switching a decision they can check.
  const frameTimeLabel = plan.status === "available" && frameTimeMs !== null && frameTimeMs > 0
    ? `${frameTimeMs.toFixed(1)}ms · 약 ${Math.round(1_000 / frameTimeMs)}fps`
    : null;
  const isNextGen = plan.backend === "webgpu";
  const statusText = probing
    ? "이 기기에서 쓸 수 있는 3D 엔진을 확인하고 있습니다."
    : (deviceLostMessage ?? plan.notice);
  const selectionUnavailable = !probing && plan.status !== "available";
  const activeStatusLabel = probing
    ? "확인 중"
    : `${activeLabel} ${
      plan.status === "failed"
        ? "실행 실패"
        : plan.status === "unavailable"
          ? "사용 불가"
          : "사용 중"
    }`;
  const statusTone = deviceLostMessage || selectionUnavailable
    ? "border-danger/45 bg-danger/10 text-danger"
    : isNextGen
      ? "border-accent/45 bg-accent-soft text-accent"
      : "border-line bg-panel/70 text-fg-3";

  return (
    <section aria-labelledby={headingId} className="mt-5 border-t border-line pt-4">
      <div className="rounded-xl border border-line bg-card/70 p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent-soft text-accent"
            aria-hidden
          >
            {isNextGen ? <Zap size={16} /> : <Cpu size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={headingId} className="text-xs font-bold text-fg">
                3D 렌더 엔진
              </h3>
              <span
                data-testid="studio-bg3d-engine-active-backend"
                className={cx(
                  "rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold",
                  selectionUnavailable
                    ? "border-danger/45 bg-danger/10 text-danger"
                    : isNextGen
                      ? "border-accent/45 bg-accent-soft text-accent"
                      : "border-line bg-panel text-fg-2",
                )}
              >
                {activeStatusLabel}
              </span>
            </div>
            <p className="mt-1 text-[0.72rem] leading-relaxed text-fg-3">
              WebGPU와 WebGL2는 서로 독립된 엔진입니다. 선택한 엔진을 사용할 수 없으면
              뷰포트를 열지 않으며, 다른 엔진은 여기서 직접 선택해야 합니다.
              {inApp.isInApp ? ` 지금은 ${inApp.label}에서 열려 있습니다.` : ""}
            </p>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2"
          role="group"
          aria-label="3D 렌더 엔진 선택"
          aria-describedby={`${statusId} ${hintId}`}
        >
          {STUDIO_BG3D_ENGINE_PREFERENCES.map((option) => {
            const optionLabel = STUDIO_BG3D_ENGINE_PREFERENCE_LABELS[option];
            const isSelected = preference === option;
            const disabled = probing;
            return (
              <button
                key={option}
                type="button"
                data-testid={`studio-bg3d-engine-preference-${option}`}
                aria-pressed={isSelected}
                aria-label={`3D 렌더 엔진 ${optionLabel} 선택`}
                disabled={disabled}
                onClick={() => onPreferenceChange(option)}
                className={cx(
                  CONTROL_BUTTON,
                  "min-h-11 w-full border-line bg-panel px-3 text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg",
                  isSelected && "border-accent/45 bg-accent-soft text-accent",
                )}
              >
                {probing && isSelected ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : isSelected ? (
                  <CheckCircle2 size={14} aria-hidden />
                ) : null}
                {optionLabel}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p id={hintId} className="text-[0.7rem] leading-relaxed text-fg-3">
            {PREFERENCE_HINTS[preference]}
          </p>
          {frameTimeLabel ? (
            <p
              data-testid="studio-bg3d-engine-frame-time"
              className="shrink-0 font-mono text-[0.68rem] tabular-nums text-fg-3"
            >
              <span className="sr-only">최근 뷰포트 프레임 시간 </span>
              {frameTimeLabel}
            </p>
          ) : null}
        </div>

        <div
          id={statusId}
          data-testid="studio-bg3d-engine-status"
          role={deviceLostMessage || selectionUnavailable ? "alert" : "status"}
          aria-live={deviceLostMessage || selectionUnavailable ? "assertive" : "polite"}
          className={cx(
            "mt-2 flex min-h-11 items-start gap-2 rounded-lg border px-2.5 py-2 text-[0.72rem] leading-relaxed",
            statusTone,
          )}
        >
          {deviceLostMessage || selectionUnavailable ? (
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          ) : probing ? (
            <Loader2
              size={14}
              className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : isNextGen ? (
            <Zap size={14} className="mt-0.5 shrink-0" aria-hidden />
          ) : (
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-fg-3" aria-hidden />
          )}
          <span>{statusText}</span>
        </div>
      </div>
    </section>
  );
}
