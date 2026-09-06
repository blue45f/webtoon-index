import { describe, expect, it } from "vitest";

import {
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS,
} from "./studio-brush-catalog";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import {
  auditStudioBrushSemanticClaims,
  describeStudioBrushRuntimeSemantics,
} from "./studio-brush-semantic-quality";

describe("Studio brush runtime semantics", () => {
  it("names the exact renderer tip, texture and input model instead of guessing from preview style", () => {
    expect(describeStudioBrushRuntimeSemantics("pen")).toMatchObject({
      engine: "causal-ink",
      tip: "round",
      texture: "none",
      dynamics: "causal-pressure",
      tipLabelKo: "원형 촉",
      textureLabelKo: "매끈",
      dynamicsLabelKo: "필압 추종",
    });
    expect(describeStudioBrushRuntimeSemantics("brush")).toMatchObject({
      engine: "angled-ribbon",
      tip: "angled-ribbon",
      dynamics: "ribbon-pressure",
      tipLabelKo: "방향성 리본 촉",
      dynamicsLabelKo: "리본 필압",
    });
    expect(describeStudioBrushRuntimeSemantics("watercolor")).toMatchObject({
      engine: "watercolor-dabs",
      texture: "wet-edge",
      dynamics: "watercolor-pressure",
      textureLabelKo: "웻 엣지",
    });
    expect(describeStudioBrushRuntimeSemantics("oil")).toMatchObject({
      engine: "oil-ribbon",
      tip: "bristle",
      texture: "procedural-bristle",
      dynamics: "bristle-pressure",
    });
    expect(describeStudioBrushRuntimeSemantics("screentone")).toMatchObject({
      engine: "screentone-dots",
      texture: "tone-grid",
      dynamics: "global-grid",
      textureLabelKo: "문서 고정 망점",
    });
  });

  it("keeps procedural catalogue identity separate from its generic runtime carrier", () => {
    const descriptor = studioBrushPackDescriptorById("heart-stamp");
    expect(descriptor).not.toBeNull();
    const presentation = describeStudioBrushRuntimeSemantics(
      descriptor!.catalogId,
      descriptor!.runtimeBrushId,
    );
    expect(presentation).toMatchObject({
      catalogId: "heart-stamp",
      runtimeBrushId: "ink-particle",
      engine: "dynamic-dabs",
      tip: "soft-particle",
      texture: "custom-alpha-capable",
      dynamics: "mapped-dabs",
    });
  });
});

describe("Studio brush semantic-claim audit", () => {
  it("detects material promises that the selected runtime does not support", () => {
    const wet = auditStudioBrushSemanticClaims({
      catalogId: "synthetic-watercolor",
      runtimeBrushId: "pen",
      name: "프로 수채 번짐",
      operation: "paint",
    });
    expect(wet.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "wet-claim-without-wet-response" }),
    ]));

    const bristle = auditStudioBrushSemanticClaims({
      catalogId: "synthetic-filbert",
      runtimeBrushId: "pen",
      name: "필버트 강모 평붓",
      operation: "paint",
      previewStyle: "solid",
    });
    expect(bristle.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "bristle-claim-without-bristle-response" }),
      expect.objectContaining({ code: "directional-claim-without-directional-tip" }),
    ]));
  });

  it("treats paint/erase contradictions as hard errors", () => {
    const result = auditStudioBrushSemanticClaims({
      catalogId: "synthetic-eraser",
      runtimeBrushId: "pen",
      name: "고무 지우개",
      operation: "paint",
    });
    expect(result.errorCount).toBe(1);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "eraser-name-operation-mismatch",
      }),
    ]));
  });

  it("accepts runtime-backed wet, bristle, particle, glow and tone promises", () => {
    const cases = [
      ["watercolor", "수채 워시"],
      ["oil", "필버트 강모 붓"],
      ["glitter", "글리터 반짝 입자"],
      ["neon", "네온 후광"],
      ["screentone", "스크린톤 망점"],
    ] as const;
    for (const [id, name] of cases) {
      const result = auditStudioBrushSemanticClaims({
        catalogId: id,
        name,
        operation: "paint",
      });
      expect(
        result.issues,
        `${id}: ${result.issues.map(({ code }) => code).join(", ")}`,
      ).toEqual([]);
    }
  });

  it("keeps every default quality-portfolio item connected to a real runtime operation", () => {
    const results = STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map((item) => {
      const descriptor = studioBrushPackDescriptorById(item.id);
      return auditStudioBrushSemanticClaims({
        catalogId: item.id,
        runtimeBrushId: descriptor?.runtimeBrushId ?? item.id,
        name: item.name,
        shortName: item.shortName,
        hint: item.hint,
        operation: item.operation,
        previewStyle: item.previewStyle,
      });
    });
    expect(results).toHaveLength(48);
    expect(results.flatMap(({ issues }) => (
      issues.filter(({ severity }) => severity === "error")
    ))).toEqual([]);
  });
});
