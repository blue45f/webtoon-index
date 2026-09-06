/**
 * CanvasKit/Skia quality provider.
 *
 * CanvasKit is deliberately a specialist, not Studio's document or live-frame authority. It
 * consumes ToonSpectrum-owned SVG path data, performs Skia PathOps / stroke expansion, returns
 * plain SVG path data, and releases every Embind allocation before returning. The saved document
 * therefore never contains a CanvasKit object or a WASM pointer.
 */

import {
  registerQualityEngineLoader,
  type StudioPathOpsResult,
  type StudioQualityEngine,
  type StudioQualityPathOp,
  type StudioStrokeToPathStyle,
} from "./studio-canvaskit-adapter";
import { flattenStudioCanvasKitPathCommands } from "./studio-canvaskit-portable-geometry";
import { StudioEngineUnavailableError } from "./studio-engine-failure-policy";

import type {
  CanvasKit,
  Path,
  PathOp,
  StrokeCap,
  StrokeJoin,
} from "canvaskit-wasm";

const MAX_PATH_DATA_CODE_UNITS = 64 * 1024 * 1024;
const DEFAULT_STROKE_PRECISION = 2;

function invalidPathReason(label: "첫 번째" | "두 번째" | "변환할"): StudioPathOpsResult {
  return {
    ok: false,
    reason: `${label} SVG 경로를 Skia가 해석하지 못했어요.`,
  };
}

function isUsablePathData(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_PATH_DATA_CODE_UNITS
  );
}

function canvasKitPathOp(
  canvasKit: CanvasKit,
  op: StudioQualityPathOp,
): PathOp {
  switch (op) {
    case "union":
      return canvasKit.PathOp.Union;
    case "intersect":
      return canvasKit.PathOp.Intersect;
    case "difference":
      return canvasKit.PathOp.Difference;
    case "xor":
      return canvasKit.PathOp.XOR;
  }
}

function canvasKitStrokeCap(
  canvasKit: CanvasKit,
  cap: StudioStrokeToPathStyle["cap"],
): StrokeCap {
  switch (cap) {
    case "butt":
      return canvasKit.StrokeCap.Butt;
    case "square":
      return canvasKit.StrokeCap.Square;
    case "round":
      return canvasKit.StrokeCap.Round;
  }
}

function canvasKitStrokeJoin(
  canvasKit: CanvasKit,
  join: StudioStrokeToPathStyle["join"],
): StrokeJoin {
  switch (join) {
    case "miter":
      return canvasKit.StrokeJoin.Miter;
    case "bevel":
      return canvasKit.StrokeJoin.Bevel;
    case "round":
      return canvasKit.StrokeJoin.Round;
  }
}

function safeDelete(path: Path | null | undefined): void {
  if (!path) return;
  try {
    path.delete();
  } catch {
    // The provider owns only short-lived paths. A failed cleanup must not hide the operation's
    // semantic result, while CanvasKit's own epoch teardown still releases the WASM heap.
  }
}

