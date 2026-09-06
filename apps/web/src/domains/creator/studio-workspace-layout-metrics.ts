/**
 * Shared workspace geometry constants used across panel, dock, and toolbar layout.
 *
 * Centralizing these keeps UX tweaks (ex: wider canvas-first layouts) easy and
 * avoids silent divergence between visual shell components and runtime inset math.
 */
export const STUDIO_WORKSPACE_LEFT_PANEL_MIN_WIDTH = 128;
export const STUDIO_WORKSPACE_LEFT_PANEL_DEFAULT_WIDTH = 160;
export const STUDIO_WORKSPACE_LEFT_PANEL_MAX_WIDTH = 360;
export const STUDIO_WORKSPACE_RIGHT_PANEL_MIN_WIDTH = 240;
// 280px 는 속성·레이어·이미지 하위 탭 밀도에 비해 좁았다(UX 감사 2026-09-02 §8 P1-7). 320px 가 기본.
export const STUDIO_WORKSPACE_RIGHT_PANEL_DEFAULT_WIDTH = 320;
export const STUDIO_WORKSPACE_RIGHT_PANEL_MAX_WIDTH = 720;

export const STUDIO_CANVAS_DRAW_TOOL_RAIL_WIDTH = 48;
export const STUDIO_CANVAS_DOCK_GAP_OPEN = 8;

/**
 * 오른쪽 패널이 이 폭 이상이면 인스펙터가 대상 속성 아래에 레이어 목록을 함께 그린다
 * (속성↔레이어 탭 왕복 제거, UX 감사 2026-09-02 §5.8).
 */
export const STUDIO_INSPECTOR_LAYER_SPLIT_MIN_WIDTH = 420;
