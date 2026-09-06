import { describe, expect, it } from "vitest";

import { createStudioDependencyImpactGraph } from "./studio-dependency-impact-graph";
import { STUDIO_SCENE_RECIPE_VERSION, type StudioSceneRecipe } from "./studio-scene-recipe";
import {
  projectStudioSceneRecipeToImpactGraph,
} from "./studio-scene-recipe-impact";

function makeRecipe(): StudioSceneRecipe {
  return {
    version: STUDIO_SCENE_RECIPE_VERSION,
    id: "r1",
    name: "옥상",
    setRef: "rooftop",
    cast: [
      { id: "hero", characterRef: "char-hero", expressionRef: "xf_joy", poseRef: "pose-run", costumeRef: "suit-a" },
      { id: "rival" },
    ],
    defaultCamera: { angle: "front", zoom: 1 },
    defaultLighting: "day",
    shots: [
      { id: "s1", lighting: "night", effects: [{ id: "fx", effectRef: "speedlines", intensity: 0.5 }], beatRefs: ["b1"] },
      { id: "s2" },
    ],
  };
}

describe("projectStudioSceneRecipeToImpactGraph", () => {
  it("레시피·슬롯·컷·레퍼런스를 노드와 엣지로 투영한다", () => {
    const { nodes, edges } = projectStudioSceneRecipeToImpactGraph(makeRecipe());
    const ids = new Set(nodes.map((n) => n.id));
    for (const expected of [
      "scene-recipe:r1",
      "set:rooftop",
      "scene-recipe:r1:slot:hero",
      "character:char-hero",
      "expression:xf_joy",
      "pose:pose-run",
      "costume:suit-a",
      "scene-recipe:r1:shot:s1",
      "lighting:night",
      "effect:speedlines",
      "dialogue:b1",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
    // 컷 s2는 조명·효과·비트 오버라이드가 없으므로 해당 노드가 없다.
    expect(ids.has("lighting:day")).toBe(false);
    const shotEdge = edges.find(
      (e) => e.dependentId === "scene-recipe:r1:shot:s1" && e.dependencyId === "effect:speedlines",
    );
    expect(shotEdge?.relation).toBe("renders-with");
  });

  it("투영 결과가 기존 그래프 엔진의 결정론 검증을 통과한다", () => {
    const { nodes, edges } = projectStudioSceneRecipeToImpactGraph(makeRecipe());
    const graph = createStudioDependencyImpactGraph({ nodes, edges });
    // 어댑터는 자기 안에서 완결된 그래프를 만들므로 dangling 진단이 없어야 한다.
    expect(graph.diagnostics.filter((d) => d.code === "DANGLING_DEPENDENCY")).toEqual([]);
    expect(graph.diagnostics.filter((d) => d.code === "DANGLING_DEPENDENT")).toEqual([]);
    expect(graph.diagnostics.filter((d) => d.code === "DUPLICATE_EDGE")).toEqual([]);
  });

  it("같은 입력이면 같은 출력 — 결정론성", () => {
    const a = projectStudioSceneRecipeToImpactGraph(makeRecipe());
    const b = projectStudioSceneRecipeToImpactGraph(makeRecipe());
    expect(a).toEqual(b);
  });
});
