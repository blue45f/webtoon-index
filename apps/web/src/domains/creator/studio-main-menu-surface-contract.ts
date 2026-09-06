/**
 * Host contract for the §15.3 rows whose feature already shipped behind a panel.
 *
 * Wave E's finding was that most "absent" §15.3 rows are not missing features —
 * they are missing *doors*. The animatic timeline, the team panel, the continuity
 * check, the checkpoint list, Auto Actions, the marquee/lasso/wand tools: every
 * one of them is implemented and reachable, just never from the menubar.
 *
 * The new host callbacks are all "open the surface that already exists", so they
 * are declared here rather than swelling `studio-main-menu-contract.ts` past its
 * boundary budget. Same split the editor bindings used: one contract file per
 * responsibility, not one file per wave.
 *
 * Pure types only — no React, no browser, no page state.
 */

/**
 * Pixel-selection tools the host can arm. Mirrors the page's own activation
 * union (`SelectionToolKind | "circle" | "wand" | "color-range"`); it is restated
 * here so the pure catalogue never imports a component module for a type.
 */
export type StudioPixelSelectionToolId =
  | "rect"
  | "ellipse"
  | "circle"
  | "lasso"
  | "poly-lasso"
  | "brush"
  | "wand"
  | "color-range";

/** Checked/disabled state for the rows this contract opens. */
export interface StudioMainMenuSurfaceState {
  /** Armed pixel-selection tool, so Select rows can show which one is live. */
  readonly pixelSelectionTool: StudioPixelSelectionToolId | null;
  readonly quickMaskActive: boolean;
  readonly animationTimelineOpen: boolean;
  readonly onionSkinEnabled: boolean;
  readonly documentCommentsOpen: boolean;
  readonly canvasGridVisible: boolean;
  readonly vectorEraseToIntersection: boolean;
  /** Menubar command bar visibility, persisted on the authored workspace layout. */
  readonly commandBarVisible?: boolean;
  /** Master-page editing suspends the document timeline and page review. */
  readonly masterEditMode: boolean;
  /** 픽셀 아트 제한 팔레트 모드 — 그리기 메뉴 체크 표시. */
  readonly pixelArtEnabled: boolean;
}

/**
 * Doors onto surfaces the product already ships. Every member must resolve to an
 * existing handler — a row that opens nothing is worse than a recorded gap.
 */
