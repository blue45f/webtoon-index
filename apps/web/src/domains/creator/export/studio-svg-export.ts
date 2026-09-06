/**
 * Studio SVG Vector Export — 일러스트레이터급 벡터 내보내기 직렬화 엔진.
 *
 * 래스터 내보내기(studio-export, png/jpg/webp)가 "캔버스 픽셀 캡처"라면, 이 모듈은
 * StudioPage 의 요소(El) 배열을 **SVG 마크업으로 직접 직렬화**해 도형·텍스트·말풍선·
 * 프레임·효과선을 벡터로 보존한다(Illustrator/Inkscape/브라우저에서 무손실 확대·재편집).
 *
 * 재현 규약(캔버스 렌더와 동일 지오메트리 소스 공유):
 *  - 도형(draw): studio-stroke-shapes 의 별/다각형 포인트·점선 프리셋·화살촉 지오메트리,
 *    studio-gradient-engine 그라데이션(defs), studio-pattern-fill 패턴(defs <pattern>).
 *    채우기 우선순위는 캔버스와 동일: 패턴 > 그라데이션 > 단색.
 *  - 말풍선: studio-bubble-path 의 bubblePathData/Multi 를 그대로 재사용(이음새 없는 단일 path).
 *  - 텍스트: 글꼴/크기/자간/행간/정렬 + 곡선 텍스트(studio-text-path)는 <textPath> 로.
 *  - 이미지: <image> 태그(data URL 은 그대로 임베드), 프레임은 <clipPath> 클립.
 *  - 회전/기울이기: Konva 변환 순서(translate→rotate→skew)와 동일한 transform 문자열.
 *  - 집중선/속도선: StudioPage 와 동일한 seededRandom(id) 시드 난수로 같은 선 배치를 재현.
 *
 * 정직성 규약: 완벽 재현이 불가한 것은 그리지 않거나 근사하고, 전부 skipped 목록으로
 * 집계해 반환한다(콜러가 사용자에게 고지). 예: 픽셀 필터/보정(제외 아님, 원본 이미지로
 * 근사), 지우개 합성(destination-out — 제외), 아래 레이어 클리핑(근사), 자동 줄바꿈(근사).
 * 말풍선 그룹 그림자는 캔버스에서도 그려지지 않으므로(Konva 컨테이너 그림자는 cache 필요)
 * 내보내지 않는다 — 화면과 동일.
 *
 * 전부 순수·결정적(입력이 같으면 출력 바이트 동일) — DOM/Konva 무의존. Blob 생성·다운로드는
 * 콜러(StudioPage) 몫이다. 사용자 노출 문자열은 한글.
 */

import {
  bubblePathData,
  bubblePathDataMulti,
  burstStarPathData,
  doubleBubblePathData,
  heartBubblePathData,
  normalizeExtraTails,
  scaredBubblePathData,
  thoughtBubbleBodyPath,
  type BubbleTailSpec,
} from "../lettering/studio-bubble-path";
import {
  planDialogueRubyOverlayPlacements,
  planDialogueVerticalRubyOverlayPlacements,
  readDialogueRubySpans,
  type StudioRubyOverlayPlacement,
  type StudioVerticalRubyLayoutPlan,
} from "../lettering/studio-dialogue-ruby-layout";
import { buildTextPathData, isFlatTextPath, normalizeTextPath } from "../lettering/studio-text-path";
import {
  estimateTextGradientBBox,
  legacyTextGradientToSpec,
} from "../studio-gradient-engine";
import { isEffectivelyHidden, type LayerGroup } from "../studio-layers";
import {
  layoutVerticalText,
  verticalBlockAlign,
  verticalTextItemGeometry,
  type VerticalTextItem,
  type VerticalTextLayout,
  type VerticalTextMeasurer,
} from "../studio-vertical-text";

import { addSkip, gradientDef, shadowFilterDef } from "./studio-svg-export-defs";
import { serializeDraw } from "./studio-svg-export-draw";
import {
  CSS_BLEND_MODES,
  containingPanel,
  serializeFocusLines,
  serializeFrame,
  serializeImage,
  serializeSpeedLines,
} from "./studio-svg-export-elements";
import {
  att,
  escapeXml,
  fmt,
  nodeTransform,
  pointsToPathD,
} from "./studio-svg-export-geometry";
import { nextId } from "./studio-svg-export-png";

import type {
  ExportCtx,
  SvgBubbleElLike,
  SvgExportPageInput,
  SvgExportResult,
  SvgExportTheme,
  SvgStickerElLike,
  SvgTextElLike,
} from "./studio-svg-export-types";

export {
  SVG_EXPORT_MIME,
  svgExportFileName,
  type SvgElMeta,
  type SvgImageElLike,
  type SvgTextElLike,
  type SvgBubbleElLike,
  type SvgFrameElLike,
  type SvgStickerElLike,
  type SvgDrawElLike,
  type SvgFocusLinesElLike,
  type SvgSpeedLinesElLike,
  type SvgExportEl,
  type SvgExportTheme,
  type SvgExportPageInput,
  type SvgExportSkip,
  type SvgExportResult,
  type ExportCtx,
} from "./studio-svg-export-types";

