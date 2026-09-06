/**
 * Studio stacking scale — single source for menu / chrome / modal z-index.
 *
 * Problem this solves: menubar dropdowns used `absolute z-80` inside a parent with
 * auto z-index, while the draw-options strip is a later sibling — so options paint
 * over open File/Edit menus. Fixed popovers also collided with each other (all z-80).
 *
 * Layers (low → high), all inside the studio shell stacking context:
 *   10  canvas HUD (status, zoom floats)
 *   20  left tool rail
 *   30  tool belt (legacy / mobile host)
 *   40  draw / select options strips
 *   50  app menubar (must stay above options so dropdowns win)
 *   70  tool-group popovers (assets / bg / style / AI)
 *   80  full-screen studio modals (storyboard, 3D, checkpoints…)
 *   90  confirm / legal / critical banners
 *  100  workspace + portaled File/Edit/export/project menus (body-level;
 *       absolute dropdowns inside menubar overflow were clipped to ~0 height)
 *  110  shortcuts help / brush studio
 *  120  emergency legal notices
 *  150  destructive-action approval (must outrank every surface that can raise one —
 *       layer lift sits at 140, interchange loss preview at 130. A승인 창이 자기를 띄운
 *       화면 아래로 가려지면 사용자는 "아무 일도 안 일어난 것"으로 본다.)
 */

export const STUDIO_Z = {
  canvasHud: 10,
  toolRail: 20,
  toolBelt: 30,
  optionsStrip: 40,
  menubar: 50,
  /** Body-portaled File/Edit/export/project — above chrome, not clipped by menubar scroll. */
  menubarMenu: 100,
  toolPopover: 70,
  modal: 80,
  confirm: 90,
  workspace: 100,
  help: 110,
  legal: 120,
  /** 파괴적 명령 승인 창 — 자기를 띄운 모든 표면 위. */
  destructiveConfirm: 150,
} as const;

export type StudioZLayer = keyof typeof STUDIO_Z;

/** Tailwind arbitrary z class helpers — keep in sync with STUDIO_Z. */
export const STUDIO_Z_CLASS = {
  canvasHud: "z-[10]",
  toolRail: "z-[20]",
  toolBelt: "z-30",
  optionsStrip: "z-[40]",
  menubar: "z-[50]",
  menubarMenu: "z-[100]",
  toolPopover: "z-[70]",
  modal: "z-[80]",
  confirm: "z-[90]",
  workspace: "z-[100]",
  help: "z-[110]",
  legal: "z-[120]",
  destructiveConfirm: "z-[150]",
} as const;
