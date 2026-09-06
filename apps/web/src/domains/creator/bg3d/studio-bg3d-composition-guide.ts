export type StudioBg3dCompositionGuideMode =
  | "none"
  | "ruleOfThirds"
  | "goldenSpiral"
  | "verticalWebtoon"
  | "crosshair";

export const STUDIO_BG3D_COMPOSITION_GUIDE_MODES = [
  { id: "none", label: "가이드 끔" },
  { id: "ruleOfThirds", label: "3분할 격자" },
  { id: "verticalWebtoon", label: "웹툰 컷 프레임" },
  { id: "goldenSpiral", label: "황금 나선" },
  { id: "crosshair", label: "중심·소점선" },
] as const satisfies readonly { id: StudioBg3dCompositionGuideMode; label: string }[];
