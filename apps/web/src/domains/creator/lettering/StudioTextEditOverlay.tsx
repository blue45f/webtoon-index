import { useLayoutEffect, useRef, useState } from "react";

import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleHorizontalPadding,
  bubbleTextBoxHeight,
  bubbleTextBoxWidth,
  bubbleVerticalPadding,
  createCanvasBubbleTextMeasurer,
  fitBubbleFontSize,
  measureBubbleTextBlock,
  resolveBubbleFontSize,
} from "./studio-bubble-text-fit";

import type { El } from "../studio-element-model";
import type Konva from "konva";

import { buttonClass } from "@/shared/components/ui/button-utils";

const OVERLAY_BUBBLE_TEXT_MEASURER = createCanvasBubbleTextMeasurer();

type EditableEl = Extract<El, { type: "text" | "bubble" | "sticker" }>;

function editableElement(el: El | undefined): EditableEl | null {
  return el && (el.type === "text" || el.type === "bubble" || el.type === "sticker") ? el : null;
}

interface StudioTextEditOverlayProps {
  elementId: string;
  elementById: Map<string, El>;
  nodeRefsRef: import("react").RefObject<Record<string, Konva.Node | null>>;
  effScale: number;
  /**
   * Where the Stage's local origin sits inside the document box, in CSS pixels.
   *
   * Normally zero. When the adaptive viewport clip is armed the Stage covers only a scrolled
   * window of the document, so `getAbsoluteTransform()` returns Stage-local coordinates that are
   * short by exactly this offset — while this overlay is a child of the document-sized zoom host.
   * Adding it back keeps the caret on the glyphs at every magnification.
   */
  stageOriginOffsetX: number;
  stageOriginOffsetY: number;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

interface OverlayVisual {
  matrix: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  align: string;
  fill: string;
}

interface OverlaySnapshot {
  text: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 편집 대상 요소의 실제 표시 Text 노드를 찾는다. text/sticker는 nodeRefsRef 가 Text 노드 자체를
 * 가리키지만(렌더 코드의 ref={setRef}가 KText에 직접 달림), bubble은 Group을 가리키므로 그 안의
 * Text 하나를 한 번만 찾아 캐시한다(bubble Group 자식은 Path(들)·Text·선택 시 KCircle 뿐이라
 * findOne("Text")로 항상 유일하게 잡힌다).
 */
function resolveOverlayTextNode(el: EditableEl, raw: Konva.Node | null | undefined): Konva.Text | null {
  if (!raw) return null;
  if (el.type === "bubble") {
    const group = raw as Konva.Group;
    const found = typeof group.findOne === "function" ? group.findOne("Text") : null;
    return (found as Konva.Text | null) ?? null;
  }
  if (el.type === "text" || el.type === "sticker") return raw as Konva.Text;
  return null;
}

function readOverlayVisual(textNode: Konva.Text): OverlayVisual {
  const m = textNode.getAbsoluteTransform().getMatrix();
  return {
    matrix: [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!],
    width: textNode.width(),
    height: textNode.height(),
    fontFamily: textNode.fontFamily(),
    fontStyle: textNode.fontStyle(),
    fontSize: textNode.fontSize(),
    lineHeight: textNode.lineHeight(),
    letterSpacing: textNode.letterSpacing(),
    align: textNode.align(),
    fill: typeof textNode.fill() === "string" ? (textNode.fill() as string) : "#111111",
  };
}

/**
 * 텍스트/말풍선/스티커 편집을 위한 캔버스 고정 오버레이 — 기존 중앙 모달(폰트 무관 textarea, 캔버스
 * 미동기화)을 대체한다. 실제 시각 피드백은 아래 Konva 노드를 타이핑마다 그대로 mutate해서 만든다
 * (textNode.text(value) 등, react-konva의 selected prop 대비 diff와는 별개 경로 — el.text 자체는
 * 커밋 전까지 안 바뀌므로 다음 무관 렌더가 이 mutation을 되돌리지 않는다. 이 파일이 언마운트되며
 * 원상복구하거나, 커밋 시 patchEl이 동일한 최종값으로 다시 설정해 덮어쓴다). textarea 자신은 텍스트를
 * 투명하게 그려 caret만 보이게 하고(color:transparent, caretColor는 실제 글자색) 입력 서페이스로만
 * 쓴다 — 폰트 지표를 픽셀 단위로 맞출 필요 없이 항상 Konva 렌더가 유일한 진짜 화면이 된다.
 */
export default function StudioTextEditOverlay({
  elementId,
  elementById,
  nodeRefsRef,
  effScale,
  stageOriginOffsetX,
  stageOriginOffsetY,
  onCommit,
  onCancel,
}: StudioTextEditOverlayProps) {
  const el = editableElement(elementById.get(elementId));
  const textNodeRef = useRef<Konva.Text | null>(null);
  const originalRef = useRef<OverlaySnapshot | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialSelectionElementIdRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const [value, setValue] = useState(el?.text ?? "");
  const [visual, setVisual] = useState<OverlayVisual | null>(null);

  useLayoutEffect(() => {
    if (!el) return;
    const raw = nodeRefsRef.current[elementId];
    const textNode = resolveOverlayTextNode(el, raw);
    textNodeRef.current = textNode;
    if (!textNode) return;
    // 최초 원본은 이 keyed 편집 세션에서 한 번만 캡처한다. 줌/무관 렌더 때 현재 live draft를
    // 다시 원본으로 덮으면 이후 Esc가 편집 전 상태로 돌아가지 못한다.
    if (!originalRef.current) {
      committedRef.current = false;
      originalRef.current = {
        text: textNode.text(),
        fontSize: textNode.fontSize(),
        x: textNode.x(),
        y: textNode.y(),
        width: textNode.width(),
        height: textNode.height(),
      };
    }
    setVisual(readOverlayVisual(textNode));
    // effScale은 discrete 줌 변경(버튼/단축키로 커밋된 값)에 반응해 위치를 다시 계산하기 위한
    // 의존성이다 — 제스처 중 임시 CSS transform은 zoomHostRef의 자식이라 자동으로 상속돼(추가
    // 코드 불필요) 여기서 따로 다룰 필요가 없다.
  }, [el, elementId, nodeRefsRef, effScale]);

  useLayoutEffect(() => {
    if (!visual || initialSelectionElementIdRef.current === elementId) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    initialSelectionElementIdRef.current = elementId;
    textarea.focus({ preventScroll: true });
    textarea.select();
  }, [elementId, visual]);

  useLayoutEffect(() => () => {
    // 언마운트 시 라이브 mutation을 원상복구한다. 커밋 경로도 곧바로 patchEl이 최종 값으로
    // 다시 설정하므로 무해한 통과점이지만, 취소 경로에서는 이게 실질적인 복구다 — committedRef로
    // 커밋 여부와 무관하게 항상 시도해도 안전하지만, 커밋 시엔 되돌렸다 바로 덮어써지는 프레임 하나
    // 낭비를 피하려고 커밋되지 않았을 때만 되돌린다.
    const textNode = textNodeRef.current;
    const original = originalRef.current;
    if (!committedRef.current && textNode && original) {
      textNode.text(original.text);
      textNode.fontSize(original.fontSize);
      textNode.x(original.x);
      textNode.y(original.y);
      textNode.width(original.width);
      textNode.height(original.height);
      textNode.getLayer()?.batchDraw();
    }
  }, []);

  if (!el || !visual) {
    return null;
  }

  function applyLiveValue(nextValue: string): void {
    const textNode = textNodeRef.current;
    if (!textNode || !el || el.type === "sticker") {
      textNode?.text(nextValue);
      textNode?.getLayer()?.batchDraw();
      if (textNode) setVisual(readOverlayVisual(textNode));
      return;
    }
    textNode.text(nextValue);
    // 세로쓰기 말풍선은 이 인라인 오버레이가 아니라 폴백 모달로 열린다(하단 주석 참고). 혹시
    // 열리더라도 열 조판 노드를 가로 상자 공식으로 건드리지 않도록 기하 갱신은 건너뛴다.
    if (el.type === "bubble" && !el.vertical) {
      // 타이핑 중에도 커밋 후와 **같은 공식**으로 상자를 다시 잡는다. 예전에는 autoShrinkText가
      // 켜졌을 때만 재계산해, 기본(꺼짐) 모드에서는 첫 상자 크기 그대로 굳었다 — Konva.Text 는
      // 고정 height 를 넘는 줄을 경고 없이 버리므로 103자 대사에서 49자가 조용히 사라졌다.
      const maxFontSize = resolveBubbleFontSize(el.fontSize);
      const lineHeight = textNode.lineHeight();
      const letterSpacing = textNode.letterSpacing();
      const fontFamily = textNode.fontFamily();
      const fontStyle = textNode.fontStyle();
      const fontSize = el.autoShrinkText
        ? fitBubbleFontSize(
            {
              text: nextValue,
              boxWidth: el.width,
              boxHeight: el.height,
              maxFontSize,
              minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
              fontFamily,
              fontStyle,
              lineHeight,
              letterSpacing,
            },
            OVERLAY_BUBBLE_TEXT_MEASURER
          ).fontSize
        : maxFontSize;
      const hPad = bubbleHorizontalPadding(fontSize);
      const { top } = bubbleVerticalPadding(fontSize);
      const boxHeight = bubbleTextBoxHeight(el.height, fontSize);
      // "크기 고정"(autoShrinkText)은 상자를 넘지 않겠다고 사용자가 고른 모드라 그대로 두고,
      // 기본 모드에서는 실제 필요한 블록 높이만큼 페인트 상자를 넓혀 절단을 막는다(중심 보정
      // 포함 — StudioKonvaBubbleNode 의 textPaintHeight/textPaintY 와 같은 계산이다).
      const paintHeight = el.autoShrinkText
        ? boxHeight
        : Math.max(
            boxHeight,
            Math.ceil(
              measureBubbleTextBlock(
                {
                  text: nextValue,
                  boxWidth: el.width,
                  fontSize,
                  fontFamily,
                  fontStyle,
                  lineHeight,
                  letterSpacing,
                },
                OVERLAY_BUBBLE_TEXT_MEASURER
              ).blockHeight
            )
          );
      textNode.fontSize(fontSize);
      textNode.x(hPad);
      textNode.y(top - (paintHeight - boxHeight) / 2);
      textNode.width(bubbleTextBoxWidth(el.width, fontSize));
      textNode.height(paintHeight);
    }
    textNode.getLayer()?.batchDraw();
    setVisual(readOverlayVisual(textNode));
  }

  function commit(): void {
    committedRef.current = true;
    onCommit(value);
  }

  // Stage-local -> document-CSS. `stageOriginOffset*` is 0 unless the viewport clip is armed.
  const [a, b, c, d, stageLocalE, stageLocalF] = visual.matrix;
  const e = stageLocalE + stageOriginOffsetX;
  const f = stageLocalF + stageOriginOffsetY;

  return (
    <textarea
      ref={textareaRef}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- 더블클릭/더블탭으로만 열리는 인라인 편집 서페이스이며, 열릴 때 바로 타이핑 가능해야 하는 것이 올바른 동작이다
      autoFocus
      aria-label={el.type === "bubble" ? "말풍선 대사 편집" : "캔버스 글자 편집"}
      aria-keyshortcuts="Control+Enter Meta+Enter Escape"
      spellCheck
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        applyLiveValue(next);
      }}
      onKeyDown={(event) => {
        // Safari/WebKit은 한글 IME 확정 keydown에서 isComposing=false와 legacy 229를 함께
        // 보낼 수 있다. 이 순간 편집면을 커밋·언마운트하면 마지막 음절이 유실된다.
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
      className="absolute left-0 top-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        width: visual.width,
        height: visual.height,
        transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
        transformOrigin: "0 0",
        color: "transparent",
        caretColor: visual.fill,
        fontFamily: visual.fontFamily,
        fontWeight: visual.fontStyle.includes("bold") ? 700 : 400,
        fontStyle: visual.fontStyle.includes("italic") ? "italic" : "normal",
        fontSize: visual.fontSize,
        lineHeight: visual.lineHeight,
        letterSpacing: visual.letterSpacing,
        textAlign: visual.align as "left" | "center" | "right",
        whiteSpace: "pre-wrap",
        zIndex: 30,
      }}
    />
  );
}