export { escapeXml } from "./studio-svg-export-geometry";
export { svgSegmentedDynamicDabVariations } from "./studio-svg-export-draw";
export { planStudioWebDrawingKitOwnedDabs } from "../studio-web-drawing-stroke-bridge";

// ---------------------------------------------------------------------------
// 텍스트 공통 — 줄 배치·정렬·폭 초과(자동 줄바꿈 없음) 근사 판정
// ---------------------------------------------------------------------------

// 알파벳 기준선 근사 오프셋(em) — Konva 10 은 폰트 메트릭 (ascent-descent)/2 를 쓰고,
// 한글/라틴 통상 메트릭(ascent≈0.86em, descent≈0.14em)에서 0.36em 에 수렴한다.
const BASELINE_EM = 0.36;

/** 한 줄 폭 근사(px) — CJK/전각 1em, 그 외 0.55em + 자간. 자동 줄바꿈 경고 판정 전용. */
function estimateLineWidth(line: string, fontSize: number, letterSpacing: number): number {
  let units = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0;
    units += code > 0x2e7f ? 1 : 0.55;
  }
  return units * fontSize + Math.max(0, line.length - 1) * letterSpacing;
}

interface TextBlockOptions {
  text: string;
  x: number; // 정렬 기준 박스 로컬 x
  y: number; // 박스 로컬 y(첫 줄 상단)
  boxWidth: number; // 정렬 박스 폭(0 이면 왼쪽 앵커 고정)
  boxHeight?: number; // verticalAlign middle 용(미지정 시 상단 정렬)
  fontSize: number;
  lineHeight: number; // 배수
  letterSpacing: number;
  align: "left" | "center" | "right";
  fontFamily: string;
  fontStyle: "normal" | "bold" | "italic" | "bold italic";
  fill: string; // 색 또는 url(#...)
  stroke?: string;
  strokeWidth?: number;
  filter?: string;
}

