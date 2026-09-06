/**
 * Compact product-state shell for the procedural artistic brush panel.
 *
 * The controller owns only UI settings and async lifecycle. Runtime probing,
 * Worker/provider orchestration, canonical raster commits, and persistence are
 * dependency-injected so this module never imports the heavy engine graph.
 */
import {
  ChevronDown,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  StudioProceduralArtisticBrushPanel,
  type StudioProceduralArtisticBrushCapabilityStatus,
  type StudioProceduralArtisticBrushUiTechnique,
} from "./StudioProceduralArtisticBrushPanel";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioProceduralArtisticBrushSettings {
  readonly technique: StudioProceduralArtisticBrushUiTechnique;
  readonly color: string;
  readonly density: number;
  readonly angle: number;
  readonly weight: number;
  readonly strength: number;
  readonly seed: number;
}

export type StudioProceduralArtisticBrushProbeResult =
  | Readonly<{
      available: true;
      message?: string;
    }>
  | Readonly<{
      available: false;
      message: string;
    }>;

export interface StudioProceduralArtisticBrushGenerateResult {
  readonly message?: string;
}

export interface StudioProceduralArtisticBrushControllerProps {
  readonly disabled?: boolean;
  readonly reason?: string | null;
  readonly currentColor: string;
  readonly probe: (
    signal: AbortSignal,
  ) => Promise<StudioProceduralArtisticBrushProbeResult>;
  readonly generate: (
    settings: StudioProceduralArtisticBrushSettings,
    signal: AbortSignal,
  ) => Promise<StudioProceduralArtisticBrushGenerateResult | void>;
}

const DEFAULT_SETTINGS = Object.freeze({
  technique: "flow-field",
  density: 60,
  angle: 45,
  weight: 2,
  strength: 0.8,
  seed: 0x5a17_c0de,
} as const);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const FALLBACK_COLOR = "#202124";

function normalizedColor(value: string): string {
  const candidate = value.trim();
  return COLOR_PATTERN.test(candidate)
    ? candidate.toLowerCase()
    : FALLBACK_COLOR;
}

function errorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    && error.message.trim().length > 0
  ) {
    return error.message.trim().slice(0, 320);
  }
  return fallback;
}

function summaryStatus(
  capabilityStatus: "idle" | StudioProceduralArtisticBrushCapabilityStatus,
  busy: boolean,
  cancelling: boolean,
): string {
  if (cancelling) return "취소하는 중";
  if (busy) return "생성 중";
  switch (capabilityStatus) {
    case "idle":
      return "확인 전";
    case "checking":
      return "확인 중";
    case "ready":
      return "사용 가능";
    case "unavailable":
      return "사용 불가";
  }
}

