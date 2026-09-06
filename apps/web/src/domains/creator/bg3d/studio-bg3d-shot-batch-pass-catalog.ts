/** Lightweight pass catalog shared by the editor controls and the deferred production runtime. */
export const STUDIO_BG3D_SHOT_BATCH_PASSES = Object.freeze([
  "beauty",
  "lt-composite",
  "color",
  "tone",
  "texture-line",
  "main-line",
  "depth",
] as const);

export type StudioBg3dShotBatchPass = (typeof STUDIO_BG3D_SHOT_BATCH_PASSES)[number];

export const STUDIO_BG3D_SHOT_BATCH_PASS_LABELS: Readonly<
  Record<StudioBg3dShotBatchPass, string>
> = Object.freeze({
  beauty: "원본 렌더",
  "lt-composite": "LT 합성",
  color: "컬러",
  tone: "톤",
  "texture-line": "질감선",
  "main-line": "주선",
  depth: "깊이",
});
