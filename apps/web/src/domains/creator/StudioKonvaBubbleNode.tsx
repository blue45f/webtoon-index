import {
  Circle as KCircle,
  Ellipse,
  Group,
  Line,
  Path,
  Rect,
  Text as KText,
} from "react-konva/lib/ReactKonvaCore";

import { normalizeStrokeStyle, strokeDashArray } from "./brush/studio-stroke-shapes";
import {
  computeBubbleShapeGeometry,
  hasCustomBubbleShape,
  normalizeCustomShapePoints,
} from "./lettering/studio-bubble-custom-shape";
import {
  normalizeBubbleOutlineStyle,
  styledBubblePathData,
  styledBubblePolygonPathData,
} from "./lettering/studio-bubble-outline-style";
import {
  BURST_STAR_VARIANT_PARAMS,
  bubblePathData,
  bubblePathDataMulti,
  burstStarPathData,
  doubleBubblePathData,
  heartBubblePathData,
  normalizeBurstStarPoints,
  normalizeExtraTails,
  scaredBubblePathData,
  thoughtBubbleBodyPath,
  thoughtTailDots,
} from "./lettering/studio-bubble-path";
import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleHorizontalPadding,
  bubbleLetterSpacing,
  bubbleTextBoxHeight,
  bubbleTextBoxWidth,
  bubbleVerticalPadding,
  fitBubbleFontSize,
  measureBubbleTextBlock,
  resolveBubbleFontFamily,
  resolveBubbleFontSize,
  resolveBubbleFontStyle,
  resolveBubbleLineHeight,
} from "./lettering/studio-bubble-text-fit";
import {
  BUBBLE_TEXT_MEASURER,
  verticalBlockAlign,
  verticalTextItemGeometry,
  verticalTextLayout,
} from "./lettering/studio-bubble-text-runtime";
import {
  planDialogueRubyOverlayPlacements,
  planDialogueVerticalRubyOverlayPlacements,
  readDialogueRubySpans,
} from "./lettering/studio-dialogue-ruby-layout";
import { konvaGradientProps } from "./studio-gradient-engine";
import { withStudioNodeInteractionGuards } from "./studio-node-props";

import type { El } from "./studio-element-model";
import type Konva from "konva";

export interface StudioKonvaBubbleNodeProps {
  el: Extract<El, { type: "bubble" }>;
  theme: "classic" | "soft" | "vivid";
  customShapeDraftPoints?: number[];
  selected: boolean;
  exporting: boolean;
  effectiveScale: number;
  draggable: boolean;
  innerRef: (node: Konva.Node | null) => void;
  dragBoundFunc: (pos: Konva.Vector2d) => Konva.Vector2d;
  onSelect: () => void;
  onEdit: () => void;
  onChange: (patch: Partial<El>) => void;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}

