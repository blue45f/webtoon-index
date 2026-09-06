// 참고 이미지 서브뷰 패널 — 위치/크기 기하 계산 + 저장 포맷(순수 함수).
// DOM 의존 없음: 드래그·리사이즈·뷰포트 클램프·직렬화 전부 여기서 테스트 가능하게 둔다.
// 실제 포인터 이벤트 배선은 StudioReferencePanel.tsx가 담당(src/hooks/use-resizable.ts와 동일한 분리 원칙).

import type { StudioAsset } from "./studio-asset-library";

export interface ReferencePanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReferencePanelSettings extends ReferencePanelRect {
  /** 핀 고정된 에셋의 studio-asset-library ID. 없으면 null(빈 상태). */
  assetId: string | null;
  /** 좌우 반전 미리보기(작화 오류 점검용). */
  flipped: boolean;
}

/**
 * Explicit pre-V12 import/test identifier only. Product boot never probes or migrates this
 * localStorage key; V12 intentionally discards the old internal Studio preference authority.
 */
export const REFERENCE_PANEL_STORAGE_KEY = "studio_reference_panel_v1";
const REFERENCE_PANEL_SETTINGS_VERSION = 1;

export const REFERENCE_PANEL_MIN_WIDTH = 200;
export const REFERENCE_PANEL_MIN_HEIGHT = 170;
export const REFERENCE_PANEL_MAX_WIDTH = 680;
export const REFERENCE_PANEL_MAX_HEIGHT = 680;
export const REFERENCE_PANEL_DEFAULT_WIDTH = 300;
export const REFERENCE_PANEL_DEFAULT_HEIGHT = 260;
/** 뷰포트 가장자리와의 최소 여백(px). */
export const REFERENCE_PANEL_EDGE_MARGIN = 12;
/** 상단 고정 툴바(sticky top-2)와 겹치지 않도록 기본/최소 y. */
export const REFERENCE_PANEL_TOP_OFFSET = 80;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (hi < lo) return lo;
  return Math.min(Math.max(n, lo), hi);
}

/** 우측 상단 기본 배치(뷰포트 안에 맞게 클램프까지 적용). */
export function defaultReferencePanelRect(viewportWidth: number, viewportHeight: number): ReferencePanelRect {
  const width = REFERENCE_PANEL_DEFAULT_WIDTH;
  const height = REFERENCE_PANEL_DEFAULT_HEIGHT;
  return clampReferencePanelRect(
    { x: viewportWidth - width - REFERENCE_PANEL_EDGE_MARGIN, y: REFERENCE_PANEL_TOP_OFFSET, width, height },
    viewportWidth,
    viewportHeight
  );
}

export function defaultReferencePanelSettings(viewportWidth: number, viewportHeight: number): ReferencePanelSettings {
  return { ...defaultReferencePanelRect(viewportWidth, viewportHeight), assetId: null, flipped: false };
}

/**
 * 임의의 rect를 현재 뷰포트 안에 완전히 들어오도록 강제한다(부분적으로도 화면 밖으로 나가지 않음 —
 * "잃어버린 패널"을 원천 차단). 너비/높이를 먼저 클램프한 뒤 x/y를 그 결과에 맞춰 클램프한다.
 * 로드 시점·창 리사이즈 시점처럼 "앵커 없이 전체를 다시 맞출 때" 쓴다.
 */
export function clampReferencePanelRect(
  rect: ReferencePanelRect,
  viewportWidth: number,
  viewportHeight: number
): ReferencePanelRect {
  const maxW = Math.min(REFERENCE_PANEL_MAX_WIDTH, Math.max(REFERENCE_PANEL_MIN_WIDTH, viewportWidth - REFERENCE_PANEL_EDGE_MARGIN * 2));
  // y의 하한은 EDGE_MARGIN이 아니라 TOP_OFFSET이므로(툴바 회피), 높이 상한도 EDGE_MARGIN*2가 아닌
  // TOP_OFFSET+EDGE_MARGIN 예산으로 잡아야 y=TOP_OFFSET일 때도 바닥이 뷰포트를 벗어나지 않는다.
  const maxH = Math.min(
    REFERENCE_PANEL_MAX_HEIGHT,
    Math.max(REFERENCE_PANEL_MIN_HEIGHT, viewportHeight - REFERENCE_PANEL_TOP_OFFSET - REFERENCE_PANEL_EDGE_MARGIN)
  );
  const width = clamp(rect.width, REFERENCE_PANEL_MIN_WIDTH, maxW);
  const height = clamp(rect.height, REFERENCE_PANEL_MIN_HEIGHT, maxH);
  const maxX = Math.max(REFERENCE_PANEL_EDGE_MARGIN, viewportWidth - width - REFERENCE_PANEL_EDGE_MARGIN);
  const maxY = Math.max(REFERENCE_PANEL_TOP_OFFSET, viewportHeight - height - REFERENCE_PANEL_EDGE_MARGIN);
  const x = clamp(rect.x, REFERENCE_PANEL_EDGE_MARGIN, maxX);
  let y = clamp(rect.y, REFERENCE_PANEL_TOP_OFFSET, maxY);
  // MIN_HEIGHT 하한과 TOP_OFFSET 하한을 동시에 만족할 수 없을 만큼 뷰포트가 극도로 작으면(262px
  // 미만) 위 클램프만으로는 y+height가 뷰포트를 넘을 수 있다 — "화면 밖으로 나가지 않는다"는
  // 이 함수의 핵심 불변식이 TOP_OFFSET(툴바 회피)보다 항상 우선해야 하므로 마지막에 한 번 더 강제.
  const hardMaxY = Math.max(REFERENCE_PANEL_EDGE_MARGIN, viewportHeight - height - REFERENCE_PANEL_EDGE_MARGIN);
  if (y > hardMaxY) y = hardMaxY;
  return { x, y, width, height };
}

