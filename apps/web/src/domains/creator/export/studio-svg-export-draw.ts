import {
  DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
  isStudioDynamicBrushCausalDepositPipeline,
  normalizeStudioBrushDynamicsSettings,
  planStudioDynamicBrushDabs,
  resolveStudioCapturedBrushDynamicsPresetId,
  studioDynamicBrushDepositPipelineUsesContinuation,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
  studioBrushDynamicsSeedFromKey,
  type StudioDynamicBrushDab,
} from "../brush/studio-brush-dynamics";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET,
} from "../brush/studio-brush-render-budget";
import {
  studioBrushSymmetryTransforms,
  studioDynamicBrushDabVariationsFromTransforms,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";
import {
  resolveStudioDynamicBrushMaterialIdentity,
} from "../brush/studio-dry-media-dynamic-bridge";
import {
  resolveStudioPaperBrushMedium,
  resolveStudioPaperBrushResponse,
} from "../brush/studio-paper-brush-response";
import {
  resolveStudioDocumentPaperSurface,
  studioPaperGranulationIsActive,
} from "../brush/studio-paper-granulation-runtime";
import {
  normalizeStudioPaperSubstrateModel,
  studioPaperUsesContactTooth,
} from "../brush/studio-paper-substrate-model";
import { isStudioBoundedFlowPaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  effectiveCornerRadius,
  lineArrowHeadGeoms,
  normalizeShapeParams,
  normalizeStrokeStyle,
  polygonPathPointsInBounds,
  starPathPoints,
  strokeDashArray,
} from "../brush/studio-stroke-shapes";
import {
  planStudioCausalDynamicBrushDepositsV2,
  planStudioCausalDynamicBrushDepositSegmentsV3,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
} from "../studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  resolveStudioDynamicBrushCoverageBudgetContract,
  type StudioDynamicBrushCoverageMark,
  type StudioDynamicBrushSegmentedDabVariation,
} from "../studio-dynamic-brush-coverage-renderer";
import { studioSketchStyleOfElement } from "../studio-rough-shape";
import { buildStudioRoughSvgParityPlan } from "../studio-rough-svg-parity";
import { planStudioWebDrawingKitOwnedDabs } from "../studio-web-drawing-stroke-bridge";

import { serializeStudioR8DynamicCoverageMarks } from "./studio-svg-export-coverage";
import { addSkip, resolveDrawFill } from "./studio-svg-export-defs";
import { serializeFreehand } from "./studio-svg-export-freehand";
import {
  att,
  drawBounds,
  escapeXml,
  fmt,
  getSymmetricPoints,
  pointsAttr,
  pointsToPathD,
} from "./studio-svg-export-geometry";

import type { ExportCtx, SvgDrawElLike } from "./studio-svg-export-types";

export function svgSegmentedDynamicDabCount(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
): number {
  return segments.reduce((count, segment) => count + segment.length, 0);
}

/**
 * Retains immutable causal-v3 continuation segments. An accepted prefix shares every complete
 * segment and allocates only the one boundary slice instead of flattening and slicing the full
 * stroke before SVG planning.
 */
export function svgSegmentedDynamicDabPrefix(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  maximumDabs: number,
): readonly (readonly StudioDynamicBrushDab[])[] {
  const accepted: Array<readonly StudioDynamicBrushDab[]> = [];
  let remaining = Math.max(0, Math.floor(maximumDabs));
  for (const segment of segments) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      accepted.push(segment);
      remaining -= segment.length;
      continue;
    }
    accepted.push(segment.slice(0, remaining));
    remaining = 0;
  }
  return accepted;
}

/**
 * Produces variation-major segment sequences in the same affine order as getSymmetricPoints.
 * Coverage consumes the nested arrays directly, preserving the historical mark/SVG byte order
 * without a second whole-stroke dab array.
 */
