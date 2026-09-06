import {
  mapStudioBrushAliasPressure,
  resolveStudioBrushAliasPencilPasses,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import {
  normalizeStudioBrushDynamicsSettings,
  resolveStudioCapturedBrushDynamicsPresetId,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
  studioBrushDynamicsSeedFromKey,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "../brush/studio-brush-dynamics";
import {
  resolveNormalizedStudioBrushDabColor,
  resolveNormalizedStudioBrushGrainAlphaMultiplier,
  studioBrushGrainIsActive,
} from "../brush/studio-brush-material-dynamics";
import { resolveStudioBrushSinglePointRoute } from "../brush/studio-brush-runtime-contract";
import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  stampJitter,
  type StudioStampBrushDab,
  type StudioStampBrushStyle,
} from "../brush/studio-brush-stamp-engine";
import {
  composeStudioBrushDualTipAlphaMap,
  planNormalizedStudioBrushTipComposition,
  studioBrushDualTipUsesSolidEllipse,
} from "../brush/studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  planStudioBrushTipStampWorldSamples,
  studioBrushTipUsesSolidEllipse,
} from "../brush/studio-brush-tip-stamp";
import {
  resolveStudioInkPressure,
  studioInkFallbackPressure,
  studioInkPressureRadius,
} from "../brush/studio-ink-pressure-model";
import {
  planStudioStampInkRibbon,
  studioStampInkRibbonOptions,
} from "../brush/studio-stamp-ink-ribbon";
import { isStudioBoundedFlowPaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  resampleStrokePressures,
  resolveStudioFreehandRenderPath,
  resolveStudioBrushRenderFamily,
  strokeRenderDistance,
} from "../studio-brush";
import {
  isStudioFxPressureBrushId,
  resolveStudioFxBrushTapPressureResponse,
} from "../studio-fx-brush";
import {
  planStudioHighlighterWashTap,
  resolveStudioHighlighterWashBrushId,
  studioHighlighterWashPlanPathData,
} from "../studio-highlighter-wash-ribbon";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE,
  planStudioPerfectFreehandRender,
  type StudioPerfectFreehandRenderPlan,
} from "../studio-outline-stroke-contract";
import {
  peekStudioPerfectFreehandStroker,
} from "../studio-perfect-freehand";
import {
  isStudioPixelPencilRenderMode,
  planStudioPixelPencilCells,
} from "../studio-pixel-pencil";
import {
  resolveStudioRetainedMediaPressure,
  resolveStudioRetainedMediaPressureProfileId,
} from "../studio-retained-media-pressure";

import { serializeStudioDynamicCoverageMarks } from "./studio-svg-export-coverage";
import { addSkip } from "./studio-svg-export-defs";
import { serializeFreehandMedia } from "./studio-svg-export-freehand-media";
import {
  escapeXml,
  fmt,
  fmtDabOpacity,
  pointsToPathD,
  tensionPathD,
} from "./studio-svg-export-geometry";
import { nextId } from "./studio-svg-export-png";

import type { ExportCtx, SvgDrawElLike } from "./studio-svg-export-types";
import type { StudioDynamicBrushRenderStampGrid } from "../brush/studio-brush-render-budget";
import type { StudioDynamicBrushMaterialIdentity } from "../brush/studio-dry-media-dynamic-bridge";
import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

