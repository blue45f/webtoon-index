// 원근자·아이소메트릭·고급자(스냅 자) 핸들러 팩토리 — StudioPage에서 분리.
// 드로잉 어시스트 설정은 페이지 문서에 포함되어 저장/undo/협업에서 같은 상태를 본다.
import {
  createStudioAdvancedRulerOfType,
  normalizeStudioAdvancedRulerDocument,
  STUDIO_ADVANCED_RULER_NAME_PREFIXES,
  type StudioAdvancedRuler,
  type StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";
import { CANVAS_W } from "./studio-assets";
import { uid } from "./studio-id";
import {
  clampIsometricAngleDeg,
  clampIsometricCellSize,
  defaultIsometricOrigin,
} from "./studio-isometric-grid";
import {
  addVanishingPoint,
  alignVanishingPointsToEyeLevel,
  defaultPerspectiveEyeLevelY,
  defaultVanishingPointPosition,
  movePerspectiveEyeLevel,
  moveVanishingPointWithEyeLevel,
  removeVanishingPoint,
} from "./studio-perspective-guide";

import type { StudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";

type StudioDrawingAssistDocumentUpdate = (
  current: StudioDrawingAssistDocument
) => StudioDrawingAssistDocument;

export interface StudioDrawingAssistHandlerDeps {
  canvasH: number;
  /** 페이지 문서에 커밋(저장/undo/협업 반영). 게이트에 걸리면 false. */
  commitStudioDrawingAssistDocument: (update: StudioDrawingAssistDocumentUpdate) => boolean;
  /** 커밋 없이 미리보기 상태만 갱신(드래그 중 사용). */
  previewStudioDrawingAssistDocument: (update: StudioDrawingAssistDocumentUpdate) => void;
  /** 미리보기 상태 해제. */
  clearDrawingAssistPreview: () => void;
}

export function createStudioDrawingAssistHandlers({
  canvasH,
  commitStudioDrawingAssistDocument,
  previewStudioDrawingAssistDocument,
  clearDrawingAssistPreview,
}: StudioDrawingAssistHandlerDeps) {
  function setPerspectiveRulerActive(
    action: boolean | ((current: boolean) => boolean)
  ): void {
    commitStudioDrawingAssistDocument((current) => {
      const active = typeof action === "function" ? action(current.perspective.active) : action;
      let points = current.perspective.points;
      if (active && points.length === 0) {
        const position = defaultVanishingPointPosition(points, CANVAS_W, canvasH);
        const y = current.perspective.lockHorizon
          && (current.perspective.eyeLevelY ?? defaultPerspectiveEyeLevelY(canvasH)) !== null
          ? (current.perspective.eyeLevelY ?? defaultPerspectiveEyeLevelY(canvasH))
          : position.y;
        points = addVanishingPoint(points, { id: uid(), x: position.x, y });
      }
      return {
        ...current,
        perspective: { ...current.perspective, active, points },
        isometric: active ? { ...current.isometric, active: false } : current.isometric,
        advanced: active
          ? { ...current.advanced, activeSnapRulerId: null }
          : current.advanced,
      };
    });
  }

  function setIsometricGridActive(
    action: boolean | ((current: boolean) => boolean)
  ): void {
    commitStudioDrawingAssistDocument((current) => {
      const active = typeof action === "function" ? action(current.isometric.active) : action;
      return {
        ...current,
        perspective: active ? { ...current.perspective, active: false } : current.perspective,
        isometric: { ...current.isometric, active },
        advanced: active
          ? { ...current.advanced, activeSnapRulerId: null }
          : current.advanced,
      };
    });
  }

  function addVanishingPointHandler() {
    commitStudioDrawingAssistDocument((current) => {
      const pos = defaultVanishingPointPosition(current.perspective.points, CANVAS_W, canvasH);
      const eyeLevelY = current.perspective.eyeLevelY
        ?? (current.perspective.lockHorizon ? defaultPerspectiveEyeLevelY(canvasH) : null);
      const y = current.perspective.lockHorizon && eyeLevelY !== null ? eyeLevelY : pos.y;
      return {
        ...current,
        perspective: {
          ...current.perspective,
          eyeLevelY: current.perspective.lockHorizon
            ? (eyeLevelY ?? defaultPerspectiveEyeLevelY(canvasH))
            : current.perspective.eyeLevelY,
          points: addVanishingPoint(
            current.perspective.points,
            { id: uid(), x: pos.x, y }
          ),
        },
      };
    });
  }
  function removeVanishingPointHandler(id: string) {
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      perspective: {
        ...current.perspective,
        points: removeVanishingPoint(current.perspective.points, id),
      },
    }));
  }
  function moveVanishingPointWithDocument(
    update: StudioDrawingAssistDocumentUpdate,
    preview: boolean
  ): void {
    if (preview) previewStudioDrawingAssistDocument(update);
    else commitStudioDrawingAssistDocument(update);
  }
  function movedVanishingPoints(
    current: StudioDrawingAssistDocument,
    id: string,
    x: number,
    y: number
  ): StudioDrawingAssistDocument {
    return {
      ...current,
      perspective: {
        ...current.perspective,
        points: moveVanishingPointWithEyeLevel(
          current.perspective.points,
          id,
          x,
          y,
          {
            eyeLevelY: current.perspective.eyeLevelY,
            lockHorizon: current.perspective.lockHorizon,
          }
        ),
      },
    };
  }
  function moveVanishingPointById(id: string, x: number, y: number) {
    moveVanishingPointWithDocument((current) => movedVanishingPoints(current, id, x, y), false);
  }
  function previewVanishingPointById(id: string, x: number, y: number) {
    moveVanishingPointWithDocument((current) => movedVanishingPoints(current, id, x, y), true);
  }
  function movedPerspectiveEyeLevel(
    current: StudioDrawingAssistDocument,
    nextY: number
  ): StudioDrawingAssistDocument {
    const previous = current.perspective.eyeLevelY;
    return {
      ...current,
      perspective: {
        ...current.perspective,
        eyeLevelY: nextY,
        points: movePerspectiveEyeLevel(current.perspective.points, previous, nextY),
      },
    };
  }
  function setPerspectiveEyeLevelY(nextY: number) {
    commitStudioDrawingAssistDocument((current) => movedPerspectiveEyeLevel(current, nextY));
  }
  function previewPerspectiveEyeLevelY(nextY: number) {
    previewStudioDrawingAssistDocument((current) => movedPerspectiveEyeLevel(current, nextY));
  }
  function setPerspectiveLockHorizon(next: boolean) {
    commitStudioDrawingAssistDocument((current) => {
      const eyeLevelY = current.perspective.eyeLevelY
        ?? defaultPerspectiveEyeLevelY(canvasH);
      return {
        ...current,
        perspective: {
          ...current.perspective,
          lockHorizon: next,
          eyeLevelY: next ? eyeLevelY : current.perspective.eyeLevelY,
          points: next
            ? alignVanishingPointsToEyeLevel(current.perspective.points, eyeLevelY)
            : current.perspective.points,
        },
      };
    });
  }
  function alignPerspectiveToEyeLevel() {
    commitStudioDrawingAssistDocument((current) => {
      const eyeLevelY = current.perspective.eyeLevelY
        ?? defaultPerspectiveEyeLevelY(canvasH);
      return {
        ...current,
        perspective: {
          ...current.perspective,
          eyeLevelY,
          points: alignVanishingPointsToEyeLevel(current.perspective.points, eyeLevelY),
        },
      };
    });
  }
  // 원근자와 동시에 켜지면 펜/직선 스냅이 어느 쪽을 따를지 모호해지므로 상호 배타적으로 만든다
  // (한쪽을 켜면 다른 쪽을 끈다).
  function toggleIsometricGridActive() {
    setIsometricGridActive((active) => !active);
  }
  function setIsometricAngleDegClamped(next: number) {
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, angleDeg: clampIsometricAngleDeg(next) },
    }));
  }
  function previewIsometricAngleDegClamped(next: number) {
    previewStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, angleDeg: clampIsometricAngleDeg(next) },
    }));
  }
  function setIsometricCellSizeClamped(next: number) {
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, cellSize: clampIsometricCellSize(next) },
    }));
  }
  function previewIsometricCellSizeClamped(next: number) {
    previewStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, cellSize: clampIsometricCellSize(next) },
    }));
  }
  function previewIsometricOrigin(x: number, y: number) {
    previewStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, originX: x, originY: y },
    }));
  }
  function commitIsometricOrigin(x: number, y: number) {
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, originX: x, originY: y },
    }));
  }
  function cancelStudioDrawingAssistPreview() {
    clearDrawingAssistPreview();
  }
  function resetIsometricOrigin() {
    const origin = defaultIsometricOrigin(CANVAS_W, canvasH);
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      isometric: { ...current.isometric, originX: origin.x, originY: origin.y },
    }));
  }

  function updateStudioAdvancedRulers(
    update: (current: StudioAdvancedRulerDocument) => StudioAdvancedRulerDocument,
    preview = false
  ): void {
    const apply = (current: StudioDrawingAssistDocument): StudioDrawingAssistDocument => ({
      ...current,
      advanced: normalizeStudioAdvancedRulerDocument(update(current.advanced)),
    });
    if (preview) previewStudioDrawingAssistDocument(apply);
    else commitStudioDrawingAssistDocument(apply);
  }

  function addAdvancedRuler(type: StudioAdvancedRuler["type"]): void {
    const id = uid();
    commitStudioDrawingAssistDocument((current) => {
      const rulerNumber = current.advanced.rulers.filter((ruler) => ruler.type === type).length + 1;
      const ruler: StudioAdvancedRuler = createStudioAdvancedRulerOfType(type, {
        id,
        name: `${STUDIO_ADVANCED_RULER_NAME_PREFIXES[type]} ${rulerNumber}`,
        canvasWidth: CANVAS_W,
        canvasHeight: canvasH,
      });
      return {
        ...current,
        perspective: { ...current.perspective, active: false },
        isometric: { ...current.isometric, active: false },
        advanced: normalizeStudioAdvancedRulerDocument({
          ...current.advanced,
          rulers: [...current.advanced.rulers, ruler],
          selectedRulerId: id,
          activeSnapRulerId: id,
        }),
      };
    });
  }

  function patchAdvancedRuler(id: string, patch: Partial<StudioAdvancedRuler>): void {
    updateStudioAdvancedRulers((current) => ({
      ...current,
      rulers: current.rulers.map((ruler) => ruler.id === id
        ? ({ ...ruler, ...patch, id: ruler.id, type: ruler.type } as StudioAdvancedRuler)
        : ruler),
      activeSnapRulerId: patch.enabled === false && current.activeSnapRulerId === id
        ? null
        : current.activeSnapRulerId,
    }));
  }

  function previewAdvancedRuler(id: string, patch: Partial<StudioAdvancedRuler>): void {
    updateStudioAdvancedRulers((current) => ({
      ...current,
      rulers: current.rulers.map((ruler) => ruler.id === id
        ? ({ ...ruler, ...patch, id: ruler.id, type: ruler.type } as StudioAdvancedRuler)
        : ruler),
    }), true);
  }

  function removeAdvancedRuler(id: string): void {
    updateStudioAdvancedRulers((current) => ({
      ...current,
      rulers: current.rulers.filter((ruler) => ruler.id !== id),
      activeSnapRulerId: current.activeSnapRulerId === id ? null : current.activeSnapRulerId,
      selectedRulerId: current.selectedRulerId === id ? null : current.selectedRulerId,
    }));
  }

  function selectAdvancedRuler(id: string | null): void {
    updateStudioAdvancedRulers((current) => ({ ...current, selectedRulerId: id }));
  }

  function setActiveAdvancedRuler(id: string | null): void {
    commitStudioDrawingAssistDocument((current) => ({
      ...current,
      perspective: id ? { ...current.perspective, active: false } : current.perspective,
      isometric: id ? { ...current.isometric, active: false } : current.isometric,
      advanced: normalizeStudioAdvancedRulerDocument({
        ...current.advanced,
        activeSnapRulerId: id,
      }),
    }));
  }

  return {
    setPerspectiveRulerActive,
    setIsometricGridActive,
    addVanishingPointHandler,
    removeVanishingPointHandler,
    moveVanishingPointById,
    previewVanishingPointById,
    setPerspectiveEyeLevelY,
    previewPerspectiveEyeLevelY,
    setPerspectiveLockHorizon,
    alignPerspectiveToEyeLevel,
    toggleIsometricGridActive,
    setIsometricAngleDegClamped,
    previewIsometricAngleDegClamped,
    setIsometricCellSizeClamped,
    previewIsometricCellSizeClamped,
    previewIsometricOrigin,
    commitIsometricOrigin,
    cancelStudioDrawingAssistPreview,
    resetIsometricOrigin,
    updateStudioAdvancedRulers,
    addAdvancedRuler,
    patchAdvancedRuler,
    previewAdvancedRuler,
    removeAdvancedRuler,
    selectAdvancedRuler,
    setActiveAdvancedRuler,
  };
}