interface StudioTextEditFallbackModalProps {
  elementId: string;
  elementById: Map<string, El>;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * StudioTextEditOverlay 가 안전하게 다룰 수 없는 두 경우만을 위한 예전 중앙 모달 폴백: 좌우
 * 미리보기 반전(canvasFlipH — Stage 자체에 음수 scaleX가 baked-in 되어, 오버레이 DOM에 그대로
 * 적용하면 실제 글자가 거울상으로 보인다)과 세로쓰기(el.vertical — 열 조판은 단일 Text 노드가
 * 아니라 열별 노드 묶음이라 인라인 캐럿 오버레이가 붙을 단일 글자면이 없다). 두 경우 모두
 * 흔치 않고(반전은 임시 미리보기 토글, 세로쓰기는 소수 요소), 캔버스 실시간 동기화 없이 커밋
 * 시점에만 반영되는 예전 동작으로 되돌아가는 것으로 충분한 v1 범위다.
 *
 * 한글 IME 가드는 인라인 오버레이와 **반드시 같아야 한다** — 조합 중 Escape 를 그대로 닫기로
 * 흘리면 입력 전체가 사라진다(2026-08 감사에서 이 모달에만 가드가 없었다).
 */
export function StudioTextEditFallbackModal({
  elementId,
  elementById,
  onCommit,
  onCancel,
}: StudioTextEditFallbackModalProps) {
  const el = editableElement(elementById.get(elementId));
  const [value, setValue] = useState(el?.text ?? "");

  if (!el) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-4">
        <p className="mb-2 text-sm font-medium text-fg">텍스트 편집</p>
        <textarea
          // eslint-disable-next-line jsx-a11y/no-autofocus -- 더블클릭/더블탭으로만 열리는 모달이며, 열릴 때 입력란에 포커스를 주는 것이 올바른 모달 a11y 패턴
          autoFocus
          spellCheck
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // 인라인 오버레이와 **같은** IME 가드. 이게 없으면 한글 조합 중 누른 Escape 가
            // "조합 취소"가 아니라 모달 닫기로 흘러가 입력 전체가 사라진다(측정된 결함).
            // Safari/WebKit 은 확정 keydown 에서 isComposing=false 와 legacy 229 를 함께 보낸다.
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onCommit(value);
            }
          }}
          rows={3}
          className="w-full resize-none rounded-lg border border-line bg-card p-2 text-sm text-fg outline-none focus:border-accent"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass({ size: "sm", variant: "quiet" })}>
            취소
          </button>
          <button
            type="button"
            onClick={() => onCommit(value)}
            className={buttonClass({ size: "sm", variant: "solid" })}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
