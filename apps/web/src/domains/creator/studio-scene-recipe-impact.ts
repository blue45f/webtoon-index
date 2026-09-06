/**
 * Scene Recipe → 의존성·영향도 그래프 어댑터.
 *
 * 레시피의 세트·캐릭터·표정·포즈·의상·효과·비트 레퍼런스를 dependency impact
 * graph의 노드/엣지로 투영한다 — "포즈 프리셋이 바뀌면 어떤 컷을 다시 본다?"
 * 를 기존 그래프 엔진이 계산하게 하는 게 목적이다. 순수, 결정론, DOM 무관.
 */

import type {
  StudioDependencyEdge,
  StudioDependencyNode,
} from "./studio-dependency-impact-graph";
import type { StudioSceneRecipe } from "./studio-scene-recipe";

const APPROVAL_DEFAULT = "draft" as const;

function node(
  id: string,
  kind: StudioDependencyNode["kind"],
  label: string,
): StudioDependencyNode {
  return {
    id,
    kind,
    label,
    approval: APPROVAL_DEFAULT,
    reworkMinutes: 0,
  };
}

function edge(
  dependencyId: string,
  dependentId: string,
  relation: StudioDependencyEdge["relation"],
  reason?: string,
): StudioDependencyEdge {
  return {
    dependencyId,
    dependentId,
    relation,
    ...(reason ? { reason } : {}),
  };
}

export interface StudioSceneRecipeGraphProjection {
  readonly nodes: readonly StudioDependencyNode[];
  readonly edges: readonly StudioDependencyEdge[];
}

/**
 * 레시피 한 개를 그래프 조각으로 투영한다. 노드 id는 `recipe:{id}` / `shot:{recipe}:{shot}`
 * 처럼 접두어를 붙여 문서 안의 다른 객체 id와 충돌하지 않게 한다. 레퍼런스 자체
 * (캐릭터·포즈 등)는 노드로 올리되 approval/rework 같은 운영 정보는 호출자가 채운다.
 */
export function projectStudioSceneRecipeToImpactGraph(
  recipe: StudioSceneRecipe,
): StudioSceneRecipeGraphProjection {
  const nodes: StudioDependencyNode[] = [];
  const edges: StudioDependencyEdge[] = [];
  const recipeNodeId = `scene-recipe:${recipe.id}`;
  nodes.push(node(recipeNodeId, "scene", recipe.name));

  if (recipe.setRef) {
    nodes.push(node(`set:${recipe.setRef}`, "location", recipe.setRef));
    edges.push(edge(`set:${recipe.setRef}`, recipeNodeId, "uses", "레시피 세트"));
  }

  for (const slot of recipe.cast) {
    const slotNodeId = `${recipeNodeId}:slot:${slot.id}`;
    nodes.push(
      node(slotNodeId, "character", slot.label ?? slot.id),
    );
    edges.push(edge(slotNodeId, recipeNodeId, "contains", "레시피 캐스트"));
    if (slot.characterRef) {
      nodes.push(node(`character:${slot.characterRef}`, "character", slot.characterRef));
      // 엔진의 "derives-from " 리터럴은 끝에 공백이 있어(기존 데이터 호환) 쓸 수 없다.
      edges.push(edge(`character:${slot.characterRef}`, slotNodeId, "uses", "슬롯 바인딩"));
    }
    if (slot.costumeRef) {
      nodes.push(node(`costume:${slot.costumeRef}`, "costume", slot.costumeRef));
      edges.push(edge(`costume:${slot.costumeRef}`, slotNodeId, "styles-with", "슬롯 의상"));
    }
    for (const refKey of ["expressionRef", "poseRef"] as const) {
      const ref = slot[refKey];
      if (!ref) continue;
      const nodeId = `${refKey === "poseRef" ? "pose" : "expression"}:${ref}`;
      nodes.push(node(nodeId, "asset", ref));
      edges.push(edge(nodeId, slotNodeId, "renders-with", refKey === "poseRef" ? "슬롯 포즈" : "슬롯 표정"));
    }
  }

  for (const shot of recipe.shots) {
    const shotNodeId = `${recipeNodeId}:shot:${shot.id}`;
    nodes.push(node(shotNodeId, "shot", shot.label ?? shot.id));
    edges.push(edge(recipeNodeId, shotNodeId, "contains", "레시피 컷"));
    if (shot.lighting) {
      nodes.push(node(`lighting:${shot.lighting}`, "lighting", shot.lighting));
      edges.push(edge(`lighting:${shot.lighting}`, shotNodeId, "renders-with", "컷 조명"));
    }
    for (const effect of shot.effects ?? []) {
      nodes.push(node(`effect:${effect.effectRef}`, "asset", effect.effectRef));
      edges.push(edge(`effect:${effect.effectRef}`, shotNodeId, "renders-with", "컷 효과"));
    }
    for (const beatRef of shot.beatRefs ?? []) {
      nodes.push(node(`dialogue:${beatRef}`, "dialogue", beatRef));
      edges.push(edge(`dialogue:${beatRef}`, shotNodeId, "localizes", "컷 비트"));
    }
  }

  return { nodes, edges };
}