export function svgSegmentedDynamicDabVariations(
  segments: readonly (readonly StudioDynamicBrushDab[])[],
  transforms: readonly StudioBrushSymmetryTransform[],
): readonly StudioDynamicBrushSegmentedDabVariation[] {
  const variationSegments = transforms.map(
    () => [] as Array<readonly StudioDynamicBrushDab[]>,
  );
  for (const segment of segments) {
    const transformed =
      studioDynamicBrushDabVariationsFromTransforms(segment, transforms);
    for (
      let variationIndex = 0;
      variationIndex < transformed.length;
      variationIndex += 1
    ) {
      variationSegments[variationIndex]!.push(transformed[variationIndex]!);
    }
  }
  return variationSegments.map((transformedSegments) => ({
    kind: "studio-dynamic-brush-segmented-dab-variation",
    segments: transformedSegments,
  }));
}

export function serializeDraw(ctx: ExportCtx, el: SvgDrawElLike): string {
  if (el.mode === "eraser") {
    addSkip(ctx, el, "skipped", "지우개 자국은 벡터로 재현할 수 없어 제외했어요.");
    return "";
  }
  const kind = el.kind ?? "freehand";
  const opacity = el.opacity ?? 1;
  const stroke = el.stroke;
  const strokeWidth = Math.max(1, el.strokeWidth);
  const strokeStyle = normalizeStrokeStyle(el.strokeStyle);
  const shapeParams = normalizeShapeParams(el.shapeParams);
  const dash = strokeDashArray(strokeStyle.dash, strokeWidth);
  const dashAttr = dash ? att("stroke-dasharray", dash.map(fmt).join(" ")) : "";
  const opacityAttr = opacity !== 1 ? att("opacity", opacity) : "";
  const strokeAttrs = `${att("stroke", stroke)}${att("stroke-width", strokeWidth)}`;
  const sketchStyle = kind !== "freehand"
    ? studioSketchStyleOfElement(el)
    : null;

  const variations = getSymmetricPoints(el.points, el.symmetry);
  // Same captured resolver as StudioDrawNode — one shared engine decision keeps the durable SVG
  // output and the Canvas replay on the same branch (no SVG-only fallback may widen this set).
  const dynamicBrushId = kind === "freehand"
    ? resolveStudioCapturedBrushDynamicsPresetId(el)
    : null;
  // Plan randomness exactly once in the original stroke coordinate space. Symmetry then transforms
  // the complete dab (source station, scatter offset and elliptical axis) just like Canvas does.
  let dynamicPlanFailed = false;
  const dynamicPlan = dynamicBrushId
    ? (() => {
        const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
          el.brush ?? dynamicBrushId,
          el.brushCatalogId,
        ) ?? resolveStudioDynamicBrushMaterialIdentity(dynamicBrushId)!;
        const sourceDynamics = normalizeStudioBrushDynamicsSettings(
          // Replay fail-safe shared with the canvas planner: an element that stored no snapshot
          // must not inherit today's dry-media kernel pin, or the same document renders through
          // the union carrier on screen and the kernel engine in an export.
          el.brushDynamics
            ?? studioReplaySafeBrushDynamicsSettingsForBrushId(el.brush)
            ?? studioReplaySafeBrushDynamicsSettingsForBrushId(dynamicBrushId)
        );
        const seed = studioBrushDynamicsSeedFromKey(
          `${el.id}:${sourceDynamics.seed}`,
        );
        // Match the renderer-neutral retained/live planner exactly. The document owns the selected
        // stroke width and each stroke owns its hashed seed; a catalogue snapshot is only the
        // immutable source profile. Leaving either value on the source snapshot made SVG texture
        // geometry diverge from the pointer-up Canvas replay.
        const dynamics = normalizeStudioBrushDynamicsSettings({
          ...sourceDynamics,
          seed,
          width: { ...sourceDynamics.width, base: strokeWidth },
        });
        const dabPlanInput = {
          points: el.points,
          pressures: el.pressures,
          tangentialPressures: el.tangentialPressures,
          speeds: el.speeds,
          tiltXs: el.tiltXs,
          tiltYs: el.tiltYs,
          twists: el.twists,
          baseWidth: strokeWidth,
          baseOpacity: dynamics.opacity.base,
          settings: dynamics,
          seed,
        };
        const kitPlanInput = {
          brushId: el.brush,
          points: dabPlanInput.points,
          pressures: dabPlanInput.pressures,
          baseWidth: dabPlanInput.baseWidth,
          baseOpacity: dabPlanInput.baseOpacity,
          seed: dabPlanInput.seed,
          centerX: el.symmetry?.centerX,
          centerY: el.symmetry?.centerY,
        };
        const webKitDabs = planStudioWebDrawingKitOwnedDabs(
          { ...kitPlanInput, maxDabs: DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS },
          dynamics,
        );
        let usesCausalDepositPlan = false;
        const usesContinuation =
          studioDynamicBrushDepositPipelineUsesContinuation(dynamics.depositPipeline);
        let causalDepositPlan:
          | ReturnType<typeof planStudioCausalDynamicBrushDepositSegmentsV3>
          | ReturnType<typeof planStudioCausalDynamicBrushDepositsV2>
          | null = null;
        let continuationPlan:
          | ReturnType<typeof planStudioCausalDynamicBrushDepositSegmentsV3>
          | null = null;
        if (webKitDabs === null) {
          usesCausalDepositPlan = isStudioDynamicBrushCausalDepositPipeline(
            dynamics.depositPipeline,
          );
          causalDepositPlan = usesCausalDepositPlan && !usesContinuation
            ? planStudioCausalDynamicBrushDepositsV2({
                points: el.points,
                pressures: el.pressures,
                tangentialPressures: el.tangentialPressures,
                speeds: el.speeds,
                tiltXs: el.tiltXs,
                tiltYs: el.tiltYs,
                twists: el.twists,
                settings: dynamics,
                maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
              })
            : null;
          continuationPlan = usesContinuation
            ? planStudioCausalDynamicBrushDepositSegmentsV3({
                points: el.points,
                pressures: el.pressures,
                tangentialPressures: el.tangentialPressures,
                speeds: el.speeds,
                tiltXs: el.tiltXs,
                tiltYs: el.tiltYs,
                twists: el.twists,
                settings: dynamics,
              })
            : null;
        }
        if (
          (causalDepositPlan && !causalDepositPlan.ok)
          || (continuationPlan && !continuationPlan.ok)
        ) {
          dynamicPlanFailed = true;
          return null;
        }
        let continuationSegments:
          | readonly (readonly StudioDynamicBrushDab[])[]
          | null = continuationPlan?.ok
            ? continuationPlan.segments.map((segment) => segment.dabs)
            : null;
        let baseDabs: readonly StudioDynamicBrushDab[] = webKitDabs === null
          ? continuationSegments
            ? []
            : causalDepositPlan?.ok
              ? [...causalDepositPlan.dabs]
              : planStudioDynamicBrushDabs({
                  ...dabPlanInput,
                  maxDabs: DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
                })
          : webKitDabs;
        const baseDabCount = continuationSegments
          ? svgSegmentedDynamicDabCount(continuationSegments)
          : baseDabs.length;
        const markBudget = usesCausalDepositPlan
          ? usesContinuation
            ? STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET
            : STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET
          : STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET;
        const coverageBudget = resolveStudioDynamicBrushCoverageBudgetContract(
          materialIdentity,
          dynamics,
        );
        const renderBudget = planStudioDynamicBrushRenderBudget({
          settings: coverageBudget.settings,
          dabCount: baseDabCount,
          symmetryCount: variations.length,
          materialMarkMultiplier: coverageBudget.materialMarkMultiplier,
          markBudget,
        });
        if (
          usesCausalDepositPlan
          && renderBudget.maxDabsPerVariation < baseDabCount
        ) {
          // Preserve the same accepted-prefix-v1 receipt used by the live and retained renderers.
          // Skipping the element here would turn a bounded pathological stroke into an empty SVG.
          if (continuationSegments) {
            continuationSegments = svgSegmentedDynamicDabPrefix(
              continuationSegments,
              renderBudget.maxDabsPerVariation,
            );
          } else {
            baseDabs = baseDabs.slice(0, renderBudget.maxDabsPerVariation);
          }
        }
        if (
          !usesCausalDepositPlan
          && renderBudget.maxDabsPerVariation < baseDabCount
        ) {
          if (webKitDabs !== null) {
            baseDabs = planStudioWebDrawingKitOwnedDabs(
              { ...kitPlanInput, maxDabs: renderBudget.maxDabsPerVariation },
              dynamics,
            ) ?? webKitDabs.slice(0, renderBudget.maxDabsPerVariation);
          } else {
            baseDabs = planStudioDynamicBrushDabs({
              ...dabPlanInput,
              maxDabs: renderBudget.maxDabsPerVariation,
            });
          }
        }
        const symmetryTransforms = studioBrushSymmetryTransforms(el.symmetry);
        const ordinaryDabVariations =
          studioDynamicBrushDabVariationsFromTransforms(
            baseDabs,
            symmetryTransforms,
          );
        const dabVariations = continuationSegments
          ? null
          : ordinaryDabVariations;
        const coverageDabVariations = continuationSegments
          ? svgSegmentedDynamicDabVariations(
              continuationSegments,
              symmetryTransforms,
            )
          : ordinaryDabVariations;
        // Causal-v3 serializes exact coverage marks below; keeping this null prevents a hidden
        // whole-stroke flatten merely to satisfy the legacy fallback parameter.
        let causalCoverageMarksByVariation:
          readonly (readonly StudioDynamicBrushCoverageMark[])[] | null = null;
        let r8CoverageMarkupByVariation: readonly string[] | null = null;
        const streamsR8Grain = dynamics.grain.amount > 0
          && dynamics.grain.source !== undefined;
        if (streamsR8Grain) {
          r8CoverageMarkupByVariation = serializeStudioR8DynamicCoverageMarks(
            ctx,
            {
              dabVariations: coverageDabVariations,
              dynamics,
              materialIdentity,
              dynamicSeed: seed,
              stroke,
              markBudget,
            },
            opacity,
            isStudioBoundedFlowPaintModelCompatible(el),
          );
          if (!r8CoverageMarkupByVariation) {
            dynamicPlanFailed = true;
            return null;
          }
        } else if (
          usesCausalDepositPlan
          || materialIdentity.dryMediaPresetId !== null
        ) {
          // Canvas(`studio-dynamic-brush-render-plan`)와 **같은 순서로 같은 값**을 해석한다.
          // 획이 들고 있는 키만 읽으므로, 키 없는 획의 SVG는 예전과 비트 단위로 같다.
          const paperModel = normalizeStudioPaperSubstrateModel(el.paperModel);
          const paperMedium = studioPaperUsesContactTooth(paperModel)
            ? resolveStudioPaperBrushMedium(el.brush)
            : null;
          const paperResponse = resolveStudioPaperBrushResponse(
            el.brush,
            undefined,
            paperModel === undefined
              ? undefined
              : { model: paperModel, medium: paperMedium },
          );
          const sharedCoverageInput = {
            dynamics,
            materialIdentity,
            dynamicSeed: seed,
            stroke,
            stampGrid: renderBudget.stampGrid,
            markBudget,
            // SVG는 Canvas와 같은 마크를 직렬화해야 하므로 종이 결도 같은 입력으로 받는다.
            ...(studioPaperGranulationIsActive(paperResponse)
              ? {
                  paper: {
                    response: paperResponse,
                    surface: resolveStudioDocumentPaperSurface(),
                    ...(paperModel ? { model: paperModel } : {}),
                    ...(paperMedium ? { medium: paperMedium } : {}),
                  },
                }
              : {}),
          };
          const completeCoverage = planStudioDynamicBrushCoverageAndLegacyMarks({
            ...sharedCoverageInput,
            dabVariations: coverageDabVariations,
          }).coveragePlan;
          if (!completeCoverage.ok) {
            dynamicPlanFailed = true;
            return null;
          }

          let completeOffset = 0;
          const partitions: (readonly StudioDynamicBrushCoverageMark[])[] = [];
          for (const dabs of coverageDabVariations) {
            const variationCoverage = planStudioDynamicBrushCoverageAndLegacyMarks({
              ...sharedCoverageInput,
              dabVariations: [dabs],
            }).coveragePlan;
            if (!variationCoverage.ok) {
              dynamicPlanFailed = true;
              return null;
            }
            const partitionEnd = completeOffset + variationCoverage.marks.length;
            partitions.push(completeCoverage.marks.slice(
              completeOffset,
              partitionEnd,
            ));
            completeOffset = partitionEnd;
          }
          if (completeOffset !== completeCoverage.marks.length) {
            // 리테인드 Canvas는 completeCoverage.marks를 그대로 그린다. 변주별 재계획은 그
            // 마크 배열을 variation 경계로 자르기 위한 자 역할일 뿐이라, 두 계획의 총 마크
            // 수가 어긋나면 결정성 어딘가가 이미 깨진 것이다. 그때 변주별 계획을 조용히
            // 직렬화하면 SVG가 Canvas와 다른 지오메트리를 내보내므로(비등가 조용한 폴백 금지
            // — studio-brush-backend-quality-policy의 cross-engine 폴백 계약과 동일 원칙)
            // skip 영수증을 남기고 fail-closed 한다.
            dynamicPlanFailed = true;
            return null;
          }
          causalCoverageMarksByVariation = partitions;
        }
        return {
          dynamics,
          materialIdentity,
          seed,
          renderBudget,
          dabVariations,
          causalCoverageMarksByVariation,
          r8CoverageMarkupByVariation,
        };
      })()
    : null;
  if (dynamicBrushId && (dynamicPlanFailed || !dynamicPlan)) {
    addSkip(
      ctx,
      el,
      "skipped",
      "동적 브러시의 causal deposit 계획을 안전하게 생성하지 못해 SVG에서 제외했어요.",
    );
    return "";
  }
  const dynamicDabVariations = dynamicPlan?.dabVariations ?? null;
  const parts: string[] = [];
  for (const [variationIndex, points] of variations.entries()) {
    if (kind !== "freehand" && sketchStyle?.enabled) {
      const roughPlan = buildStudioRoughSvgParityPlan({
        elementId: el.id,
        variationIndex,
        kind,
        points,
        strokeWidth,
        hasFill: Boolean(el.fill),
        shapeParams,
        style: sketchStyle,
      });
      if (roughPlan.paths.length > 0) {
        const roughPaths = roughPlan.paths.map((path) => {
          const data = escapeXml(path.data);
          if (path.role === "outline") {
            return (
              `<path d="${data}" data-rough-role="${path.role}" fill="none" stroke="${escapeXml(stroke)}"` +
              ` stroke-width="${fmt(path.strokeWidth)}"${dashAttr}` +
              ` stroke-linecap="${strokeStyle.lineCap}" stroke-linejoin="round"/>`
            );
          }
          if (path.role === "fill-hatch") {
            return (
              `<path d="${data}" data-rough-role="${path.role}" fill="none" stroke="${escapeXml(el.fill ?? "none")}"` +
              ` stroke-width="${fmt(path.strokeWidth)}"` +
              ` stroke-linecap="round" stroke-linejoin="round"/>`
            );
          }
          return (
            `<path d="${data}" data-rough-role="${path.role}" fill="${escapeXml(
              path.role === "outline-fill" ? stroke : (el.fill ?? "none"),
            )}"/>`
          );
        });
        const lineHeads = kind === "line"
          ? lineArrowHeadGeoms(points, strokeStyle, strokeWidth).map((head) =>
              head.kind === "dot"
                ? (
                    `<circle cx="${fmt(head.cx)}" cy="${fmt(head.cy)}"` +
                    ` r="${fmt(head.r)}" fill="${escapeXml(stroke)}"/>`
                  )
                : (
                    `<path d="${pointsToPathD(head.points, true)}"` +
                    ` fill="${escapeXml(stroke)}" stroke-linejoin="round"/>`
                  )
            )
          : [];
        parts.push(
          `<g data-studio-rough-shape="v1" data-rough-seed="${roughPlan.seed}"${opacityAttr}>` +
            roughPaths.join("") +
            lineHeads.join("") +
          `</g>`,
        );
        continue;
      }
    }
    if (kind === "rect") {
      const box = drawBounds(points);
      const w = Math.max(0.1, box.width);
      const h = Math.max(0.1, box.height);
      const fill = resolveDrawFill(ctx, el, { x: box.x, y: box.y }, { x: 0, y: 0, width: w, height: h });
      const rx = effectiveCornerRadius(box.width, box.height, shapeParams.cornerRadius);
      parts.push(
        `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(w)}" height="${fmt(h)}"${rx > 0 ? att("rx", rx) : ""} fill="${escapeXml(fill)}"${strokeAttrs}${dashAttr} stroke-linejoin="round"${opacityAttr}/>`
      );
    } else if (kind === "ellipse") {
      const box = drawBounds(points);
      const w = Math.max(0.1, box.width);
      const h = Math.max(0.1, box.height);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const fill = resolveDrawFill(ctx, el, { x: cx, y: cy }, { x: -box.width / 2, y: -box.height / 2, width: w, height: h });
      parts.push(
        `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}" fill="${escapeXml(fill)}"${strokeAttrs}${dashAttr}${opacityAttr}/>`
      );
    } else if (kind === "star" || kind === "triangle" || kind === "polygon") {
      const box = drawBounds(points);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const m = Math.max(0.1, Math.min(box.width, box.height));
      // 캔버스 규약: 그라데이션은 별에만(triangle/polygon 은 패턴·단색만) — 동일하게 반영.
      const gradientBBox = kind === "star" ? { x: -m / 2, y: -m / 2, width: m, height: m } : null;
      const fill = resolveDrawFill(ctx, el, { x: cx, y: cy }, gradientBBox);
      const pts =
        kind === "star"
          ? starPathPoints(cx, cy, m / 2, shapeParams)
          : polygonPathPointsInBounds(
              box.x,
              box.y,
              box.width,
              box.height,
              kind === "triangle" ? 3 : shapeParams.polygonSides
            );
      parts.push(
        `<polygon points="${pointsAttr(pts)}" fill="${escapeXml(fill)}"${strokeAttrs}${dashAttr} stroke-linejoin="round"${opacityAttr}/>`
      );
    } else if (kind === "line") {
      const heads = lineArrowHeadGeoms(points, strokeStyle, strokeWidth)
        .map((head) =>
          head.kind === "dot"
            ? `<circle cx="${fmt(head.cx)}" cy="${fmt(head.cy)}" r="${fmt(head.r)}" fill="${escapeXml(stroke)}"/>`
            : `<path d="${pointsToPathD(head.points, true)}" fill="${escapeXml(stroke)}" stroke-linejoin="round"/>`
        )
        .join("");
      parts.push(
        `<g${opacityAttr}><path d="${pointsToPathD(points)}" fill="none"${strokeAttrs}${dashAttr} stroke-linecap="${strokeStyle.lineCap}" stroke-linejoin="round"/>${heads}</g>`
      );
    } else if (kind === "arrow") {
      // Konva Arrow 재현 — 몸통 폴리라인 + 끝점 삼각 화살촉(굵기 비례, 화살촉은 점선 미적용).
      const pointer = Math.max(8, strokeWidth * 2);
      let head = "";
      if (points.length >= 4) {
        const xe = points[points.length - 2];
        const ye = points[points.length - 1];
        const angle = Math.atan2(ye - points[points.length - 3], xe - points[points.length - 4]);
        const bx = xe - pointer * Math.cos(angle);
        const by = ye - pointer * Math.sin(angle);
        const px = (pointer / 2) * Math.cos(angle + Math.PI / 2);
        const py = (pointer / 2) * Math.sin(angle + Math.PI / 2);
        head = `<path d="${pointsToPathD([xe, ye, bx + px, by + py, bx - px, by - py], true)}" fill="${escapeXml(stroke)}"${strokeAttrs}/>`;
      }
      parts.push(
        `<g${opacityAttr}><path d="${pointsToPathD(points)}" fill="none"${strokeAttrs}${dashAttr} stroke-linecap="${strokeStyle.lineCap}"/>${head}</g>`
      );
    } else {
      const r8CoverageMarkup =
        dynamicPlan?.r8CoverageMarkupByVariation?.[variationIndex];
      parts.push(r8CoverageMarkup ?? serializeFreehand(
          ctx,
          el,
          points,
          stroke,
          strokeWidth,
          opacityAttr,
          opacity,
          dynamicDabVariations?.[variationIndex],
          dynamicPlan?.dynamics,
          dynamicPlan?.seed,
          dynamicPlan?.renderBudget.stampGrid,
          dynamicPlan?.causalCoverageMarksByVariation?.[variationIndex],
          dynamicPlan?.materialIdentity,
        ));
    }
  }
  return parts.join("");
}
