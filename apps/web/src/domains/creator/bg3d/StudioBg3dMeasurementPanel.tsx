/**
 * THESIS: 측정값과 추론 상태를 한 시선 안에 두고, SketchUp식 줄자를 웹툰 배경 작업에 연결한다.
 * OWN-WORLD: 기존 warm-ink 패널, 얇은 경계, persimmon 활성 신호, tabular 측정 숫자를 계승한다.
 * STORY: 두 점을 찍고 방향을 확인한 뒤 길이를 잠그거나 영구 가이드로 남기고 다시 관리한다.
 * FIRST VIEWPORT: 단위 토글 → 실시간 거리·XYZ → 추론/잠금 → 영구 가이드 순서로 스캔한다.
 * FORM: 기존 BG3D 도구 패널을 확장하는 조밀한 Operate 표면이며 독립 컴포넌트로 통합을 기다린다.
 */

import {
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Plus,
  Ruler,
  Trash2,
  Unlock,
} from "lucide-react";
import { useState } from "react";

import {
  STUDIO_BG3D_CONTROL_BUTTON,
  STUDIO_BG3D_ICON_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";
import {
  STUDIO_BG3D_MEASUREMENT_MAX_GUIDES,
  addStudioBg3dMeasurementGuide,
  deleteStudioBg3dMeasurementGuide,
  formatStudioBg3dMeasurementLength,
  resolveStudioBg3dMeasurementGuide,
  setStudioBg3dMeasurementGuideVisibility,
  setStudioBg3dMeasurementUnit,
  studioBg3dMeasurementValueInUnit,
  studioBg3dMeasurementValueToMeters,
  type StudioBg3dMeasurementDocument,
  type StudioBg3dMeasurementInferenceSuccess,
  type StudioBg3dMeasurementPrimaryInference,
  type StudioBg3dMeasurementUnit,
  type StudioBg3dWorldMeasurement,
} from "./studio-bg3d-measurement";

const UNIT_OPTIONS: readonly {
  readonly id: StudioBg3dMeasurementUnit;
  readonly label: string;
}[] = Object.freeze([
  { id: "mm", label: "mm" },
  { id: "cm", label: "cm" },
  { id: "m", label: "m" },
]);

type PanelNotice = {
  readonly tone: "error" | "success";
  readonly message: string;
};

export interface StudioBg3dMeasurementPanelProps {
  readonly document: StudioBg3dMeasurementDocument;
  readonly draftMeasurement?: StudioBg3dWorldMeasurement | null;
  readonly inference?: StudioBg3dMeasurementInferenceSuccess | null;
  readonly lockedLengthMeters?: number | null;
  readonly disabled?: boolean;
  readonly onDocumentChange: (document: StudioBg3dMeasurementDocument) => void;
  readonly onLengthLockChange: (lockedLengthMeters: number | null) => void;
}

function formatSignedCoordinate(
  meters: number,
  unit: StudioBg3dMeasurementUnit,
): string {
  const converted = studioBg3dMeasurementValueInUnit(meters, unit);
  if (converted === null) return "—";
  const rounded = Math.round(converted * 1_000) / 1_000;
  const value = Object.is(rounded, -0) ? 0 : rounded;
  return `${value > 0 ? "+" : ""}${String(value)} ${unit}`;
}

function inferenceLabel(inference: StudioBg3dMeasurementPrimaryInference): string {
  if (inference.kind === "free") return "자유 방향";
  const error = inference.angularErrorDegrees === 0
    ? "정확히 일치"
    : `오차 ${inference.angularErrorDegrees}°`;
  if (inference.kind === "axis") {
    return `${inference.sign < 0 ? "−" : "+"}${inference.axis.toUpperCase()}축 · ${error}`;
  }
  if (inference.kind === "parallel") {
    return `${inference.referenceId}에 ${inference.sign < 0 ? "역" : ""}평행 · ${error}`;
  }
  return `${inference.referenceId}에 수직 · ${error}`;
}

function lockedLengthInputValue(
  lockedLengthMeters: number | null,
  unit: StudioBg3dMeasurementUnit,
): string {
  if (lockedLengthMeters === null) return "";
  const converted = studioBg3dMeasurementValueInUnit(lockedLengthMeters, unit);
  if (converted === null) return "";
  return String(Math.round(converted * 1_000) / 1_000);
}

export function StudioBg3dMeasurementPanel({
  document,
  draftMeasurement = null,
  inference = null,
  lockedLengthMeters = null,
  disabled = false,
  onDocumentChange,
  onLengthLockChange,
}: StudioBg3dMeasurementPanelProps) {
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const distanceLabel = draftMeasurement
    ? formatStudioBg3dMeasurementLength(draftMeasurement.distanceMeters, document.unit)
    : null;
  const resolvedGuides = document.guides.map((guide) => ({
    guide,
    resolved: resolveStudioBg3dMeasurementGuide(guide, document.unit),
  }));

  const updateDocument = (
    result:
      | ReturnType<typeof setStudioBg3dMeasurementUnit>
      | ReturnType<typeof deleteStudioBg3dMeasurementGuide>
      | ReturnType<typeof setStudioBg3dMeasurementGuideVisibility>,
    successMessage?: string,
  ) => {
    if (!result.ok) {
      setNotice({ tone: "error", message: result.message });
      return;
    }
    onDocumentChange(result.document);
    setNotice(successMessage ? { tone: "success", message: successMessage } : null);
  };

  const addCurrentGuide = () => {
    if (!draftMeasurement || disabled) return;
    const result = addStudioBg3dMeasurementGuide(document, {
      startWorld: draftMeasurement.startWorld,
      endWorld: draftMeasurement.endWorld,
      lockedLengthMeters,
    });
    if (!result.ok) {
      setNotice({ tone: "error", message: result.message });
      return;
    }
    onDocumentChange(result.document);
    const guideLabel =
      formatStudioBg3dMeasurementLength(draftMeasurement.distanceMeters, document.unit)
      ?? "측정";
    setNotice({
      tone: "success",
      message: `${guideLabel} 가이드를 장면에 고정했습니다.`,
    });
  };

  return (
    <section aria-labelledby="bg3d-measurement-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="bg3d-measurement-title"
            className="flex items-center gap-1.5 text-sm font-bold text-fg"
          >
            <Ruler size={15} className="shrink-0 text-accent" aria-hidden />
            줄자 · 추론 가이드
          </h3>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            뷰포트의 두 점을 재고 축·평행·수직 방향을 확인한 뒤 영구 가이드로 남깁니다.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-bold tabular-nums text-fg-3">
          {document.guides.length}/{STUDIO_BG3D_MEASUREMENT_MAX_GUIDES}
        </span>
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-line bg-card p-1"
        role="radiogroup"
        aria-label="측정 표시 단위"
      >
        {UNIT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={document.unit === option.id}
            disabled={disabled}
            className={cx(
              "min-h-10 rounded-md text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-8",
              document.unit === option.id
                ? "bg-accent text-on-accent"
                : "text-fg-3 hover:bg-raised hover:text-fg",
            )}
            onClick={() => updateDocument(setStudioBg3dMeasurementUnit(document, option.id))}
          >
            {option.label}
          </button>
        ))}
      </div>

      {draftMeasurement ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card/70">
          <div className="flex items-end justify-between gap-3 border-b border-line/70 px-3 py-2.5">
            <div>
              <p className="text-[0.64rem] font-semibold text-fg-3">현재 두 점 거리</p>
              <output
                aria-label="현재 측정 거리"
                className="mt-0.5 block text-lg font-bold tabular-nums tracking-[-0.02em] text-fg"
              >
                {distanceLabel ?? "—"}
              </output>
            </div>
            <span
              className={cx(
                "inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-[0.62rem] font-bold",
                inference?.primary.kind && inference.primary.kind !== "free"
                  ? "border-accent/45 bg-accent-soft text-accent"
                  : "border-line bg-panel text-fg-3",
              )}
            >
              <Magnet size={11} aria-hidden />
              {inference ? inferenceLabel(inference.primary) : "추론 대기"}
            </span>
          </div>

          <dl className="grid grid-cols-3 divide-x divide-line/70 border-b border-line/70">
            {(["x", "y", "z"] as const).map((axis, index) => (
              <div key={axis} className="min-w-0 px-2 py-2 text-center">
                <dt className="text-[0.6rem] font-bold uppercase text-fg-3">Δ{axis}</dt>
                <dd className="mt-0.5 truncate text-[0.68rem] font-semibold tabular-nums text-fg-2">
                  {formatSignedCoordinate(draftMeasurement.deltaWorld[index], document.unit)}
                </dd>
              </div>
            ))}
          </dl>

          <p className="px-3 py-2 text-[0.64rem] tabular-nums text-fg-3">
            중점&nbsp;
            {draftMeasurement.midpointWorld.map((value) =>
              formatSignedCoordinate(value, document.unit)
            ).join(" · ")}
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-line bg-card/45 px-3 py-4 text-center">
          <Ruler size={20} className="mx-auto text-fg-3" aria-hidden />
          <p className="mt-2 text-xs font-semibold text-fg-2">뷰포트에서 시작점과 끝점을 찍어 주세요.</p>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
            두 번째 점을 움직이는 동안 거리와 XYZ 변화량, 방향 추론이 실시간으로 표시됩니다.
          </p>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-line bg-card/70 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-pressed={lockedLengthMeters !== null}
            disabled={disabled || !draftMeasurement}
            className={cx(
              STUDIO_BG3D_CONTROL_BUTTON,
              "min-w-24",
              lockedLengthMeters !== null
                ? "border-accent/55 bg-accent-soft text-accent"
                : "border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg",
            )}
            onClick={() => onLengthLockChange(
              lockedLengthMeters === null ? draftMeasurement?.distanceMeters ?? null : null,
            )}
          >
            {lockedLengthMeters === null ? <Unlock size={13} aria-hidden /> : <Lock size={13} aria-hidden />}
            길이 잠금
          </button>
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs sm:min-h-9">
            <span className="shrink-0 text-fg-3">값</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.000001}
              step="any"
              aria-label="잠금 길이"
              disabled={disabled || lockedLengthMeters === null}
              value={lockedLengthInputValue(lockedLengthMeters, document.unit)}
              className="min-w-0 flex-1 bg-transparent text-right font-semibold tabular-nums text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              onChange={(event) => {
                if (!event.target.value.trim()) {
                  onLengthLockChange(null);
                  return;
                }
                const parsed = Number(event.target.value);
                const meters = studioBg3dMeasurementValueToMeters(parsed, document.unit);
                if (meters !== null && meters > 0) onLengthLockChange(meters);
              }}
            />
            <span className="shrink-0 font-semibold text-fg-3">{document.unit}</span>
          </label>
        </div>
        <button
          type="button"
          disabled={
            disabled
            || !draftMeasurement
            || draftMeasurement.distanceMeters <= 0
            || document.guides.length >= STUDIO_BG3D_MEASUREMENT_MAX_GUIDES
          }
          className={cx(
            STUDIO_BG3D_CONTROL_BUTTON,
            "mt-2 w-full border-accent bg-accent text-on-accent hover:bg-accent-2",
          )}
          onClick={addCurrentGuide}
        >
          <Plus size={14} aria-hidden />
          현재 측정을 영구 가이드로 고정
        </button>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          aria-label="측정 가이드 알림"
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          className={cx(
            "mt-2 rounded-lg border px-2.5 py-2 text-[0.68rem] leading-relaxed",
            notice.tone === "error"
              ? "border-bad/40 bg-bad/10 text-bad"
              : "border-good/40 bg-good/10 text-good",
          )}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-fg">영구 가이드</h4>
        <span className="text-[0.62rem] text-fg-3">캡처 제외 · 장면에 저장</span>
      </div>

      {resolvedGuides.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-3 text-center text-[0.68rem] leading-relaxed text-fg-3">
          저장된 가이드가 없습니다. 자주 쓰는 벽 높이·문 폭·가구 간격을 남겨 보세요.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5" aria-label="영구 측정 가이드 목록">
          {resolvedGuides.map(({ guide, resolved }, index) => {
            const label = resolved.ok ? resolved.resolved.label : "손상된 가이드";
            return (
              <li
                key={guide.id}
                className={cx(
                  "flex min-h-12 items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5",
                  !guide.visible && "opacity-55",
                )}
              >
                <span className="relative h-px w-8 shrink-0 bg-accent" aria-hidden>
                  <span className="absolute -left-0.5 -top-1 size-2 rounded-full border border-accent bg-card" />
                  <span className="absolute -right-0.5 -top-1 size-2 rounded-full border border-accent bg-card" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.68rem] font-bold tabular-nums text-fg">
                    {label}
                  </span>
                  <span className="block truncate text-[0.6rem] text-fg-3">
                    가이드 {String(index + 1).padStart(2, "0")}
                    {guide.lockedLengthMeters !== null ? " · 길이 잠금" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`${label} 가이드 ${guide.visible ? "숨기기" : "보이기"}`}
                  disabled={disabled}
                  className={STUDIO_BG3D_ICON_BUTTON}
                  onClick={() => updateDocument(
                    setStudioBg3dMeasurementGuideVisibility(
                      document,
                      guide.id,
                      !guide.visible,
                    ),
                  )}
                >
                  {guide.visible ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-label={`${label} 가이드 삭제`}
                  disabled={disabled}
                  className={cx(
                    STUDIO_BG3D_ICON_BUTTON,
                    "hover:border-bad/45 hover:bg-bad/10 hover:text-bad",
                  )}
                  onClick={() => updateDocument(
                    deleteStudioBg3dMeasurementGuide(document, guide.id),
                    `${label} 가이드를 삭제했습니다.`,
                  )}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
