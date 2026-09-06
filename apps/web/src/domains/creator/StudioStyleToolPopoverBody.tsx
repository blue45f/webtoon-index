import { Package, Palette } from "lucide-react";
import { Suspense } from "react";

import { StudioMenuPopoverHeader, StudioMenuSubtabs } from "./studio-chrome-ui";
import {
  StudioBrandKitPanel,
  StudioPaletteLibraryPanel,
} from "./studio-page-lazy-ui";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type { StudioMenu } from "./studio-editor-tool-model";
import type { StudioToolBeltContentProps } from "./StudioToolBeltContent";

export interface StudioStyleToolPopoverBodyProps {
  readonly toolBelt: StudioToolBeltContentProps;
}

export function StudioStyleToolPopoverBody({
  toolBelt,
}: StudioStyleToolPopoverBodyProps) {
  const {
    menu,
    recentColors,
    selected,
    setColor,
    setMenu,
  } = toolBelt;
  const {
    applyBrandKitFont,
    applyBrandKitLogo,
  } = toolBelt.stableHandlers;

  return (
    <>
              <StudioMenuPopoverHeader
                icon={Palette}
                title="스타일"
                description="팔레트와 브랜드 킷으로 작품 톤을 고정합니다."
              />
              <StudioMenuSubtabs
                aria-label="스타일 메뉴 구역"
                activeId={menu === "palette" || menu === "brandKit" ? menu : "palette"}
                onSelect={(id) => setMenu(id as StudioMenu)}
                items={[
                  { id: "palette", label: "팔레트", icon: Palette, title: "색상 팔레트 저장·가져오기(.gpl)·내보내기" },
                  { id: "brandKit", label: "브랜드 킷", icon: Package, title: "팔레트·글꼴·로고를 묶은 브랜드 킷 저장·적용" },
                ]}
              />
              {menu === "palette" && (
                <Suspense fallback={<StudioPanelLoading label="팔레트 라이브러리를 여는 중..." />}>
                  <StudioPaletteLibraryPanel
                    onPickColor={(hex) => setColor(hex)}
                    seedColors={recentColors}
                  />
                </Suspense>
              )}
              {menu === "brandKit" && (
                <Suspense fallback={<StudioPanelLoading label="브랜드 킷 패널을 여는 중..." />}>
                  <StudioBrandKitPanel
                    onPickColor={(hex) => setColor(hex)}
                    canApplyFont={!!selected && (selected.type === "text" || selected.type === "bubble")}
                    onApplyFont={applyBrandKitFont}
                    onApplyLogo={applyBrandKitLogo}
                  />
                </Suspense>
              )}

    </>
  );
}