export function serializeStampBrushDabs(
  ctx: ExportCtx,
  style: StudioStampBrushStyle,
  dabs: readonly StudioStampBrushDab[]
): string {
  if (dabs.length === 0) return "";
  const color = escapeXml(style.color);

  if (style.kind === "ink") {
    const ribbon = planStudioStampInkRibbon(dabs, studioStampInkRibbonOptions(style));
    const path = ribbon.polygons.map((polygon) => (
      pointsToPathD(polygon.points, true)
    )).join(" ");
    const slab = `<path data-stamp-brush="ink" data-stamp-ink-ribbon="${ribbon.version}" data-stamp-ink-coverage="${ribbon.coverageOperation}" data-stamp-ink-cap="${ribbon.cap}" d="${path}" fill="${color}" fill-rule="${ribbon.fillRule}" stroke="none" opacity="${fmtDabOpacity(ribbon.opacity)}"/>`;
    // Knife edge relief — plain alpha, deliberately NOT `mix-blend-mode`. White over the slab is
    // the lit crest, the pigment itself is the shaded flank, and both composite the same way in
    // every rasteriser, so what is measured is what ships (see STUDIO_STAMP_KNIFE_RELIEF_VERSION).
    const relief = (ribbon.reliefBands ?? []).map((band) => (
      `<path data-stamp-knife-relief="${band.kind}" data-stamp-knife-relief-version="${ribbon.reliefVersion}" d="${band.runs.map((run) => pointsToPathD(run)).join(" ")}" fill="none" stroke="${band.kind === "highlight" ? "#ffffff" : color}" stroke-width="${fmt(band.lineWidth)}" stroke-linecap="butt" stroke-linejoin="round" opacity="${fmtDabOpacity(band.opacity)}"/>`
    )).join("");
    return relief ? `<g data-stamp-brush="ink-knife">${slab}${relief}</g>` : slab;
  }

  if (style.kind === "pencil") {
    const marks = dabs.map((dab) => {
      // Canvas drawDab과 같은 salt/산식 — 주 dab 1개 + 종이 그레인 2개.
      const jx = (stampJitter(dab.index, 11) - 0.5) * dab.radius * 0.5;
      const jy = (stampJitter(dab.index, 23) - 0.5) * dab.radius * 0.5;
      const primaryRadius = dab.radius * (0.82 + 0.18 * stampJitter(dab.index, 41));
      const primaryOpacity = dab.alpha * (0.7 + 0.3 * stampJitter(dab.index, 37));
      const grains = [0, 1].map((grain) => {
        const gx = dab.x + (stampJitter(dab.index, 53 + grain) - 0.5) * dab.radius * 2.4;
        const gy = dab.y + (stampJitter(dab.index, 67 + grain) - 0.5) * dab.radius * 2.4;
        return `<circle cx="${fmt(gx)}" cy="${fmt(gy)}" r="${fmt(dab.radius * 0.2)}" opacity="${fmtDabOpacity(dab.alpha * 0.45)}"/>`;
      }).join("");
      return `<circle cx="${fmt(dab.x + jx)}" cy="${fmt(dab.y + jy)}" r="${fmt(primaryRadius)}" opacity="${fmtDabOpacity(primaryOpacity)}"/>${grains}`;
    }).join("");
    return `<g data-stamp-brush="pencil" fill="${color}">${marks}</g>`;
  }

  // Canvas의 inner radius(hardness×.85)까지 단색, 바깥에서 0으로 감쇠하는 방사 팁.
  const gradientId = nextId(ctx, style.kind === "airbrush" ? "ssa" : "ssw");
  const hardStop = fmt(Math.min(1, Math.max(0, style.hardness)) * 85);
  ctx.defs.push(
    `<radialGradient id="${gradientId}" cx="50%" cy="50%" r="50%"><stop offset="${hardStop}%" stop-color="${color}"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient>`
  );
  const marks = dabs.map((dab) => {
    const fill = `<circle cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" r="${fmt(dab.radius)}" fill="url(#${gradientId})" opacity="${fmtDabOpacity(dab.alpha)}"/>`;
    if (style.kind === "airbrush") return fill;
    // 수채 웻엣지 링도 Canvas와 같은 반경·굵기·0.22 농도다.
    return `${fill}<circle cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" r="${fmt(dab.radius * 0.94)}" fill="none" stroke="${color}" stroke-width="${fmt(Math.max(0.35, dab.radius * 0.1))}" opacity="${fmtDabOpacity(dab.alpha * 0.22)}"/>`;
  }).join("");
  return `<g data-stamp-brush="${style.kind}">${marks}</g>`;
}

