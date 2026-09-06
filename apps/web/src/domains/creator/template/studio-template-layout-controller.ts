import { svgToDataUrl } from "../studio-characters";
import { confirmStudioDestructiveAction } from "../studio-destructive-action-preview";
import {
  studioApplyCollageRequest,
  studioApplyPanelLayoutRequest,
  studioApplyTemplateRequest,
  settleStudioDestructiveCommit,
} from "../studio-destructive-command-catalog";
import { comipoSeedsToEls } from "../studio-page-comipo-seeds";
import { loadStudioComipoAssembly } from "../studio-page-lazy-ui";
import { regenerateStudioTemplateFrames } from "../studio-template-gutter-layout";

import type { BgPreset, FrameSpec, TemplateSpec } from "../studio-assets";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { StudioMenu } from "../studio-editor-tool-model";
import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type { PanelLayoutPreset } from "../studio-panel-layouts";

export interface StudioCollagePayload {
  canvasH: number;
  canvasBg: string;
  frames: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
    bg: string;
    stroke: string;
    strokeWidth: number;
    name: string;
    groupId: string;
  }[];
  groupId: string;
  imagePlacements: readonly {
    imageId: string;
    slotIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  replaceExisting: boolean;
}

export interface StudioBackgroundFillPayload {
  kind: "solid" | "gradient" | "svg";
  color?: string;
  stops?: string[];
  direction?: "vertical" | "horizontal";
  svg?: string;
  width?: number;
  height?: number;
  label?: string;
  presetId?: string;
}

export interface StudioTemplateBackgroundControllerOptions {
  elements: El[];
  panelGutter: number;
  canvasH: number;
  dialogueScript: string;
  uid: () => string;
  setMenu: (menu: StudioMenu | null) => void;
  setCanvasH: (h: number) => void;
  setBg: (bg: string) => void;
  setBgGrad: (grad: string[] | null) => void;
  setCurrentTemplate: (tpl: TemplateSpec | null) => void;
  commit: (els: El[]) => boolean;
  undo: () => void;
  setSelectedId: (id: string | null) => void;
  setError: (err: string | null) => void;
  announceDrawingShortcut: (msg: string) => void;
  comipoActionBusyRef: React.MutableRefObject<boolean>;
  captureDeferredComipoAction: () => {
    mutationTicket: StudioEditorMutationTicket;
    history: PageState[][];
    historyIndex: number;
  };
  canApplyDeferredComipoAction: (action: {
    mutationTicket: StudioEditorMutationTicket;
    history: PageState[][];
    historyIndex: number;
  }) => boolean;
  markStudioDocumentChanged: () => boolean;
}

export function instantiateStudioTemplateFrames(
  nextFrames: readonly FrameSpec[],
  currentEls: El[],
  uid: () => string,
): El[] {
  const nonFrames = currentEls.filter((el) => el.type !== "frame");
  const newFrames = nextFrames.map((f) => ({
    id: uid(),
    type: "frame" as const,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
  }));

  return [...newFrames, ...nonFrames];
}

export function regenerateStudioTemplate(
  tpl: TemplateSpec,
  gutter: number,
  currentEls: El[],
  uid: () => string,
): El[] | null {
  const nextFrames = regenerateStudioTemplateFrames(tpl, gutter);
  return nextFrames ? instantiateStudioTemplateFrames(nextFrames, currentEls, uid) : null;
}

