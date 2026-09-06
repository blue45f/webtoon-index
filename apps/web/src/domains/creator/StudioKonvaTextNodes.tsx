import { Group as KGroup, Text as KText, TextPath as KTextPath } from "react-konva/lib/ReactKonvaCore";

import {
  verticalBlockAlign,
  verticalTextItemGeometry,
  verticalTextLayout,
} from "./lettering/studio-bubble-text-runtime";
import {
  planDialogueRubyOverlayPlacements,
  planDialogueVerticalRubyOverlayPlacements,
  readDialogueRubySpans,
} from "./lettering/studio-dialogue-ruby-layout";
import {
  buildTextPathData,
  isFlatTextPath,
  normalizeTextPath,
  textPathAdvanceWidth,
} from "./lettering/studio-text-path";
import {
  estimateTextGradientBBox,
  konvaGradientProps,
  legacyTextGradientToSpec,
} from "./studio-gradient-engine";
import { textNodeProps } from "./studio-node-props";
import { toKonvaSkewAttrs } from "./studio-skew";

import type { El } from "./studio-element-model";
import type Konva from "konva";

export interface StudioTextTransformOptions {
  minFontSize: number;
  patchWidth?: boolean;
}

interface StudioKonvaTextInteractionProps {
  draggable: boolean;
  innerRef: (node: Konva.Node | null) => void;
  onSelect: () => void;
  onEdit: (id: string) => void;
  onPatch: (id: string, patch: Partial<El>) => void;
  dragBoundFunc: (pos: Konva.Vector2d) => Konva.Vector2d;
  onInteractionBegin: () => boolean;
  onInteractionEnd: () => void;
  onCommitTransform: (
    elId: string,
    fontSize: number,
    event: Konva.KonvaEventObject<Event>,
    options: StudioTextTransformOptions,
  ) => void;
}

export interface StudioKonvaTextNodeProps extends StudioKonvaTextInteractionProps {
  el: Extract<El, { type: "text" }>;
}

export interface StudioKonvaStickerNodeProps extends StudioKonvaTextInteractionProps {
  el: Extract<El, { type: "sticker" }>;
}

