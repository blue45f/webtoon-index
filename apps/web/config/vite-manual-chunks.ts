export type StudioChunkPredicate = (id: string) => boolean;

export function createStudioManualChunks(predicates: {
  isInitialIconModule: StudioChunkPredicate;
  isStudioCoreIconModule: StudioChunkPredicate;
}) {
  const { isInitialIconModule, isStudioCoreIconModule } = predicates;
  return (id: string): string | undefined => {
    if (
      id.includes("/node_modules/@babylonjs/")
      || id.includes("/node_modules/babylonjs-gltf2interface/")
    ) {
      // Keep every Babylon package in one manifest-visible specialist chunk. The production
      // bundle audit can then prove that no generic shared vendor chunk leaks the engine
      // into the app, Studio route, or BG3D editor activation graphs.
      return "studio-bg3d-babylon-runtime";
    }
    // NOTE (2026-08-29): naming a chunk for Three's `three.webgpu` build was tried and
    // reverted for the same reason as the SQLite repositories below. `three.webgpu.js` is
    // not a leaf — it shares `three.core.js` with `three.module.js` — so rolldown made the
    // named chunk the home of that shared color. Every three importer then gained a static
    // edge to an 897 KiB blob and the BG3D editor activation grew 68 KiB gzip. Left
    // unnamed, `three.webgpu` lands in a chunk reachable only through the WebGPU renderer's
    // dynamic import, which is exactly what the bundle audit requires.
    // NOTE (2026-08-14): naming a chunk for the launch-time SQLite repositories was tried and
    // reverted. Every entry above is a dependency-free leaf; these repositories are not, so
    // rolldown made the named chunk the home of their whole shared color — a 671 KiB blob that
    // the BG3D editor (+28%) and even the admin/feedback routes then had to download. Merging
    // only pays when the merged modules carry nothing behind them.
    if (
      id.endsWith("/src/domains/creator/bg3d/studio-bg3d-model-thumbnail-encode.ts")
      || id.endsWith("/src/domains/creator/bg3d/studio-bg3d-shot-png-worker-client.ts")
    ) {
      // Every thumbnail encoder caller already loads the PNG Worker client. Keep this
      // unconditional pair in one request rather than a separate 250-byte wrapper chunk.
      // The Worker itself, capture controller and archive paths retain their boundaries.
      return "studio-bg3d-png-client";
    }
    if (
      id.endsWith("/src/domains/creator/bg3d/studio-bg3d-production-workflow.ts")
      || id.endsWith("/src/domains/creator/bg3d/studio-bg3d-production-pass-readiness.ts")
      || id.endsWith("/src/domains/creator/bg3d/studio-bg3d-production-multipass.ts")
      || id.endsWith("/src/domains/creator/bg3d/studio-bg3d-pro-suite-runtime-context.tsx")
    ) {
      // The editor already needs these production UI contracts and its shared context.
      // Co-locate the 200-byte context instead of issuing another request on activation.
      // Its only runtime dependency is React, which keeps its existing react-runtime chunk.
      // Never include panels, SceneDocument runtime, engines or archive/Worker clients here.
      return "studio-bg3d-production-models";
    }
    if (
      id.endsWith("/src/domains/creator/studio-workspaces.ts")
      || id.endsWith("/src/domains/creator/brush/studio-drawing-palettes.ts")
    ) {
      // Drawing-palette layout is part of the synchronously restored workspace envelope.
      // Co-locate both small models so Studio startup does not pay a separate shared-chunk
      // request while the lazy palette stack can reuse the already-loaded workspace chunk.
      return "studio-workspaces";
    }
    if (
      id.endsWith("/lib/sha256-portable.ts")
      || id.endsWith("/src/domains/creator/studio-sha256.ts")
    ) {
      // The Studio entry is a compatibility-only re-export and the portable implementation
      // is dependency-free. Co-locate the unconditional pair so Studio/BG3D do not pay a
      // second request, while every non-Studio consumer still receives only this small hash
      // implementation rather than any product runtime.
      return "studio-sha256";
    }
    if (
      id.endsWith("/src/domains/creator/studio-selection-tools.ts")
      || id.endsWith("/src/domains/creator/studio-magic-wand.ts")
      || id.endsWith("/src/domains/creator/studio-alpha-lock.ts")
    ) {
      // Advanced Fill's user-triggered browser engine shares alpha-lock and magic-wand
      // primitives with the always-on selection graph. Keep those already-eager pure cores
      // in one chunk so the dynamic boundary does not add two launch-time HTTP requests.
      return "studio-selection-tools";
    }
    if (
      id.endsWith("/src/domains/creator/studio-tool-hints.ts")
      || id.endsWith("/src/domains/creator/studio-view-action-hints.ts")
      || id.endsWith("/src/domains/creator/studio-inspector-layout.ts")
    ) {
      // The view HUD, always-visible rails and inspector shell share this small UI
      // vocabulary. Co-locating it avoids an extra HTTP request on every Studio launch.
      return "studio-tool-hints";
    }
    if (
      id.endsWith("/lib/studio-raster-asset-admission.ts")
      || id.endsWith("/src/domains/creator/studio-background-gradient-color-stops.ts")
      || id.endsWith("/src/domains/creator/studio-characters.ts")
      || id.endsWith("/src/domains/creator/brush/studio-brush-pack-format.ts")
      || id.endsWith("/src/domains/creator/brush/studio-brush-pack-id.ts")
      || id.endsWith("/src/domains/creator/brush/studio-brush-selection.ts")
      || id.endsWith("/src/domains/creator/studio-help-center-channel.ts")
      || id.endsWith("/src/domains/creator/studio-inspector-focus.ts")
      || id.endsWith("/src/domains/creator/studio-liquify-contract.ts")
      || id.endsWith("/src/domains/creator/studio-mobile-sheet-snap.ts")
      || id.endsWith("/src/domains/creator/studio-similar-style.ts")
      || id.endsWith("/src/domains/creator/studio-story-beats.ts")
      || id.endsWith("/src/domains/creator/studio-element-model.ts")
      || id.endsWith("/src/domains/creator/render/studio-raster-image-presentation.ts")
      || id.endsWith("/src/domains/creator/brush/studio-brush-engine-program-set.ts")
    ) {
      // These lightweight contracts are shared by several Studio lazy entries. Similar-style
      // and story-beat helpers are also synchronously needed by StudioPage, so leaving their
      // tiny bodies as separate shared chunks costs launch requests without preserving lazy
      // bytes. Element-model and raster-presentation are dependency-free linked-surface
      // contracts, and the program-set leaf's owners are a subset of this chunk's owners, so
      // co-locating them also avoids recursive dependency capture. The
      // procedural descriptor index is deliberately excluded so its 160 labels/previews stay
      // behind the full-library and saved-pro-brush dynamic boundaries.
      return "studio-core-micro-contracts";
    }
    if (
      id.endsWith("/src/domains/creator/studio-panel-split.ts")
      || id.endsWith("/src/domains/creator/studio-edit-controls.ts")
    ) {
      // Dependency-free leaves with the same entry-owner set; merging removes one request
      // without changing any static or lazy closure.
      return "studio-editing-micro-models";
    }
    if (
      id.endsWith("/src/domains/creator/studio-id.ts")
      || id.endsWith("/src/domains/creator/live/studio-live-local-transport-support.ts")
      || id.endsWith("/src/domains/creator/studio-content-aware-fill-contract.ts")
      || id.endsWith("/src/domains/creator/studio-z-index.ts")
      || id.endsWith("/src/domains/creator/studio-initial-primary-tool.ts")
    ) {
      // These dependency-free leaves total less than 1 KiB. The initial-tool policy is
      // already synchronous in workspace restoration; co-locate it instead of paying a
      // separate startup request. Do not include the preferences repository or any UI.
      return "studio-tiny-capability-contracts";
    }
    if (
      id.endsWith("/src/domains/creator/studio-layers.ts")
      || id.endsWith("/src/domains/creator/studio-work-metadata.ts")
      || id.endsWith("/src/domains/creator/studio-page-review.ts")
      || id.endsWith("/src/domains/creator/studio-frame-animation-timing.ts")
    ) {
      // These pure document models have no runtime dependencies. Review status and frame
      // timing are already needed by the editor and reused by the lazy quality inspector;
      // co-locating their sub-KiB bodies avoids separate startup requests without
      // capturing a quality UI, decoder, rendering engine or browser runtime.
      return "studio-document-micro-models";
    }
    if (
      id.endsWith("/src/domains/creator/studio-assets.ts")
      || id.endsWith("/src/domains/creator/render/studio-raster-assets.ts")
    ) {
      // Both are dependency-free models; every raster-asset owner already loads assets.
      return "studio-asset-micro-models";
    }
    if (
      id.endsWith("/src/domains/creator/brush/studio-paper-brush-response.ts")
      || id.endsWith("/src/domains/creator/brush/studio-paper-texture.ts")
    ) {
      // Paper texture is an unconditional dependency of the eager brush-response model.
      // Keep the tiny texture helper in the same request instead of paying a second chunk.
      return "studio-paper-brush-response";
    }
    if (
      id.includes("/node_modules/react/") ||
      id.includes("/node_modules/react-dom/") ||
      id.includes("/node_modules/scheduler/") ||
      id.includes("/node_modules/react-router/") ||
      id.includes("/node_modules/react-router-dom/")
    ) {
      return "react-runtime";
    }
    if (id.includes("/node_modules/konva/") || id.includes("/node_modules/react-konva/")) {
      return "studio-konva-runtime";
    }
    if (isInitialIconModule(id)) {
      return "lucide-initial-icons";
    }
    if (isStudioCoreIconModule(id)) {
      return "lucide-studio-core-icons";
    }
  };
}