export interface StudioMainMenuSurfaceActions {
  /** §15.3 Select ▸ Rectangle/Ellipse/Lasso/Polygon + Magic Wand/Color Range. */
  activatePixelSelectionTool: (tool: StudioPixelSelectionToolId) => unknown;
  /** Window ▸ 명령 바 — flips the persisted command bar visibility. */
  toggleCommandBar?: () => unknown;
  /** 레이어 ▸ 경계 효과… — ensures the right dock is visible so the panel can open. */
  openLayerPanel?: () => unknown;
  /** §15.3 Select ▸ Quick Mask — enter/commit, the `Q` chord's two halves. */
  enterQuickMask: () => unknown;
  commitQuickMask: () => unknown;
  /** §15.3 Animation ▸ Timeline — the multi-layer keyframe panel. */
  toggleAnimationTimeline: () => unknown;
  /** §15.3 Animation ▸ Frame/Cel — needs a raster target, host resolves it. */
  openFrameAnimation: () => unknown;
  /** §15.3 Animation ▸ Onion Skin — the shared `OnionSkinSettings.enabled` flag. */
  toggleOnionSkin: () => unknown;
  /** §15.3 Comic ▸ Animatic — the cut-timing edit-decision timeline. */
  openAnimaticTimeline: () => unknown;
  /** §15.3 Collaboration ▸ Share/Permission — team, invites, live session. */
  openTeamPanel: () => unknown;
  /** §15.3 Collaboration ▸ Comment. */
  toggleDocumentComments: () => unknown;
  /** §15.3 Collaboration ▸ Approval — per-page review state. */
  openPageReview: () => unknown;
  /** §15.3 File ▸ 버전 체크포인트 — named restore points + revision compare. */
  openCheckpoints: () => unknown;
  /** §15.3 Comic ▸ Script — Writer Room. */
  openWriterRoom: () => unknown;
  /** §15.3 Comic ▸ Shot — storyboard grid with shot/camera tags. */
  openStoryboardGrid: () => unknown;
  /** §15.3 Comic ▸ Scroll Rhythm — vertical reader simulation. */
  openScrollPreview: () => unknown;
  /** §15.3 Comic ▸ Continuity Check. */
  openContinuityCheck: () => unknown;
  /** §15.3 Comic ▸ Story Bible — production bible workspace. */
  openProductionBible: () => unknown;
  /** §15.3 File ▸ 새 프로젝트 (approximate) — the quick-start / wizard surface. */
  openQuickStart: () => unknown;
  /** §15.3 File ▸ Publish Package. */
  openPublishPackage: () => unknown;
  openPublishPreflight: () => unknown;
  /** §15.3 File ▸ 프로젝트 권리 BOM — the asset rights manifest audit. */
  openAssetRightsAudit: () => unknown;
  /** §15.3 Edit ▸ Automation Recipe — Auto Actions sets + macro recorder. */
  openAutoActions: () => unknown;
  /** §15.3 View ▸ Navigator — the minimap route. */
  openCanvasNavigator: () => unknown;
  /** §15.3 Canvas ▸ 크기·해상도 — the document canvas settings route. */
  openCanvasSettings: () => unknown;
  /** §15.3 Canvas ▸ 그리드. */
  toggleCanvasGrid: () => unknown;
  /** §15.3 Vector ▸ Vector Eraser — erase-to-intersection on the eraser. */
  toggleVectorEraseToIntersection: () => unknown;
  /** §15.3 Text ▸ Dialogue Link — batch dialogue editing (split/merge/ruby). */
  openDialogueBatch: () => unknown;
  /** §15.3 Text ▸ Localization Layout — dialogue locales + translation memory. */
  openDialogueTranslate: () => unknown;
  /**
   * §15.3 Text ▸ Localization Layout, 현지화 QA — the same translate panel opened
   * straight onto its overflow/style/MQM report screen.
   */
  openLocalizationQa: () => unknown;
  /** 그리기 ▸ 픽셀 아트 — 제한 팔레트 스냅. */
  togglePixelArtMode: () => unknown;
  /** 캔버스 ▸ 스티키 노트 — 기본 레몬 프리셋. */
  insertDefaultStickyNote: () => unknown;
  /** 그리기 ▸ 실크 대칭 — 미러 생성형 스트로크. */
  enableSilkSymmetry: () => unknown;
  /** 3D ▸ 스컬프트 — 하이브리드 DCC sculpt 표면. */
  openSculptWorkbench: () => unknown;
  /** 협업 ▸ 빠른 화이트보드 — 휘발 보드 세션. */
  startEphemeralWhiteboard: () => unknown;
  /** 3D ▸ 캐릭터 — VRM poser 표면. URL `surface=poser`. */
  openVrmPoser: () => unknown;
  /** 3D ▸ 캐릭터 셰이퍼 — 프리셋 우선 캐릭터 작업실. URL `surface=character`. */
  openCharacterShaper: () => unknown;
  /** 3D ▸ 배경 — 3D 배경 표면. URL `surface=bg3d`. */
  openBackground3d: () => unknown;
  /** 웹툰 창작 보조 센터 — 규격 검사, 자동 슬라이서, 스크롤 페이싱, 효과음 사전, 컬러 조화, 포커스 타이머. */
  openWebtoonAssistant?: () => unknown;
  /** AI 웹툰 생성 슈퍼 스위트 — 툰필터 화풍 변환, 음영 어시스트, 프롬프트 증강, 콘티 디렉터, 감정 말풍선. */
  openAiSuperSuite?: () => unknown;
}
