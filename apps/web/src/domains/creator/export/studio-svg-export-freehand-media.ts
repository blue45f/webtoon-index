import {
  applyStudioBrushAliasWatercolorMaterial,
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasPencilPasses,
  resolveStudioBrushAliasWatercolorPlanSettings,
} from "../brush/studio-brush-alias-profile";
import { resolveStudioCalligraphyRenderTip } from "../brush/studio-calligraphy-nib-profile";
import { planStudioCalligraphyRibbon } from "../brush/studio-calligraphy-ribbon";
import { studioOilFamilyPlanFields } from "../brush/studio-fluid-paint-reference";
import {
  resolveStudioInkPressure,
  studioInkFallbackPressure,
  studioInkPressureDiameter,
} from "../brush/studio-ink-pressure-model";
import {
  planStudioOilRibbonCarrier,
  studioOilRibbonProgramsForBrush,
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
  STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION,
  studioOilRibbonPathData,
} from "../brush/studio-oil-ribbon-carrier";
import {
  planStudioAngledNibStrokeLocalCoverage,
  type StudioStrokeLocalCoveragePolygon,
} from "../brush/studio-stroke-local-coverage";
import { isStudioStrokePaintModelCompatible } from "../brush/studio-stroke-paint-model";
import {
  planWatercolorBrushDabs,
  watercolorBrushSeedFromKey,
} from "../brush/studio-watercolor-brush";
import {
  planStudioWetRibbonCarrier,
  studioWetRibbonCarrierBatchPathData,
} from "../brush/studio-wet-ribbon-carrier";
import {
  buildCalligraphySegments,
  processFreehandPoints,
  processPencilPoints,
  resampleStrokePressures,
  resolveStudioFreehandRenderPath,
  screentoneDotRadius,
  screentoneDotsForStroke,
  type CalligraphyStylusInput,
  type StudioBrushRenderFamily,
} from "../studio-brush";
import { planStudioCausalInk } from "../studio-causal-ink";
import {
  DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
  planCausalWatercolorBrushDabs,
} from "../studio-causal-watercolor-brush";
import {
  FX_OIL_DAB_CAP,
  FX_PASTEL_DAB_CAP,
  STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION,
  fxBrushSeedFromKey,
  isStudioFxPressureBrushId,
  planGlitterBrushParticles,
  planGlowBrushPasses,
  planNeonBrushPasses,
  planOilBrushDabs,
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
  planPastelBrushDabs,
  planStudioFxBrushPressurePath,
  planStudioFxLuminousRibbonPass,
  resolveStudioFxBrushTapPressureResponse,
  resolveStudioFxPressurePassResponse,
  studioLuminousCoreColor,
} from "../studio-fx-brush";
import {
  planStudioHighlighterWashRibbon,
  resolveStudioHighlighterWashBrushId,
  studioHighlighterWashDetailPathData,
  studioHighlighterWashPlanPathData,
} from "../studio-highlighter-wash-ribbon";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  buildStudioPerfectFreehandPathData,
  loadStudioPerfectFreehandStroker,
  peekStudioPerfectFreehandStroker,
  resolveStudioPerfectFreehandProfile,
} from "../studio-perfect-freehand";
import {
  planStudioRetainedMediaPressureCurve,
  resolveStudioRetainedMediaPressureProfileId,
} from "../studio-retained-media-pressure";
import { planStudioRetainedMediaRibbon } from "../studio-retained-media-ribbon";

import {
  circularDabsToCompoundPathD,
  escapeXml,
  fmt,
  fmtDabOpacity,
  pointsToPathD,
  studioFxLuminousRibbonPathD,
  tensionPathD,
} from "./studio-svg-export-geometry";
import { nextId } from "./studio-svg-export-png";

import type { ExportCtx, SvgDrawElLike } from "./studio-svg-export-types";

const STUDIO_PENCIL_DEFAULT_JITTER_RADIUS = 0.75;

function scaledPencilJitterPoints(
  points: number[],
  jitterRadius: number
): number[] {
  const jittered = processPencilPoints(points);
  if (jitterRadius === STUDIO_PENCIL_DEFAULT_JITTER_RADIUS) return jittered;
  const scale = jitterRadius / STUDIO_PENCIL_DEFAULT_JITTER_RADIUS;
  return jittered.map((value, coordinateIndex) => {
    const source = points[coordinateIndex];
    return source === undefined ? value : source + (value - source) * scale;
  });
}