/** 헤더 드래그: 크기 고정, x/y만 포인터 델타만큼 이동 후 뷰포트 안으로 클램프. */
export function dragReferencePanelRect(
  startRect: ReferencePanelRect,
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number
): ReferencePanelRect {
  const dx = currentPointer.x - startPointer.x;
  const dy = currentPointer.y - startPointer.y;
  return clampReferencePanelRect(
    { x: startRect.x + dx, y: startRect.y + dy, width: startRect.width, height: startRect.height },
    viewportWidth,
    viewportHeight
  );
}

/**
 * 우하단 코너 리사이즈: x/y(앵커)는 고정, width/height만 포인터 델타만큼 변경한다.
 * 최대치는 "이 x/y에서 뷰포트를 벗어나지 않는 최대 너비/높이"로 계산한다 — clampReferencePanelRect의
 * 전역 최대치(뷰포트 중앙 기준)를 그대로 쓰면 패널이 화면 오른쪽에 붙어 있을 때도 최대까지 커져서
 * 오른쪽 가장자리를 넘어갈 수 있으므로, 앵커(x/y) 기준으로 별도 계산한다.
 */
export function resizeReferencePanelRect(
  startRect: ReferencePanelRect,
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number
): ReferencePanelRect {
  const dx = currentPointer.x - startPointer.x;
  const dy = currentPointer.y - startPointer.y;
  const maxW = Math.max(REFERENCE_PANEL_MIN_WIDTH, Math.min(REFERENCE_PANEL_MAX_WIDTH, viewportWidth - startRect.x - REFERENCE_PANEL_EDGE_MARGIN));
  const maxH = Math.max(REFERENCE_PANEL_MIN_HEIGHT, Math.min(REFERENCE_PANEL_MAX_HEIGHT, viewportHeight - startRect.y - REFERENCE_PANEL_EDGE_MARGIN));
  return {
    x: startRect.x,
    y: startRect.y,
    width: clamp(startRect.width + dx, REFERENCE_PANEL_MIN_WIDTH, maxW),
    height: clamp(startRect.height + dy, REFERENCE_PANEL_MIN_HEIGHT, maxH),
  };
}

/** 더블클릭/버튼으로 크기만 기본값으로 되돌린다(위치는 유지). */
export function resetReferencePanelSize(
  rect: ReferencePanelRect,
  viewportWidth: number,
  viewportHeight: number
): ReferencePanelRect {
  return clampReferencePanelRect(
    { x: rect.x, y: rect.y, width: REFERENCE_PANEL_DEFAULT_WIDTH, height: REFERENCE_PANEL_DEFAULT_HEIGHT },
    viewportWidth,
    viewportHeight
  );
}

export function serializeReferencePanelSettings(settings: ReferencePanelSettings): string {
  return JSON.stringify({ v: REFERENCE_PANEL_SETTINGS_VERSION, ...settings });
}

/**
 * 역직렬화 — 버전 불일치·손상 JSON·필드 누락 시 안전한 기본값으로 폴백한다(필드 단위 폴백,
 * studio-watermark.ts의 normalizeWatermark와 동일한 관대한 정책 — 위치 한두 필드가 깨졌다고
 * 핀 고정된 이미지까지 통째로 잃게 하지 않는다). raw가 null/파싱 실패/객체 아님/버전 불일치면
 * 통째로 기본값.
 */
export function deserializeReferencePanelSettings(
  raw: string | null,
  viewportWidth: number,
  viewportHeight: number
): ReferencePanelSettings {
  const fallback = defaultReferencePanelSettings(viewportWidth, viewportHeight);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const o = parsed as Record<string, unknown>;
    if (o.v !== REFERENCE_PANEL_SETTINGS_VERSION) return fallback;
    const rect = clampReferencePanelRect(
      {
        x: typeof o.x === "number" && Number.isFinite(o.x) ? o.x : fallback.x,
        y: typeof o.y === "number" && Number.isFinite(o.y) ? o.y : fallback.y,
        width: typeof o.width === "number" && Number.isFinite(o.width) ? o.width : fallback.width,
        height: typeof o.height === "number" && Number.isFinite(o.height) ? o.height : fallback.height,
      },
      viewportWidth,
      viewportHeight
    );
    return {
      ...rect,
      assetId: typeof o.assetId === "string" && o.assetId.length > 0 ? o.assetId : null,
      flipped: o.flipped === true,
    };
  } catch {
    return fallback;
  }
}

/** 라이브러리 목록에서 핀 고정된 에셋을 찾는다(없으면 null — 삭제된 에셋 등). */
export function resolvePinnedAsset(assets: StudioAsset[], assetId: string | null): StudioAsset | null {
  if (!assetId) return null;
  return assets.find((a) => a.id === assetId) ?? null;
}

/** 피커 검색창 필터 — 대소문자 무시 부분일치(studio-asset-library 계열 패널과 동일 규칙). */
export function filterReferenceAssetsByName(assets: StudioAsset[], query: string): StudioAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter((a) => a.name.toLowerCase().includes(q));
}
