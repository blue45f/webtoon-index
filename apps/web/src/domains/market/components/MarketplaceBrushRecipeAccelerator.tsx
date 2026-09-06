import { useMemo, useState, type ReactElement } from "react";

import {
  createCreatorMarketplaceBrushEngineNode,
  creatorMarketplaceBrushCombinationCount,
  normalizeCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceBrushEngineKind,
  type CreatorMarketplaceBrushInputChannel,
  type CreatorMarketplaceBrushTarget,
  type CreatorMarketplaceBrushTipLayer,
} from "@/shared/lib/creator-marketplace-authoring-workshop";

interface RecipeTemplate {
  id: string;
  name: string;
  description: string;
  engines: readonly CreatorMarketplaceBrushEngineKind[];
  intendedUse: readonly string[];
}

const RECIPES: readonly RecipeTemplate[] = [
  {
    id: "webtoon-ink",
    name: "웹툰 잉크 프로",
    description: "솔리드 경로 + 벡터 외곽선 + 종이 릴리프",
    engines: ["solid-path", "vector-outline", "texture-relief"],
    intendedUse: ["inking", "webtoon", "clean-line"],
  },
  {
    id: "graphite-pencil",
    name: "흑연·거친 연필",
    description: "드라이 미디어 + 이미지 팁 + 그레인 + 정리 지우개",
    engines: ["dry-media", "image-tip", "texture-relief", "eraser"],
    intendedUse: ["sketch", "pencil", "shading"],
  },
  {
    id: "watercolor-wash",
    name: "수채 워시",
    description: "젖은 매체 + 확산 + 종이 결 + 가장자리 후처리",
    engines: ["wet-media", "watercolor-diffusion", "texture-relief", "post-process"],
    intendedUse: ["watercolor", "wash", "background"],
  },
  {
    id: "oil-impasto",
    name: "유화 임파스토",
    description: "브리슬 댑 + 유화 혼합 + 높이 릴리프 + 스머지",
    engines: ["dab-stamp", "oil-impasto", "texture-relief", "smudge"],
    intendedUse: ["oil", "impasto", "painting"],
  },
  {
    id: "neon-ribbon",
    name: "네온 리본",
    description: "벡터 코어 + 글로우 + 색상 후처리",
    engines: ["vector-outline", "glow", "post-process"],
    intendedUse: ["neon", "effect", "lettering"],
  },
  {
    id: "particle-scatter",
    name: "파티클 산포",
    description: "절차형 팁 + 파티클 + 듀얼 결합 + 발광",
    engines: ["procedural-sdf-tip", "particle-scatter", "dual-brush", "glow"],
    intendedUse: ["particle", "foliage", "effect"],
  },
  {
    id: "living-ink",
    name: "리빙 잉크",
    description: "살아 있는 잉크 + 젖은 혼합 + 안정화 후처리",
    engines: ["living-ink", "wet-media", "post-process"],
    intendedUse: ["organic", "ink", "experimental"],
  },
  {
    id: "tone-stamp",
    name: "톤·재질 스탬프",
    description: "이미지 팁 + 산포 + 마스크형 듀얼 브러시",
    engines: ["image-tip", "particle-scatter", "dual-brush"],
    intendedUse: ["tone", "texture", "stamp"],
  },
] as const;

const COMMON_PARAMETERS = ["size", "opacity", "flow", "spacing", "scatter", "jitter"] as const;
const MAPPING_PRESETS: readonly [CreatorMarketplaceBrushInputChannel, CreatorMarketplaceBrushTarget][] = [
  ["pressure", "size"],
  ["pressure", "opacity"],
  ["velocity", "spacing"],
  ["tilt-magnitude", "roundness"],
  ["twist", "angle"],
  ["direction", "angle"],
  ["random", "scatter"],
  ["time", "color-hue"],
] as const;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function requiresWebGl(engine: CreatorMarketplaceBrushEngineKind): boolean {
  return engine === "particle-scatter" || engine === "glow" || engine === "post-process";
}

function requiresWebGpu(engine: CreatorMarketplaceBrushEngineKind): boolean {
  return engine === "living-ink" || engine === "oil-impasto";
}

