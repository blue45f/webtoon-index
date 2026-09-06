/**
 * Pure stroke-start planning boundary for Studio pointer input.
 *
 * The Page owns gesture priority, collaboration leases, pointer capture, CRDT publication, React
 * state, and live-surface I/O. This leaf only snapshots one contact's immutable brush contract and
 * creates the first serializable draw element. Keeping those decisions together prevents the
 * pointer-move and replay pipelines from seeing a partially configured stroke.
 */

import { resolveStudioHybridPressureSample } from "../hybrid-dcc/studio-hybrid-pressure-profile";
import {
  normalizeCalligraphyStylusInput,
  resolveBrushPressureSample,
  resolveStudioBrushPresetOperation,
  resolveStudioBrushRenderFamily,
  strokeSampleDistanceForBrushFamily,
  strokeSampleDistanceForScale,
  type NormalizedCalligraphyStylusInput,
} from "../studio-brush";
import { normalizeStudioBrushCatalogIdentityMetadata, type DrawEl } from "../studio-element-model";
import {
  resolveStudioCausalInkInputPlan,
  type StudioCausalInkInputPlan,
} from "../studio-fixed-rate-input-eligibility";
import {
  quantizeFixedRateStrokeSample,
  type FixedRateStrokeQuantizedSample,
} from "../studio-fixed-rate-stroke-filter";
import { captureStudioOutlineStrokeContractV1 } from "../studio-outline-stroke-contract";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "../studio-pixel-pencil";

import { isStudioBrushEraserAliasId } from "./studio-brush-alias-profile";
import { resolveStudioBrushDynamicsSelectionPresetId } from "./studio-brush-dynamics";
import { resolveStudioStrokeSymmetry } from "./studio-brush-intrinsic-symmetry";
import {
  resolveStudioStampBrushKind,
  type StudioStampBrushTuning,
} from "./studio-brush-stamp-engine";
import { resolveStudioCalligraphyAuthoringTip } from "./studio-calligraphy-nib-profile";
import { captureStudioDrawPointerPressureContract } from "./studio-draw-pointer-pressure-contract";
import { captureStudioPointerStartInkChannels } from "./studio-draw-pointer-start-ink-channels";
import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
} from "./studio-ink-pressure-model";
import { isStudioInkwashFluidBrush } from "./studio-inkwash-fluid-brushes";
import { resolveStudioPaperBrushMedium } from "./studio-paper-brush-response";
import { STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2 } from "./studio-paper-substrate-model";
import {
  STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
  STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
  isStudioBoundedFlowSymmetryCompatible,
} from "./studio-stroke-paint-model";

import type { StudioBrushEngineProgramSet } from "./studio-brush-engine-program-set";
import type { DrawMode, DrawShapeKind } from "../studio-editor-tool-model";
import type { StudioStabilizerMode } from "./studio-stroke-stabilizer";

export interface StudioDrawPointerStartSample {
  readonly pointerType?: unknown;
  readonly pressure?: unknown;
  readonly tiltX?: unknown;
  readonly tiltY?: unknown;
  readonly twist?: unknown;
  readonly tangentialPressure?: unknown;
  readonly altitudeAngle?: unknown;
  readonly azimuthAngle?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly timeStamp: number;
}

export interface StudioDrawPointerStartInput {
  readonly id: string;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly pointer: StudioDrawPointerStartSample;
  readonly drawMode: DrawMode;
  readonly drawShape: DrawShapeKind;
  readonly shapeFill: boolean;
  readonly color: string;
  readonly strokeWidth: number;
  readonly brushOpacity: number;
  readonly brush: string;
  readonly brushCatalogId?: unknown;
  readonly brushCatalogName?: unknown;
  readonly stampTuning?: StudioStampBrushTuning | null;
  readonly brushDynamics?: unknown;
  /**
   * 사용자가 고른 엔진 조합. 프리셋 기본 조합이면 null 이 오고, 그때는 이 키를 아예 싣지 않는다 —
   * 출하 브러시의 획이 프리셋과 바이트 단위로 같은 플랜을 유지하는 경로가 '키 없음'이다.
   */
  readonly brushEnginePrograms?: StudioBrushEngineProgramSet | null;
  readonly stabilizer: number;
  readonly stabilizerMode: StudioStabilizerMode;
  readonly velocitySensitivity: number;
  readonly pressureCurve: number;
  /** CSP min size ratio (0..1) for residual pen/marker pressure floor. */
  readonly pressureMinSize?: number;
  readonly positionScale: number;
  readonly brushTip: Readonly<{
    tiltEnabled: boolean;
    angleDeg: number;
    roundness: number;
  }>;
  readonly symmetry: Readonly<{
    type: NonNullable<DrawEl["symmetry"]>["type"];
    centerX: number;
    centerY: number;
    radialCount: number;
  }>;
}