function normalizeDash(
  dash: StudioStrokeToPathStyle["dash"],
): { on: number; off: number; phase: number } | null | "unsupported" {
  if (!dash) return null;
  if (
    !Array.isArray(dash.pattern)
    || dash.pattern.length === 0
    || dash.pattern.length > 2
    || dash.pattern.some((value) => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(dash.phase)
  ) {
    return "unsupported";
  }
  const on = dash.pattern[0]!;
  const off = dash.pattern.length === 1 ? on : dash.pattern[1]!;
  return { on, off, phase: dash.phase };
}

function pathResult(
  canvasKit: CanvasKit,
  path: Path | null,
  failureReason: string,
): StudioPathOpsResult {
  if (!path) return { ok: false, reason: failureReason };
  const pathData = path.toSVGString();
  if (!pathData || pathData.trim().length === 0) {
    return { ok: false, reason: failureReason };
  }
  let commands: Float32Array;
  try {
    commands = path.toCmds();
  } catch {
    return {
      ok: false,
      reason: "Skia 경로 결과를 이식 가능한 지오메트리로 추출하지 못했어요.",
    };
  }
  const portable = flattenStudioCanvasKitPathCommands(commands, {
    move: canvasKit.MOVE_VERB,
    line: canvasKit.LINE_VERB,
    quad: canvasKit.QUAD_VERB,
    conic: canvasKit.CONIC_VERB,
    cubic: canvasKit.CUBIC_VERB,
    close: canvasKit.CLOSE_VERB,
  });
  if (!portable.ok) return { ok: false, reason: portable.reason };
  return { ok: true, pathData, geometry: portable.geometry };
}

/**
 * SVG `d` does not carry a fill rule. PathOps can legitimately return an EvenOdd path (notably
 * XOR), so serializing it directly would make a later SVG/Path2D consumer interpret the same
 * contours with nonzero winding and fill a hole. Convert the contour directions while the Skia
 * fill type is still available, then return the portable path data.
 */
function windingPathResult(
  canvasKit: CanvasKit,
  path: Path | null,
  failureReason: string,
): StudioPathOpsResult {
  if (!path) return { ok: false, reason: failureReason };
  let empty: Path | null = null;
  let simplified: Path | null = null;
  let winding: Path | null = null;
  try {
    // CanvasKit 0.41 can change an XOR path's FillType without reversing a corner-touching
    // contour. Unioning with an empty path first makes PathOps simplify that topology into
    // portable contours; makeAsWinding can then orient any remaining nested holes correctly.
    empty = new canvasKit.Path();
    simplified = canvasKit.Path.MakeFromOp(path, empty, canvasKit.PathOp.Union);
    if (!simplified) return { ok: false, reason: failureReason };
    winding = simplified.makeAsWinding();
    return pathResult(canvasKit, winding, failureReason);
  } catch {
    return { ok: false, reason: failureReason };
  } finally {
    safeDelete(winding);
    if (simplified !== winding) safeDelete(simplified);
    safeDelete(empty);
  }
}

/**
 * Creates a synchronous quality provider from an already initialized CanvasKit module.
 *
 * Text shaping is deliberately unavailable because the adapter's canonical text contract requires
 * glyph IDs and source clusters. CanvasKit Paragraph can rasterize shaped text, but it does not
 * expose the full editable run contract we need. HarfBuzz can become a separately selected provider;
 * CanvasKit never delegates this operation to a basic approximation.
 */
export function createStudioCanvasKitQualityEngine(
  canvasKit: CanvasKit,
): StudioQualityEngine {
  return {
    id: "canvaskit",
    capabilities: {
      textShaping: false,
      pathBoolean: true,
      strokeToPath: true,
      fontSubsetting: false,
    },

    shapeText() {
      throw new StudioEngineUnavailableError({
        providerId: "canvaskit",
        stage: "capability",
        message: "CanvasKit does not satisfy the editable text-shaping contract.",
      });
    },

    pathOp(a, b, op) {
      if (!isUsablePathData(a)) return invalidPathReason("첫 번째");
      if (!isUsablePathData(b)) return invalidPathReason("두 번째");

      let first: Path | null = null;
      let second: Path | null = null;
      let combined: Path | null = null;
      try {
        first = canvasKit.Path.MakeFromSVGString(a);
        if (!first) return invalidPathReason("첫 번째");
        second = canvasKit.Path.MakeFromSVGString(b);
        if (!second) return invalidPathReason("두 번째");

        // Use the public static factory. CanvasKit 0.41.1's generated runtime exposes
        // Path.MakeFromOp consistently even where an older prototype misses makeCombined.
        combined = canvasKit.Path.MakeFromOp(
          first,
          second,
          canvasKitPathOp(canvasKit, op),
        );
        return windingPathResult(
          canvasKit,
          combined,
          "Skia가 이 두 경로의 불리언 결과를 만들지 못했어요.",
        );
      } catch {
        return {
          ok: false,
          reason: "Skia 경로 불리언 연산 중 오류가 발생했어요.",
        };
      } finally {
        safeDelete(combined);
        safeDelete(second);
        safeDelete(first);
      }
    },

    strokeToPath(pathData, style) {
      if (!isUsablePathData(pathData)) return invalidPathReason("변환할");
      if (
        !Number.isFinite(style.widthPx)
        || style.widthPx <= 0
        || !Number.isFinite(style.miterLimit)
        || style.miterLimit <= 0
      ) {
        return {
          ok: false,
          reason: "획 두께와 마이터 한계는 0보다 큰 유한한 값이어야 해요.",
        };
      }

      const dash = normalizeDash(style.dash);
      if (dash === "unsupported") {
        return {
          ok: false,
          reason:
            "현재 Skia 고품질 변환은 실선 또는 1·2값 점선 패턴만 지원해요. 복합 점선은 별도 지오메트리 단계가 필요합니다.",
        };
      }

      let source: Path | null = null;
      let dashed: Path | null = null;
      let stroked: Path | null = null;
      try {
        source = canvasKit.Path.MakeFromSVGString(pathData);
        if (!source) return invalidPathReason("변환할");

        const strokeSource = dash
          ? (dashed = source.makeDashed(dash.on, dash.off, dash.phase))
          : source;
        if (!strokeSource) {
          return {
            ok: false,
            reason: "Skia가 점선 경로를 만들지 못했어요.",
          };
        }

        stroked = strokeSource.makeStroked({
          width: style.widthPx,
          miter_limit: style.miterLimit,
          precision: DEFAULT_STROKE_PRECISION,
          cap: canvasKitStrokeCap(canvasKit, style.cap),
          join: canvasKitStrokeJoin(canvasKit, style.join),
        });
        return pathResult(
          canvasKit,
          stroked,
          "Skia가 이 획을 채움 경로로 변환하지 못했어요.",
        );
      } catch {
        return {
          ok: false,
          reason: "Skia 획 변환 중 오류가 발생했어요.",
        };
      } finally {
        safeDelete(stroked);
        safeDelete(dashed);
        safeDelete(source);
      }
    },
  };
}

/**
 * Lazy-loads the production CanvasKit package and its emitted WASM asset.
 *
 * `?url` lets Vite fingerprint/copy the binary while keeping both the JS glue and the 6.8 MiB WASM
 * out of Studio's eager graph. The quality provider is loaded only when a caller resolves it.
 */
export async function loadStudioCanvasKitQualityEngine(): Promise<StudioQualityEngine> {
  const [{ default: initializeCanvasKit }, { default: wasmUrl }] = await Promise.all([
    import("canvaskit-wasm"),
    import("canvaskit-wasm/bin/canvaskit.wasm?url"),
  ]);
  const canvasKit = await initializeCanvasKit({
    locateFile(file) {
      return file.endsWith(".wasm") ? wasmUrl : file;
    },
  });
  return createStudioCanvasKitQualityEngine(canvasKit);
}

/** Registers the lazy provider with the existing quality-engine resolver. */
export function registerStudioCanvasKitQualityEngine(): void {
  registerQualityEngineLoader(loadStudioCanvasKitQualityEngine);
}
