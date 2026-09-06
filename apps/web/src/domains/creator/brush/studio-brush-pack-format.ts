/**
 * Brush file sniffing — the only part of the import stack that is safe to load
 * eagerly.
 *
 * The parsers behind each lane are heavy (ag-psd for ABR, the format-gateway
 * PNG/XML walk for KPP) and must stay behind a dynamic import, but the *file
 * picker* has to know which extensions to advertise and which lane a chosen
 * file belongs to before anything is loaded. That decision lives here so
 * `StudioBrushLibraryPanel` and the Brush menu entry can share it without
 * dragging a parser into their chunk.
 */

/** Formats reachable from the brush import entry points. */
export type StudioBrushPackFormat =
  | "abr"
  | "myb"
  | "kpp"
  | "sut"
  | "sutg"
  | "bundle"
  | "json";

/**
 * `accept` for every brush import input. `.kpp` files are PNGs, so `image/png`
 * is listed too — some platforms report the sniffed MIME type instead of the
 * extension and would otherwise grey the file out.
 */
export const STUDIO_BRUSH_PACK_ACCEPT =
  ".json,.abr,.myb,.kpp,.sut,.sutg,.bundle,application/json,application/octet-stream,application/x-photoshop,image/png,application/zip,application/x-krita-resourcebundle";

/** `.myb`/`.kpp` are single presets; the ABR lane keeps its own 32MB budget. */
export const STUDIO_BRUSH_PROGRAM_MAX_BYTES = 8 * 1024 * 1024;

/** Bounded external containers; mirrors the hard FormatGateway ceiling. */
export const STUDIO_EXTERNAL_BRUSH_PACK_MAX_BYTES = 128_000_000;

/** Extension first, then the MIME types a picker may report instead. */
export function studioBrushPackFormatOf(
  fileName: string,
  mimeType = "",
): StudioBrushPackFormat | null {
  if (/\.abr$/iu.test(fileName) || mimeType === "application/x-photoshop") return "abr";
  if (/\.myb$/iu.test(fileName)) return "myb";
  if (/\.kpp$/iu.test(fileName)) return "kpp";
  if (/\.sut$/iu.test(fileName)) return "sut";
  if (/\.sutg$/iu.test(fileName)) return "sutg";
  if (/\.bundle$/iu.test(fileName) || mimeType === "application/x-krita-resourcebundle") {
    return "bundle";
  }
  if (/\.json$/iu.test(fileName) || mimeType === "application/json") return "json";
  return null;
}