export function MarketplaceBrushRecipeAccelerator({
  draft: draftInput,
  onChange,
}: {
  draft: CreatorMarketplaceAuthoringDraft;
  onChange: (draft: CreatorMarketplaceAuthoringDraft) => void;
}): ReactElement | null {
  const draft = useMemo(
    () => normalizeCreatorMarketplaceAuthoringDraft(draftInput),
    [draftInput],
  );
  const [expanded, setExpanded] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState(0);
  if (draft.kind !== "brush") return null;

  const emit = (next: CreatorMarketplaceAuthoringDraft): void => {
    onChange(normalizeCreatorMarketplaceAuthoringDraft(next));
  };

  const applyRecipe = (recipe: RecipeTemplate): void => {
    const nodes = recipe.engines.map((engine, index) => {
      const node = createCreatorMarketplaceBrushEngineNode(engine);
      const parameters = {
        ...node.parameters,
        size: index === 0 ? 24 : Math.max(3, 18 - index * 2),
        opacity: index === 0 ? 1 : 0.62,
        flow: engine === "watercolor-diffusion" ? 0.5 : 0.9,
        spacing: engine === "solid-path" || engine === "vector-outline" ? 0.035 : 0.14,
        scatter: engine === "particle-scatter" ? 0.55 : 0,
        jitter: engine === "dry-media" ? 0.16 : 0,
      };
      return {
        ...node,
        id: `${recipe.id}_${index}_${node.id}`,
        name: `${recipe.name} · ${engine}`,
        parameters,
        backend: requiresWebGpu(engine)
          ? "webgpu" as const
          : requiresWebGl(engine)
            ? "webgl2" as const
            : node.backend,
      };
    });
    emit({
      ...draft,
      brush: {
        ...draft.brush,
        engineNodes: nodes,
        presetFamily: recipe.id,
        intendedUse: recipe.intendedUse,
      },
      compatibility: {
        ...draft.compatibility,
        webgl2: nodes.some((node) => node.backend === "webgl2") || draft.compatibility.webgl2,
        webgpu: nodes.some((node) => node.backend === "webgpu") || draft.compatibility.webgpu,
      },
    });
  };

  const updateNode = (
    nodeId: string,
    update: (node: CreatorMarketplaceAuthoringDraft["brush"]["engineNodes"][number]) =>
      CreatorMarketplaceAuthoringDraft["brush"]["engineNodes"][number],
  ): void => {
    emit({
      ...draft,
      brush: {
        ...draft.brush,
        engineNodes: draft.brush.engineNodes.map((node) => node.id === nodeId ? update(node) : node),
      },
    });
  };

  const addMapping = (nodeId: string): void => {
    const [channel, target] = MAPPING_PRESETS[selectedMapping] ?? MAPPING_PRESETS[0];
    updateNode(nodeId, (node) => ({
      ...node,
      mappings: [
        ...node.mappings,
        {
          id: uid("mapping"),
          channel,
          target,
          enabled: true,
          min: 0,
          max: 1,
          invert: false,
          curve: [0, 0.15, 0.38, 0.62, 0.82, 1],
        },
      ],
    }));
  };

  const addTip = (nodeId: string, source: CreatorMarketplaceBrushTipLayer["source"]): void => {
    updateNode(nodeId, (node) => ({
      ...node,
      tipLayers: [
        ...node.tipLayers,
        {
          id: uid("tip"),
          name: source === "studio-snapshot" ? "Brush Studio native tip" : `${source} tip`,
          source,
          blend: source === "image" ? "multiply" : "normal",
          opacity: 1,
          scale: 1,
          rotationDeg: 0,
          spacing: 0.14,
          scatter: source === "procedural" ? 0.18 : 0,
        },
      ],
    }));
  };

  const duplicateNode = (
    node: CreatorMarketplaceAuthoringDraft["brush"]["engineNodes"][number],
  ): void => {
    const copy = {
      ...node,
      id: uid("engine"),
      name: `${node.name} copy`,
      mappings: node.mappings.map((mapping) => ({ ...mapping, id: uid("mapping") })),
      tipLayers: node.tipLayers.map((tip) => ({ ...tip, id: uid("tip") })),
    };
    emit({
      ...draft,
      brush: { ...draft.brush, engineNodes: [...draft.brush.engineNodes, copy] },
    });
  };

  return (
    <section
      data-testid="market-brush-recipe-lab"
      className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/5 via-card to-card p-4 sm:p-5"
      aria-labelledby="market-brush-recipe-lab-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 id="market-brush-recipe-lab-title" className="text-base font-bold text-fg">
            브러시 레시피 랩
          </h4>
          <p className="mt-1 text-xs leading-5 text-fg-2">
            제작 목적에 맞는 다중 엔진 기준점을 선택한 뒤 모든 패스와 입력 매핑을 수정하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-h-10 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg"
        >
          {expanded ? "고급 편집 닫기" : "고급 편집 열기"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {RECIPES.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            onClick={() => applyRecipe(recipe)}
            className="min-h-24 rounded-xl border border-line bg-card p-3 text-left transition-colors hover:border-accent hover:bg-raised motion-reduce:transition-none"
          >
            <strong className="block text-sm text-fg">{recipe.name}</strong>
            <span className="mt-1 block text-[11px] leading-4 text-fg-2">{recipe.description}</span>
            <span className="mt-2 block text-[10px] font-semibold text-accent">
              {recipe.engines.length}개 엔진 패스
            </span>
          </button>
        ))}
      </div>

      {expanded && (
        <div className="mt-5 space-y-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-xs font-semibold text-fg">
              새 매핑
              <select
                value={selectedMapping}
                onChange={(event) => setSelectedMapping(Number(event.target.value))}
                className="ml-2 min-h-10 rounded-lg border border-line bg-card px-2 text-xs text-fg"
              >
                {MAPPING_PRESETS.map(([channel, target], index) => (
                  <option key={`${channel}-${target}`} value={index}>{channel} → {target}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-fg-2">
              현재 탐색 조합 {creatorMarketplaceBrushCombinationCount(draft).toLocaleString()}개
            </span>
          </div>

          {draft.brush.engineNodes.map((node, index) => (
            <article key={node.id} className="rounded-xl border border-line bg-card p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-fg">{index + 1}. {node.name}</strong>
                <span className="rounded-full bg-raised px-2 py-1 text-[10px] text-fg-2">
                  {node.engine} · {node.backend}
                </span>
                <div className="ml-auto flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => duplicateNode(node)}
                    className="min-h-10 rounded-lg border border-line px-3 text-[11px] font-semibold text-fg"
                  >복제</button>
                  <button
                    type="button"
                    onClick={() => addMapping(node.id)}
                    className="min-h-10 rounded-lg border border-line px-3 text-[11px] font-semibold text-fg"
                  >매핑 추가</button>
                  {(["shape", "image", "procedural", "studio-snapshot"] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => addTip(node.id, source)}
                      className="min-h-10 rounded-lg border border-line px-2 text-[10px] text-fg-2"
                    >+ {source}</button>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {COMMON_PARAMETERS.map((parameter) => (
                  <label key={parameter} className="text-[10px] font-semibold text-fg-2">
                    {parameter}
                    <input
                      type="number"
                      step={parameter === "size" ? 1 : 0.01}
                      value={Number(node.parameters[parameter] ?? 0)}
                      onChange={(event) => updateNode(node.id, (current) => ({
                        ...current,
                        parameters: {
                          ...current.parameters,
                          [parameter]: Number(event.target.value),
                        },
                      }))}
                      className="mt-1 min-h-10 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {node.mappings.map((mapping) => (
                  <button
                    key={mapping.id}
                    type="button"
                    title="매핑 삭제"
                    onClick={() => updateNode(node.id, (current) => ({
                      ...current,
                      mappings: current.mappings.filter((item) => item.id !== mapping.id),
                    }))}
                    className="min-h-9 rounded-full border border-line bg-raised/40 px-2 text-[10px] text-fg-2"
                  >
                    {mapping.channel} → {mapping.target} ×
                  </button>
                ))}
                {node.tipLayers.map((tip) => (
                  <button
                    key={tip.id}
                    type="button"
                    title="팁 레이어 삭제"
                    onClick={() => updateNode(node.id, (current) => ({
                      ...current,
                      tipLayers: current.tipLayers.filter((item) => item.id !== tip.id),
                    }))}
                    className="min-h-9 rounded-full border border-accent/25 bg-accent/5 px-2 text-[10px] text-fg-2"
                  >
                    tip:{tip.source} ×
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
