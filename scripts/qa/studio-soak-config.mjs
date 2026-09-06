export const VARIANTS = [
  ["ko-light", { TZ: "Asia/Seoul", TOONSPECTRUM_VERIFY_LOCALE: "ko-KR", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "light", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "no-preference" }],
  ["ko-dark-reduced", { TZ: "Asia/Seoul", TOONSPECTRUM_VERIFY_LOCALE: "ko-KR", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "dark", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "reduce" }],
  ["en-light-reduced", { TZ: "UTC", TOONSPECTRUM_VERIFY_LOCALE: "en-US", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "light", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "reduce" }],
  ["en-dark", { TZ: "UTC", TOONSPECTRUM_VERIFY_LOCALE: "en-US", TOONSPECTRUM_VERIFY_COLOR_SCHEME: "dark", TOONSPECTRUM_VERIFY_REDUCED_MOTION: "no-preference" }],
];

export const TESTS = {
  "ux-persistence": [
    ["inapp-route-matrix", "pnpm run verify:studio-inapp-browser", 46, "mobile-inapp"],
    ["cross-browser-route-matrix", "node scripts/qa/verify-studio-cross-browser-matrix.mjs", 34, "cross-browser"],
    ["mobile-top-matrix", "pnpm run verify:studio-mobile-top", 24, "mobile-layout"],
    ["studio-launch", "pnpm run verify:studio-launch", 22, "launch"],
    ["studio-lifecycle", "pnpm run verify:studio-lifecycle", 24, "lifecycle"],
    ["service-worker", "pnpm run verify:studio-service-worker", 22, "offline-cache"],
    ["artist-journey", "pnpm run verify:studio-artist-journey", 32, "journey"],
    ["autosave-opfs", "pnpm run verify:studio-autosave-opfs", 26, "persistence"],
    ["autosave-two-tab", "pnpm run verify:studio-autosave-two-tab", 28, "multi-tab"],
    ["menus", "pnpm run verify:studio-menus", 22, "menus"],
    ["canvas-chrome", "pnpm run verify:studio-canvas-chrome", 22, "canvas-ui"],
    ["canvas-surfaces", "pnpm run verify:studio-canvas-surfaces", 24, "canvas-ui"],
    ["companion", "pnpm run verify:studio-companion", 28, "companion"],
    ["inspector", "pnpm run verify:studio-inspector-walkthrough", 28, "inspector"],
    ["filter-dialog", "pnpm run verify:studio-filter-dialog", 22, "filters"],
    ["ux-benchmark", "pnpm run verify:studio-ux-task-benchmark", 28, "ux-performance"],
    ["groups", "pnpm run verify:studio-groups", 22, "groups"],
    ["icons", "pnpm run verify:studio-icons", 18, "accessibility"],
  ],
  "rendering-brush-3d": [
    ["bg3d-inapp", 'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-bg3d-inapp-editor', 42, "bg3d-inapp"],
    ["3d-visual", 'xvfb-run -a --server-args="-screen 0 1920x1200x24" pnpm run verify:studio-3d-visual', 38, "bg3d-visual"],
    ["brushes", "pnpm run verify:studio-brushes", 32, "brush"],
    ["brush-latency", "pnpm run verify:studio-brush-latency", 28, "brush-performance"],
    ["native-raster", "pnpm run verify:studio-native-raster-tools", 30, "raster"],
    ["gpu-filters", "pnpm run verify:studio-gpu-filters", 28, "gpu-filter"],
    ["hokusai-live", "pnpm run verify:studio-hokusai-live-integration", 30, "brush-hokusai"],
    ["living-ink", "pnpm run verify:studio-living-ink-integration", 30, "living-ink"],
    ["hybrid-dcc", "pnpm run verify:studio-hybrid-dcc-integration", 34, "hybrid-dcc"],
    ["p5-runtime", "pnpm run verify:studio-p5-brush-real-runtime", 24, "brush-p5"],
    ["webgpu-brush", "pnpm run verify:studio-engine-webgpu-brush-parity", 24, "webgpu"],
    ["webgpu-filter", "pnpm run verify:studio-engine-webgpu-filter-parity", 24, "webgpu"],
    ["bg3d-physics", "pnpm run verify:studio-bg3d-physics", 28, "bg3d-physics"],
    ["3d-console", "pnpm run verify:studio-3d-console", 24, "bg3d-console"],
    ["vello", "pnpm run verify:studio-vello-candidate", 26, "renderer-vello"],
    ["bristle-webgpu", "pnpm run verify:studio-professional-bristle-webgpu", 24, "brush-webgpu"],
    ["dual-tip-webgpu", "pnpm run verify:studio-dynamic-dual-tip-webgpu-v2", 24, "brush-webgpu"],
    ["canvaskit-worker", "pnpm run verify:studio-canvaskit-quality-worker", 24, "renderer-canvaskit"],
  ],
};

const KNOWN = [
  ["KAN-11", /(menubar lane clips|전체 화면 드로잉 종료.*(offscreen|clipped)|게시하기.*(offscreen|clipped)|초안 저장.*clipped)/i],
  ["KAN-15", /(workspace-dialog.*did not open|작업공간.*intercepts pointer events)/i],
  ["KAN-16", /(빠른 시작.*offscreen|말풍선·텍스트.*offscreen|웹툰 흐름으로 시작.*offscreen|컷 나누기.*offscreen|3D 배경 열기.*offscreen)/i],
  ["KAN-17", /(small (tap )?target.*(페이지 목록 열기|다운로드 2× PNG|1페이지 복제))/i],
  ["KAN-18", /(unnamed control.*accent-accent|icon-only control without an accessible name)/i],
  ["KAN-14", /(Production migration manifest must list every numbered SQL migration|0035_creator_marketplace_3d_asset_kind)/i],
  ["KAN-13", /(studio-bg3d-dialog.*(Expected|Received)|캡처할 3D 장면이 아직 준비되지|컬러 배경 추가.*완료되지)/i],
];

export function knownJira(text) { // NOSONAR javascript:S3800
  return KNOWN.find(([, regex]) => regex.test(text))?.[0] ?? null;
}
