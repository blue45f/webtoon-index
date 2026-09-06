/**
 * Narrow types for the CanvasKit SceneIR adapter, so the app never type-traverses into it.
 *
 * The app already replaces `canvaskit-wasm`'s vendor types with a narrow shim
 * (`canvaskit-wasm-shim.d.ts`) because the upstream global declarations reorder lib.dom's
 * HTMLCanvasElement overloads and break unrelated Canvas2D mocks. `@toonspectrum/studio-engine-skia`
 * imports the REAL CanvasKit types, so pulling the package into the app's program surfaces a wall
 * of "no exported member" errors that say nothing about the app.
 *
 * The previous workaround for that was to hold the package name in a const and import it with
 * `@vite-ignore`, which keeps TypeScript out — and keeps the bundler out too. Vite emitted the bare
 * specifier verbatim, no browser could resolve it, and the skia-canvaskit-scene-ir route threw on
 * every call and silently degraded to resvg. A path mapping is the tool that was actually wanted:
 * the runtime still resolves the real workspace package, and the specifier stays a literal so Vite
 * bundles it.
 */
export function renderSceneToPixels(
  canvasKit: unknown,
  scene: unknown,
  options?: unknown,
): Uint8Array;
export function renderSceneToPng(
  canvasKit: unknown,
  scene: unknown,
  options?: unknown,
): Uint8Array;
export function encodeRgbaToPng(
  canvasKit: unknown,
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array;
