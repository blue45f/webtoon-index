import {
  Bone,
  Box,
  ChevronDown,
  CircleGauge,
  Hand,
  Move3d,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_GENERIC_3D_CLASSIFICATION_LABELS,
  STUDIO_GENERIC_3D_RIG_LABELS,
  getStudioGeneric3dCapability,
  type StudioGeneric3dClassification,
  type StudioGeneric3dModelManifest,
} from "./studio-generic-3d-model-mode";

import type { StudioGeneric3dPoseProxy } from "./studio-generic-3d-pose-proxy";

export type StudioGeneric3dControlMode = "root" | "parts" | "pose";

export interface StudioGeneric3dModelModePanelProps {
  readonly manifest: StudioGeneric3dModelManifest;
  readonly proxies: readonly StudioGeneric3dPoseProxy[];
  readonly controlMode: StudioGeneric3dControlMode;
  readonly selectedProxyId: string | null;
  readonly onClassificationChange: (classification: StudioGeneric3dClassification) => void;
  readonly onControlModeChange: (mode: StudioGeneric3dControlMode) => void;
  readonly onProxySelect: (proxyId: string) => void;
}

const CONTROL_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

const CLASSIFICATIONS: readonly StudioGeneric3dClassification[] = [
  "character",
  "creature",
  "prop",
];

const FORMAT_LABELS: Readonly<Record<StudioGeneric3dModelManifest["sourceFormat"], string>> =
  Object.freeze({
    glb: "GLB",
    gltf: "glTF → GLB",
    obj: "OBJ",
    "obj-mtl": "OBJ + MTL",
  });

const RIGHTS_LABELS: Readonly<Record<StudioGeneric3dModelManifest["rights"]["status"], string>> =
  Object.freeze({
    owned: "직접 제작",
    licensed: "라이선스 확인",
    "public-domain": "퍼블릭 도메인",
    unknown: "권리 확인 전",
  });

const MODE_DEFINITIONS: ReadonlyArray<{
  readonly id: StudioGeneric3dControlMode;
  readonly label: string;
  readonly capability: "root-transform" | "part-transform" | "pose-proxy";
  readonly icon: typeof Move3d;
}> = [
  { id: "root", label: "전체", capability: "root-transform", icon: Move3d },
  { id: "parts", label: "부위", capability: "part-transform", icon: Hand },
  { id: "pose", label: "포즈", capability: "pose-proxy", icon: Bone },
];

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function admissionLabel(manifest: StudioGeneric3dModelManifest): string {
  if (manifest.admission.status === "ready") return "검사 완료";
  if (manifest.admission.status === "canonical-validation-pending") return "최종 검사 대기";
  return "사용 차단";
}

function operationLabel(proxy: StudioGeneric3dPoseProxy): string {
  if (proxy.operation === "root-transform") return "전체 변환";
  if (proxy.operation === "bone-rotate") return proxy.deformsMesh ? "본·스킨" : "본 회전";
  if (proxy.operation === "node-transform") return "부위 이동";
  return "가이드";
}

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