export function StudioKonvaTextNode({
  el,
  draggable,
  innerRef,
  onSelect,
  onEdit,
  onPatch,
  dragBoundFunc,
  onInteractionBegin,
  onInteractionEnd,
  onCommitTransform,
}: StudioKonvaTextNodeProps) {
  const interactionProps = textNodeProps<Partial<El>>({
    id: el.id,
    draggable,
    dragBoundFunc,
    onSelect,
    onEdit,
    onPatch,
    onInteractionBegin,
    onInteractionEnd,
  });

  if (el.textPath && !isFlatTextPath(normalizeTextPath(el.textPath))) {
    // 경로는 요소 박스 폭이 아니라 **글자가 실제로 먹는 폭**을 담아야 한다 — Konva TextPath는
    // 경로 길이를 넘는 글자를 조용히 버린다(studio-text-path의 "경로 길이 = 글자 예산").
    const pathAdvance = textPathAdvanceWidth({
      text: el.text,
      fontSize: el.fontSize,
      fontFamily: el.font ?? "Pretendard, sans-serif",
      fontStyle: el.fontStyle ?? "bold",
      letterSpacing: el.letterSpacing ?? 0,
    });
    return (
      <KTextPath
        studioElementId={el.id}
        key={el.id}
        ref={innerRef}
        text={el.text}
        x={el.x}
        y={el.y}
        data={buildTextPathData(normalizeTextPath(el.textPath), el.width, el.fontSize, pathAdvance)}
        fontSize={el.fontSize}
        fill={el.fillType === "gradient" ? undefined : el.fill}
        {...(el.fillType === "gradient"
          ? konvaGradientProps(
              el.gradient ?? legacyTextGradientToSpec(el.gradientColorStart, el.gradientColorEnd, el.gradientDirection),
              // 곡선 텍스트 로컬 bbox 근사 — baseline(fontSize×1.4) 중심으로 위아래 글자 폭 커버.
              // 폭은 박스가 아니라 글자가 실제로 뻗는 길이 기준(경로가 박스보다 길어질 수 있다).
              { x: 0, y: 0, width: Math.max(1, el.width, pathAdvance), height: el.fontSize * 2.8 },
            )
          : {})}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth ?? 0}
        fillAfterStrokeEnabled
        lineJoin="round"
        rotation={el.rotation}
        opacity={el.opacity ?? 1}
        fontFamily={el.font ?? "Pretendard, sans-serif"}
        fontStyle={el.fontStyle ?? "bold"}
        align={el.align ?? "left"}
        letterSpacing={el.letterSpacing ?? 0}
        shadowColor={el.shadowColor}
        shadowBlur={el.shadowBlur}
        shadowOffsetX={el.shadowOffsetX}
        shadowOffsetY={el.shadowOffsetY}
        shadowOpacity={el.shadowOpacity}
        shadowEnabled={!!el.shadowColor && (el.shadowOpacity ?? 0) > 0}
        {...toKonvaSkewAttrs(el)}
        {...interactionProps}
        onTransformEnd={(event) => onCommitTransform(el.id, el.fontSize, event, { minFontSize: 10 })}
      />
    );
  }

  if (el.vertical) {
    // Vertical base and ruby share one transform group so selection/edit/resize semantics stay atomic.
    return (
      <StudioKonvaVerticalTextNode
        el={el}
        innerRef={innerRef}
        interactionProps={interactionProps}
        onCommitTransform={onCommitTransform}
      />
    );
  }

  const text = el.text;
  const fontFamily = el.font ?? "Pretendard, sans-serif";
  const fontStyle = el.fontStyle ?? "bold";
  const letterSpacing = el.letterSpacing ?? 0;
  const lineHeight = el.lineHeight ?? 1;
  const align = el.align ?? "left";
  const fill = el.fillType === "gradient" ? undefined : el.fill;
  const gradientProps =
    el.fillType === "gradient"
      ? konvaGradientProps(
          el.gradient ?? legacyTextGradientToSpec(el.gradientColorStart, el.gradientColorEnd, el.gradientDirection),
          estimateTextGradientBBox({
            width: el.width,
            text,
            fontSize: el.fontSize,
            lineHeight,
          }),
        )
      : {};
  const shadowEnabled = !!el.shadowColor && (el.shadowOpacity ?? 0) > 0;

  // rubySpans is a stable element-model field; base stays one KText and each horizontal reading is
  // a smaller overlay Text centered on its annotated segment.
  const rubySpans = readDialogueRubySpans(el.rubySpans);
  const rubyOverlays = rubySpans
    ? planDialogueRubyOverlayPlacements(text, rubySpans, {
        fontSize: el.fontSize,
        letterSpacing,
        textWidth: el.width,
        align,
      })
    : [];

  if (rubyOverlays.length > 0) {
    return (
      <KGroup
        studioElementId={el.id}
        key={el.id}
        ref={innerRef}
        x={el.x}
        y={el.y}
        width={el.width}
        rotation={el.rotation}
        opacity={el.opacity ?? 1}
        {...toKonvaSkewAttrs(el)}
        {...interactionProps}
        onTransformEnd={(event: Konva.KonvaEventObject<Event>) =>
          onCommitTransform(el.id, el.fontSize, event, { minFontSize: 10, patchWidth: true })
        }
      >
        <KText
          text={text}
          x={0}
          y={0}
          width={el.width}
          fontSize={el.fontSize}
          fill={fill}
          {...gradientProps}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth ?? 0}
          fillAfterStrokeEnabled
          lineJoin="round"
          fontFamily={fontFamily}
          fontStyle={fontStyle}
          align={align}
          letterSpacing={letterSpacing}
          lineHeight={lineHeight}
          shadowColor={el.shadowColor}
          shadowBlur={el.shadowBlur}
          shadowOffsetX={el.shadowOffsetX}
          shadowOffsetY={el.shadowOffsetY}
          shadowOpacity={el.shadowOpacity}
          shadowEnabled={shadowEnabled}
        />
        {rubyOverlays.map((placement) => (
          <KText
            key={`ruby-${placement.start}-${placement.end}-${placement.ruby}`}
            text={placement.ruby}
            x={placement.x}
            y={placement.y}
            width={Math.max(placement.baseWidth, 1)}
            align="center"
            wrap="none"
            fontSize={placement.rubyFontSize}
            fontFamily={fontFamily}
            fontStyle={fontStyle}
            // Solid fill only — gradient on tiny ruby overlays is out of MVP scope.
            fill={el.fill}
            // listening=false so selection/transform stay on the group, not tiny ruby hits.
            listening={false}
          />
        ))}
      </KGroup>
    );
  }

  return (
    <KText
      studioElementId={el.id}
      key={el.id}
      ref={innerRef}
      text={text}
      x={el.x}
      y={el.y}
      width={el.width}
      fontSize={el.fontSize}
      fill={fill}
      {...gradientProps}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth ?? 0}
      fillAfterStrokeEnabled
      lineJoin="round"
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      fontFamily={fontFamily}
      fontStyle={fontStyle}
      align={align}
      letterSpacing={letterSpacing}
      lineHeight={lineHeight}
      shadowColor={el.shadowColor}
      shadowBlur={el.shadowBlur}
      shadowOffsetX={el.shadowOffsetX}
      shadowOffsetY={el.shadowOffsetY}
      shadowOpacity={el.shadowOpacity}
      shadowEnabled={shadowEnabled}
      {...toKonvaSkewAttrs(el)}
      {...interactionProps}
      onTransformEnd={(event) => onCommitTransform(el.id, el.fontSize, event, { minFontSize: 10, patchWidth: true })}
    />
  );
}