/** 여러 줄 텍스트 <text> 마크업 — Konva Text 의 줄 중앙(midline) 배치와 동일 산식. */
function textBlockMarkup(opts: TextBlockOptions): string {
  const lines = opts.text.split("\n");
  const lineHeightPx = opts.fontSize * opts.lineHeight;
  // verticalAlign middle — 블록 높이를 박스 안 가운데로(Konva alignY 산식).
  const alignY = opts.boxHeight !== undefined ? (opts.boxHeight - lines.length * lineHeightPx) / 2 : 0;
  const anchor = opts.align === "center" ? "middle" : opts.align === "right" ? "end" : "start";
  const anchorX = opts.align === "center" ? opts.x + opts.boxWidth / 2 : opts.align === "right" ? opts.x + opts.boxWidth : opts.x;
  const weight = opts.fontStyle.includes("bold") ? "bold" : undefined;
  const style = opts.fontStyle.includes("italic") ? "italic" : undefined;
  const spans = lines
    .map((line, i) => {
      const baseline = opts.y + alignY + (i + 0.5) * lineHeightPx + opts.fontSize * BASELINE_EM;
      return `<tspan x="${fmt(anchorX)}" y="${fmt(baseline)}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  const strokeAttrs =
    opts.stroke && (opts.strokeWidth ?? 0) > 0
      ? `${att("stroke", opts.stroke)}${att("stroke-width", opts.strokeWidth)} paint-order="stroke" stroke-linejoin="round"`
      : "";
  return (
    `<text xml:space="preserve" font-family="${escapeXml(opts.fontFamily)}" font-size="${fmt(opts.fontSize)}"` +
    `${att("font-weight", weight)}${att("font-style", style)}` +
    `${opts.letterSpacing !== 0 ? att("letter-spacing", opts.letterSpacing) : ""}` +
    ` text-anchor="${anchor}" fill="${escapeXml(opts.fill)}"${strokeAttrs}${opts.filter ? att("filter", opts.filter) : ""}>` +
    `${spans}</text>`
  );
}

// ---------------------------------------------------------------------------
// 세로쓰기(縦組み) — studio-vertical-text 코어를 캔버스와 같은 지오메트리로 SVG에 옮긴다
// ---------------------------------------------------------------------------

/**
 * SVG 내보내기용 세로쓰기 글자 폭 측정기 — 이 모듈은 순수/Worker 안전이라 캔버스 measureText를
 * 쓸 수 없으므로 `estimateLineWidth` 근사를 쓴다. 한글/한자만 있는 세로쓰기는 회전 런이 없어
 * 폭 측정 자체가 호출되지 않으므로 화면과 열 나눔이 정확히 같다. 라틴/숫자 구간이 섞이면
 * 그 런의 길이만 근사가 되어 열 나눔 지점이 화면과 달라질 수 있고, 그때는 정직하게 고지한다.
 */
const SVG_VERTICAL_MEASURER: VerticalTextMeasurer = {
  measureWidth: (text, fontPx) => estimateLineWidth(text, fontPx, 0),
};

interface VerticalTextBlockOptions {
  layout: VerticalTextLayout;
  fontSize: number;
  letterSpacing: number;
  fontFamily: string;
  fontStyle: "normal" | "bold" | "italic" | "bold italic";
  /** 단색이면 그대로, 그라데이션이면 아이템 로컬 좌표계마다 새 def를 만들어야 해 콜백으로 받는다. */
  fill: (item: VerticalTextItem) => string;
  stroke?: string;
  strokeWidth?: number;
  filter?: string;
}

/**
 * 세로쓰기 블록 마크업 — 아이템마다 `<g transform="translate(x y)[ rotate(90)]">` 안에 로컬
 * 원점 기준 `textBlockMarkup`을 하나 넣는다. Konva 쪽(StudioKonvaTextNodes의 세로쓰기 노드)이
 * 만드는 노드 트리와 **좌표계가 1:1로 대응**하므로(자식 노드 = 이 `<g>`), 그라데이션처럼 노드
 * 로컬 좌표계에서 해석되는 값도 캔버스와 같은 결과가 된다.
 */
function verticalTextBlockMarkup(opts: VerticalTextBlockOptions): string {
  const parts: string[] = [];
  for (const column of opts.layout.columns) {
    for (const item of column.items) {
      const { boxWidth, lineHeight, scaleX } = verticalTextItemGeometry(item, opts.fontSize);
      const rotated = item.rotation === 90;
      const block = textBlockMarkup({
        text: item.text,
        x: 0,
        y: 0,
        boxWidth: rotated ? 0 : boxWidth,
        fontSize: opts.fontSize,
        lineHeight,
        letterSpacing: rotated ? opts.letterSpacing : 0,
        align: rotated ? "left" : "center",
        fontFamily: opts.fontFamily,
        fontStyle: opts.fontStyle,
        fill: opts.fill(item),
        stroke: opts.stroke,
        strokeWidth: opts.strokeWidth,
        filter: opts.filter,
      });
      const transform =
        `translate(${fmt(item.x)} ${fmt(item.y)})`
        + `${rotated ? " rotate(90)" : ""}`
        + `${scaleX !== 1 ? ` scale(${fmt(scaleX)} 1)` : ""}`;
      parts.push(`<g transform="${transform}">${block}</g>`);
    }
  }
  return parts.join("");
}

function horizontalRubyBlockMarkup(
  placements: readonly StudioRubyOverlayPlacement[],
  options: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly fontFamily: string;
    readonly fontStyle: "normal" | "bold" | "italic" | "bold italic";
    readonly fill: string;
  },
): string {
  return placements
    .map((placement) => textBlockMarkup({
      text: placement.ruby,
      x: options.offsetX + placement.x,
      y: options.offsetY + placement.y,
      boxWidth: Math.max(placement.baseWidth, 1),
      fontSize: placement.rubyFontSize,
      lineHeight: 1,
      letterSpacing: 0,
      align: "center",
      fontFamily: options.fontFamily,
      fontStyle: options.fontStyle,
      fill: options.fill,
    }))
    .join("");
}

function verticalRubyBlockMarkup(
  plan: StudioVerticalRubyLayoutPlan,
  options: {
    readonly fontFamily: string;
    readonly fontStyle: "normal" | "bold" | "italic" | "bold italic";
    readonly fill: string;
  },
): string {
  return plan.placements
    .map((placement) => textBlockMarkup({
      text: [...placement.ruby].join("\n"),
      x: placement.x,
      y: placement.y,
      boxWidth: placement.width,
      boxHeight: placement.height,
      fontSize: placement.rubyFontSize,
      lineHeight: placement.rubyGlyphAdvance / placement.rubyFontSize,
      letterSpacing: 0,
      align: "center",
      fontFamily: options.fontFamily,
      fontStyle: options.fontStyle,
      fill: options.fill,
    }))
    .join("");
}

function reportVerticalRubyPlan(
  ctx: ExportCtx,
  el: { readonly id: string; readonly type: string },
  plan: StudioVerticalRubyLayoutPlan,
): void {
  for (const warning of plan.warnings) {
    addSkip(ctx, el, "approximated", `세로 루비 경고(${warning.code}): ${warning.message}`);
  }
  for (const unsupported of plan.unsupported) {
    addSkip(ctx, el, "skipped", `세로 루비 미지원(${unsupported.code}): ${unsupported.message}`);
  }
}

function serializeText(ctx: ExportCtx, el: SvgTextElLike): string {
  const fontFamily = el.font ?? "Pretendard, sans-serif";
  const fontStyle = el.fontStyle ?? "bold";
  ctx.fonts.add(fontFamily);
  const transform = nodeTransform(el.x, el.y, el.rotation, el);
  const opacity = el.opacity ?? 1;
  const shadowEnabled = !!el.shadowColor && (el.shadowOpacity ?? 0) > 0;
  const filter = shadowEnabled
    ? shadowFilterDef(ctx, {
        color: el.shadowColor ?? "#000000",
        blur: el.shadowBlur ?? 0,
        offsetX: el.shadowOffsetX ?? 0,
        offsetY: el.shadowOffsetY ?? 0,
        opacity: el.shadowOpacity ?? 1,
      })
    : undefined;

  const textPath = normalizeTextPath(el.textPath);
  const usesPath = el.textPath && !isFlatTextPath(textPath);
  const rubySpans = readDialogueRubySpans(el.rubySpans);

  // 채우기 — 그라데이션이면 로컬(0,0 원점) bbox 로 defs 생성(그룹 translate 안이라 로컬 좌표).
  const gradientSpec =
    el.fillType === "gradient"
      ? (el.gradient ?? legacyTextGradientToSpec(el.gradientColorStart, el.gradientColorEnd, el.gradientDirection))
      : null;

  if (usesPath) {
    if (rubySpans) {
      addSkip(ctx, el, "skipped", "곡선 텍스트의 루비 주석은 SVG 경로 조판에서 아직 재현할 수 없어요.");
    }
    const pathData = buildTextPathData(textPath, el.width, el.fontSize);
    const pathId = nextId(ctx, "stp");
    ctx.defs.push(`<path id="${pathId}" d="${escapeXml(pathData)}" fill="none"/>`);
    const fill = gradientSpec
      ? gradientDef(ctx, gradientSpec, { x: 0, y: 0, width: Math.max(1, el.width), height: el.fontSize * 2.8 }, { x: 0, y: 0 })
      : el.fill;
    const align = el.align ?? "left";
    const startOffset = align === "center" ? "50%" : align === "right" ? "100%" : "0";
    const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
    const weight = (el.fontStyle ?? "bold").includes("bold") ? "bold" : undefined;
    const style = (el.fontStyle ?? "bold").includes("italic") ? "italic" : undefined;
    const strokeAttrs =
      el.stroke && (el.strokeWidth ?? 0) > 0
        ? `${att("stroke", el.stroke)}${att("stroke-width", el.strokeWidth)} paint-order="stroke" stroke-linejoin="round"`
        : "";
    return (
      `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}>` +
      `<text xml:space="preserve" font-family="${escapeXml(fontFamily)}" font-size="${fmt(el.fontSize)}"` +
      `${att("font-weight", weight)}${att("font-style", style)}` +
      `${(el.letterSpacing ?? 0) !== 0 ? att("letter-spacing", el.letterSpacing ?? 0) : ""}` +
      ` fill="${escapeXml(fill)}"${strokeAttrs}${filter ? att("filter", filter) : ""}>` +
      `<textPath href="#${pathId}" startOffset="${startOffset}" text-anchor="${anchor}">${escapeXml(el.text)}</textPath>` +
      `</text></g>`
    );
  }

  if (el.vertical) {
    // 세로쓰기 — studio-vertical-text 코어가 캔버스와 같은 열/런 배치를 계산하고, 여기서는
    // 그 좌표를 그대로 <g transform> 으로 옮긴다(StudioKonvaTextNodes 세로쓰기 노드와 1:1 대응).
    // el.width 는 CSS 논리 속성 규약대로 inline size = **열 길이 예산**으로 읽는다.
    const verticalLetterSpacing = el.letterSpacing ?? 0;
    const verticalLayout = layoutVerticalText(
      {
        text: el.text,
        fontSize: el.fontSize,
        lineHeight: el.lineHeight ?? 1.4,
        letterSpacing: verticalLetterSpacing,
        fontFamily,
        fontStyle: el.fontStyle ?? "bold",
        maxColumnLength: el.width,
        blockAlign: verticalBlockAlign(el.align),
      },
      SVG_VERTICAL_MEASURER
    );
    if (
      verticalLayout.columns.some((column) =>
        column.items.some(
          (item) => item.rotation === 90 || item.form === "tate-chu-yoko",
        ),
      )
    ) {
      addSkip(
        ctx,
        el,
        "approximated",
        "세로쓰기 속 라틴/숫자 구간의 폭은 글꼴 실측 없이 근사해 열 나눔이 화면과 조금 다를 수 있어요."
      );
    }
    const verticalBlock = verticalTextBlockMarkup({
      layout: verticalLayout,
      fontSize: el.fontSize,
      letterSpacing: verticalLetterSpacing,
      fontFamily,
      fontStyle,
      fill: (item) =>
        gradientSpec
          ? gradientDef(
              ctx,
              gradientSpec,
              // 캔버스와 동일하게 "블록 전체 bbox를 아이템 로컬 원점으로 옮긴 것"을 쓴다.
              {
                x: -item.x,
                y: -item.y,
                width: Math.max(1, verticalLayout.width),
                height: Math.max(1, verticalLayout.height),
              },
              { x: 0, y: 0 }
            )
          : el.fill,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      filter,
    });
    const verticalRuby = planDialogueVerticalRubyOverlayPlacements(
      el.text,
      rubySpans,
      verticalLayout,
      {
        fontSize: el.fontSize,
        lineHeight: el.lineHeight ?? 1.4,
        letterSpacing: verticalLetterSpacing,
      },
    );
    reportVerticalRubyPlan(ctx, el, verticalRuby);
    const rubyBlock = verticalRubyBlockMarkup(verticalRuby, {
      fontFamily,
      fontStyle,
      fill: el.fill,
    });
    return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}>${verticalBlock}${rubyBlock}</g>`;
  }

  const content = el.text;
  const lineHeight = el.lineHeight ?? 1;
  const letterSpacing = el.letterSpacing ?? 0;
  const fill = gradientSpec
    ? gradientDef(
        ctx,
        gradientSpec,
        estimateTextGradientBBox({ width: el.width, text: content, fontSize: el.fontSize, lineHeight }),
        { x: 0, y: 0 }
      )
    : el.fill;
  // 자동 줄바꿈은 SVG 에 없음 — 수동 줄바꿈 없이 박스 폭을 넘길 것으로 추정되면 근사 고지.
  if (content.split("\n").some((line) => estimateLineWidth(line, el.fontSize, letterSpacing) > el.width * 1.02)) {
    addSkip(ctx, el, "approximated", "자동 줄바꿈은 SVG에 없어 수동 줄바꿈(엔터)만 반영돼요.");
  }
  const block = textBlockMarkup({
    text: content,
    x: 0,
    y: 0,
    boxWidth: el.width,
    fontSize: el.fontSize,
    lineHeight,
    letterSpacing,
    align: el.align ?? "left",
    fontFamily,
    fontStyle,
    fill,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    filter,
  });
  const horizontalRuby = rubySpans
    ? planDialogueRubyOverlayPlacements(content, rubySpans, {
        fontSize: el.fontSize,
        letterSpacing,
        textWidth: el.width,
        align: el.align ?? "left",
      })
    : [];
  if (horizontalRuby.length > 0) {
    addSkip(ctx, el, "approximated", "가로 루비 위치는 SVG에서 글꼴 advance 근사로 배치돼요.");
  } else if (rubySpans) {
    addSkip(ctx, el, "skipped", "유효한 가로 루비 범위를 찾지 못해 루비 주석을 그리지 않았어요.");
  }
  const rubyBlock = horizontalRubyBlockMarkup(horizontalRuby, {
    offsetX: 0,
    offsetY: 0,
    fontFamily,
    fontStyle,
    fill: el.fill,
  });
  return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}>${block}${rubyBlock}</g>`;
}

function serializeSticker(ctx: ExportCtx, el: SvgStickerElLike): string {
  ctx.fonts.add("Arial");
  const transform = nodeTransform(el.x, el.y, el.rotation, el);
  const opacity = el.opacity ?? 1;
  const block = textBlockMarkup({
    text: el.text,
    x: 0,
    y: 0,
    boxWidth: 0,
    fontSize: el.fontSize,
    lineHeight: 1,
    letterSpacing: 0,
    align: "left",
    fontFamily: "Arial",
    fontStyle: "normal",
    fill: "black",
  });
  return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}>${block}</g>`;
}