export interface StudioDrawPointerStartPlan {
  readonly element: DrawEl;
  readonly strokeOrigin: Readonly<{ x: number; y: number }>;
  readonly pressure: number;
  readonly stylus: NormalizedCalligraphyStylusInput;
  readonly causalInitialSample: FixedRateStrokeQuantizedSample | null;
  readonly causalInputPlan: StudioCausalInkInputPlan;
  readonly capturePointerDynamics: boolean;
}

/** Builds one immutable stroke-start snapshot without touching browser, renderer, or app state. */
export function planStudioDrawPointerStart(
  input: StudioDrawPointerStartInput
): StudioDrawPointerStartPlan {
  const {
    brush,
    brushOpacity,
    brushTip,
    color,
    drawMode,
    drawShape,
    pointer,
    position,
    positionScale,
    shapeFill,
    stampTuning,
    brushEnginePrograms,
    strokeWidth,
    symmetry,
  } = input;
  const brushFamily = resolveStudioBrushRenderFamily(brush);
  const namedEraser =
    drawMode === "eraser" && resolveStudioBrushPresetOperation(brush) === "erase";
  const lowDensityEraser = namedEraser && isStudioBrushEraserAliasId(brush);
  const stampKind = drawMode === "pen" ? resolveStudioStampBrushKind(brush) : null;
  // Eraser/pixel input contracts do not carry the currently selected pen's whole-stroke dynamics.
  // Letting that unrelated brush id affect eligibility sent the eraser through the slower legacy
  // stabilizer whenever an artist happened to switch from a dynamics brush.
  const inkwashFluidStroke = drawMode === "pen" && isStudioInkwashFluidBrush(brush);
  // Listed InkWash fluid presets skip dab dynamics so pointer-start opts into the wet/fluid runtime.
  const hasBrushDynamics = drawMode === "pen"
    && !inkwashFluidStroke
    && resolveStudioBrushDynamicsSelectionPresetId(brush, input.brushDynamics) !== null;
  const causalWatercolor = drawMode === "pen"
    && brushFamily === "watercolor"
    && !hasBrushDynamics;
  const causalInputPlan = resolveStudioCausalInkInputPlan({
    stabilizerMode: input.stabilizerMode,
    stabilizerStrength: input.stabilizer,
    drawMode,
    brushFamily,
    hasBrushDynamics,
    causalStampV2: stampKind !== null,
    causalWatercolorV2: causalWatercolor,
  });
  const linearPressureEligible =
    drawMode === "eraser"
    || (
      drawMode === "pen"
      && (
        brushFamily === "pen"
        || brushFamily === "marker"
      )
    );
  const residualPressureEligible =
    drawMode === "pen"
    && (
      brushFamily === "pen"
      || brushFamily === "marker"
    );
  const pressureModel = linearPressureEligible
    ? residualPressureEligible
      ? STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3
      : STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1
    : undefined;
  const layeredFlowPaintEligible =
    brushOpacity < 1
    && (
      lowDensityEraser
      || (drawMode === "pen" && (brushFamily === "pen" || brushFamily === "marker"))
    )
    && !hasBrushDynamics
    && stampKind === null
    && symmetry.type === "none";
  const boundedDynamicFlowPaintEligible =
    drawMode === "pen"
    && hasBrushDynamics
    && isStudioBoundedFlowSymmetryCompatible(symmetry);
  /**
   * 이 획이 교정된 substrate로 태어나는가.
   *
   * 지우개·픽셀은 안료를 얹지 않으므로 제외하고, 종이 반응이 항등인 도구도 제외한다 —
   * 키가 붙어도 렌더가 같으므로 문서에 의미 없는 바이트만 남는다.
   */
  const contactToothSubstrateEligible =
    drawMode === "pen"
    && resolveStudioPaperBrushMedium(brush) !== null;
  const hybridPressure = (drawMode === "pen" || lowDensityEraser) && brush !== "pen"
    ? resolveStudioHybridPressureSample(brush, {
        pointerType: pointer.pointerType,
        rawPressure: pointer.pressure,
        distance: 0,
        pressureCurve: input.pressureCurve,
        velocitySensitivityScale: input.velocitySensitivity,
        // The first sample is causal: mouse/touch uses the family nominal pressure and never
        // looks ahead to a future point. Real stylus pressure still takes precedence.
        simulateVelocity: false,
      })
    : null;
  const resolvedPressure = hybridPressure?.pressure ?? resolveBrushPressureSample({
      pointerType: pointer.pointerType,
      rawPressure: pointer.pressure,
      distance: 0,
      // The first sample has no velocity. Real pen pressure still takes precedence.
      velocityFallbackEnabled: false,
      velocitySensitivity: input.velocitySensitivity,
      pressureCurve: input.pressureCurve,
      // Residual pen/marker only: stamp/dynamics own independent min floors.
      minSizeRatio: linearPressureEligible ? input.pressureMinSize : 0,
      // Versioned linear ink treats the selected size as full-pressure diameter. Specialty and
      // legacy engines retain their historical nominal-pressure contract.
      fallbackPressure: pressureModel ? 1 : 0.5,
    });
  const stylus = normalizeCalligraphyStylusInput(pointer);
  const causalInitialSample = causalInputPlan.sampleSpacing === 0
    ? quantizeFixedRateStrokeSample({
        x: position.x,
        y: position.y,
        positionScale,
        pressure: resolvedPressure,
        tiltX: stylus.tiltX,
        tiltY: stylus.tiltY,
        timeStamp: pointer.timeStamp,
      })
    : null;
  const strokeOrigin = causalInitialSample
    ? { x: causalInitialSample.x, y: causalInitialSample.y }
    : { x: position.x, y: position.y };
  const pressure = causalInitialSample?.pressure ?? resolvedPressure;
  const capturePointerDynamics = drawMode === "pen" && hasBrushDynamics;
  const captureInkSensorChannels = drawMode === "pen";
  const pressureContract = captureStudioDrawPointerPressureContract(input, capturePointerDynamics);
  const startInkChannels = captureInkSensorChannels
    ? captureStudioPointerStartInkChannels(pointer, stylus)
    : {};
  const brushCatalogIdentity = drawMode === "pen" || namedEraser
    ? normalizeStudioBrushCatalogIdentityMetadata(input)
    : {};
  // Resolved causal pressure is already persisted, including the mouse velocity fallback.
  const outlineStroke = drawMode === "pen"
    ? captureStudioOutlineStrokeContractV1({ brushId: brush, pressureSource: "recorded" })
    : null;
  const common = {
    id: input.id,
    type: "draw" as const,
    stroke: color,
    strokeWidth,
    opacity: brushOpacity,
    brush: drawMode === "pen"
      ? (brush === STUDIO_PIXEL_PENCIL_RENDER_MODE ? "pen" : brush)
      : namedEraser
        ? brush
        : drawMode === "pixel"
          ? STUDIO_PIXEL_PENCIL_RENDER_MODE
          : undefined,
    ...pressureContract,
    ...brushCatalogIdentity,
    ...(outlineStroke ? { outlineStroke } : {}),
    // Each calligraphy-family brush persists its own nib instead of inheriting the inspector's 45° tip.
    brushTip: drawMode === "pen"
      ? resolveStudioCalligraphyAuthoringTip(brush, brushTip)
      : undefined,
    ...(drawMode === "pen" && brushEnginePrograms ? { brushEnginePrograms } : {}),
    stamp: drawMode === "pen" && stampTuning && stampKind && !hasBrushDynamics ? { ...stampTuning } : undefined,
    stampPipeline: drawMode === "pen" && stampKind && !hasBrushDynamics ? "causal-walker-v2" as const : undefined,
    watercolorPipeline: causalWatercolor ? "causal-walker-v2" as const : undefined,
    symmetry: drawMode === "pixel" ? undefined : resolveStudioStrokeSymmetry(symmetry, brush),
  };
  const element: DrawEl = drawMode === "shape"
    ? {
        ...common,
        kind: drawShape,
        mode: "pen",
        points: [position.x, position.y, position.x, position.y],
        fill: shapeFill && drawShape !== "line" ? color : undefined,
        pressures: [pressure, pressure],
      }
    : {
        ...common,
        kind: "freehand",
        mode: drawMode === "eraser" ? "eraser" : "pen",
        points: [strokeOrigin.x, strokeOrigin.y],
        strokeWidth: drawMode === "pixel" ? 1 : strokeWidth,
        fill: drawMode === "lasso-fill" ? color : undefined,
        pressures: [drawMode === "pixel" ? 1 : pressure],
        pressureModel,
        // 종이를 실제로 읽는 패밀리에만 찍는다. 항등 도구(기술펜·톤·픽셀)는 키를 달아도
        // 렌더가 달라지지 않으므로 문서에 의미 없는 바이트를 남기지 않는다.
        paperModel: contactToothSubstrateEligible
          ? STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2
          : undefined,
        paintModel: boundedDynamicFlowPaintEligible
          ? STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2
          : layeredFlowPaintEligible
            ? STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1
            : undefined,
        sampleSpacing: drawMode === "pixel"
          ? 1
          : causalInputPlan.sampleSpacing
            ?? (
              drawMode === "pen"
                ? strokeSampleDistanceForBrushFamily(positionScale, brushFamily)
                : strokeSampleDistanceForScale(positionScale)
            ),
        ...startInkChannels,
      };

  return {
    element,
    strokeOrigin,
    pressure,
    stylus,
    causalInitialSample,
    causalInputPlan,
    capturePointerDynamics,
  };
}