export function StudioProceduralArtisticBrushController({
  disabled = false,
  reason = null,
  currentColor,
  probe,
  generate,
}: StudioProceduralArtisticBrushControllerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [technique, setTechnique] =
    useState<StudioProceduralArtisticBrushUiTechnique>(
      DEFAULT_SETTINGS.technique,
    );
  const [color, setColor] = useState(() => normalizedColor(currentColor));
  const [density, setDensity] = useState<number>(DEFAULT_SETTINGS.density);
  const [angle, setAngle] = useState<number>(DEFAULT_SETTINGS.angle);
  const [weight, setWeight] = useState<number>(DEFAULT_SETTINGS.weight);
  const [strength, setStrength] = useState<number>(DEFAULT_SETTINGS.strength);
  const [seed, setSeed] = useState<number>(DEFAULT_SETTINGS.seed);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capabilityStatus, setCapabilityStatus] =
    useState<"idle" | StudioProceduralArtisticBrushCapabilityStatus>("idle");
  const [capabilityMessage, setCapabilityMessage] = useState<string | null>(
    null,
  );
  const probeControllerRef = useRef<AbortController | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const probeEpochRef = useRef(0);
  const generationEpochRef = useRef(0);

  useEffect(() => {
    setColor(normalizedColor(currentColor));
  }, [currentColor]);

  useEffect(() => () => {
    probeEpochRef.current += 1;
    generationEpochRef.current += 1;
    probeControllerRef.current?.abort();
    generationControllerRef.current?.abort();
    probeControllerRef.current = null;
    generationControllerRef.current = null;
  }, []);

  const beginProbe = (): void => {
    probeControllerRef.current?.abort();
    const controller = new AbortController();
    const epoch = probeEpochRef.current + 1;
    probeEpochRef.current = epoch;
    probeControllerRef.current = controller;
    setCapabilityStatus("checking");
    setCapabilityMessage(null);
    setError(null);
    setMessage(null);
    void probe(controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted
          || epoch !== probeEpochRef.current
        ) return;
        setCapabilityStatus(result.available ? "ready" : "unavailable");
        setCapabilityMessage(
          result.message
            ?? (result.available
              ? "전용 GPU Worker를 사용할 수 있습니다."
              : "전용 GPU Worker를 사용할 수 없습니다."),
        );
      })
      .catch((probeError: unknown) => {
        if (
          controller.signal.aborted
          || epoch !== probeEpochRef.current
        ) return;
        setCapabilityStatus("unavailable");
        const nextError = errorMessage(
          probeError,
          "렌더링 기능을 확인하지 못했습니다.",
        );
        setCapabilityMessage(nextError);
        setError(nextError);
      })
      .finally(() => {
        if (probeControllerRef.current === controller) {
          probeControllerRef.current = null;
        }
      });
  };

  const cancelGeneration = (): void => {
    const controller = generationControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    generationEpochRef.current += 1;
    controller.abort();
    setCancelling(true);
    setError(null);
    setMessage("절차적 질감 생성을 취소하는 중입니다.");
  };

  const closeController = (): void => {
    probeEpochRef.current += 1;
    probeControllerRef.current?.abort();
    probeControllerRef.current = null;
    if (generationControllerRef.current) cancelGeneration();
    setCapabilityStatus("idle");
    setCapabilityMessage(null);
    setOpen(false);
  };

  const generateTexture = (): void => {
    if (
      disabled
      || busy
      || cancelling
      || capabilityStatus !== "ready"
      || generationControllerRef.current
    ) return;
    const controller = new AbortController();
    const epoch = generationEpochRef.current + 1;
    generationEpochRef.current = epoch;
    generationControllerRef.current = controller;
    setBusy(true);
    setCancelling(false);
    setError(null);
    setMessage(null);
    const settings: StudioProceduralArtisticBrushSettings = Object.freeze({
      technique,
      color,
      density,
      angle,
      weight,
      strength,
      seed,
    });
    void generate(settings, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted
          || epoch !== generationEpochRef.current
        ) return;
        setMessage(
          result?.message
            ?? "절차적 질감을 새 래스터 레이어에 추가했습니다.",
        );
      })
      .catch((generationError: unknown) => {
        if (
          controller.signal.aborted
          || epoch !== generationEpochRef.current
        ) return;
        setError(errorMessage(
          generationError,
          "절차적 질감을 생성하지 못했습니다.",
        ));
      })
      .finally(() => {
        if (generationControllerRef.current === controller) {
          generationControllerRef.current = null;
          setBusy(false);
          setCancelling(false);
          if (controller.signal.aborted) {
            setMessage("절차적 질감 생성을 취소했습니다.");
          }
        }
      });
  };

  return (
    <details
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setOpen(true);
          if (!open || capabilityStatus === "idle") beginProbe();
        } else if (open) {
          closeController();
        }
      }}
      data-studio-procedural-artistic-brush-controller="true"
      className="rounded-lg border border-line/65 bg-panel/30"
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-left",
          "transition-colors hover:bg-raised/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent-soft/40 text-accent"
        >
          <Sparkles size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-fg">
            절차적 질감 생성기
          </span>
          <span className="block truncate text-[0.6rem] text-fg-3">
            흐름장 · 해칭 · 매스 · 수채 채움 · 플랫 워시
          </span>
        </span>
        <span
          role="status"
          aria-live="polite"
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[0.56rem] font-semibold",
            capabilityStatus === "ready" && !busy
              ? "border-good/30 bg-good/10 text-good"
              : capabilityStatus === "unavailable"
                ? "border-warn/35 bg-warn/10 text-warn"
                : "border-line bg-card text-fg-3",
          )}
        >
          {busy || capabilityStatus === "checking" ? (
            <LoaderCircle
              size={10}
              className="mr-1 inline animate-spin"
              aria-hidden
            />
          ) : null}
          {summaryStatus(capabilityStatus, busy, cancelling)}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "shrink-0 text-fg-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </summary>

      {open ? (
        <div className="border-t border-line/55 p-2">
          <StudioProceduralArtisticBrushPanel
            technique={technique}
            color={color}
            density={density}
            angle={angle}
            weight={weight}
            strength={strength}
            seed={seed}
            busy={busy}
            error={error}
            capabilityStatus={
              capabilityStatus === "idle"
                ? "checking"
                : capabilityStatus
            }
            capabilityMessage={
              cancelling
                ? "렌더링 자원을 정리하며 취소하는 중입니다."
                : capabilityMessage
            }
            disabled={disabled}
            disabledReason={reason}
            onTechniqueChange={setTechnique}
            onColorChange={setColor}
            onDensityChange={setDensity}
            onAngleChange={setAngle}
            onWeightChange={setWeight}
            onStrengthChange={setStrength}
            onSeedChange={setSeed}
            onGenerate={generateTexture}
            onCancel={cancelGeneration}
          />
          {message ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-2 rounded-lg border border-good/30 bg-good/10 px-2.5 py-2 text-[0.66rem] leading-relaxed text-fg-2"
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
