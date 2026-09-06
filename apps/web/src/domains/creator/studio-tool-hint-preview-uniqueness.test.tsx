import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioToolHintPreview } from "./components/StudioToolHintPreview";
import {
  STUDIO_TOOL_HINT_PREVIEW_KINDS,
  STUDIO_TOOL_HINT_PREVIEW_VARIANTS,
  studioToolHintPreviewSpecFromRuntime,
} from "./studio-tool-hint-preview-kind";

function normalizeVisualMarkup(markup: string): string {
  return markup
    .replace(/\sdata-[\w:-]+="[^"]*"/gu, "")
    .replace(/\sid="[^"]*"/gu, ' id="__preview-id__"')
    .replace(/url\(#[^)]+\)/gu, "url(#__preview-id__)")
    .replace(/\s+/gu, " ")
    .trim();
}

function renderPreview(
  kind: (typeof STUDIO_TOOL_HINT_PREVIEW_KINDS)[number],
  variant?: string,
  reducedMotion = true,
): string {
  const spec = studioToolHintPreviewSpecFromRuntime(kind, variant);
  return normalizeVisualMarkup(
    renderToStaticMarkup(
      createElement(StudioToolHintPreview, { ...spec, reducedMotion })
    )
  );
}

describe("Studio motion-coach visual uniqueness", () => {
  for (const reducedMotion of [true, false]) {
    it(`keeps every base tool family visually distinct in ${reducedMotion ? "reduced" : "animated"} mode after removing identity metadata`, () => {
      const ownersByVisual = new Map<string, string[]>();
      for (const kind of STUDIO_TOOL_HINT_PREVIEW_KINDS) {
        const visual = renderPreview(kind, undefined, reducedMotion);
        ownersByVisual.set(visual, [...(ownersByVisual.get(visual) ?? []), kind]);
      }

      const duplicates = [...ownersByVisual.values()].filter((owners) => owners.length > 1);
      expect(duplicates).toEqual([]);
    });
  }

  for (const reducedMotion of [true, false]) {
    it(`keeps each stateful family's canonical actions visually distinct in ${reducedMotion ? "reduced" : "animated"} mode`, () => {
      const duplicates: Array<{ kind: string; variants: string[] }> = [];
      for (const kind of STUDIO_TOOL_HINT_PREVIEW_KINDS) {
        const variants = STUDIO_TOOL_HINT_PREVIEW_VARIANTS[kind];
        if (variants.length < 2) continue;
        const variantsByVisual = new Map<string, string[]>();
        for (const variant of variants) {
          const visual = renderPreview(kind, variant, reducedMotion);
          variantsByVisual.set(visual, [
            ...(variantsByVisual.get(visual) ?? []),
            variant,
          ]);
        }
        for (const repeatedVariants of variantsByVisual.values()) {
          if (repeatedVariants.length > 1) {
            duplicates.push({ kind, variants: repeatedVariants });
          }
        }
      }

      expect(duplicates).toEqual([]);
    });
  }
});