/**
 * 세로쓰기(縦組み) 텍스트 노드 — studio-vertical-text.ts 코어가 계산한 열/런 배치를 Konva 노드로
 * 옮긴다. 한 줄짜리 KText로는 표현할 수 없는 것들(라틴/숫자 런의 90° 회전, 、。의 우상단 이동,
 * 열 단위 줄바꿈)이 있어 Group + 런별 노드로 그린다. 연속 직립 글자는 코어가 하나의 런으로 합쳐
 * 주므로 보통 열마다 노드 1개면 끝난다.
 *
 * 상자 대응(CSS 논리 속성 규약): 세로쓰기에서 줄바꿈을 결정하는 축은 **열 길이(세로)** 이므로
 * `el.width`(요소가 가진 유일한 상자 치수 = inline size)를 열 길이 예산으로 읽는다. CSS의
 * `writing-mode: vertical-rl`에서 inline-size가 물리적 높이에 대응하는 것과 같은 매핑이다.
 * 블록의 좌상단을 (el.x, el.y)에 두는 것은 다른 모든 요소와 동일하며, 레거시
 * `formatVerticalText` 근사가 만들던 배치(마지막 열이 x=0에서 시작)와도 같은 방향이다.
 */
function StudioKonvaVerticalTextNode({
  el,
  innerRef,
  interactionProps,
  onCommitTransform,
}: {
  el: Extract<El, { type: "text" }>;
  innerRef: (node: Konva.Node | null) => void;
  interactionProps: Record<string, unknown>;
  onCommitTransform: StudioKonvaTextInteractionProps["onCommitTransform"];
}) {
  const fontFamily = el.font ?? "Pretendard, sans-serif";
  const fontStyle = el.fontStyle ?? "bold";
  const lineHeight = el.lineHeight ?? 1.4;
  const letterSpacing = el.letterSpacing ?? 0;
  const layout = verticalTextLayout({
    text: el.text,
    fontSize: el.fontSize,
    // 세로쓰기 기본 행간은 1.4 — 가로쓰기 기본값 1은 열이 서로 맞닿아 읽을 수 없다(말풍선의
    // 세로쓰기 기본값 `el.vertical ? 1.4 : …`와 같은 값을 쓴다).
    lineHeight,
    letterSpacing,
    fontFamily,
    fontStyle,
    maxColumnLength: el.width,
    blockAlign: verticalBlockAlign(el.align),
  });
  const rubySpans = readDialogueRubySpans(el.rubySpans);
  const verticalRuby = planDialogueVerticalRubyOverlayPlacements(
    el.text,
    rubySpans,
    layout,
    { fontSize: el.fontSize, lineHeight, letterSpacing },
  );
  const gradientSpec =
    el.fillType === "gradient"
      ? (el.gradient ?? legacyTextGradientToSpec(el.gradientColorStart, el.gradientColorEnd, el.gradientDirection))
      : null;

  return (
    <KGroup
      studioElementId={el.id}
      key={el.id}
      ref={innerRef}
      x={el.x}
      y={el.y}
      // Group의 width/height는 렌더에 쓰이지 않지만 StudioPage commitTextTransformEnd가
      // node.width()로 새 el.width를 계산하므로 가로쓰기와 같은 의미(inline size)를 유지한다.
      width={el.width}
      height={layout.height}
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      {...toKonvaSkewAttrs(el)}
      {...interactionProps}
      onTransformEnd={(event: Konva.KonvaEventObject<Event>) =>
        onCommitTransform(el.id, el.fontSize, event, { minFontSize: 10, patchWidth: true })
      }
    >
      {layout.columns.flatMap((column) =>
        column.items.map((item, itemIndex) => {
          const { boxWidth, lineHeight: itemLineHeight, scaleX } = verticalTextItemGeometry(
            item,
            el.fontSize,
          );
          return (
            <KText
              key={`${column.index}-${itemIndex}`}
              text={item.text}
              x={item.x}
              y={item.y}
              rotation={item.rotation}
              scaleX={scaleX}
              {...(item.rotation === 0
                ? // 열 폭(1em) 상자에 글자를 가운데로. wrap="none" — 이 상자는 이미 열 코어가
                  // 정한 조판 결과라 Konva가 다시 줄바꿈하면 안 된다(폭이 1em보다 넓은 이모지 등).
                  { width: boxWidth, align: "center" as const, wrap: "none" as const }
                : {})}
              fontSize={el.fontSize}
              fontFamily={fontFamily}
              fontStyle={fontStyle}
              lineHeight={itemLineHeight}
              letterSpacing={item.rotation === 90 ? letterSpacing : 0}
              fill={gradientSpec ? undefined : el.fill}
              {...(gradientSpec
                ? konvaGradientProps(gradientSpec, {
                    // 그라데이션은 블록 전체 기준 — 자식 로컬 좌표로 원점을 옮겨 이어붙인다.
                    x: -item.x,
                    y: -item.y,
                    width: Math.max(1, layout.width),
                    height: Math.max(1, layout.height),
                  })
                : {})}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth ?? 0}
              fillAfterStrokeEnabled
              lineJoin="round"
              shadowColor={el.shadowColor}
              shadowBlur={el.shadowBlur}
              shadowOffsetX={el.shadowOffsetX}
              shadowOffsetY={el.shadowOffsetY}
              shadowOpacity={el.shadowOpacity}
              shadowEnabled={!!el.shadowColor && (el.shadowOpacity ?? 0) > 0}
            />
          );
        }),
      )}
      {verticalRuby.placements.map((placement) => (
        <KText
          key={`vertical-ruby-${placement.spanIndex}-${placement.fragmentIndex}`}
          name="studio-vertical-ruby"
          text={[...placement.ruby].join("\n")}
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          align="center"
          wrap="none"
          rotation={0}
          fontSize={placement.rubyFontSize}
          fontFamily={fontFamily}
          fontStyle={fontStyle}
          lineHeight={placement.rubyGlyphAdvance / placement.rubyFontSize}
          fill={el.fill}
          listening={false}
        />
      ))}
    </KGroup>
  );
}

export function StudioKonvaStickerNode({
  el,
  draggable,
  innerRef,
  onSelect,
  onEdit,
  onPatch,
  dragBoundFunc,
  onInteractionBegin,
  onInteractionEnd,
  onCommitTransform,
}: StudioKonvaStickerNodeProps) {
  return (
    <KText
      studioElementId={el.id}
      key={el.id}
      ref={innerRef}
      text={el.text}
      x={el.x}
      y={el.y}
      fontSize={el.fontSize}
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      {...toKonvaSkewAttrs(el)}
      {...textNodeProps<Partial<El>>({
        id: el.id,
        draggable,
        dragBoundFunc,
        onSelect,
        onEdit,
        onPatch,
        onInteractionBegin,
        onInteractionEnd,
      })}
      onTransformEnd={(event) => onCommitTransform(el.id, el.fontSize, event, { minFontSize: 16 })}
    />
  );
}
