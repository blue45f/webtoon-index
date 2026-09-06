import { STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION } from "../brush/studio-brush-soft-falloff-stamp";

import {
  escapeXml,
  fmtCoverageNumber,
  fmtDabOpacity,
} from "./studio-svg-export-geometry";
import {
  svgAlphaMapTextureAsset,
  svgSoftFalloffTextureAsset,
} from "./studio-svg-export-png";
import {
  STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET,
  visitStudioSvgR8StreamingCoverage,
  type StudioSvgR8DabVariation,
  type StudioSvgR8StreamingCoverageMark,
} from "./studio-svg-r8-streaming-export";

import type { NormalizedStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import type { StudioDynamicBrushMaterialIdentity } from "../brush/studio-dry-media-dynamic-bridge";
import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";
import type { ExportCtx } from "./studio-svg-export-types";

export function serializeStudioDynamicCoverageMark(
  ctx: ExportCtx,
  mark: StudioDynamicBrushCoverageMark | StudioSvgR8StreamingCoverageMark,
  strokeOpacity: number,
  boundedFlow: boolean,
  retainAlphaMapIdentity = true,
  materialIdentity?: StudioDynamicBrushMaterialIdentity,
  /**
   * Skip the texture-asset branches and take the geometric one. Used only after an exact pass has
   * already failed on the document's texture budget, so the stroke lands as untextured coverage
   * rather than not landing at all.
   */
  geometricFallback = false,
): string | null {
  const opacity = Math.min(
    1,
    Math.max(0, mark.alpha * (boundedFlow ? 1 : strokeOpacity)),
  );
  const angleDegrees = mark.angleRadians * 180 / Math.PI;
  const transform = `rotate(${fmtCoverageNumber(angleDegrees)} ${fmtCoverageNumber(mark.x)} ${fmtCoverageNumber(mark.y)})`;
  const materialAttributes = materialIdentity
    ? (
        (materialIdentity.dryMediaPresetId === "pastel"
          ? ` data-brush-carrier="soft-pigment-fiber"`
          : "")
        + ` data-brush-material="${escapeXml(materialIdentity.brushId)}"`
      )
    : "";

  if (
    "ribbon" in mark
    && (
      mark.ribbon?.kind === "flat-nib-ribbon-polygon"
      || mark.ribbon?.kind === "paint-roller-ribbon-polygon"
      || mark.ribbon?.kind === "dry-media-union-ribbon-polygon"
      || mark.ribbon?.kind === "professional-shelf-ribbon-polygon"
      || mark.ribbon?.kind === "competitor-specialty-ribbon-polygon"
    )
  ) {
    if (
      mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
      && mark.ribbon.contourStyles
    ) {
      let contours = "";
      let contourIndex = 0;
      while (contourIndex < mark.ribbon.polygons.length) {
        const style = mark.ribbon.contourStyles[contourIndex];
        if (!style) return null;
        let contourPath = "";
        do {
          const points = mark.ribbon.polygons[contourIndex]!;
          const [firstX, firstY, ...remaining] = points;
          if (firstX === undefined || firstY === undefined) return null;
          contourPath +=
            `M${fmtCoverageNumber(firstX)} ${fmtCoverageNumber(firstY)}`;
          for (let index = 0; index < remaining.length; index += 2) {
            const x = remaining[index];
            const y = remaining[index + 1];
            if (x === undefined || y === undefined) return null;
            contourPath += `L${fmtCoverageNumber(x)} ${fmtCoverageNumber(y)}`;
          }
          contourPath += "Z";
          contourIndex += 1;
        } while (
          contourIndex < mark.ribbon.polygons.length
          && mark.ribbon.contourStyles[contourIndex]?.role === style.role
          && mark.ribbon.contourStyles[contourIndex]?.color === style.color
          && mark.ribbon.contourStyles[contourIndex]?.alphaMultiplier
            === style.alphaMultiplier
        );
        contours += (
          `<path data-brush-contour-role="${escapeXml(style.role)}"`
          + ` d="${contourPath}" fill="${escapeXml(style.color)}"`
          + ` opacity="${fmtDabOpacity(Math.min(
            1,
            Math.max(0, opacity * style.alphaMultiplier),
          ))}"/>`
        );
      }
      return (
        `<g data-brush-coverage="competitor-specialty-ribbon"${materialAttributes}`
        + ` data-brush-material-profile="${escapeXml(mark.ribbon.semanticProfile)}">`
        + `${contours}</g>`
      );
    }
    let path = "";
    for (const points of mark.ribbon.polygons) {
      const [firstX, firstY, ...remaining] = points;
      if (firstX === undefined || firstY === undefined) return null;
      path += `M${fmtCoverageNumber(firstX)} ${fmtCoverageNumber(firstY)}`;
      for (let index = 0; index < remaining.length; index += 2) {
        const x = remaining[index];
        const y = remaining[index + 1];
        if (x === undefined || y === undefined) return null;
        path += `L${fmtCoverageNumber(x)} ${fmtCoverageNumber(y)}`;
      }
      path += "Z";
    }
    return (
      `<path data-brush-coverage="${
        mark.ribbon.kind === "paint-roller-ribbon-polygon"
          ? "paint-roller-ribbon"
          : mark.ribbon.kind === "dry-media-union-ribbon-polygon"
            ? "dry-media-union-ribbon"
            : mark.ribbon.kind === "professional-shelf-ribbon-polygon"
              ? "professional-shelf-ribbon"
              : mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
                ? "competitor-specialty-ribbon"
              : "flat-nib-ribbon"
      }"${materialAttributes}${
        mark.ribbon.kind === "professional-shelf-ribbon-polygon"
        || mark.ribbon.kind === "competitor-specialty-ribbon-polygon"
          ? ` data-brush-material-profile="${escapeXml(mark.ribbon.semanticProfile)}"`
          : ""
      } d="${path}"`
      + ` fill="${escapeXml(mark.color)}" opacity="${fmtDabOpacity(opacity)}"/>`
    );
  }

  if (mark.texture?.kind === "alpha-map" && !geometricFallback) {
    const asset = svgAlphaMapTextureAsset(
      ctx,
      mark.texture.alphaMap,
      retainAlphaMapIdentity,
    );
    if (!asset) return null;
    return (
      `<use data-brush-coverage="alpha-map"${materialAttributes} href="#${asset.symbolId}"`
        + ` x="${fmtCoverageNumber(mark.x - mark.radiusX)}"`
        + ` y="${fmtCoverageNumber(mark.y - mark.radiusY)}"`
        + ` width="${fmtCoverageNumber(mark.radiusX * 2)}"`
        + ` height="${fmtCoverageNumber(mark.radiusY * 2)}"`
        + ` preserveAspectRatio="none" color="${escapeXml(mark.color)}"`
        + ` opacity="${fmtDabOpacity(opacity)}" transform="${transform}"/>`
    );
  }

  if ("falloff" in mark && mark.falloff?.kind === "analytic-radial" && !geometricFallback) {
    const asset = svgSoftFalloffTextureAsset(
      ctx,
      mark.falloff.exponent,
      mark.falloff.tone,
    );
    if (!asset) return null;
    const overscan = asset.size / STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION;
    const radiusX = mark.radiusX * overscan;
    const radiusY = mark.radiusY * overscan;
    // 톤은 마크 단위로 왕복 직렬화한다 — 핀 스트로크의 문서는 어떤 램프로 스커트를 쌓았는지
    // 자체 기술하고, 톤 없는 레거시 마크는 오늘의 마크업과 바이트 단위로 같아야 한다.
    const toneAttribute = mark.falloff.tone === undefined
      ? ""
      : ` data-brush-falloff-tone="${escapeXml(mark.falloff.tone)}"`;
    return (
      `<use data-brush-coverage="analytic-radial"${toneAttribute}${materialAttributes} href="#${asset.symbolId}"`
        + ` x="${fmtCoverageNumber(mark.x - radiusX)}"`
        + ` y="${fmtCoverageNumber(mark.y - radiusY)}"`
        + ` width="${fmtCoverageNumber(radiusX * 2)}"`
        + ` height="${fmtCoverageNumber(radiusY * 2)}"`
        + ` preserveAspectRatio="none" color="${escapeXml(mark.color)}"`
        + ` opacity="${fmtDabOpacity(opacity)}" transform="${transform}"/>`
    );
  }

  // 솔리드 타원 커버리지도 리본·알파맵·해석적 falloff 분기와 같은 재질 주석을 남긴다 —
  // data-brush-material/data-brush-carrier는 내보낸 문서에서 질감 정체성을 추적하는
  // 시맨틱 메타데이터라 지오메트리가 가장 단순한 분기에서도 생략하지 않는다.
  // 위치 계약: 재질 속성은 ry 뒤에 둔다. Canvas↔SVG 교차 검증 파서는
  // `data-brush-coverage="ellipse" cx=…` 인접성을 전제하므로 지오메트리 앞에 끼워 넣지 않는다.
  return (
    `<ellipse data-brush-coverage="ellipse"`
      + ` cx="${fmtCoverageNumber(mark.x)}" cy="${fmtCoverageNumber(mark.y)}"`
      + ` rx="${fmtCoverageNumber(mark.radiusX)}" ry="${fmtCoverageNumber(mark.radiusY)}"`
      + `${materialAttributes}`
      + ` fill="${escapeXml(mark.color)}" opacity="${fmtDabOpacity(opacity)}"`
      + ` transform="${transform}"/>`
  );
}

export function serializeStudioDynamicCoverageMarks(
  ctx: ExportCtx,
  marks: readonly StudioDynamicBrushCoverageMark[],
  strokeOpacity: number,
  boundedFlow: boolean,
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  /** Set when the stroke had to be drawn without its tip textures to fit the budget. */
  approximated: { textureBudgetExhausted: boolean },
): string | null {
  if (marks.length === 0) return null;
  const initialDefsLength = ctx.defs.length;
  const initialSequence = ctx.seq;
  const initialAssetKeys = new Set(ctx.brushTextureAssets.keys());
  const initialAlphaMapKeys = new Set(ctx.brushTextureAssetsByAlphaMap.keys());
  const initialSerializedUtf16Bytes = ctx.brushTextureSerializedUtf16Bytes;
  const rollbackAssets = (): null => {
    ctx.defs.length = initialDefsLength;
    ctx.seq = initialSequence;
    ctx.brushTextureSerializedUtf16Bytes = initialSerializedUtf16Bytes;
    for (const key of ctx.brushTextureAssets.keys()) {
      if (!initialAssetKeys.has(key)) ctx.brushTextureAssets.delete(key);
    }
    for (const key of ctx.brushTextureAssetsByAlphaMap.keys()) {
      if (!initialAlphaMapKeys.has(key)) {
        ctx.brushTextureAssetsByAlphaMap.delete(key);
      }
    }
    return null;
  };
  const serializeAll = (geometricFallback: boolean): string[] | null => {
    const out: string[] = [];
    for (const mark of marks) {
      const serialized = serializeStudioDynamicCoverageMark(
        ctx,
        mark,
        strokeOpacity,
        boundedFlow,
        true,
        materialIdentity,
        geometricFallback,
      );
      if (serialized === null) return null;
      out.push(serialized);
    }
    return out;
  };

  let markup = serializeAll(false);
  if (markup === null) {
    // The document's texture budget is gone. Every texture branch would fail from here, so the
    // exact pass is abandoned and the stroke is re-serialised as untextured coverage — the same
    // positions, radii, rotations, colours and opacities, drawn as the geometric branch the
    // renderer already falls back to. It loses the tip's alpha map; it does NOT lose the stroke.
    //
    // Dropping was silent data loss on every real page: paint-tube's three-stroke cell serialises
    // to 21.2MB while its curve alone needs 22.7MB, so the second stroke exhausted the budget and
    // the exporter removed it outright. A single-stroke probe cannot see that — the drop only
    // appears once a page holds more than one stroke. erodible-pencil is next at 22.4MB.
    rollbackAssets();
    markup = serializeAll(true);
    if (markup === null) return null;
    approximated.textureBudgetExhausted = true;
  }

  return boundedFlow
    ? `<g opacity="${fmtDabOpacity(strokeOpacity)}">${markup.join("")}</g>`
    : `<g>${markup.join("")}</g>`;
}

/**
 * Encodes verified R8 paper one dab at a time. Unlike the retained Canvas plan, this path never
 * stores the per-dab Float32 alpha maps in `brushTextureAssetsByAlphaMap`; only the deterministic
 * PNG definition string and its tiny content-addressed cache record survive each callback.
 */
export function serializeStudioR8DynamicCoverageMarks(
  ctx: ExportCtx,
  input: Readonly<{
    dabVariations: readonly StudioSvgR8DabVariation[];
    dynamics: NormalizedStudioBrushDynamicsSettings;
    materialIdentity?: StudioDynamicBrushMaterialIdentity;
    dynamicSeed: number;
    stroke: string;
    markBudget: number;
  }>,
  strokeOpacity: number,
  boundedFlow: boolean,
): readonly string[] | null {
  const initialDefsLength = ctx.defs.length;
  const initialSequence = ctx.seq;
  const initialAssetKeys = new Set(ctx.brushTextureAssets.keys());
  const initialAlphaMapKeys = new Set(ctx.brushTextureAssetsByAlphaMap.keys());
  const initialR8EmbeddedRgbaBytes = ctx.r8EmbeddedRgbaBytes;
  const initialSerializedUtf16Bytes = ctx.brushTextureSerializedUtf16Bytes;
  const rollbackAssets = (): null => {
    ctx.defs.length = initialDefsLength;
    ctx.seq = initialSequence;
    ctx.r8EmbeddedRgbaBytes = initialR8EmbeddedRgbaBytes;
    ctx.brushTextureSerializedUtf16Bytes = initialSerializedUtf16Bytes;
    for (const key of ctx.brushTextureAssets.keys()) {
      if (!initialAssetKeys.has(key)) ctx.brushTextureAssets.delete(key);
    }
    for (const key of ctx.brushTextureAssetsByAlphaMap.keys()) {
      if (!initialAlphaMapKeys.has(key)) {
        ctx.brushTextureAssetsByAlphaMap.delete(key);
      }
    }
    return null;
  };
  const markupByVariation = input.dabVariations.map(() => [] as string[]);
  const remainingRgbaByteBudget =
    STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET - initialR8EmbeddedRgbaBytes;
  if (remainingRgbaByteBudget <= 0) return rollbackAssets();
  const streamed = visitStudioSvgR8StreamingCoverage(
    {
      ...input,
      rgbaByteBudget: remainingRgbaByteBudget,
    },
    (mark, variationIndex) => {
      const serialized = serializeStudioDynamicCoverageMark(
        ctx,
        mark,
        strokeOpacity,
        boundedFlow,
        false,
      );
      if (serialized === null) return false;
      markupByVariation[variationIndex]!.push(serialized);
      return true;
    },
  );
  if (!streamed.ok) return rollbackAssets();
  ctx.r8EmbeddedRgbaBytes =
    initialR8EmbeddedRgbaBytes + streamed.embeddedRgbaBytes;
  return markupByVariation.map((markup) => (
    boundedFlow
      ? `<g opacity="${fmtDabOpacity(strokeOpacity)}">${markup.join("")}</g>`
      : `<g>${markup.join("")}</g>`
  ));
}
