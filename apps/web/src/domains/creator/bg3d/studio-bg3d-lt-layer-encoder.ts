/**
 * Main-thread DOM PNG compatibility boundary for Studio's 3D line-and-tone output.
 *
 * LT detection stays renderer-neutral and Worker-owned. Interactive insertion still publishes
 * PNG data URLs, so this narrowly scoped module owns only the final canvas encoding boundary.
 */

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";
import type { StudioBackground3DLtLayer } from "../scene-3d/studio-3d-insert-contract";

/**
 * Interactive insert compatibility encoder. LT detection runs in a Worker, while this bounded
 * DOM-canvas PNG boundary intentionally remains on the main thread until the insert contract can
 * accept Blob-backed work assets. Keeping it named and isolated makes that ownership testable.
 */
export function encodeStudioBg3dLtLayers(
  layers: readonly StudioBg3dLtRasterLayer[]
): { readonly layers: readonly StudioBackground3DLtLayer[]; readonly compositePngDataUrl: string } {
  if (layers.length === 0) throw new Error("LT layers are empty.");
  const width = layers[0]?.width ?? 0;
  const height = layers[0]?.height ?? 0;
  if (width < 1 || height < 1 || layers.some((layer) => layer.width !== width || layer.height !== height)) {
    throw new Error("LT layer dimensions do not match.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D PNG context unavailable.");
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  const compositeContext = compositeCanvas.getContext("2d");
  if (!compositeContext) throw new Error("2D composite context unavailable.");
  const encodedLayers = layers.map((layer) => {
    const imageData = context.createImageData(width, height);
    imageData.data.set(layer.data);
    context.clearRect(0, 0, width, height);
    context.putImageData(imageData, 0, 0);
    compositeContext.drawImage(canvas, 0, 0);
    const pngDataUrl = canvas.toDataURL("image/png").split("#", 1)[0];
    if (!pngDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("LT layer PNG encoding failed.");
    }
    return Object.freeze({
      role: layer.role,
      pngDataUrl,
      width,
      height,
    });
  });
  const compositePngDataUrl = compositeCanvas.toDataURL("image/png").split("#", 1)[0];
  if (!compositePngDataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("LT composite PNG encoding failed.");
  }
  return Object.freeze({
    layers: Object.freeze(encodedLayers),
    compositePngDataUrl,
  });
}