export function serializeStudioOutlineStrokePlan(
  ctx: ExportCtx,
  el: SvgDrawElLike,
  plan: StudioPerfectFreehandRenderPlan,
  stroke: string,
  opacityAttr: string,
): string | null {
  if (plan.kind === "legacy-contract") return null;
  if (plan.kind === "unsupported-contract") {
    addSkip(
      ctx,
      el,
      "skipped",
      `외곽선 획 계약을 지원하지 않아 제외했어요 (${plan.issue.code}).`,
    );
    return "";
  }
  if (plan.kind === "invalid-input") {
    addSkip(
      ctx,
      el,
      "skipped",
      `외곽선 획의 저장 입력이 손상되어 제외했어요 (${plan.reason}).`,
    );
    return "";
  }
  // The capsule sibling branch carries its own honest engine label; the perfect-freehand label is
  // byte-frozen ("perfect-outline-contract-v1") so pre-wave exports stay identical (2026-08-13).
  const engineLabel =
    plan.contract.engine === STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE
      ? "croquis-capsule-outline-contract-v1"
      : "perfect-outline-contract-v1";
  if (plan.kind === "outline") {
    return (
      `<path d="${plan.pathData}" fill="${escapeXml(stroke)}"`
      + ` data-brush-engine="${engineLabel}"`
      + ` data-brush-profile="${escapeXml(plan.contract.profile.id)}"${opacityAttr}/>`
    );
  }

  const line = plan.line;
  const pathData = tensionPathD(line.points, line.tension);
  const lineMarkup = pathData
    ? (
        `<path d="${pathData}" fill="none" stroke="${escapeXml(stroke)}"`
        + ` stroke-width="${fmt(line.strokeWidth)}"`
        + ' stroke-linecap="round" stroke-linejoin="round"/>'
      )
    : "";
  const capRadius = line.endpointCapRadius;
  const capMarkup: string[] = [];
  if (capRadius !== null && line.points.length >= 2) {
    const startX = line.points[0]!;
    const startY = line.points[1]!;
    capMarkup.push(
      `<circle cx="${fmt(startX)}" cy="${fmt(startY)}" r="${fmt(capRadius)}"`
      + ` fill="${escapeXml(stroke)}"/>`,
    );
    const endX = line.points[line.points.length - 2]!;
    const endY = line.points[line.points.length - 1]!;
    if (endX !== startX || endY !== startY) {
      capMarkup.push(
        `<circle cx="${fmt(endX)}" cy="${fmt(endY)}" r="${fmt(capRadius)}"`
        + ` fill="${escapeXml(stroke)}"/>`,
      );
    }
  }
  return (
    `<g data-brush-engine="${engineLabel}"`
    + ` data-brush-fallback="${plan.reason}"${opacityAttr}>`
    + `${lineMarkup}${capMarkup.join("")}</g>`
  );
}

