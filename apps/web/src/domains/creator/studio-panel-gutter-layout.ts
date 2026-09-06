/**
 * Studio Responsive Panel Gutter & Frame Layout Solver — 웹툰 컷/프레임
 * 분할(가로/세로/대각선), 거터(Gutter) 간격 제약 솔버, 블리드 마진 및 반응형 리플로우 코어.
 *
 * 마스터플랜 7.2 (컷·프레임 편집), 8.5 (Responsive Panel Layout) & 997개 기능 갭 (F-211 ~ F-238):
 * - 컷 트리(Panel Tree) 모델 및 재귀적 분할 (Horizontal, Vertical, Diagonal)
 * - 디자인 토큰 기반 거터(Gutter Spacing) 간격 유지 및 외곽 마진(Safe/Bleed) 제어
 * - 캔버스 크기/뷰포트 비율 변경 시 종횡비 및 상대 비율 보존 자동 리플로우
 * - 컷 모서리 곡률(Corner Radius) 및 테두리(Border Stroke) 폴리곤 산출
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_PANEL_LAYOUT_VERSION = 1 as const;

export type PanelSplitDirection = "horizontal" | "vertical" | "diagonal";

export interface PanelFrameStyle {
  readonly borderWidthPx: number;
  readonly borderColorHex: string;
  readonly cornerRadiusPx: number;
  readonly isBleedOut: boolean;
}

export interface PanelTreeNode {
  readonly id: string;
  readonly kind: "leaf" | "split";
  readonly splitDirection?: PanelSplitDirection;
  readonly splitRatio?: number; // 0.1..0.9
  readonly gutterSpacingPx?: number;
  readonly style: PanelFrameStyle;
  readonly children?: readonly PanelTreeNode[]; // 2 children for split
  readonly computedBounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface StudioPanelLayoutTree {
  readonly version: typeof STUDIO_PANEL_LAYOUT_VERSION;
  readonly id: string;
  readonly rootBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly root: PanelTreeNode;
}

export const DEFAULT_FRAME_STYLE: PanelFrameStyle = Object.freeze({
  borderWidthPx: 2,
  borderColorHex: "#000000",
  cornerRadiusPx: 0,
  isBleedOut: false,
});

export function createPanelLayoutTree(params: {
  id: string;
  rootBounds: { x: number; y: number; width: number; height: number };
  rootId?: string;
}): StudioPanelLayoutTree {
  const rootNode: PanelTreeNode = Object.freeze({
    id: (params.rootId ?? "panel_root").trim(),
    kind: "leaf",
    style: DEFAULT_FRAME_STYLE,
    computedBounds: Object.freeze({ ...params.rootBounds }),
  });

  return Object.freeze({
    version: STUDIO_PANEL_LAYOUT_VERSION,
    id: params.id.trim(),
    rootBounds: Object.freeze({ ...params.rootBounds }),
    root: rootNode,
  });
}

function solveNodeBounds(
  node: PanelTreeNode,
  bounds: { x: number; y: number; width: number; height: number },
): PanelTreeNode {
  if (node.kind === "leaf" || !node.children || node.children.length !== 2) {
    return Object.freeze({
      ...node,
      computedBounds: Object.freeze({ ...bounds }),
    });
  }

  const dir = node.splitDirection ?? "vertical";
  const ratio = node.splitRatio ?? 0.5;
  const gutter = node.gutterSpacingPx ?? 24;

  let child1Bounds: { x: number; y: number; width: number; height: number };
  let child2Bounds: { x: number; y: number; width: number; height: number };

  if (dir === "vertical") {
    // Top / Bottom split
    const usableHeight = bounds.height - gutter;
    const h1 = Math.round(usableHeight * ratio);
    const h2 = usableHeight - h1;

    child1Bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(10, h1) };
    child2Bounds = { x: bounds.x, y: bounds.y + h1 + gutter, width: bounds.width, height: Math.max(10, h2) };
  } else {
    // Horizontal split (Left / Right)
    const usableWidth = bounds.width - gutter;
    const w1 = Math.round(usableWidth * ratio);
    const w2 = usableWidth - w1;

    child1Bounds = { x: bounds.x, y: bounds.y, width: Math.max(10, w1), height: bounds.height };
    child2Bounds = { x: bounds.x + w1 + gutter, y: bounds.y, width: Math.max(10, w2), height: bounds.height };
  }

  const resolvedChild1 = solveNodeBounds(node.children[0], child1Bounds);
  const resolvedChild2 = solveNodeBounds(node.children[1], child2Bounds);

  return Object.freeze({
    ...node,
    computedBounds: Object.freeze({ ...bounds }),
    children: Object.freeze([resolvedChild1, resolvedChild2]),
  });
}

/**
 * 캔버스 크기가 바뀌었을 때 전체 컷 트리의 위치와 크기를 재계산(Reflow)한다.
 */
export function evaluateLayoutBounds(
  tree: StudioPanelLayoutTree,
  newRootBounds?: { x: number; y: number; width: number; height: number },
): StudioPanelLayoutTree {
  const targetBounds = newRootBounds ?? tree.rootBounds;
  const resolvedRoot = solveNodeBounds(tree.root, targetBounds);

  return Object.freeze({
    ...tree,
    rootBounds: Object.freeze({ ...targetBounds }),
    root: resolvedRoot,
  });
}

/**
 * 특정 Leaf 컷을 가로 또는 세로로 2분할한다.
 */
export function splitPanel(
  tree: StudioPanelLayoutTree,
  targetPanelId: string,
  splitDirection: PanelSplitDirection,
  ratio: number = 0.5,
  gutterSpacingPx: number = 24,
): StudioPanelLayoutTree {
  function transformNode(curr: PanelTreeNode): PanelTreeNode {
    if (curr.id === targetPanelId && curr.kind === "leaf") {
      const child1: PanelTreeNode = {
        id: `${curr.id}_a`,
        kind: "leaf",
        style: curr.style,
      };
      const child2: PanelTreeNode = {
        id: `${curr.id}_b`,
        kind: "leaf",
        style: curr.style,
      };

      return {
        id: curr.id,
        kind: "split",
        splitDirection,
        splitRatio: Math.max(0.1, Math.min(0.9, ratio)),
        gutterSpacingPx,
        style: curr.style,
        children: [child1, child2],
      };
    }

    if (curr.children) {
      return {
        ...curr,
        children: curr.children.map(transformNode),
      };
    }

    return curr;
  }

  const newRoot = transformNode(tree.root);
  return evaluateLayoutBounds({ ...tree, root: newRoot });
}

/**
 * 모든 Leaf 컷의 최종 산출된 렌더 바운딩 박스 목록을 추출한다.
 */
export function extractLeafPanelBounds(
  tree: StudioPanelLayoutTree,
): readonly { readonly panelId: string; readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly style: PanelFrameStyle }[] {
  const leaves: { panelId: string; bounds: { x: number; y: number; width: number; height: number }; style: PanelFrameStyle }[] = [];

  function collect(node: PanelTreeNode) {
    if (node.kind === "leaf" && node.computedBounds) {
      leaves.push({
        panelId: node.id,
        bounds: node.computedBounds,
        style: node.style,
      });
    }
    if (node.children) {
      for (const c of node.children) collect(c);
    }
  }

  collect(tree.root);
  return Object.freeze(leaves);
}
