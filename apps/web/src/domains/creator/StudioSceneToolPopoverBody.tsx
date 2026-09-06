import {
  Boxes,
  Droplets,
  Grid2x2,
  Image as ImageIcon,
  Mountain,
  Search,
  X,
} from "lucide-react";
import { Suspense } from "react";

import { CANVAS_W } from "./studio-assets";
import { StudioMenuPopoverHeader, StudioMenuSubtabs } from "./studio-chrome-ui";
import {
  Studio2dSceneBrowser,
  StudioBackgroundPanel,
  StudioCanvasResizer,
  StudioTonePanel,
} from "./studio-page-lazy-ui";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type { StudioMenu } from "./studio-editor-tool-model";
import type { StudioToolBeltContentProps } from "./StudioToolBeltContent";



export interface StudioSceneToolPopoverBodyProps {
  readonly toolBelt: StudioToolBeltContentProps;
}

export function StudioSceneToolPopoverBody({
  toolBelt,
}: StudioSceneToolPopoverBodyProps) {
  const {
    bg,
    bgGrad,
    bgSceneGenreFilter,
    bgSceneSearchQuery,
    canvasH,
    magicResizeStrategy,
    masterEditMode,
    menu,
    setBg3dInitialDataUrl,
    setBg3dInitialElementId,
    setBg3dInitialScene,
    setBg3dOpen,
    setBgSceneGenreFilter,
    setBgSceneSearchQuery,
    setMagicResizeStrategy,
    setMenu,
    setToneSearchQuery,
    studioBgSceneAssetsError,
    studioBgSceneAssetsLoaded,
    studioBgSceneAssetsLoading,
    studioOptionalAssets,
    toneSearchQuery,
  } = toolBelt;
  const {
    addBgScene,
    addTone,
    announceDrawingShortcut,
    applyMagicResizePreset,
    applyStudioBackgroundFill,
    setCanvasH,
  } = toolBelt.stableHandlers;

  return (
    <>
              <StudioMenuPopoverHeader
                icon={Mountain}
                title="배경 편집"
                description="채우기·캔버스 크기, 2D 씬, 톤, 3D를 한곳에서 고르세요."
              />
              <StudioMenuSubtabs
                aria-label="배경 메뉴 구역"
                activeId={
                  menu === "bgScene" || menu === "tone" || menu === "bgFill" ? menu : "bgFill"
                }
                onSelect={(id) => {
                  if (id === "bg3d") {
                    setBg3dInitialScene(undefined);
                    setBg3dInitialDataUrl(undefined);
                    setBg3dInitialElementId(undefined);
                    setBg3dOpen(true);
                    setMenu(null);
                    return;
                  }
                  setMenu(id as StudioMenu);
                }}
                items={[
                  { id: "bgFill", label: "편집", icon: Droplets, title: "채우기·크기·비율 리사이저" },
                  { id: "bgScene", label: "씬", icon: ImageIcon, title: "2D 배경 씬" },
                  { id: "tone", label: "톤", icon: Grid2x2, title: "만화 스크린톤" },
                  { id: "bg3d", label: "3D", icon: Boxes, title: "3D 배경 블록아웃" },
                ]}
              />
              {menu === "bgFill" && (
                <Suspense fallback={<StudioPanelLoading label="배경 편집기를 여는 중..." />}>
                  <StudioBackgroundPanel
                    canvasW={CANVAS_W}
                    canvasH={canvasH}
                    currentBg={bg}
                    currentBgGrad={bgGrad}
                    onApply={(payload) => {
                      void applyStudioBackgroundFill(payload);
                    }}
                    sizeSlot={
                      <StudioCanvasResizer
                        canvasW={CANVAS_W}
                        canvasH={canvasH}
                        strategy={magicResizeStrategy}
                        onStrategyChange={setMagicResizeStrategy}
                        disabled={masterEditMode}
                        onSetHeight={(height) => {
                          if (masterEditMode) return;
                          setCanvasH(height);
                          announceDrawingShortcut(`캔버스 높이 ${height}px`);
                        }}
                        onMagicResizePreset={(preset) => {
                          applyMagicResizePreset(preset);
                          announceDrawingShortcut(`${preset.label} 규격 적용`);
                        }}
                      />
                    }
                  />
                </Suspense>
              )}
              {menu === "bgScene" && (
                <Suspense fallback={<StudioPanelLoading label="2D 장면 라이브러리를 여는 중..." />}>
                  <Studio2dSceneBrowser
                    groups={studioOptionalAssets.bgSceneGenreGroups}
                    query={bgSceneSearchQuery}
                    onQueryChange={setBgSceneSearchQuery}
                    genre={bgSceneGenreFilter}
                    onGenreChange={setBgSceneGenreFilter}
                    loading={studioBgSceneAssetsLoading && !studioBgSceneAssetsLoaded}
                    error={studioBgSceneAssetsError}
                    disabled={masterEditMode || Boolean(toolBelt.builtinRasterBusyId)}
                    onPick={addBgScene}
                  />
                </Suspense>
              )}
              {menu === "tone" && (
                <>
                  <p className="mb-1.5 text-[0.66rem] font-medium text-fg-3">만화 스크린톤</p>
                  <p className="mb-2 rounded-lg border border-line bg-card px-2 py-1.5 text-[0.66rem] leading-snug text-fg-3">
                    톤을 누르면 캔버스에 깔려요. 패널을 먼저 선택하면 그 칸을 덮고, 망점 크기는 칸에 맞춰 일정하게 유지됩니다.
                  </p>
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" />
                    <input
                      type="text"
                      placeholder="톤 검색 (망점·선·교차선...)"
                      value={toneSearchQuery}
                      onChange={(e) => setToneSearchQuery(e.target.value)}
                      className="w-full rounded-lg border border-line bg-card py-1 pl-6 pr-5 text-[0.65rem] placeholder:text-fg-3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-colors"
                    />
                    {toneSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setToneSearchQuery("")}
                        aria-label="검색어 지우기" className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-fg-3 hover:text-fg-2 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto pr-1">
                    <Suspense fallback={<StudioPanelLoading label="톤 패널을 여는 중..." />}>
                      <StudioTonePanel onPick={(svg) => void addTone(svg)} query={toneSearchQuery} />
                    </Suspense>
                  </div>
                </>
              )}

    </>
  );
}