export function useStudioTemplateLayout(options: StudioTemplateBackgroundControllerOptions) {
  const {
    elements,
    panelGutter,
    canvasH,
    dialogueScript,
    uid,
    setMenu,
    setCanvasH,
    setBg,
    setBgGrad,
    setCurrentTemplate,
    commit,
    undo,
    setSelectedId,
    setError,
    announceDrawingShortcut,
    comipoActionBusyRef,
    captureDeferredComipoAction,
    canApplyDeferredComipoAction,
    markStudioDocumentChanged,
  } = options;

  function instantiateTemplateFrames(
    nextFrames: readonly FrameSpec[],
    currentEls: El[],
  ): El[] {
    return instantiateStudioTemplateFrames(nextFrames, currentEls, uid);
  }

  function regenerateTemplate(
    tpl: TemplateSpec,
    gutter: number,
    currentEls: El[] = elements,
  ): El[] | null {
    return regenerateStudioTemplate(tpl, gutter, currentEls, uid);
  }

  async function applyTemplate(tpl: TemplateSpec) {
    const templateRequest = studioApplyTemplateRequest({
      elementCount: elements.length,
      frameCount: tpl.frames.length,
    });
    if (elements.length > 0 && !(await confirmStudioDestructiveAction(templateRequest))) return;
    setMenu(null);
    setCanvasH(tpl.canvasH);
    setBg("#ffffff");
    setBgGrad(null);
    setCurrentTemplate(tpl);
    const nextEls = regenerateTemplate(tpl, panelGutter, [])
      ?? instantiateTemplateFrames(tpl.frames, []);
    settleStudioDestructiveCommit(templateRequest, commit(nextEls), undo);
    setSelectedId(null);
    announceDrawingShortcut(
      tpl.frames.length > 0
        ? `「${tpl.label}」템플릿 · 컷 ${tpl.frames.length}개`
        : `「${tpl.label}」빈 캔버스`
    );
  }

  async function applyPanelLayout(layout: PanelLayoutPreset) {
    if (comipoActionBusyRef.current) return;
    const panelLayoutRequest = studioApplyPanelLayoutRequest({
      layoutName: layout.label,
      elementCount: elements.length,
    });
    if (elements.length > 0 && !(await confirmStudioDestructiveAction(panelLayoutRequest))) return;
    const deferredAction = captureDeferredComipoAction();
    const script = dialogueScript.trim() || undefined;
    comipoActionBusyRef.current = true;
    try {
      const { assembleComipoPage } = await loadStudioComipoAssembly();
      if (!canApplyDeferredComipoAction(deferredAction)) return;
      const assembled = assembleComipoPage({
        layoutId: layout.id,
        dialogueScript: script,
      });
      if (!assembled?.composable) {
        setError("컷 템플릿을 배치하지 못했습니다. 대사 길이를 줄이거나 레이아웃을 바꿔 보세요.");
        return;
      }
      setMenu(null);
      setCanvasH(assembled.canvasH);
      setBg("#ffffff");
      setBgGrad(null);
      setCurrentTemplate(null);
      settleStudioDestructiveCommit(
        panelLayoutRequest,
        commit(comipoSeedsToEls(assembled.seeds)),
        undo
      );
      setSelectedId(null);
      announceDrawingShortcut(`「${layout.label}」컷 템플릿 적용`);
    } catch (error) {
      console.error("Failed to load the Studio panel assembly engine:", error);
      if (canApplyDeferredComipoAction(deferredAction)) {
        setError("컷 템플릿 엔진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      comipoActionBusyRef.current = false;
    }
  }

  async function applyCollage(payload: StudioCollagePayload) {
    setMenu(null);
    const collageRequest = studioApplyCollageRequest({
      elementCount: elements.length,
      frameCount: payload.frames.length,
    });
    if (
      payload.replaceExisting
      && elements.length > 0
      && !(await confirmStudioDestructiveAction(collageRequest))
    ) {
      return;
    }
    setCanvasH(payload.canvasH);
    setBg(payload.canvasBg);
    setBgGrad(null);
    setCurrentTemplate(null);

    const groupId = `${payload.groupId}-${uid()}`;
    const frameEls: El[] = payload.frames.map((frame) => ({
      id: uid(),
      type: "frame" as const,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      bg: frame.bg,
      bgColor: frame.bg,
      stroke: frame.strokeWidth > 0 && frame.stroke !== "transparent" ? frame.stroke : undefined,
      strokeWidth: frame.strokeWidth > 0 ? frame.strokeWidth : undefined,
      name: frame.name,
      groupId,
    }));

    const imageById = new Map(
      elements.filter((el) => el.type === "image").map((el) => [el.id, el])
    );
    const placedImages: El[] = [];
    for (const placement of payload.imagePlacements) {
      const source = imageById.get(placement.imageId);
      if (!source || source.type !== "image") continue;
      placedImages.push({
        ...source,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: 0,
        noClip: false,
        groupId,
        name: source.name ?? `콜라주 사진 ${placement.slotIndex + 1}`,
      });
    }

    if (payload.replaceExisting) {
      settleStudioDestructiveCommit(
        collageRequest,
        commit([...frameEls, ...placedImages]),
        undo
      );
    } else {
      const placedIds = new Set(placedImages.map((el) => el.id));
      const kept = elements.filter((el) => !placedIds.has(el.id));
      commit([...kept, ...frameEls, ...placedImages]);
    }
    setSelectedId(null);
    announceDrawingShortcut(`${payload.frames.length}칸 콜라주를 적용했어요.`);
  }

  function applyBgPreset(p: BgPreset) {
    if (!p.grad && !p.fill) return;
    if (!markStudioDocumentChanged()) return;
    if (p.grad) setBgGrad(p.grad);
    else if (p.fill) {
      setBg(p.fill);
      setBgGrad(null);
    }
  }

  async function applyStudioBackgroundFill(payload: StudioBackgroundFillPayload) {
    setMenu(null);
    if (!markStudioDocumentChanged()) return;
    const {
      buildStudioBackgroundGradientSvg,
      isStudioBackgroundFillLayerName,
      STUDIO_BG_FILL_LAYER_PREFIX,
    } = await import("../studio-background-presets");
    const stripFillLayers = (list: El[]) =>
      list.filter((el) => !isStudioBackgroundFillLayerName(el.name));

    if (payload.kind === "solid" && payload.color) {
      setBg(payload.color);
      setBgGrad(null);
      const next = stripFillLayers(elements);
      if (next.length !== elements.length) commit(next);
      announceDrawingShortcut("단색 배경을 적용했어요.");
      return;
    }

    const CANVAS_W = 800;
    if (payload.kind === "gradient" && payload.stops && payload.stops.length > 0) {
      const direction = payload.direction ?? "vertical";
      if (direction === "vertical") {
        setBg(payload.stops[0] ?? "#ffffff");
        setBgGrad([...payload.stops]);
        const next = stripFillLayers(elements);
        if (next.length !== elements.length) commit(next);
        announceDrawingShortcut("그라데이션 배경을 적용했어요.");
        return;
      }
      const svg = buildStudioBackgroundGradientSvg(
        CANVAS_W,
        canvasH,
        payload.stops,
        "horizontal"
      );
      const src = svgToDataUrl(svg);
      setBg("#ffffff");
      setBgGrad(null);
      const bgEl: El = {
        id: uid(),
        type: "image",
        src,
        x: 0,
        y: 0,
        width: CANVAS_W,
        height: canvasH,
        rotation: 0,
        locked: true,
        noClip: true,
        name: `${STUDIO_BG_FILL_LAYER_PREFIX} · ${payload.label ?? "가로 그라데이션"}`,
      };
      commit([bgEl, ...stripFillLayers(elements)]);
      announceDrawingShortcut("가로 그라데이션 배경을 적용했어요.");
      return;
    }

    if (payload.kind === "svg" && payload.svg) {
      const src = svgToDataUrl(payload.svg);
      const w = payload.width ?? CANVAS_W;
      const h = payload.height ?? canvasH;
      setBg("#ffffff");
      setBgGrad(null);
      const bgEl: El = {
        id: uid(),
        type: "image",
        src,
        x: 0,
        y: 0,
        width: w,
        height: h,
        rotation: 0,
        locked: true,
        noClip: true,
        name: `${STUDIO_BG_FILL_LAYER_PREFIX} · ${payload.label ?? "패턴"}`,
      };
      commit([bgEl, ...stripFillLayers(elements)]);
      announceDrawingShortcut("패턴·분위기 배경을 적용했어요.");
    }
  }

  return {
    instantiateTemplateFrames,
    regenerateTemplate,
    applyTemplate,
    applyPanelLayout,
    applyCollage,
    applyBgPreset,
    applyStudioBackgroundFill,
  };
}