/** 말풍선 테마 파라미터(StudioPage 렌더의 classic/soft/vivid 분기 포트). */
function bubbleThemeParams(el: SvgBubbleElLike, theme: SvgExportTheme) {
  const avgSize = (el.width + el.height) / 2;
  let stroke = el.stroke ?? "#1f1a16";
  let strokeW = el.strokeWidth ?? (avgSize < 300 ? 2.5 : avgSize < 500 ? 3 : 3.5);
  let radius = 18;
  let tailHeightAdjust = 0;
  let borderRatio = 0.08;
  if (theme === "soft") {
    stroke = el.stroke ?? "#2d2d2d";
    strokeW = el.strokeWidth ?? (avgSize < 300 ? 1.5 : avgSize < 500 ? 1.8 : 2);
    radius = 24;
    tailHeightAdjust = -10;
  } else if (theme === "vivid") {
    stroke = el.stroke ?? "#444444";
    strokeW = el.strokeWidth ?? (avgSize < 300 ? 1.2 : avgSize < 500 ? 1.5 : 1.8);
    radius = Math.min(el.width, el.height) / 2;
    tailHeightAdjust = -14;
    borderRatio = 0.06;
  }
  return { stroke, strokeW, radius, tailHeightAdjust, borderRatio };
}

function serializeBubble(ctx: ExportCtx, el: SvgBubbleElLike): string {
  const theme = ctx.theme;
  const { stroke: bStroke, strokeW: bStrokeW, radius: bRadius, tailHeightAdjust, borderRatio } = bubbleThemeParams(el, theme);
  const tXRatio = el.tailXRatio ?? 0.35;
  const tHeight = el.tailHeight ?? 30;
  const tailDir = el.tail ?? "left";
  const tailDirection = el.tailDirection ?? "bottom";
  const showTail = tailDir !== "none";

  // 본체+꼬리 단일 path — StudioPage 와 동일 정규화(최소변 비례 꼬리 길이/밑동).
  const tailIsVertical = tailDirection === "bottom" || tailDirection === "top";
  const bMinDim = Math.min(el.width, el.height);
  const bTailLen = Math.max(bMinDim * 0.12, Math.min(Math.max(8, tHeight + tailHeightAdjust), bMinDim * 0.3));
  const automaticTailBase = Math.max(
    bMinDim * 0.1,
    (tailIsVertical ? el.width : el.height) * borderRatio * 1.8
  );
  const bTailBase = Math.max(4, Math.min(el.tailBase ?? automaticTailBase, bMinDim * 0.62));
  const bubbleTailSpec: BubbleTailSpec | null = showTail
    ? {
        direction: tailDirection,
        ratio: tailDir === "right" && tailIsVertical ? 1 - tXRatio : tXRatio,
        length: bTailLen,
        base: bTailBase,
        side: "center",
        bend: Math.max(-1, Math.min(el.tailBend ?? 0, 1)),
      }
    : null;
  const bubbleExtraTails = normalizeExtraTails(el.extraTails);
  const speechPathData =
    bubbleExtraTails.length > 0
      ? bubblePathDataMulti(el.width, el.height, bRadius, [...(bubbleTailSpec ? [bubbleTailSpec] : []), ...bubbleExtraTails])
      : bubblePathData(el.width, el.height, bRadius, bubbleTailSpec);

  const body: string[] = [];
  const strokeAttrs = `${att("stroke", bStroke)}${att("stroke-width", bStrokeW)}`;

  if (el.customShapePoints && el.customShapePoints.length >= 6) {
    body.push(
      `<path d="${pointsToPathD(el.customShapePoints, true)}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "shout" || el.variant === "angry") {
    const isShout = el.variant === "shout";
    const outer = isShout ? 68 : 64;
    const innerBase = isShout ? 36 / 68 : 28 / 64;
    const amp = el.starAmplitude ?? innerBase;
    const inner = outer * Math.min(0.95, Math.max(0.1, amp));
    const starStroke = isShout
      ? bStroke
      : theme === "soft"
        ? "#dc2626"
        : theme === "vivid"
          ? "#7f1d1d"
          : "#991b1b";
    const starStrokeW = isShout ? bStrokeW : Math.max(bStrokeW, 3.5);
    body.push(
      `<path d="${escapeXml(burstStarPathData(el.width, el.height, isShout ? 20 : 22, inner, outer))}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(starStroke)}" stroke-width="${fmt(starStrokeW)}" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "double") {
    body.push(
      `<path d="${escapeXml(doubleBubblePathData(el.width, el.height, bubbleTailSpec))}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "thought") {
    body.push(
      `<path d="${escapeXml(thoughtBubbleBodyPath(el.width, el.height))}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
    if (showTail) {
      const thoughtSW = bStrokeW * 0.8;
      const bigX = tailDir === "right" ? el.width * 0.74 : el.width * 0.26;
      const smallX = tailDir === "right" ? el.width * 0.84 : el.width * 0.16;
      const bigY = tailDir === "right" ? el.height * 0.74 : el.height * 0.26;
      const smallY = tailDir === "right" ? el.height * 0.84 : el.height * 0.16;
      const dot = (x: number, y: number, rx: number, ry: number) =>
        `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(bStroke)}" stroke-width="${fmt(thoughtSW)}"/>`;
      if (tailDirection === "bottom") {
        body.push(dot(bigX, el.height + 14, 14, 11), dot(bigX, el.height + 32, 10, 8), dot(smallX, el.height + 54, 6, 5));
      } else if (tailDirection === "top") {
        body.push(dot(bigX, -14, 14, 11), dot(bigX, -32, 10, 8), dot(smallX, -54, 6, 5));
      } else if (tailDirection === "left") {
        body.push(dot(-14, bigY, 11, 14), dot(-32, bigY, 8, 10), dot(-54, smallY, 5, 6));
      } else {
        body.push(dot(el.width + 14, bigY, 11, 14), dot(el.width + 32, bigY, 8, 10), dot(el.width + 54, smallY, 5, 6));
      }
    }
  } else if (el.variant === "whisper") {
    body.push(
      `<path d="${escapeXml(speechPathData)}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="8 5"/>`
    );
  } else if (el.variant === "scared") {
    const scaredFill = el.fill === "transparent" ? "transparent" : el.fill === "#ffffff" ? "#f5f3ff" : el.fill;
    body.push(
      `<path d="${escapeXml(scaredBubblePathData(el.width, el.height, bubbleTailSpec))}" fill="${escapeXml(scaredFill)}" stroke="#7c3aed" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "system") {
    body.push(
      `<rect width="${fmt(el.width)}" height="${fmt(el.height)}" rx="4" fill="#0a0f24" opacity="0.88" stroke="#0ea5e9" stroke-width="2.5"/>`,
      `<rect x="4" y="4" width="${fmt(el.width - 8)}" height="${fmt(el.height - 8)}" rx="2" fill="none" stroke="#38bdf8" stroke-width="1" opacity="0.5"/>`
    );
  } else if (el.variant === "phone") {
    const phoneRadius = theme === "soft" ? 10 : theme === "vivid" ? 6 : 8;
    const bMinDim = Math.min(el.width, el.height);
    const phoneTail =
      showTail && bubbleTailSpec
        ? {
            ...bubbleTailSpec,
            length: Math.min(bubbleTailSpec.length, Math.max(8, bMinDim * 0.1)),
            base: Math.min(bubbleTailSpec.base, Math.max(6, bMinDim * 0.12)),
          }
        : null;
    body.push(
      `<path d="${escapeXml(bubblePathData(el.width, el.height, phoneRadius, phoneTail))}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "heart") {
    body.push(
      `<path d="${escapeXml(heartBubblePathData(el.width, el.height))}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
  } else if (el.variant === "box") {
    const boxRadius = theme === "soft" ? 6 : theme === "vivid" ? 3 : 4;
    body.push(
      `<rect width="${fmt(el.width)}" height="${fmt(el.height)}" rx="${fmt(boxRadius)}" fill="${escapeXml(el.fill)}"${strokeAttrs}/>`
    );
  } else {
    // speech(기본) — 본체+꼬리 단일 path.
    body.push(
      `<path d="${escapeXml(speechPathData)}" fill="${escapeXml(el.fill)}"${strokeAttrs} stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }

  // 말풍선 텍스트 — StudioPage 여백/행간/자간 규약 그대로.
  const fontFamily = el.font ?? "Pretendard, sans-serif";
  ctx.fonts.add(fontFamily);
  const bFs = el.fontSize ?? 24;
  const bHPad = Math.max(12, Math.round(bFs * 0.6));
  const bVPadTop = Math.max(8, Math.round(bFs * 0.48));
  const bVPadBot = Math.max(10, Math.round(bFs * 0.64));
  const lineHeight = el.lineHeight ?? (el.vertical ? 1.4 : theme === "soft" ? 1.35 : theme === "vivid" ? 1.2 : 1.25);
  const letterSpacing = theme === "vivid" ? 0 : 0.3;
  const content = el.text;
  const boxWidth = Math.max(8, el.width - bHPad * 2);
  const boxHeight = Math.max(8, el.height - (bVPadTop + bVPadBot));
  const bubbleFontStyle = el.fontStyle ?? "bold";
  const rubySpans = readDialogueRubySpans(el.rubySpans);
  if (el.vertical && content.trim().length > 0) {
    const verticalLayout = layoutVerticalText(
      {
        text: content,
        fontSize: bFs,
        lineHeight,
        letterSpacing,
        fontFamily,
        fontStyle: bubbleFontStyle,
        maxColumnLength: boxHeight,
        blockAlign: verticalBlockAlign(el.align),
      },
      SVG_VERTICAL_MEASURER,
    );
    if (
      verticalLayout.columns.some((column) =>
        column.items.some((item) => item.rotation === 90 || item.form === "tate-chu-yoko"),
      )
    ) {
      addSkip(
        ctx,
        el,
        "approximated",
        "말풍선 세로쓰기 속 라틴/숫자 폭은 글꼴 실측 없이 근사해 열 나눔이 화면과 조금 다를 수 있어요.",
      );
    }
    const verticalRuby = planDialogueVerticalRubyOverlayPlacements(
      content,
      rubySpans,
      verticalLayout,
      { fontSize: bFs, lineHeight, letterSpacing },
    );
    reportVerticalRubyPlan(ctx, el, verticalRuby);
    const baseMarkup = verticalTextBlockMarkup({
      layout: verticalLayout,
      fontSize: bFs,
      letterSpacing,
      fontFamily,
      fontStyle: bubbleFontStyle,
      fill: () => el.textFill,
    });
    const rubyMarkup = verticalRubyBlockMarkup(verticalRuby, {
      fontFamily,
      fontStyle: bubbleFontStyle,
      fill: el.textFill,
    });
    const verticalX = bHPad + Math.max(0, (boxWidth - verticalLayout.width) / 2);
    const verticalY = bVPadTop + Math.max(0, (boxHeight - verticalLayout.height) / 2);
    body.push(`<g transform="translate(${fmt(verticalX)} ${fmt(verticalY)})">${baseMarkup}${rubyMarkup}</g>`);
  } else if (content.trim().length > 0) {
    if (content.split("\n").some((line) => estimateLineWidth(line, bFs, letterSpacing) > boxWidth * 1.02)) {
      addSkip(ctx, el, "approximated", "말풍선 자동 줄바꿈은 SVG에 없어 수동 줄바꿈(엔터)만 반영돼요.");
    }
    body.push(
      textBlockMarkup({
        text: content,
        x: bHPad,
        y: bVPadTop,
        boxWidth,
        boxHeight,
        fontSize: bFs,
        lineHeight,
        letterSpacing,
        align: el.align ?? "center",
        fontFamily,
        fontStyle: bubbleFontStyle,
        fill: el.textFill,
      })
    );
    const horizontalRuby = rubySpans
      ? planDialogueRubyOverlayPlacements(content, rubySpans, {
          fontSize: bFs,
          letterSpacing,
          textWidth: boxWidth,
          align: el.align ?? "center",
        })
      : [];
    if (horizontalRuby.length > 0) {
      addSkip(ctx, el, "approximated", "말풍선 가로 루비 위치는 SVG에서 글꼴 advance 근사로 배치돼요.");
    } else if (rubySpans) {
      addSkip(ctx, el, "skipped", "유효한 말풍선 가로 루비 범위를 찾지 못해 루비 주석을 그리지 않았어요.");
    }
    body.push(horizontalRubyBlockMarkup(horizontalRuby, {
      offsetX: bHPad,
      offsetY: bVPadTop,
      fontFamily,
      fontStyle: bubbleFontStyle,
      fill: el.textFill,
    }));
  }

  const transform = nodeTransform(el.x, el.y, el.rotation);
  const opacity = el.opacity ?? 1;
  return `<g${transform ? att("transform", transform) : ""}${opacity !== 1 ? att("opacity", opacity) : ""}>${body.join("")}</g>`;
}

// ---------------------------------------------------------------------------
// 메인 — 페이지 → SVG
// ---------------------------------------------------------------------------

export function exportPageToSvg(input: SvgExportPageInput): SvgExportResult {
  const ctx: ExportCtx = {
    defs: [],
    skips: [],
    fonts: new Set<string>(),
    theme: input.theme ?? "classic",
    brushTextureAssets: new Map(),
    brushTextureAssetsByAlphaMap: new Map(),
    brushTextureSerializedUtf16Bytes: 0,
    r8EmbeddedRgbaBytes: 0,
    seq: 0,
  };
  const groups: LayerGroup[] = [...(input.groups ?? [])];
  const body: string[] = [];

  // 배경 — 캔버스 bg 레이어와 동일(그라데이션은 세로 2색).
  if (!input.transparentBg) {
    const grad = input.bgGrad;
    if (grad && grad.length >= 2) {
      const id = nextId(ctx, "sg");
      ctx.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${fmt(input.height)}"><stop offset="0%" stop-color="${escapeXml(grad[0])}"/><stop offset="100%" stop-color="${escapeXml(grad[1])}"/></linearGradient>`
      );
      body.push(`<rect width="${fmt(input.width)}" height="${fmt(input.height)}" fill="url(#${id})"/>`);
    } else {
      body.push(`<rect width="${fmt(input.width)}" height="${fmt(input.height)}" fill="${escapeXml(input.bg ?? "#ffffff")}"/>`);
    }
  }

  let elementCount = 0;
  for (const el of input.elements) {
    if (isEffectivelyHidden(el, groups)) continue; // 숨긴 레이어/그룹은 캔버스 내보내기와 동일하게 제외
    elementCount += 1;

    let markup = "";
    switch (el.type) {
      case "image":
        markup = serializeImage(ctx, el);
        break;
      case "frame":
        markup = serializeFrame(ctx, el);
        break;
      case "focusLines":
        markup = serializeFocusLines(el);
        break;
      case "speedLines":
        markup = serializeSpeedLines(el);
        break;
      case "draw":
        markup = serializeDraw(ctx, el);
        break;
      case "text":
        markup = serializeText(ctx, el);
        break;
      case "sticker":
        markup = serializeSticker(ctx, el);
        break;
      case "bubble":
        markup = serializeBubble(ctx, el);
        break;
    }
    if (!markup) continue;

    // 아래 레이어 클리핑(알파 마스크) — SVG 로 재현 불가, 자르지 않고 표시(근사 고지).
    if (el.clipBelow) {
      addSkip(ctx, el, "approximated", "아래 레이어로 자르기(클리핑 마스크)는 SVG에서 지원되지 않아 자르지 않고 표시돼요.");
    }

    // 패널 클리핑 + 혼합 모드 — 캔버스 wrapClip 과 동일 조건.
    const panel = el.type !== "frame" && !el.noClip ? containingPanel(el, input.elements) : null;
    const blend = el.blendMode && el.blendMode !== "source-over" ? el.blendMode : null;
    let blendStyle = "";
    if (blend) {
      if (CSS_BLEND_MODES.has(blend)) {
        blendStyle = ` style="mix-blend-mode:${blend}"`;
      } else {
        addSkip(ctx, el, "approximated", `혼합 모드(${blend})는 SVG에서 지원되지 않아 보통 합성으로 표시돼요.`);
      }
    }
    if (panel) {
      const clipId = nextId(ctx, "sc");
      ctx.defs.push(
        `<clipPath id="${clipId}"><rect x="${fmt(panel.x)}" y="${fmt(panel.y)}" width="${fmt(panel.width)}" height="${fmt(panel.height)}"/></clipPath>`
      );
      markup = `<g clip-path="url(#${clipId})"${blendStyle}>${markup}</g>`;
    } else if (blendStyle) {
      markup = `<g${blendStyle}>${markup}</g>`;
    }
    body.push(markup);
  }

  const caveats: string[] = [];
  if (ctx.fonts.size > 0) {
    caveats.push("글꼴은 SVG 파일에 임베드되지 않아요 — 보는 기기에 설치된 글꼴로 표시돼요.");
  }

  const defsMarkup = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(input.width)}" height="${fmt(input.height)}" viewBox="0 0 ${fmt(input.width)} ${fmt(input.height)}">` +
    defsMarkup +
    body.join("") +
    `</svg>`;

  return {
    svg,
    skipped: ctx.skips,
    fontFamilies: [...ctx.fonts],
    caveats,
    elementCount,
  };
}

/** 내보내기 결과 요약 한 줄(한글) — 내보내기 패널 상태 문구용. 정직하게 제외/근사 개수를 밝힌다. */
export function svgExportResultMessage(result: SvgExportResult): string {
  const droppedIds = new Set(result.skipped.filter((s) => s.mode === "skipped").map((s) => s.id));
  const approxIds = new Set(result.skipped.filter((s) => s.mode === "approximated" && !droppedIds.has(s.id)).map((s) => s.id));
  const parts = [`SVG 저장 완료 — 요소 ${result.elementCount}개 벡터 변환`];
  if (droppedIds.size > 0) parts.push(`제외 ${droppedIds.size}개`);
  if (approxIds.size > 0) parts.push(`근사 ${approxIds.size}개`);
  if (droppedIds.size === 0 && approxIds.size === 0 && result.elementCount > 0) parts.push("전부 벡터 보존");
  return parts.join(" · ");
}