export function StudioGeneric3dModelModePanel({
  manifest,
  proxies,
  controlMode,
  selectedProxyId,
  onClassificationChange,
  onControlModeChange,
  onProxySelect,
}: StudioGeneric3dModelModePanelProps) {
  const id = useId();
  const admissionReady = manifest.admission.status === "ready";

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-xl border border-line bg-panel"
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised text-accent">
          <Box size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={`${id}-title`} className="min-w-0 truncate text-sm font-bold text-fg">
              범용 3D 모델
            </h3>
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[0.62rem] font-bold text-fg-3">
              VRM과 별도
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs font-semibold text-fg-2" title={manifest.name}>
            {manifest.name}
          </p>
          <p className="mt-1 text-[0.66rem] leading-relaxed text-fg-3">
            {FORMAT_LABELS[manifest.sourceFormat]} · {STUDIO_GENERIC_3D_RIG_LABELS[manifest.rigStatus]}
          </p>
        </div>
      </div>

      <div
        className={cx(
          "flex items-start gap-2 border-y border-line px-3 py-2 text-[0.68rem] leading-relaxed",
          manifest.admission.status === "ready"
            ? "text-good"
            : manifest.admission.status === "blocked"
              ? "text-bad"
              : "text-warn",
        )}
        role={manifest.admission.status === "blocked" ? "alert" : "status"}
      >
        {manifest.admission.status === "ready" ? (
          <ShieldCheck className="mt-0.5 shrink-0" size={14} aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 shrink-0" size={14} aria-hidden />
        )}
        <span>
          <strong className="font-bold">{admissionLabel(manifest)}</strong>
          <span className="text-fg-3"> · {manifest.admission.message}</span>
        </span>
      </div>

      <div className="px-3 py-3">
        <fieldset>
          <legend className="text-[0.68rem] font-bold text-fg-2">모델 용도</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {CLASSIFICATIONS.map((classification) => {
              const selected = manifest.classification === classification;
              return (
                <button
                  key={classification}
                  type="button"
                  aria-pressed={selected}
                  className={cx(
                    CONTROL_BUTTON,
                    selected
                      ? "border-accent/60 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                  onClick={() => onClassificationChange(classification)}
                >
                  {STUDIO_GENERIC_3D_CLASSIFICATION_LABELS[classification]}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3">
            {manifest.classificationSource === "manual"
              ? "사용자가 지정한 분류입니다."
              : "파일명·태그·노드 이름으로 제안한 분류이며 언제든 바꿀 수 있습니다."}
          </p>
        </fieldset>

        <fieldset className="mt-3 border-t border-line pt-3">
          <legend className="text-[0.68rem] font-bold text-fg-2">조작 모드</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {MODE_DEFINITIONS.map((mode) => {
              const Icon = mode.icon;
              const capability = getStudioGeneric3dCapability(manifest, mode.capability);
              const disabled = capability.availability === "unavailable";
              const selected = controlMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selected}
                  aria-describedby={`${id}-${mode.id}-hint`}
                  disabled={disabled}
                  className={cx(
                    CONTROL_BUTTON,
                    selected
                      ? "border-accent/60 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                  onClick={() => onControlModeChange(mode.id)}
                >
                  <Icon size={14} aria-hidden />
                  {mode.label}
                  {capability.availability === "limited" ? (
                    <span className="sr-only">제한됨</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="sr-only">
            {MODE_DEFINITIONS.map((mode) => (
              <p key={mode.id} id={`${id}-${mode.id}-hint`}>
                {getStudioGeneric3dCapability(manifest, mode.capability).detail}
              </p>
            ))}
          </div>
        </fieldset>

        {controlMode === "pose" ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[0.68rem] font-bold text-fg-2">포즈 대상</h4>
              <span className="text-[0.62rem] font-semibold text-fg-3">
                조작 가능 {proxies.filter((item) => item.canApply).length}/{proxies.length}
              </span>
            </div>
            <div className="mt-1.5 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
              {proxies.map((proxy) => {
                const selected = proxy.id === selectedProxyId;
                return (
                  <button
                    key={proxy.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={!admissionReady}
                    className={cx(
                      "min-h-11 rounded-lg border px-2 py-1.5 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                      selected
                        ? "border-accent/60 bg-accent-soft text-accent"
                        : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                    )}
                    title={proxy.detail}
                    onClick={() => onProxySelect(proxy.id)}
                  >
                    <span className="block truncate text-[0.68rem] font-bold">{proxy.label}</span>
                    <span className="mt-0.5 block text-[0.6rem] font-semibold text-fg-3">
                      {operationLabel(proxy)}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3">
              가이드는 구도 참고용이며 메시를 변형하지 않습니다. 정적 부위 이동은 이음새가 벌어질 수 있습니다.
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 border-t border-line" aria-label="3D 모델 구조 요약">
        <div className="px-2 py-2 text-center">
          <span className="block text-[0.6rem] font-semibold text-fg-3">삼각형</span>
          <strong className="mt-0.5 block text-[0.7rem] tabular-nums text-fg">
            {formatNumber(manifest.structure.triangles)}
          </strong>
        </div>
        <div className="border-x border-line px-2 py-2 text-center">
          <span className="block text-[0.6rem] font-semibold text-fg-3">부위 / 본</span>
          <strong className="mt-0.5 block text-[0.7rem] tabular-nums text-fg">
            {formatNumber(manifest.structure.parts)} / {formatNumber(manifest.structure.bones)}
          </strong>
        </div>
        <div className="px-2 py-2 text-center">
          <span className="block text-[0.6rem] font-semibold text-fg-3">애니메이션</span>
          <strong className="mt-0.5 block text-[0.7rem] tabular-nums text-fg">
            {formatNumber(manifest.structure.animations)}
          </strong>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[0.66rem] text-fg-3">
        <CircleGauge size={13} className="shrink-0 text-fg-2" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {manifest.admission.profile ? `${manifest.admission.profile === "mobile" ? "모바일" : "데스크톱"} 예산 통과` : "기기 예산 확인 전"}
        </span>
        <span className={manifest.rights.reviewRequired ? "text-warn" : "text-good"}>
          {RIGHTS_LABELS[manifest.rights.status]}
        </span>
      </div>

      <details className="group border-t border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-bold text-fg marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
          <TriangleAlert size={14} className="shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1">제한 사항 {manifest.limitations.length}개</span>
          <ChevronDown
            size={14}
            className="shrink-0 text-fg-3 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="border-t border-line px-3 py-2" aria-label="3D 모델 제한 사항">
          {manifest.limitations.length > 0 ? manifest.limitations.map((item) => (
            <li key={item.code} className="py-1 text-[0.66rem] leading-relaxed text-fg-3">
              <strong className={cx(
                "font-bold",
                item.severity === "blocking"
                  ? "text-bad"
                  : item.severity === "warning"
                    ? "text-warn"
                    : "text-fg-2",
              )}>
                {item.title}
              </strong>
              <span> · {item.detail}</span>
            </li>
          )) : (
            <li className="py-1 text-[0.66rem] text-good">확인된 제한 사항이 없습니다.</li>
          )}
        </ul>
      </details>
    </section>
  );
}