/** 자유곡선(브러시별) — 캔버스 렌더 경로와 같은 지오메트리 소스(studio-brush)를 쓴다. */
export function serializeFreehand(
  ctx: ExportCtx,
  el: SvgDrawElLike,
  points: number[],
  stroke: string,
  strokeWidth: number,
  opacityAttr: string,
  strokeOpacity: number,
  dynamicDabs?: readonly StudioDynamicBrushDab[],
  dynamics?: NormalizedStudioBrushDynamicsSettings,
  dynamicSeed?: number,
  dynamicStampGrid: StudioDynamicBrushRenderStampGrid = 7,
  causalCoverageMarks?: readonly StudioDynamicBrushCoverageMark[],
  dynamicMaterialIdentity?: StudioDynamicBrushMaterialIdentity,
): string {
  const brush = el.brush ?? "pen";
  const brushFamily = resolveStudioBrushRenderFamily(brush);
  // Mirrors StudioDrawNode's engine decision exactly (shared captured resolver, no fallback).
  const dynamicsPresetId = resolveStudioCapturedBrushDynamicsPresetId(el);
  const dynamicBrush = dynamicsPresetId !== null;
  const stampKind = resolveStudioStampBrushKind(brush);
  const renderSampleDistance = strokeRenderDistance(el.sampleSpacing);
  const aliasStrokeWidth = studioBrushAliasEffectiveDiameter(brush, strokeWidth);
  const singlePointRoute = resolveStudioBrushSinglePointRoute({
    brushId: brush,
    mode: el.mode,
    causalInkEnabled: el.sampleSpacing !== undefined || el.pressureModel !== undefined,
  });

  if (isStudioPixelPencilRenderMode(brush) && el.mode !== "eraser") {
    const pixelPlan = planStudioPixelPencilCells({
      points,
      strokeWidth: aliasStrokeWidth,
    });
    if (!pixelPlan.complete) {
      addSkip(ctx, el, "skipped", "픽셀 펜 셀 예산을 초과해 SVG에서 안전하게 제외했어요.");
      return "";
    }
    const path = pixelPlan.cells
      .map((cell) => `M${cell.x} ${cell.y}h1v1h-1Z`)
      .join("");
    return path
      ? `<path d="${path}" fill="${escapeXml(stroke)}" shape-rendering="crispEdges"${opacityAttr}/>`
      : "";
  }

  if (el.outlineStroke !== undefined) {
    const outlineMarkup = serializeStudioOutlineStrokePlan(
      ctx,
      el,
      planStudioPerfectFreehandRender({
        contract: el.outlineStroke,
        stroker: peekStudioPerfectFreehandStroker(),
        points,
        // `recorded` means DrawEl already owns canonical renderer pressure. Alias mappings belong
        // to the legacy no-contract path below and must never be applied twice.
        pressures: el.pressures,
        // The durable contract, rather than the mutable brush catalogue, owns alias scale.
        strokeWidth,
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
      }),
      stroke,
      opacityAttr,
    );
    if (outlineMarkup !== null) return outlineMarkup;
  }

  if (
    points.length === 2 &&
    singlePointRoute === "generic-dot"
  ) {
    const pencilPasses = resolveStudioBrushAliasPencilPasses(brush);
    if (brushFamily === "pencil" && pencilPasses.length > 0) {
      const pressureProfile = resolveStudioRetainedMediaPressureProfileId(brush)
        ?? "pencil";
      const pressureResponse = resolveStudioRetainedMediaPressure(
        pressureProfile,
        el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
          ? el.pressures?.[0]
          : undefined,
        el.materialMinimumDiameterRatio,
      );
      const circles = pencilPasses.map((pass) => (
        `<circle data-pencil-pass="${pass.role}" cx="${fmt(points[0])}" cy="${fmt(points[1])}" r="${fmt(Math.max(0.35, aliasStrokeWidth * pass.widthScale * pressureResponse.sizeScale / 2))}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(strokeOpacity * Math.min(1, pass.opacityScale * Math.sqrt(pressureResponse.opacityScale * pressureResponse.flowScale)))}"/>`
      ));
      return `<g data-brush-alias="${escapeXml(brush)}">${circles.join("")}</g>`;
    }
    const pressure = mapStudioBrushAliasPressure(
      brush,
      resolveStudioInkPressure(el.pressures?.[0], el.pressureModel),
      studioInkFallbackPressure(el.pressureModel)
    );
    const retainedPressureProfile =
      resolveStudioRetainedMediaPressureProfileId(brush);
    const retainedPressure = retainedPressureProfile
      ? resolveStudioRetainedMediaPressure(
          retainedPressureProfile,
          el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
            ? el.pressures?.[0]
            : undefined,
          el.materialMinimumDiameterRatio,
        )
      : null;
    const pressureAware = brushFamily === "pen"
      || brushFamily === "gpen"
      || brushFamily === "calligraphy"
      || brushFamily === "perfect"
      || brushFamily === "marker"
      || retainedPressure !== null;
    const width = retainedPressure
      ? aliasStrokeWidth * retainedPressure.sizeScale
      : pressureAware
        ? aliasStrokeWidth * (0.3 + pressure * 1.4)
        : aliasStrokeWidth;
    if (brushFamily === "highlighter") {
      const pressureBrush = isStudioFxPressureBrushId(brush)
        ? brush
        : "highlighter";
      const pressureResponse = resolveStudioFxBrushTapPressureResponse(
        pressureBrush,
        el.pressures?.[0],
        el.materialPressureModel,
        el.materialMinimumDiameterRatio,
      );
      const tapWidth = aliasStrokeWidth * pressureResponse.widthScale;
      const washPlan = planStudioHighlighterWashTap({
        brushId: resolveStudioHighlighterWashBrushId(brush),
        x: points[0],
        y: points[1],
        width: tapWidth,
        opacityScale: pressureResponse.opacityScale,
      });
      return `<path d="${studioHighlighterWashPlanPathData(washPlan)}" fill="${escapeXml(stroke)}" fill-rule="nonzero" data-brush-engine="${washPlan.version}" data-highlighter-cap="${washPlan.capProfile}" data-highlighter-wash="tap" style="mix-blend-mode:multiply" opacity="${fmtDabOpacity(strokeOpacity * washPlan.opacityScale)}"/>`;
    }
    if (brushFamily === "brush" || brushFamily === "calligraphy") {
      const roundness = brushFamily === "calligraphy"
        ? Math.min(1, Math.max(0.08, el.brushTip?.roundness ?? 0.35))
        : 0.36;
      const angle = brushFamily === "calligraphy"
        ? el.brushTip?.angleDeg ?? -30
        : -30;
      return `<ellipse cx="${fmt(points[0])}" cy="${fmt(points[1])}" rx="${fmt(Math.max(0.35, width / 2))}" ry="${fmt(Math.max(0.35, width * roundness / 2))}" fill="${escapeXml(stroke)}" transform="rotate(${fmt(angle)} ${fmt(points[0])} ${fmt(points[1])})"${opacityAttr}/>`;
    }
    const radius = pressureAware && el.pressureModel !== undefined
      ? studioInkPressureRadius(aliasStrokeWidth, pressure, el.pressureModel)
      : Math.max(0.35, width / 2);
    return `<circle cx="${fmt(points[0])}" cy="${fmt(points[1])}" r="${fmt(radius)}" fill="${escapeXml(stroke)}"${opacityAttr}/>`;
  }

  // Branch order mirrors StudioDrawNode exactly: the stamp engine wins before dynamics. The two
  // id sets are disjoint under the shared resolver, but keeping the order identical guarantees
  // both surfaces take the same branch even for foreign/corrupt documents.
  if (stampKind) {
    const style = resolveStudioStampBrushStyle(
      stampKind,
      { color: stroke, size: strokeWidth, opacity: strokeOpacity },
      el.stamp,
      brush,
    );
    // v2는 이미 수락·안정화된 append-only 입력이다. legacy만 과거 평활화/압력 재표본을 유지한다.
    const causal = el.stampPipeline === "causal-walker-v2";
    const stampPoints = causal
      ? points
      : resolveStudioFreehandRenderPath(points, {
          sampleSpacing: el.sampleSpacing,
          legacyMinDistance: renderSampleDistance,
          legacyTension: 0,
        }).points;
    const sourceAligned = causal || stampPoints === points;
    const stampPressures = sourceAligned
      ? el.pressures
      : resampleStrokePressures(
          el.pressures ?? [],
          Math.floor(stampPoints.length / 2),
          0.5
        );
    return serializeStampBrushDabs(
      ctx,
      style,
      planStudioStampBrushDabs(style, stampPoints, stampPressures)
    );
  }

  if (
    dynamicBrush &&
    dynamicsPresetId &&
    ((causalCoverageMarks !== undefined && causalCoverageMarks.length > 0) || (dynamicDabs !== undefined && dynamicDabs.length > 0))
  ) {
    const normalizedDynamics = dynamics ?? normalizeStudioBrushDynamicsSettings(
      // Same replay fail-safe as serializeDraw and the canvas planner.
      el.brushDynamics
        ?? studioReplaySafeBrushDynamicsSettingsForBrushId(brush)
        ?? studioReplaySafeBrushDynamicsSettingsForBrushId(dynamicsPresetId)
    );
    if (causalCoverageMarks) {
      const approximated = { textureBudgetExhausted: false };
      const exactCoverage = serializeStudioDynamicCoverageMarks(
        ctx,
        causalCoverageMarks,
        strokeOpacity,
        isStudioBoundedFlowPaintModelCompatible(el),
        dynamicMaterialIdentity,
        approximated,
      );
      if (exactCoverage !== null) {
        if (approximated.textureBudgetExhausted) {
          addSkip(
            ctx,
            el,
            "approximated",
            "문서의 브러시 텍스처 예산을 모두 써서, 이 획은 팁 질감 없이 형태만 그렸어요.",
          );
        }
        return exactCoverage;
      }
      addSkip(
        ctx,
        el,
        "skipped",
        "동적 브러시의 전체 해상도 팁을 SVG에 무손실로 직렬화하지 못해 제외했어요.",
      );
      return "";
    }
    const strokeSeed = dynamicSeed
      ?? studioBrushDynamicsSeedFromKey(`${el.id}:${normalizedDynamics.seed}`);
    const dabs = dynamicDabs ?? [];
    const grainActive = studioBrushGrainIsActive(normalizedDynamics.grain);
    const tipDefinitions = [
      normalizedDynamics.tip,
      ...normalizedDynamics.tipLayers.map((layer) => layer.tip),
    ];
    // 듀얼 브러시는 1차 팁(index 0)에만 합성 — 비활성 시 기존 함수와 동일 반환(바이트 불변).
    const dualBrush = normalizedDynamics.dualBrush;
    const tipUsesEllipse = tipDefinitions.map((tip, tipIndex) => (
      !grainActive && (tipIndex === 0
        ? studioBrushDualTipUsesSolidEllipse(tip, dualBrush)
        : studioBrushTipUsesSolidEllipse(tip))
    ));
    const tipAlphaMaps = tipDefinitions.map((tip, tipIndex) => (
      tipUsesEllipse[tipIndex]
        ? null
        : tipIndex === 0
          ? composeStudioBrushDualTipAlphaMap(tip, dualBrush)
          : buildStudioBrushTipAlphaMap(tip)
    ));
    const strokeOriginX = dabs[0]?.sourceX ?? dabs[0]?.x ?? 0;
    const strokeOriginY = dabs[0]?.sourceY ?? dabs[0]?.y ?? 0;
    const boundedFlow = isStudioBoundedFlowPaintModelCompatible(el);
    const marks: string[] = [];
    const grainAt = (x: number, y: number) => resolveNormalizedStudioBrushGrainAlphaMultiplier({
      x,
      y,
      strokeOriginX,
      strokeOriginY,
      strokeSeed,
    }, normalizedDynamics.grain);

    const dabScale = aliasStrokeWidth / 16;
    for (const dab of dabs) {
      const dabColor = escapeXml(resolveNormalizedStudioBrushDabColor(
        stroke,
        dab.index,
        strokeSeed,
        normalizedDynamics.colorDynamics
      ));
      const composed = planNormalizedStudioBrushTipComposition(
        dab,
        normalizedDynamics.tip,
        normalizedDynamics.tipLayers
      );
      for (const composedTip of composed) {
        const composedDab = composedTip.dab;
        const tipIndex = composedTip.role === "primary" ? 0 : composedTip.layerIndex + 1;
        const baseOpacity = Math.min(
          1,
          Math.max(
            0,
            composedDab.opacity * composedDab.flow * (boundedFlow ? 1 : strokeOpacity)
          )
        );
        const alphaMap = tipAlphaMaps[tipIndex] ?? null;
        if (tipUsesEllipse[tipIndex] || !alphaMap) {
          // Canvas clamps the circular radius and then scales its Y axis by roundness.
          const radius = Math.max(0.25, (composedDab.size * dabScale) / 2);
          const opacity = Math.min(
            1,
            Math.max(0, baseOpacity * grainAt(composedDab.x, composedDab.y))
          );
          marks.push(`<ellipse cx="${fmt(composedDab.x)}" cy="${fmt(composedDab.y)}" rx="${fmt(radius)}" ry="${fmt(radius * composedDab.roundness)}" fill="${dabColor}" opacity="${fmtDabOpacity(opacity)}" transform="rotate(${fmt(composedDab.angle)} ${fmt(composedDab.x)} ${fmt(composedDab.y)})"/>`);
          continue;
        }

        for (const sample of planStudioBrushTipStampWorldSamples(
          composedDab,
          composedTip.tip,
          { alphaMap, grid: dynamicStampGrid }
        )) {
          const opacity = Math.min(
            1,
            Math.max(0, baseOpacity * sample.alpha * grainAt(sample.x, sample.y))
          );
          marks.push(`<circle cx="${fmt(sample.x)}" cy="${fmt(sample.y)}" r="${fmt(sample.radius * dabScale)}" fill="${dabColor}" opacity="${fmtDabOpacity(opacity)}"/>`);
        }
      }
    }
    return boundedFlow
      ? `<g opacity="${fmtDabOpacity(strokeOpacity)}">${marks.join("")}</g>`
      : `<g>${marks.join("")}</g>`;
  }
  return serializeFreehandMedia(
    ctx,
    el,
    points,
    stroke,
    strokeWidth,
    opacityAttr,
    strokeOpacity,
    brush,
    brushFamily,
    renderSampleDistance,
    aliasStrokeWidth,
  );
}
