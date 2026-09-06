import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BONE_OFFSETS,
  SCENE_PROP_IDS,
  SCENE_PROPS,
} from "./studio-vrm-procedural-scene-props";

function moduleImports(fileName: string) {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const valueImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { dynamicImports, source, valueImports };
}

describe("Studio VRM procedural scene prop ownership", () => {
  it("preserves the shipped catalog identities and categories", () => {
    const ids = SCENE_PROPS.map((prop) => prop.id);
    const categories = SCENE_PROPS.reduce<Record<string, number>>((counts, prop) => {
      counts[prop.category] = (counts[prop.category] ?? 0) + 1;
      return counts;
    }, {});

    expect(ids).toEqual([
      "cat", "dog", "bunny", "bird", "fox", "bear", "chick", "fish",
      "sword", "shield", "book", "flower", "gem", "crystal", "cloud", "star",
      "penguin", "dragon", "unicorn", "owl", "butterfly", "deer", "wolf", "turtle",
      "staff", "bowWeapon", "lantern", "crown", "ring", "potion", "scroll", "guitar",
      "umbrella", "hammer", "wand", "heartProp", "moon", "sun", "treasureChest", "balloon",
      "candle", "mask", "sparkle", "fire", "lightning", "snowflake", "rainbow", "bubbles",
      "leaves", "feather", "hamster", "snake", "frog", "panda", "lion", "basket",
      "letter", "rose", "dagger", "mirror", "clock", "teacup", "backpack2", "torch",
      "coin", "heartFX", "note", "magic", "smoke", "cherry",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...SCENE_PROP_IDS]).toEqual(ids);
    expect(categories).toEqual({ animal: 21, item: 34, effect: 15 });
  });

  it("preserves the established smart attachment defaults", () => {
    expect(DEFAULT_BONE_OFFSETS.sword?.rightHand).toEqual({
      offsetX: 0.05,
      offsetY: 0.12,
      offsetZ: -0.05,
      rotX: 70,
      rotY: 0,
      rotZ: -20,
      scale: 0.75,
    });
    expect(DEFAULT_BONE_OFFSETS.crown?.head).toEqual({
      offsetX: 0,
      offsetY: 0.18,
      offsetZ: 0.02,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scale: 0.55,
    });
  });

  it("keeps one-way static ownership without bypassing the outer VRM lazy boundary", () => {
    const poser = moduleImports("./StudioVrmPoserViewport.tsx");
    const props = moduleImports("./studio-vrm-procedural-scene-props.tsx");
    const lazyUi = moduleImports("../studio-page-lazy-ui.ts");

    expect(poser.valueImports).toContain("./studio-vrm-procedural-scene-props");
    expect(props.valueImports).not.toContain("./StudioVrmPoser");
    expect(props.valueImports).not.toContain("../StudioPage");
    expect(lazyUi.dynamicImports).toContain("./vrm/StudioVrmPoser");
    expect(lazyUi.source).not.toContain("studio-vrm-procedural-scene-props");
  });

  it("leaves the former owner free of local catalog and mesh declarations", () => {
    const poser = moduleImports("./StudioVrmPoser.tsx").source;

    for (const declaration of [
      "type ScenePropDef",
      "const SCENE_PROPS",
      "const SCENE_PROP_IDS",
      "function AnimalCat",
      "const PROP_COMPONENTS",
      "const DEFAULT_BONE_OFFSETS",
      "function SceneProp3D",
    ]) {
      expect(poser).not.toContain(declaration);
    }
  });
});
