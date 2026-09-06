import type {
  StudioProductionAssetInput,
  StudioProductionFrameInput,
  StudioProductionInsightsInput,
  StudioProductionIssueInput,
  StudioProductionPageInput,
} from "./studio-production-insights";

/**
 * Converts Studio's flat page-element document into the deliberately small production-insights
 * input. It is a geometric/editorial projection, not reader telemetry: element rotation and
 * clipping are intentionally ignored, and text outside every frame remains page-level text.
 */

type RecordValue = Record<string, unknown>;

type FrameBounds = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source: RecordValue;
};

type MutableFrameProjection = {
  dialogue: string[];
  narration: string[];
  assets: StudioProductionAssetInput[];
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function visibleElement(value: unknown): value is RecordValue {
  return isRecord(value) && value.hidden !== true;
}

function frameBounds(value: unknown): FrameBounds | null {
  if (!visibleElement(value) || value.type !== "frame" || typeof value.id !== "string") return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { id: value.id, x, y, width, height, source: value };
}

function containingFrameIndex(value: RecordValue, frames: readonly FrameBounds[]): number {
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x === null || y === null) return -1;
  const width = finiteNumber(value.width) ?? 0;
  const height = finiteNumber(value.height) ?? 0;
  const centerX = x + Math.max(0, width) / 2;
  const centerY = y + Math.max(0, height) / 2;
  return frames.findIndex(
    (frame) =>
      centerX >= frame.x &&
      centerX <= frame.x + frame.width &&
      centerY >= frame.y &&
      centerY <= frame.y + frame.height
  );
}

function assetProjection(value: RecordValue): StudioProductionAssetInput {
  const provenance = isRecord(value.aiProvenance) ? value.aiProvenance : null;
  return {
    aiGenerated: provenance?.action === "generated",
    aiEdited: provenance?.action === "edited",
  };
}

function textValue(value: RecordValue): string | null {
  return typeof value.text === "string" && value.text.trim() ? value.text : null;
}

function frameInput(value: MutableFrameProjection): StudioProductionFrameInput {
  return {
    dialogue: value.dialogue,
    narration: value.narration,
    assets: value.assets,
  };
}

function projectPage(value: unknown): StudioProductionPageInput {
  if (!isRecord(value)) return {};
  const elements = Array.isArray(value.elements) ? value.elements.filter(visibleElement) : [];
  const frames = elements.flatMap((element) => {
    const bounds = frameBounds(element);
    return bounds ? [bounds] : [];
  });
  const frameProjections: MutableFrameProjection[] = frames.map((frame) => ({
    dialogue: [],
    narration: [],
    assets:
      typeof frame.source.bg === "string" && frame.source.bg.trim()
        ? [assetProjection(frame.source)]
        : [],
  }));
  const pageDialogue: string[] = [];
  const pageNarration: string[] = [];
  const pageAssets: StudioProductionAssetInput[] = [];

  for (const element of elements) {
    if (element.type === "frame") continue;
    const frameIndex = containingFrameIndex(element, frames);
    const target = frameIndex >= 0 ? frameProjections[frameIndex] : null;
    const text = textValue(element);
    if (text && element.type === "bubble") {
      (element.variant === "box" ? target?.narration ?? pageNarration : target?.dialogue ?? pageDialogue).push(text);
    } else if (text && element.type === "text") {
      (target?.narration ?? pageNarration).push(text);
    }
    if (element.type === "image" || element.type === "sticker") {
      (target?.assets ?? pageAssets).push(assetProjection(element));
    }
  }

  return {
    frames: frameProjections.map(frameInput),
    dialogue: pageDialogue,
    narration: pageNarration,
    assets: pageAssets,
    review: isRecord(value.review)
      ? {
          status:
            value.review.status === "draft" ||
            value.review.status === "needs-review" ||
            value.review.status === "changes-requested" ||
            value.review.status === "approved"
              ? value.review.status
              : null,
          locked: value.review.locked === true,
        }
      : null,
  };
}

export function buildStudioProductionInsightsInput(
  pages: unknown,
  issues: readonly StudioProductionIssueInput[] = []
): StudioProductionInsightsInput {
  return {
    pages: Array.isArray(pages) ? pages.map(projectPage) : [],
    issues,
  };
}