export function StudioKonvaBubbleNode({
  el,
  theme,
  customShapeDraftPoints,
  selected,
  exporting,
  effectiveScale,
  draggable,
  innerRef,
  dragBoundFunc,
  onSelect,
  onEdit,
  onChange,
  onInteractionBegin,
  onInteractionEnd,
}: StudioKonvaBubbleNodeProps) {
  // 외곽선 두께: 사용자 지정 우선, 없으면 말풍선 평균크기 3단계(작을수록 가늘게).
  const avgSize = (el.width + el.height) / 2;
  let bStroke = el.stroke ?? "#1f1a16"; // 순흑 대신 따뜻한 잉크색
  let bStrokeW = el.strokeWidth ?? (avgSize < 300 ? 2.5 : avgSize < 500 ? 3 : 3.5);
  // 그림자: 사용자 지정 없으면 테마별 기본값(종이 위에 살짝 뜬 미세 그림자).
  let bShadowColor = el.shadowColor !== undefined ? el.shadowColor : "rgba(0, 0, 0, 0.2)";
  let bShadowBlur = el.shadowBlur !== undefined ? el.shadowBlur : 5;
  let bShadowOpacity = el.shadowOpacity !== undefined ? el.shadowOpacity : 0.16;
  let bShadowOffset = el.shadowOffsetX !== undefined && el.shadowOffsetY !== undefined
    ? { x: el.shadowOffsetX, y: el.shadowOffsetY }
    : { x: 1, y: 2 };
  const tXRatio = el.tailXRatio ?? 0.35;
  const tHeight = el.tailHeight ?? 30;
  const tailDir = el.tail ?? "left";
  const tailDirection = el.tailDirection ?? "bottom";
  const showTail = tailDir !== "none";

  if (theme === "soft") {
    bStroke = el.stroke ?? "#2d2d2d";
    bStrokeW = el.strokeWidth ?? (avgSize < 300 ? 1.5 : avgSize < 500 ? 1.8 : 2);
    if (el.shadowColor === undefined) {
      bShadowColor = "rgba(0, 0, 0, 0.1)";
      bShadowBlur = 5;
      bShadowOpacity = 0.16;
      bShadowOffset = { x: 1, y: 2 };
    }
  } else if (theme === "vivid") {
    bStroke = el.stroke ?? "#444444";
    bStrokeW = el.strokeWidth ?? (avgSize < 300 ? 1.2 : avgSize < 500 ? 1.5 : 1.8);
    if (el.shadowColor === undefined) {
      bShadowColor = "black";
      bShadowBlur = 8;
      bShadowOpacity = 0.16;
      bShadowOffset = { x: 2, y: 3 };
    }
  }

  // 점선 등 스트로크 스타일 — strokeStyle을 지정하면 그걸 우선 적용한다. whisper는
  // strokeStyle 미지정 시 기존 하드코딩 dash([8,5])를 그대로 유지한다(하위호환).
  // scared/system/angry는 스트로크 색(및 system은 두께)이 이미 하드코딩이라 점선도
  // 적용하지 않는다(사용자가 지정 안 한 색 위에 점선만 얹히는 어색함 방지 — 기존 갭,
  // 이 배치의 책임 밖).
  const bDash = el.strokeStyle
    ? strokeDashArray(normalizeStrokeStyle(el.strokeStyle).dash, bStrokeW)
    : el.variant === "whisper"
      ? [8, 5]
      : undefined;

  // 실제 렌더와 커스텀 외곽선 전환이 같은 기하 소스를 사용해야 전환 순간 모양이 튀지 않는다.
  // extraTails는 저장 문서의 불신 입력을 먼저 정규화한 뒤 geometry 계약으로 넘긴다.
  const bMinDim = Math.min(el.width, el.height);
  const bubbleGeometry = computeBubbleShapeGeometry({
    width: el.width,
    height: el.height,
    theme,
    tail: tailDir,
    tailDirection,
    tailXRatio: tXRatio,
    tailHeight: tHeight,
    tailBase: el.tailBase,
    tailBend: el.tailBend,
    extraTails: normalizeExtraTails(el.extraTails),
  });
  const bRadius = bubbleGeometry.radius;
  const bubbleTailSpec = bubbleGeometry.tailSpec;
  const bubbleExtraTails = bubbleGeometry.extraTails;
  const bTailLen = bubbleTailSpec?.length ?? 0;
  // 드래그 중이면 미확정 draft를(커밋 전 실시간 미리보기), 아니면 저장된 값을 정규화해 쓴다 —
  // StudioDrawNode의 nodeEditDraft 병합과 동일한 관례. normalizeCustomShapePoints는 위
  // normalizeExtraTails(el.extraTails)와 동일하게, 저장 문서에서 불러온 값을 매 렌더 방어적으로
  // 정규화한다(짝수 길이·유한수 아니면 undefined로 폴백 — 커스텀 모양 미적용 취급).
  const liveCustomShapePoints = customShapeDraftPoints ?? normalizeCustomShapePoints(el.customShapePoints);
  const showCustomShape = hasCustomBubbleShape(liveCustomShapePoints);
  // 손그림 외곽선(studio-bubble-outline-style) — 미설정이면 styled()는 입력 d를 그대로 돌려줘
  // 기본 렌더 경로가 바이트 단위로 불변이다(하위호환).
  const outlineStyle = normalizeBubbleOutlineStyle(el.outlineStyle);
  const styled = (d: string) => styledBubblePathData(d, outlineStyle, el.id, bStrokeW);
  const speechPathData = styled(
    bubbleExtraTails.length > 0
      ? bubblePathDataMulti(el.width, el.height, bRadius, [
          ...(bubbleTailSpec ? [bubbleTailSpec] : []),
          ...bubbleExtraTails,
        ])
      : bubblePathData(el.width, el.height, bRadius, bubbleTailSpec)
  );
  // 타이포: 한글 가독성을 위한 테마별 줄간격 + 약한 자간(세로쓰기는 넉넉히). 기본값은 전부
  // studio-bubble-text-fit 의 단일 소스에서 온다 — 커밋 측정(StudioPage.commitEditText)과
  // 높이 맞춤(studio-fit)이 예전에 각각 1.1 / 1.2 를 쓰다가 대사를 잘라먹은 결함의 재발 방지.
  const bubbleFontFamily = resolveBubbleFontFamily(el.font);
  const bubbleFontStyle = resolveBubbleFontStyle(el.fontStyle);
  const bubbleLineHeight = resolveBubbleLineHeight({
    lineHeight: el.lineHeight,
    vertical: el.vertical,
    theme,
  });
  const bubbleLetterSpacingPx = bubbleLetterSpacing(theme);
  // 안쪽 여백: 글자 크기 비례(좌우 대칭, 상<하로 시각 중심 보정).
  const bubbleMaxFontSize = resolveBubbleFontSize(el.fontSize);
  const bubbleBlockAlign = verticalBlockAlign(el.align ?? "center");
  const bFs = el.autoShrinkText
    ? fitBubbleFontSize(
        {
          // 세로쓰기는 레거시 전치 문자열이 아니라 **원문 + vertical:true** 로 판정한다
          // (studio-bubble-text-fit 의 vertical 경로 계약 — 전치 근사는 열 수를 잘못 센다).
          text: el.text,
          boxWidth: el.width,
          boxHeight: el.height,
          maxFontSize: bubbleMaxFontSize,
          minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
          fontFamily: bubbleFontFamily,
          fontStyle: bubbleFontStyle,
          lineHeight: bubbleLineHeight,
          letterSpacing: bubbleLetterSpacingPx,
          vertical: el.vertical,
          blockAlign: bubbleBlockAlign,
        },
        BUBBLE_TEXT_MEASURER,
      ).fontSize
    : bubbleMaxFontSize;
  // bHPad/bVPadTop/bVPadBot 공식을 studio-bubble-text-fit.ts와 공유(§1.1) — fitBubbleFontSize의
  // 내부 탐색이 가정한 패딩과 실제 렌더 패딩이 정확히 일치해야 한다.
  const bHPad = bubbleHorizontalPadding(bFs);
  const { top: bVPadTop } = bubbleVerticalPadding(bFs);

  // 생각 말풍선 꼬리: 큰→중간→작은 3단 구름방울(코미포식) — 캔버스·SVG export 가 공유하는
  // thoughtTailDots 단일 소스. tailXRatio/tailHeight 가 있으면 손잡이를 따라 움직인다.
  const thoughtSW = bStrokeW * 0.8;
  const thoughtEllipses = showTail
    ? thoughtTailDots({
        width: el.width,
        height: el.height,
        direction: tailDirection,
        mirror: tailDir === "right" ? "right" : "left",
        ratio: el.tailXRatio,
        length: el.tailHeight,
      }).map((dot, index) => (
        <Ellipse
          key={`thought-dot-${index}`}
          x={dot.x}
          y={dot.y}
          radiusX={dot.rx}
          radiusY={dot.ry}
          fill={el.fill}
          stroke={bStroke}
          strokeWidth={thoughtSW}
        />
      ))
    : null;

  let lx = el.width * tXRatio;
  let ly = el.height + bTailLen;

  if (tailDirection === "bottom") {
    const ratio = tailDir === "right" ? 1 - tXRatio : tXRatio;
    lx = el.width * ratio;
    ly = el.height + bTailLen;
  } else if (tailDirection === "top") {
    const ratio = tailDir === "right" ? 1 - tXRatio : tXRatio;
    lx = el.width * ratio;
    ly = -bTailLen;
  } else if (tailDirection === "left") {
    lx = -bTailLen;
    ly = el.height * tXRatio;
  } else if (tailDirection === "right") {
    lx = el.width + bTailLen;
    ly = el.height * tXRatio;
  }

  const tailHandle = selected && showTail && !exporting && !showCustomShape && (
    <KCircle
      x={lx}
      y={ly}
      radius={6 / effectiveScale}
      fill="#ffcc00"
      stroke="#1f1a16"
      strokeWidth={1.5 / effectiveScale}
      draggable
      onDragStart={(e) => {
        e.cancelBubble = true;
        if (onInteractionBegin && !onInteractionBegin()) {
          e.target.stopDrag();
        }
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const dx = node.x();
        const dy = node.y();

        const dTop = Math.abs(dy);
        const dBot = Math.abs(dy - el.height);
        const dLeft = Math.abs(dx);
        const dRight = Math.abs(dx - el.width);
        const minDist = Math.min(dTop, dBot, dLeft, dRight);

        let newDir: "bottom" | "top" | "left" | "right" = "bottom";
        let ratio = tXRatio;
        let len = tHeight;

        if (minDist === dBot) {
          newDir = "bottom";
          const rawRatio = dx / el.width;
          ratio = Math.max(0.15, Math.min(0.85, rawRatio));
          len = Math.max(8, Math.min(150, dy - el.height));
        } else if (minDist === dTop) {
          newDir = "top";
          const rawRatio = dx / el.width;
          ratio = Math.max(0.15, Math.min(0.85, rawRatio));
          len = Math.max(8, Math.min(150, -dy));
        } else if (minDist === dLeft) {
          newDir = "left";
          const rawRatio = dy / el.height;
          ratio = Math.max(0.15, Math.min(0.85, rawRatio));
          len = Math.max(8, Math.min(150, -dx));
        } else if (minDist === dRight) {
          newDir = "right";
          const rawRatio = dy / el.height;
          ratio = Math.max(0.15, Math.min(0.85, rawRatio));
          len = Math.max(8, Math.min(150, dx - el.width));
        }

        if (tailDir === "right" && (newDir === "bottom" || newDir === "top")) {
          ratio = 1 - ratio;
        }

        onChange({
          tailDirection: newDir,
          tailXRatio: Math.round(ratio * 100) / 100,
          tailHeight: Math.round(len),
        });
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        try {
          e.target.x(lx);
          e.target.y(ly);
          e.target.getLayer()?.batchDraw();
        } finally {
          onInteractionEnd?.();
        }
      }}
    />
  );

  const bubbleInteractionProps = withStudioNodeInteractionGuards(
    {
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        onChange({ x: e.target.x(), y: e.target.y() });
      },
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target as Konva.Group;
        const w = Math.max(60, el.width * node.scaleX());
        const h = Math.max(50, el.height * node.scaleY());
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: w,
          height: h,
          rotation: node.rotation(),
        });
      },
    },
    { onInteractionBegin, onInteractionEnd }
  );

  // Text box + optional horizontal ruby overlays (base stays one KText; vertical uses the column core).
  const textBoxWidth = bubbleTextBoxWidth(el.width, bFs);
  const textBoxHeight = bubbleTextBoxHeight(el.height, bFs);
  const bubbleAlign = el.align ?? "center";
  // 세로쓰기는 studio-vertical-text 코어로 조판한다. 레거시 formatVerticalText 는 "가로 문자열을
  // 전치해 가로 렌더러에 먹이는" 근사라, 상자 높이를 넘는 열이 Konva 의 무음 절단에 그대로
  // 걸렸다(측정: "안녕하세요" 5자 중 3자만 렌더 / 103자 대사는 103줄 필요 · 6줄 표시).
  const verticalLayout = el.vertical
    ? verticalTextLayout({
        text: el.text,
        fontSize: bFs,
        lineHeight: bubbleLineHeight,
        letterSpacing: bubbleLetterSpacingPx,
        fontFamily: bubbleFontFamily,
        fontStyle: bubbleFontStyle,
        maxColumnLength: textBoxHeight,
        blockAlign: bubbleBlockAlign,
      })
    : null;
  // 가로쓰기 무음 절단 방어: Konva.Text 는 height 가 고정이면 넘치는 줄을 경고 없이 버린다.
  // 실제로 필요한 블록 높이를 재서 그보다 작지 않은 페인트 상자를 주고, 그만큼 y 를 위로
  // 되돌려 시각 중심(verticalAlign:"middle")을 상자 중심에 그대로 유지한다 — 텍스트가 들어가는
  // 보통의 경우 결과 픽셀은 예전과 완전히 동일하고, 넘칠 때만 잘리는 대신 밖으로 흘러넘친다.
  // autoShrinkText("크기 고정")는 사용자가 상자를 못 넘게 하겠다고 명시한 모드라 제외한다
  // (그 모드는 인스펙터가 overflow 경고를 따로 띄운다).
  // 줄 수는 아무리 좁아도 "글자 수 + 1"을 넘을 수 없다(빈 문단 포함). 그 상한으로도 상자 안이면
  // 절단이 원리적으로 불가능하므로 측정 자체를 건너뛴다 — 짧은 대사(대부분의 말풍선)는 렌더마다
  // 캔버스 measureText 를 한 번도 부르지 않는다.
  const cannotOverflow =
    ([...el.text].length + 1) * bFs * bubbleLineHeight <= textBoxHeight;
  const horizontalBlockHeight =
    verticalLayout || el.autoShrinkText || cannotOverflow
      ? 0
      : measureBubbleTextBlock(
          {
            text: el.text,
            boxWidth: el.width,
            fontSize: bFs,
            fontFamily: bubbleFontFamily,
            fontStyle: bubbleFontStyle,
            lineHeight: bubbleLineHeight,
            letterSpacing: bubbleLetterSpacingPx,
          },
          BUBBLE_TEXT_MEASURER,
        ).blockHeight;
  const textPaintHeight = Math.max(textBoxHeight, Math.ceil(horizontalBlockHeight));
  const textPaintY = bVPadTop - (textPaintHeight - textBoxHeight) / 2;
  const rubySpans = readDialogueRubySpans(el.rubySpans);
  const rubyOverlays = rubySpans && !verticalLayout
    ? planDialogueRubyOverlayPlacements(el.text, rubySpans, {
        fontSize: bFs,
        letterSpacing: bubbleLetterSpacingPx,
        textWidth: textBoxWidth,
        align: bubbleAlign,
      })
    : [];
  const verticalRuby = verticalLayout
    ? planDialogueVerticalRubyOverlayPlacements(el.text, rubySpans, verticalLayout, {
        fontSize: bFs,
        lineHeight: bubbleLineHeight,
        letterSpacing: bubbleLetterSpacingPx,
      })
    : null;

  return (
    <Group
      studioElementId={el.id}
      key={el.id}
      ref={innerRef}
      x={el.x}
      y={el.y}
      rotation={el.rotation}
      opacity={el.opacity ?? 1}
      draggable={draggable}
      dragBoundFunc={dragBoundFunc}
      shadowColor={bShadowColor}
      shadowBlur={bShadowBlur}
      shadowOpacity={bShadowOpacity}
      shadowOffset={bShadowOffset}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={onEdit}
      onDblTap={onEdit}
      {...bubbleInteractionProps}
    >
      {showCustomShape ? (
        outlineStyle ? (
          <Path
            data={styledBubblePolygonPathData(liveCustomShapePoints, outlineStyle, el.id, bStrokeW)}
            fill={el.fill}
            stroke={bStroke}
            strokeWidth={bStrokeW}
            lineJoin="round"
            lineCap="round"
          />
        ) : (
          <Line
            points={liveCustomShapePoints}
            closed
            fill={el.fill}
            stroke={bStroke}
            strokeWidth={bStrokeW}
            lineJoin="round"
            lineCap="round"
          />
        )
      ) : el.variant === "double" ? (
        <Path
          data={styled(doubleBubblePathData(el.width, el.height, bubbleTailSpec))}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "shout" ? (
        <Path
          data={styled(burstStarPathData(
            el.width,
            el.height,
            normalizeBurstStarPoints(el.starPoints, BURST_STAR_VARIANT_PARAMS.shout.points),
            68 * Math.min(0.95, Math.max(0.1, el.starAmplitude ?? 36 / 68)),
            68,
          ))}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "thought" ? (
        <>
          <Path
            data={styled(thoughtBubbleBodyPath(el.width, el.height))}
            fill={el.fill}
            {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
            stroke={bStroke}
            strokeWidth={bStrokeW}
            dash={bDash}
            lineJoin="round"
            lineCap="round"
          />
          {thoughtEllipses}
        </>
      ) : el.variant === "whisper" ? (
        <Path
          data={speechPathData}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          lineJoin="round"
          lineCap="round"
          dash={bDash}
        />
      ) : el.variant === "scared" ? (
        <Path
          data={styled(scaredBubblePathData(el.width, el.height, bubbleTailSpec))}
          fill={el.fill === "transparent" ? "transparent" : (el.fill === "#ffffff" ? "#f5f3ff" : el.fill)}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke="#7c3aed"
          strokeWidth={2}
          shadowColor="#7c3aed"
          shadowBlur={6}
          shadowOpacity={0.16}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "system" ? (
        <>
          <Rect
            width={el.width}
            height={el.height}
            fill="#0a0f24"
            opacity={0.88}
            cornerRadius={4}
            stroke="#0ea5e9"
            strokeWidth={2.5}
            shadowColor="#0ea5e9"
            shadowBlur={8}
            shadowOpacity={0.4}
          />
          <Rect
            x={4}
            y={4}
            width={el.width - 8}
            height={el.height - 8}
            fill="transparent"
            cornerRadius={2}
            stroke="#38bdf8"
            strokeWidth={1}
            opacity={0.5}
          />
        </>
      ) : el.variant === "angry" ? (
        <Path
          data={styled(burstStarPathData(
            el.width,
            el.height,
            normalizeBurstStarPoints(el.starPoints, BURST_STAR_VARIANT_PARAMS.angry.points),
            64 * Math.min(0.95, Math.max(0.1, el.starAmplitude ?? 28 / 64)),
            64,
          ))}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={theme === "soft" ? "#dc2626" : theme === "vivid" ? "#7f1d1d" : "#991b1b"}
          strokeWidth={Math.max(bStrokeW, 3.5)}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "phone" ? (
        <Path
          data={styled(bubblePathData(
            el.width,
            el.height,
            theme === "soft" ? 10 : theme === "vivid" ? 6 : 8,
            // 메신저는 짧은 꼬리(채팅 꼬리 느낌) — 없으면 본체만.
            showTail && bubbleTailSpec
              ? {
                  ...bubbleTailSpec,
                  length: Math.min(bubbleTailSpec.length, Math.max(8, bMinDim * 0.1)),
                  base: Math.min(bubbleTailSpec.base, Math.max(6, bMinDim * 0.12)),
                }
              : null,
          ))}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "heart" ? (
        <Path
          data={heartBubblePathData(el.width, el.height)}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
          lineJoin="round"
          lineCap="round"
        />
      ) : el.variant === "box" ? (
        <Rect
          width={el.width}
          height={el.height}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          cornerRadius={theme === "soft" ? 6 : theme === "vivid" ? 3 : 4}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
        />
      ) : (
        <Path
          data={speechPathData}
          fill={el.fill}
          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
          stroke={bStroke}
          strokeWidth={bStrokeW}
          dash={bDash}
          lineJoin="round"
          lineCap="round"
        />
      )}
      {verticalLayout ? (
        <Group
          x={bHPad + Math.max(0, (textBoxWidth - verticalLayout.width) / 2)}
          y={bVPadTop + Math.max(0, (textBoxHeight - verticalLayout.height) / 2)}
        >
          {verticalLayout.columns.flatMap((column) =>
            column.items.map((item, itemIndex) => {
              const { boxWidth, lineHeight: itemLineHeight, scaleX } = verticalTextItemGeometry(
                item,
                bFs,
              );
              return (
                <KText
                  key={`bubble-vcol-${column.index}-${itemIndex}`}
                  text={item.text}
                  x={item.x}
                  y={item.y}
                  rotation={item.rotation}
                  scaleX={scaleX}
                  {...(item.rotation === 0
                    ? { width: boxWidth, align: "center" as const, wrap: "none" as const }
                    : {})}
                  fontSize={bFs}
                  fontFamily={bubbleFontFamily}
                  fontStyle={bubbleFontStyle}
                  fill={el.textFill}
                  lineHeight={itemLineHeight}
                  letterSpacing={item.rotation === 90 ? bubbleLetterSpacingPx : 0}
                />
              );
            }),
          )}
          {verticalRuby?.placements.map((placement) => (
            <KText
              key={`bubble-vertical-ruby-${placement.spanIndex}-${placement.fragmentIndex}`}
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
              fontFamily={bubbleFontFamily}
              fontStyle={bubbleFontStyle}
              fill={el.textFill}
              lineHeight={placement.rubyGlyphAdvance / placement.rubyFontSize}
              listening={false}
            />
          ))}
        </Group>
      ) : (
        <KText
          text={el.text}
          width={textBoxWidth}
          height={textPaintHeight}
          x={bHPad}
          y={textPaintY}
          fontSize={bFs}
          fontFamily={bubbleFontFamily}
          fontStyle={bubbleFontStyle}
          fill={el.textFill}
          align={bubbleAlign}
          verticalAlign="middle"
          lineHeight={bubbleLineHeight}
          letterSpacing={bubbleLetterSpacingPx}
        />
      )}
      {rubyOverlays.map((placement) => (
        <KText
          key={`bubble-ruby-${placement.start}-${placement.end}-${placement.ruby}`}
          text={placement.ruby}
          // First-line approximation: y is relative to the text box top (verticalAlign middle
          // is not re-measured). Honest MVP — multi-line wrap is not modelled.
          x={bHPad + placement.x}
          y={bVPadTop + placement.y}
          width={Math.max(placement.baseWidth, 1)}
          align="center"
          wrap="none"
          fontSize={placement.rubyFontSize}
          fontFamily={bubbleFontFamily}
          fontStyle={bubbleFontStyle}
          fill={el.textFill}
          listening={false}
        />
      ))}
      {tailHandle}
    </Group>
  );
}