export function serializeFreehandMedia(
  ctx: ExportCtx,
  el: SvgDrawElLike,
  points: number[],
  stroke: string,
  strokeWidth: number,
  opacityAttr: string,
  strokeOpacity: number,
  brush: string,
  brushFamily: StudioBrushRenderFamily,
  renderSampleDistance: number,
  aliasStrokeWidth: number,
): string {
  const perfectProfile = resolveStudioPerfectFreehandProfile(brush);
  if (perfectProfile) {
    // perfect 잉크와 G펜 계열 — 캔버스와 같은 연속 가변 폭 아웃라인을 선 색으로 채운다.
    // getStroke는 순수 함수라 같은 입력이면 바이트가 동일하다(내보내기 결정성 규약 유지).
    const perfectStroker = peekStudioPerfectFreehandStroker();
    if (perfectStroker) {
      const outlinePressures = brushFamily === "gpen"
        || (el.pressures && el.pressures.length > 0)
        ? mapStudioBrushAliasPressureSamples(
            brush,
            el.pressures,
            Math.floor(points.length / 2),
            brushFamily === "gpen" ? 0.6 : 0.5
          )
        : el.pressures;
      const pathD = buildStudioPerfectFreehandPathData(perfectStroker, {
        points,
        pressures: outlinePressures,
        strokeWidth: aliasStrokeWidth,
        profile: perfectProfile,
      });
      if (pathD) {
        return `<path d="${pathD}" fill="${escapeXml(stroke)}" data-brush-engine="perfect-outline" data-brush-variant="${escapeXml(brush)}"${opacityAttr}/>`;
      }
    }
    // 모듈 미로드(드문 경우: 해당 브러시 획을 화면에 그린 적 없이 곧바로 내보내기) — 다음
    // 내보내기를 위해 백그라운드 로드를 걸고, 이번에는 깨끗한 라인 폴백으로 근사한다.
    if (!perfectStroker) {
      void loadStudioPerfectFreehandStroker().catch(() => {});
    }
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.4,
    });
    return `<path d="${tensionPathD(renderPath.points, renderPath.tension)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(aliasStrokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`;
  }

  if (brushFamily === "watercolor") {
    const watercolorSettings = resolveStudioBrushAliasWatercolorPlanSettings(
      brush,
      strokeWidth
    ) ?? { baseWidth: strokeWidth, spacing: Math.max(0.25, strokeWidth * 0.34) };
    const watercolorSeed = watercolorBrushSeedFromKey(el.id);
    const watercolorPressures = mapStudioBrushAliasPressureSamples(
      brush,
      el.pressures,
      Math.floor(points.length / 2),
      0.55
    );
    if (el.watercolorPipeline === "causal-walker-v2") {
      const plannedDabs = planCausalWatercolorBrushDabs({
          points,
          pressures: watercolorPressures,
          baseWidth: watercolorSettings.baseWidth,
          spacing: watercolorSettings.spacing,
          seed: watercolorSeed,
          maxDabs: DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
        }, true);
      // Export is settled by definition — the opt-in living-ink bake runs here exactly as it does
      // on the settled Canvas commit (same seed, same planner), keeping the two surfaces agreeing.
      const dabs = applyStudioBrushAliasWatercolorMaterial(
        brush,
        plannedDabs,
        watercolorSeed,
        "settled",
        el.brushEnginePrograms,
      );
      const wetRibbonPlan = planStudioWetRibbonCarrier(dabs, {
        seed: watercolorSeed,
      });
      if (wetRibbonPlan.batches.length === 0) return "";
      const ribbonPaths = wetRibbonPlan.batches.map((batch) => (
        `<path d="${studioWetRibbonCarrierBatchPathData(batch)}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(batch.opacity * strokeOpacity)}"/>`
      )).join("");
      return `<g data-brush-engine="wet-ribbon-carrier-v2">${ribbonPaths}</g>`;
    }

    // Persisted watercolor without the causal marker is intentionally byte-compatible with the
    // fitted legacy circle plan. Only new v2 strokes may use the directional ribbon carrier.
    const plannedDabs = planWatercolorBrushDabs({
      points: processFreehandPoints(points, renderSampleDistance),
      pressures: watercolorPressures,
      baseWidth: watercolorSettings.baseWidth,
      spacing: watercolorSettings.spacing,
      seed: watercolorSeed,
      maxDabs: 512,
    });
    const dabs = applyStudioBrushAliasWatercolorMaterial(
      brush,
      plannedDabs,
      watercolorSeed,
      "settled",
      el.brushEnginePrograms,
    );
    if (dabs.length === 0) return "";
    const diffuseId = nextId(ctx, "sw");
    ctx.defs.push(
      `<radialGradient id="${diffuseId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${escapeXml(stroke)}"/><stop offset="45%" stop-color="${escapeXml(stroke)}"/><stop offset="100%" stop-color="${escapeXml(stroke)}" stop-opacity="0"/></radialGradient>`
    );
    const circles = dabs.map((dab) => (
      `<circle cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" r="${fmt(dab.radius)}" fill="${dab.role === "diffuse" ? `url(#${diffuseId})` : escapeXml(stroke)}" opacity="${fmtDabOpacity(dab.opacity * strokeOpacity)}"/>`
    )).join("");
    return `<g>${circles}</g>`;
  }

  if (brushFamily === "calligraphy") {
    const smoothed = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0,
    }).points;
    if (smoothed.length < 2) return "";
    const sourcePointCount = Math.floor(points.length / 2);
    const sampleCount = Math.min(
      sourcePointCount,
      Math.max(el.tiltXs?.length ?? 0, el.tiltYs?.length ?? 0, el.twists?.length ?? 0)
    );
    const stylusSamples: CalligraphyStylusInput[] = Array.from(
      { length: sampleCount },
      (_, sampleIndex) => ({
        pointerType: "pen",
        tiltX: el.tiltXs?.[sampleIndex],
        tiltY: el.tiltYs?.[sampleIndex],
        twist: el.twists?.[sampleIndex],
      })
    );
    const segments = buildCalligraphySegments(
      smoothed,
      mapStudioBrushAliasPressureSamples(
        brush,
        el.pressures,
        sourcePointCount,
        0.5,
      ),
      stylusSamples,
      aliasStrokeWidth,
      // Same fallback as the Canvas node so the two renderers cannot disagree about the nib.
      resolveStudioCalligraphyRenderTip(el.brush, el.brushTip)
    );
    if (segments.length === 0) {
      return `<circle cx="${fmt(smoothed[0])}" cy="${fmt(smoothed[1])}" r="${fmt(Math.max(0.5, aliasStrokeWidth * 0.18))}" fill="${escapeXml(stroke)}"${opacityAttr}/>`;
    }
    const ribbon = planStudioCalligraphyRibbon(segments);
    const subpaths = ribbon.runs.map((run) => {
      const outline = run.outlinePoints;
      const polygon = outline.length >= 4
        ? `M ${fmt(outline[0])} ${fmt(outline[1])} ${Array.from(
            { length: Math.max(0, outline.length / 2 - 1) },
            (_, pointIndex) => {
              const offset = (pointIndex + 1) * 2;
              return `L ${fmt(outline[offset])} ${fmt(outline[offset + 1])}`;
            }
          ).join(" ")} Z`
        : "";
      const start = run.startCap;
      const end = run.endCap;
      const startCircle = `M ${fmt(start.x + start.radius)} ${fmt(start.y)} A ${fmt(start.radius)} ${fmt(start.radius)} 0 1 0 ${fmt(start.x - start.radius)} ${fmt(start.y)} A ${fmt(start.radius)} ${fmt(start.radius)} 0 1 0 ${fmt(start.x + start.radius)} ${fmt(start.y)} Z`;
      const endCircle = `M ${fmt(end.x + end.radius)} ${fmt(end.y)} A ${fmt(end.radius)} ${fmt(end.radius)} 0 1 0 ${fmt(end.x - end.radius)} ${fmt(end.y)} A ${fmt(end.radius)} ${fmt(end.radius)} 0 1 0 ${fmt(end.x + end.radius)} ${fmt(end.y)} Z`;
      return `${polygon} ${startCircle} ${endCircle}`;
    }).join(" ");
    return `<path d="${subpaths}" fill="${escapeXml(stroke)}" fill-rule="nonzero"${opacityAttr} data-brush-engine="calligraphy-ribbon"/>`;
  }

  if (brushFamily === "brush") {
    // 붓 — Canvas와 같은 stroke-local non-zero coverage plan을 직렬화한다.
    // 각 세그먼트의 winding을 하나로 정규화해야 역방향 재추적/자기교차가 이전 칠을
    // 상쇄해 투명하게 만드는 SVG non-zero compound-path 취소를 막을 수 있다.
    const smoothed = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0,
    }).points;
    if (smoothed.length < 2) return "";
    const coveragePlan = planStudioAngledNibStrokeLocalCoverage(
      smoothed,
      aliasStrokeWidth,
      -Math.PI / 6,
      el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
        ? {
            profileId: brush === "flat-brush"
              ? "flat-brush"
              : brush === "marker--chisel-ribbon"
                ? "marker-chisel"
                : "brush",
            pressures: el.pressures,
            minimumDiameterRatio: el.materialMinimumDiameterRatio,
            elementOpacity: strokeOpacity,
          }
        : undefined,
    );
    if (coveragePlan.polygons.length === 0) return "";
    const coverageSubpaths = (
      polygons: readonly StudioStrokeLocalCoveragePolygon[],
    ) => polygons.map((polygon) => (
      `M ${fmt(polygon.points[0])} ${fmt(polygon.points[1])} ${Array.from(
        { length: polygon.points.length / 2 - 1 },
        (_, pointIndex) => {
          const coordinateIndex = (pointIndex + 1) * 2;
          return `L ${fmt(polygon.points[coordinateIndex])} ${fmt(polygon.points[coordinateIndex + 1])}`;
        }
      ).join(" ")} Z`
    )).join(" ");
    // No resolvable tonal range — one compound fill at the element's opacity, byte for byte what
    // this carrier has always emitted, so saved documents replay unchanged.
    if (coveragePlan.shells.length <= 1) {
      return `<path d="${coverageSubpaths(coveragePlan.polygons)}" fill="${escapeXml(stroke)}" fill-rule="nonzero"${opacityAttr} data-brush-engine="angled-nib-local-coverage"/>`;
    }
    // Cumulative density shells. Each shell is still ONE compound nonzero fill — the property that
    // keeps butt joints and self-crossings from double-darkening — and the shell's alpha is
    // absolute, so the element opacity is applied exactly once, by the planner.
    const shellPaths = coveragePlan.shells.map((shell) => (
      `<path d="${coverageSubpaths(shell.polygons)}" fill="${escapeXml(stroke)}" fill-rule="nonzero" opacity="${fmtDabOpacity(shell.opacity)}" data-brush-engine="angled-nib-local-coverage" data-nib-density-band="${shell.band}"/>`
    )).join("");
    return `<g data-brush-shells="angled-nib-density">${shellPaths}</g>`;
  }

  if (brushFamily === "screentone") {
    // 스크린톤 — 전역 격자 정렬 망점(결정적)을 원으로 그대로 재현.
    const pitch = Math.max(3, aliasStrokeWidth * 0.42);
    const radius = Math.max(2, aliasStrokeWidth / 2);
    const dots = screentoneDotsForStroke(points, radius, pitch);
    const dotR = screentoneDotRadius(pitch);
    const circles: string[] = [];
    for (let i = 0; i + 1 < dots.length; i += 2) {
      circles.push(`<circle cx="${fmt(dots[i])}" cy="${fmt(dots[i + 1])}" r="${fmt(dotR)}"/>`);
    }
    return `<g fill="${escapeXml(stroke)}"${opacityAttr}>${circles.join("")}</g>`;
  }

  if (brushFamily === "pencil") {
    // 연필 — 새 획은 append-only raw 샘플, 레거시는 과거 평활화+tension을 유지한다.
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      acceptedTension: 0.18,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.2,
    });
    const configuredPasses = resolveStudioBrushAliasPencilPasses(brush);
    const passes = configuredPasses.length > 0
      ? configuredPasses
      : [{ role: "core" as const, widthScale: 1, opacityScale: 1, jitterRadius: 0.75 }];
    if (
      el.materialPressureModel
      !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
    ) {
      const paths = passes.map((pass) => {
        const jittered = scaledPencilJitterPoints(
          renderPath.points,
          pass.jitterRadius * (pass.role === "soft-edge" ? 0.6 : 1.3),
        );
        return `<path d="${tensionPathD(jittered, renderPath.tension)}" fill="none" stroke="${escapeXml(stroke)}" data-pencil-pass="${pass.role}" stroke-width="${fmt(aliasStrokeWidth * pass.widthScale)}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmtDabOpacity(strokeOpacity * pass.opacityScale)}"/>`;
      });
      return `<g data-brush-alias="${escapeXml(brush)}">${paths.join("")}</g>`;
    }
    const pressureProfile = resolveStudioRetainedMediaPressureProfileId(brush)
      ?? "pencil";
    const paths = passes.flatMap((pass) => {
      const jittered = scaledPencilJitterPoints(
        renderPath.points,
        pass.jitterRadius,
      );
      const pressurePlan = planStudioRetainedMediaPressureCurve(
        jittered,
        el.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
          ? el.pressures
          : undefined,
        pressureProfile,
        {
          tension: renderPath.tension,
          minimumDiameterRatio: el.materialMinimumDiameterRatio,
        },
      );
      const ribbon = planStudioRetainedMediaRibbon(
        pressurePlan,
        Math.max(0.5, aliasStrokeWidth * pass.widthScale),
      );
      return ribbon.runs.flatMap((run, runIndex) => {
        const cells = run.cells.map((cell, cellIndex) => {
          const cellOpacity = strokeOpacity * Math.min(
            1,
            pass.opacityScale
            * Math.sqrt(cell.opacityScale * cell.flowScale),
          );
          return `<path d="${pointsToPathD(cell.points, true)}" fill="${escapeXml(stroke)}" stroke="none" stroke-width="${fmt(cell.width)}" data-pencil-pass="${pass.role}" data-pencil-ribbon-cell="${runIndex}:${cellIndex}" opacity="${fmtDabOpacity(cellOpacity)}"/>`;
        });
        const caps = run.caps.map((cap) => {
          const capOpacity = strokeOpacity * Math.min(
            1,
            pass.opacityScale
            * Math.sqrt(cap.opacityScale * cap.flowScale),
          );
          return `<path d="${pointsToPathD(cap.points, true)}" fill="${escapeXml(stroke)}" data-pencil-endcap="${pass.role}:${cap.role}" opacity="${fmtDabOpacity(capOpacity)}"/>`;
        });
        return [...cells, ...caps];
      });
    });
    return `<g data-brush-alias="${escapeXml(brush)}" data-brush-engine="retained-pressure-ribbon-v1">${paths.join("")}</g>`;
  }

  if (brushFamily === "highlighter") {
    // 형광펜 — 한 gesture를 한 번만 채우는 wash 리본. 자기 교차는 농도가 겹치지 않고,
    // 서로 다른 DrawEl만 multiply로 자연스럽게 중첩된다.
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      acceptedTension: 0.35,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.4,
    });
    const pressureBrush = isStudioFxPressureBrushId(brush)
      ? brush
      : "highlighter";
    const pressurePath = planStudioFxBrushPressurePath({
      brushId: pressureBrush,
      points: renderPath.points,
      pressures: el.pressures,
      pressureModel: el.materialPressureModel,
      minimumDiameterRatio: el.materialMinimumDiameterRatio,
      tension: renderPath.tension,
    });
    const washPlan = planStudioHighlighterWashRibbon({
      brushId: resolveStudioHighlighterWashBrushId(brush),
      pressurePath,
      baseWidth: aliasStrokeWidth,
    });
    const pathData = studioHighlighterWashPlanPathData(washPlan);
    const detailPathData = studioHighlighterWashDetailPathData(washPlan);
    // Same two passes as the Canvas node: one base wash, one rim/fibre wash, each painted once.
    const detailPath = detailPathData
      ? `<path d="${detailPathData}" fill="${escapeXml(stroke)}" fill-rule="nonzero" stroke="none" data-highlighter-wash="detail" opacity="${fmtDabOpacity(washPlan.opacityScale * washPlan.detailOpacityScale)}" style="mix-blend-mode:multiply"/>`
      : "";
    return `<g data-brush-engine="${washPlan.version}" data-highlighter-cap="${washPlan.capProfile}" data-highlighter-wash="single-fill"${opacityAttr}><path d="${pathData}" fill="${escapeXml(stroke)}" fill-rule="nonzero" stroke="none" opacity="${fmtDabOpacity(washPlan.opacityScale)}" style="mix-blend-mode:multiply"/>${detailPath}</g>`;
  }

  if (brushFamily === "neon") {
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      acceptedTension: 0.3,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.35,
    });
    const passes = planNeonBrushPasses(strokeWidth);
    if (
      el.materialPressureModel
      !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
    ) {
      const layers = renderPath.points.length === 2
        ? passes.map((pass) => (
            `<circle cx="${fmt(renderPath.points[0])}" cy="${fmt(renderPath.points[1])}" r="${fmt(Math.max(0.25, strokeWidth * pass.widthScale / 2))}" fill="${escapeXml(pass.tone === "white-core" ? studioLuminousCoreColor(stroke) : stroke)}" opacity="${fmtDabOpacity(pass.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`
          )).join("")
        : (() => {
            const pathD = tensionPathD(renderPath.points, renderPath.tension);
            return passes.map((pass) => (
              `<path d="${pathD}" fill="none" stroke="${escapeXml(pass.tone === "white-core" ? studioLuminousCoreColor(stroke) : stroke)}" stroke-width="${fmt(Math.max(0.5, strokeWidth * pass.widthScale))}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmtDabOpacity(pass.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`
            )).join("");
          })();
      return `<g data-brush-engine="neon-halo" data-luminous-composite="${STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}">${layers}</g>`;
    }
    const pressurePath = planStudioFxBrushPressurePath({
      brushId: "neon",
      points: renderPath.points,
      pressures: el.pressures,
      pressureModel: el.materialPressureModel,
      minimumDiameterRatio: el.materialMinimumDiameterRatio,
      tension: renderPath.tension,
    });
    const tapPressure = resolveStudioFxBrushTapPressureResponse(
      "neon",
      el.pressures?.[0],
      el.materialPressureModel,
      el.materialMinimumDiameterRatio,
    );
    const layers = renderPath.points.length === 2
      ? passes.map((pass) => {
          const response = resolveStudioFxPressurePassResponse(
            tapPressure,
            pass.widthScale,
            pass.tone === "white-core",
          );
          return `<circle cx="${fmt(renderPath.points[0])}" cy="${fmt(renderPath.points[1])}" r="${fmt(Math.max(0.25, strokeWidth * pass.widthScale * response.widthScale / 2))}" fill="${escapeXml(pass.tone === "white-core" ? studioLuminousCoreColor(stroke) : stroke)}" opacity="${fmtDabOpacity(Math.min(1, pass.opacity * response.opacityScale) * strokeOpacity)}" style="mix-blend-mode:normal"/>`;
        }).join("")
      : passes.map((pass) => {
          const luminousCore = pass.tone === "white-core";
          const ribbonPlan = planStudioFxLuminousRibbonPass({
            brushId: "neon",
            pressurePath,
            baseWidth: strokeWidth,
            passWidthScale: pass.widthScale,
            passOpacity: pass.opacity,
            luminousCore,
          });
          return `<path data-luminous-ribbon="single-fill" data-luminous-cap="${ribbonPlan.cap}" data-luminous-composite="${ribbonPlan.compositeOperation}" d="${studioFxLuminousRibbonPathD(ribbonPlan)}" fill="${escapeXml(pass.tone === "white-core" ? studioLuminousCoreColor(stroke) : stroke)}" fill-rule="${ribbonPlan.fillRule}" stroke="none" opacity="${fmtDabOpacity(ribbonPlan.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`;
        }).join("");
    return `<g data-brush-engine="neon-halo" data-luminous-composite="${STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}">${layers}</g>`;
  }

  if (brushFamily === "glow") {
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      acceptedTension: 0.3,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.35,
    });
    const soft = (el.brush ?? "glow") === "soft-glow";
    const passes = planGlowBrushPasses(strokeWidth, soft);
    if (
      el.materialPressureModel
      !== STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
    ) {
      const layers = renderPath.points.length === 2
        ? passes.map((pass) => (
            `<circle cx="${fmt(renderPath.points[0])}" cy="${fmt(renderPath.points[1])}" r="${fmt(Math.max(0.25, strokeWidth * pass.widthScale / 2))}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(pass.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`
          )).join("")
        : (() => {
            const pathD = tensionPathD(renderPath.points, renderPath.tension);
            return passes.map((pass) => (
              `<path d="${pathD}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(Math.max(0.5, strokeWidth * pass.widthScale))}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmtDabOpacity(pass.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`
            )).join("");
          })();
      return `<g data-brush-engine="glow-pressure-halo" data-luminous-composite="${STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}">${layers}</g>`;
    }
    const pressureBrush = soft ? "soft-glow" : "glow";
    const pressurePath = planStudioFxBrushPressurePath({
      brushId: pressureBrush,
      points: renderPath.points,
      pressures: el.pressures,
      pressureModel: el.materialPressureModel,
      minimumDiameterRatio: el.materialMinimumDiameterRatio,
      tension: renderPath.tension,
    });
    const tapPressure = resolveStudioFxBrushTapPressureResponse(
      pressureBrush,
      el.pressures?.[0],
      el.materialPressureModel,
      el.materialMinimumDiameterRatio,
    );
    const layers = renderPath.points.length === 2
      ? passes.map((pass, passIndex) => {
          const response = resolveStudioFxPressurePassResponse(
            tapPressure,
            pass.widthScale,
            passIndex === passes.length - 1,
          );
          return `<circle cx="${fmt(renderPath.points[0])}" cy="${fmt(renderPath.points[1])}" r="${fmt(Math.max(0.25, strokeWidth * pass.widthScale * response.widthScale / 2))}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(Math.min(1, pass.opacity * response.opacityScale) * strokeOpacity)}" style="mix-blend-mode:normal"/>`;
        }).join("")
      : passes.map((pass, passIndex) => {
          const luminousCore = passIndex === passes.length - 1;
          const ribbonPlan = planStudioFxLuminousRibbonPass({
            brushId: pressureBrush,
            pressurePath,
            baseWidth: strokeWidth,
            passWidthScale: pass.widthScale,
            passOpacity: pass.opacity,
            luminousCore,
          });
          return `<path data-luminous-ribbon="single-fill" data-luminous-cap="${ribbonPlan.cap}" data-luminous-composite="${ribbonPlan.compositeOperation}" d="${studioFxLuminousRibbonPathD(ribbonPlan)}" fill="${escapeXml(stroke)}" fill-rule="${ribbonPlan.fillRule}" stroke="none" opacity="${fmtDabOpacity(ribbonPlan.opacity * strokeOpacity)}" style="mix-blend-mode:normal"/>`;
        }).join("");
    return `<g data-brush-engine="glow-pressure-halo" data-luminous-composite="${STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}">${layers}</g>`;
  }

  if (brushFamily === "glitter") {
    const mode = (el.brush ?? "glitter") === "star-dust" ? "star-dust" : (el.brush === "sparkle-star" ? "sparkle-star" : "glitter");
    const particles = planGlitterBrushParticles({
      points: resolveStudioFreehandRenderPath(points, {
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
        legacyTension: 0,
      }).points,
      pressures: el.pressures,
      baseWidth: aliasStrokeWidth,
      seed: fxBrushSeedFromKey(el.id),
      mode,
      maxParticles: 512,
    });
    const marks = particles.map((p) => {
      if (p.kind === 1) {
        const s = p.radius * 1.35;
        return `<rect x="${fmt(p.x - s / 2)}" y="${fmt(p.y - s / 2)}" width="${fmt(s)}" height="${fmt(s)}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(p.opacity * strokeOpacity)}" transform="rotate(45 ${fmt(p.x)} ${fmt(p.y)})"/>`;
      }
      return `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(p.radius)}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(p.opacity * strokeOpacity)}"/>`;
    }).join("");
    return `<g data-luminous-composite="${STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}" style="mix-blend-mode:normal">${marks}</g>`;
  }

  if (brushFamily === "oil") {
    const dabs = planOilBrushDabs({
      points: resolveStudioFreehandRenderPath(points, {
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
        legacyTension: 0,
      }).points,
      pressures: el.pressures,
      baseWidth: aliasStrokeWidth,
      seed: fxBrushSeedFromKey(el.id),
      maxDabs: FX_OIL_DAB_CAP,
      // The airbrush branch below shares this planner and deliberately does NOT take these: it has
      // no carrier pipeline to save, so it keeps the budget-filling refit.
      ...studioOilFamilyPlanFields(brush),
    });
    // 유화 기계 프로그램의 정본은 studioOilRibbonProgramsForBrush 의 id 매트릭스다. Canvas 렌더러
    // (StudioDrawNode)의 유화 분기에 같은 요약이 있고, 매트릭스를 고치면 둘 다 고친다 — "bristle-physics
    // 레인만 시뮬" 이던 2026-08-13 wave 3 서술이 확장 뒤에도 남아 브러시 통합 검토를 오도한 전례가 있다.
    // 2026-09-02 기준:
    // - WetBrush-2D 강모 물리 시뮬(bristlePhysics): brush--bristle-physics · oil--filbert-ribbon ·
    //   oil--impasto-ribbon · 기본 유화 2종(oil · acrylic). 2026-08-13 wave 3 에는 bristle-physics
    //   전용이었고 2026-08-15 에 filbert·impasto-ribbon, 2026-08-20 에 기본 유화로 확장됐다(그때
    //   함께 들어온 미출하 id — fluid-paint 4종·oil--fluid-paint-* 2행 — 은 2026-09-02 에 제거).
    // - v1 강모 고갈 다이내믹(bristleLoadDynamics): brush--bristle-physics · brush--bristle-depletion ·
    //   기본 유화 2종.
    // - dli GGX 릴리프 오버레이(impastoRelief): brush--impasto-relief · oil--impasto-ribbon · 기본 유화 2종.
    // 고유한 것은 조합이다: 고갈만 = bristle-depletion, 시뮬만 = filbert-ribbon, 릴리프만 = impasto-relief,
    // 시뮬+고갈(릴리프 없음) = bristle-physics, 시뮬+릴리프(고갈 없음) = impasto-ribbon, 셋 다 = 기본 유화
    // 2종. 매트릭스 밖의 유화 브러시는 캐리어 계약상 바이트 동일 플랜을 유지하고, 저장된 브러시의 프로그램
    // 세트(brushEnginePrograms.oil)는 매트릭스를 병합이 아니라 대체한다. Canvas 렌더러와 동일 입력(대브·시드)
    // 이라 두 렌더러의 플랜이 일치한다. 라이브 retained 오버레이(studio-live-retained-media-overlay)는 같은
    // 매트릭스를 부르지만 대브 입력(원시 점·비alias 폭)이 달라 이 패리티 주장의 범위 밖이다.
    //
    // oil--impasto-ribbon 이 릴리프를 켠 것은 2026-08-15 다(당시엔 brush--impasto-relief 와 둘뿐이었다).
    // 임파스토 레인이 이름만 임파스토였던 것을 고친 것이다: 릴리프가 없으면 oil--impasto-ribbon 은 선언
    // 필드가 oil--filbert-ribbon 과 완전히 동일해서 defaultWidth/defaultOpacity 만 다른 같은 브러시였고,
    // 렌더 픽셀 비교에서도 oil--flat-ribbon 과 0.163, acrylic--stiff-ribbon 과 0.168 로 코퍼스 중앙값(1.04)의
    // 6분의 1 거리에 붙어 있었다. 저장된 oil--impasto-ribbon 획은 이제 릴리프와 함께 다시 그려진다 — 질감을
    // 바이트 안정성보다 우선한다는 기존 결정(크레용 5레인)과 같은 판단.
    const carrier = planStudioOilRibbonCarrier(
      dabs,
      studioOilRibbonProgramsForBrush(brush, fxBrushSeedFromKey(el.id), el.brushEnginePrograms?.oil),
    );
    if (!carrier.body) return "";
    const body = `<path data-paint-carrier="contiguous-variable-width-ribbon" d="${studioOilRibbonPathData(carrier.body, true)}" fill="${escapeXml(stroke)}" opacity="${fmtDabOpacity(carrier.bodyOpacity * strokeOpacity)}"/>`;
    // One <path> per load band, with every run of that band as a subpath: SVG paints a path once,
    // which is what keeps a self-crossing from depositing its bristle ridges twice.
    const bristles = carrier.bristleLanes.map((lane) => (
      `<path data-paint-bristle-lane="true" d="${lane.runs.map((run) => studioOilRibbonPathData(run)).join("")}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(lane.lineWidth)}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmtDabOpacity(lane.opacity * strokeOpacity)}"/>`
    )).join("");
    // impastoRelief 오버레이(위 매트릭스가 릴리프를 켜는 모든 id) — Canvas sceneFunc과 같은 페인트
    // 계약(하이라이트=공유 화이트 상수 screen, 섀도우=스트로크 색 multiply, 레인당 한 번 페인트).
    // 플랜에 키가 없으면 빈 문자열이라 기존 유화 lane 직렬화 바이트가 그대로 유지된다.
    const relief = (carrier.impastoReliefLanes ?? []).map((lane) => (
      `<path data-paint-impasto-relief="${lane.kind}" d="${lane.runs.map((run) => studioOilRibbonPathData(run)).join("")}" fill="none" stroke="${lane.kind === "highlight" ? STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR : escapeXml(stroke)}" stroke-width="${fmt(lane.lineWidth)}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmtDabOpacity(lane.opacity * strokeOpacity)}" style="mix-blend-mode:${lane.kind === "highlight" ? "screen" : "multiply"}"/>`
    )).join("");
    return `<g data-brush-engine="oil-ribbon-carrier-v1">${body}<g style="mix-blend-mode:multiply">${bristles}</g>${relief === "" ? "" : `<g data-brush-engine-overlay="${STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION}">${relief}</g>`}</g>`;
  }

  if (brushFamily === "airbrush") {
    const isSplatter = el.brush === "splatter";
    const dabs = planOilBrushDabs({
      points: resolveStudioFreehandRenderPath(points, {
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
        legacyTension: 0,
      }).points,
      pressures: el.pressures,
      baseWidth: aliasStrokeWidth * (isSplatter ? 1.6 : 1.0),
      seed: fxBrushSeedFromKey(el.id),
      maxDabs: isSplatter ? 256 : 512,
    });
    const softId = nextId(ctx, isSplatter ? "spl" : "sa");
    ctx.defs.push(
      `<radialGradient id="${softId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${escapeXml(stroke)}"/><stop offset="${isSplatter ? "40%" : "60%"}" stop-color="${escapeXml(stroke)}" stop-opacity="${isSplatter ? "0.9" : "0.6"}"/><stop offset="100%" stop-color="${escapeXml(stroke)}" stop-opacity="0"/></radialGradient>`
    );
    const circles = dabs.map((dab) => (
      `<circle cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" r="${fmt(dab.radiusX * (isSplatter ? 0.7 : 1))}" fill="url(#${softId})" opacity="${fmtDabOpacity(dab.opacity * strokeOpacity)}"/>`
    )).join("");
    return `<g>${circles}</g>`;
  }

  if (brushFamily === "pastel") {
    const dabs = planPastelBrushDabs({
      points: resolveStudioFreehandRenderPath(points, {
        sampleSpacing: el.sampleSpacing,
        legacyMinDistance: renderSampleDistance,
        legacyTension: 0,
      }).points,
      pressures: el.pressures,
      baseWidth: aliasStrokeWidth,
      seed: fxBrushSeedFromKey(el.id),
      maxDabs: FX_PASTEL_DAB_CAP,
    });
    if (dabs.length === 0) return "";
    const softId = nextId(ctx, "sp");
    ctx.defs.push(
      `<radialGradient id="${softId}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${escapeXml(stroke)}"/><stop offset="55%" stop-color="${escapeXml(stroke)}"/><stop offset="100%" stop-color="${escapeXml(stroke)}" stop-opacity="0"/></radialGradient>`
    );
    const fibres = dabs.map((dab) => (
      `<ellipse cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" rx="${fmt(dab.radiusX)}" ry="${fmt(dab.radiusY)}" transform="rotate(${fmt(dab.angleRad * 180 / Math.PI)} ${fmt(dab.x)} ${fmt(dab.y)})" fill="url(#${softId})" opacity="${fmtDabOpacity(dab.opacity * strokeOpacity)}"/>`
    )).join("");
    return `<g>${fibres}</g>`;
  }

  // 새 기본 펜/마커 — live Canvas, WebGPU, Konva가 공유하는 round-dab footprint 그대로.
  if (
    (el.sampleSpacing !== undefined || el.pressureModel !== undefined)
    && !el.fill
    && (brushFamily === "pen" || brushFamily === "marker")
  ) {
    const plan = planStudioCausalInk({
      points,
      pressures: mapStudioBrushAliasPressureSamples(
        brush,
        el.pressures,
        Math.floor(points.length / 2),
        studioInkFallbackPressure(el.pressureModel)
      ),
      pressureModel: el.pressureModel,
      minDistance: el.sampleSpacing ?? 0,
      size: aliasStrokeWidth,
    });
    const layeredOpacity = isStudioStrokePaintModelCompatible({
      paintModel: el.paintModel,
      kind: el.kind,
      mode: el.mode,
      brush: el.brush,
      sampleSpacing: el.sampleSpacing,
      pressureModel: el.pressureModel,
      fill: el.fill,
      brushDynamics: el.brushDynamics,
      stampPipeline: el.stampPipeline,
      watercolorPipeline: el.watercolorPipeline,
      symmetry: el.symmetry,
    });
    if (layeredOpacity) {
      const path = circularDabsToCompoundPathD(plan.dabs);
      return path.length > 0
        ? `<path d="${path}" fill="${escapeXml(stroke)}"${opacityAttr}/>`
        : "";
    }
    const dabs = plan.dabs.map((dab) => (
      `<circle cx="${fmt(dab.x)}" cy="${fmt(dab.y)}" r="${fmt(dab.radius)}" fill="${escapeXml(stroke)}"${opacityAttr}/>`
    )).join("");
    return `<g>${dabs}</g>`;
  }

  // Filled freehand paths are the document representation used by lasso fill and generated
  // drafting faces. Preserve their closed fill in SVG instead of degrading them to an outline.
  if (el.fill && el.mode !== "eraser" && points.length >= 6) {
    const renderPath = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: el.sampleSpacing,
      legacyMinDistance: renderSampleDistance,
      legacyTension: 0.4,
    });
    const path = renderPath.tension === 0
      ? pointsToPathD(renderPath.points, true)
      : `${tensionPathD(renderPath.points, renderPath.tension)} Z`;
    return `<path d="${path}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`;
  }

  // 레거시 기본 펜/마커 — 필압 배열이 있으면 세그먼트별 굵기 산식으로 재현.
  const smoothed = processFreehandPoints(points, renderSampleDistance);
  const pressures = el.pressures;
  if (pressures && pressures.length > 0 && smoothed.length >= 4) {
    const sampledPressures = mapStudioBrushAliasPressureSamples(
      brush,
      resampleStrokePressures(
        pressures,
        Math.floor(smoothed.length / 2),
        studioInkFallbackPressure(el.pressureModel)
      ),
      Math.floor(smoothed.length / 2),
      studioInkFallbackPressure(el.pressureModel)
    );
    const segs: string[] = [];
    for (let i = 2; i < smoothed.length; i += 2) {
      const p = resolveStudioInkPressure(
        sampledPressures[Math.floor(i / 2)],
        el.pressureModel
      );
      const w = el.pressureModel === undefined
        ? Math.max(0.5, aliasStrokeWidth * (0.3 + p * 1.4))
        : studioInkPressureDiameter(aliasStrokeWidth, p, el.pressureModel);
      segs.push(
        `<path d="M ${fmt(smoothed[i - 2])} ${fmt(smoothed[i - 1])} L ${fmt(smoothed[i])} ${fmt(smoothed[i + 1])}" stroke="${escapeXml(stroke)}" stroke-width="${fmt(w)}" stroke-linecap="round" fill="none"/>`
      );
    }
    return `<g${opacityAttr}>${segs.join("")}</g>`;
  }
  return `<path d="${tensionPathD(smoothed, 0.4)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(aliasStrokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`;
}
