export type StudioTiledDocPrimarySurfaceOwner =
  | "canvas2d"
  | "none"
  | "tiledoc-webgpu";

/** One primary owner per raster-document island; Vello remains selection-overlay owner only. */
export function resolveStudioTiledDocPrimarySurfaceOwner(
  backend: "canvas2d" | "pending" | "webgpu",
  presentationAuthorized: boolean
): StudioTiledDocPrimarySurfaceOwner {
  if (!presentationAuthorized || backend === "pending") return "none";
  return backend === "webgpu" ? "tiledoc-webgpu" : "canvas2d";
}
