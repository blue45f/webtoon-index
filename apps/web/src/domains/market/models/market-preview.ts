import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

export interface BrushPreviewData {
  readonly name: string;
  readonly size?: number;
  readonly opacity?: number;
  readonly flow?: number;
  readonly spacing?: number;
  readonly family?: string;
  readonly blendMode?: string;
  readonly hardness?: number;
  readonly color?: string;
  readonly tip?: string;
}

export interface FilterPreviewData {
  readonly name: string;
  readonly engine: string;
  readonly values: Record<string, number | string | boolean>;
}

export interface PalettePreviewData {
  readonly name: string;
  readonly colors: readonly string[];
}

export interface TemplatePreviewData {
  readonly name: string;
  readonly templateId: string;
}

export interface RecipePreviewData {
  readonly name: string;
  readonly recipeId: string;
  readonly parameters?: Record<string, unknown>;
  readonly runtimeRef?: string;
}

/**
 * 팔레트 리소스의 portable JSON definition에서 실제 색상 배열을 꺼낸다.
 * 계약상 colors는 중복 없는 소문자 #rrggbb 1~64개이지만, 저장 시점 버전 차이에
 * 대비해 여기서 한 번 더 방어적으로 검증한다. 팔레트가 아니면 null.
 */
export function palettePreviewColors(
  record: CreatorMarketplaceResourceRecord
): readonly string[] | null {
  return palettePreviewData(record)?.[0]?.colors ?? null;
}

/**
 * A palette pack can carry several independently named color sets. Keep each valid entry so the
 * detail page can let artists inspect the whole pack instead of silently previewing only entry 1.
 */
export function palettePreviewData(
  record: CreatorMarketplaceResourceRecord
): readonly PalettePreviewData[] | null {
  if (record.kind !== "palette") return null;
  const items: PalettePreviewData[] = [];
  for (const entry of record.entries) {
    if (entry.delivery.mode !== "portable-json") continue;
    const definition = entry.delivery.payload.definition as { colors?: unknown };
    const colors = definition?.colors;
    if (
      Array.isArray(colors)
      && colors.length > 0
      && colors.every((color) => typeof color === "string" && HEX_COLOR_PATTERN.test(color))
    ) {
      items.push({ name: entry.name, colors });
    }
  }
  return items.length > 0 ? items : null;
}

export function brushPreviewData(
  record: CreatorMarketplaceResourceRecord
): readonly BrushPreviewData[] | null {
  if (record.kind !== "brush") return null;
  const items: BrushPreviewData[] = [];
  for (const entry of record.entries) {
    if (entry.delivery.mode !== "portable-json") continue;
    const definition = entry.delivery.payload.definition as { snapshot?: Record<string, unknown> };
    const snapshot = definition?.snapshot;
    if (snapshot && typeof snapshot === "object") {
      items.push({
        name: entry.name,
        size: typeof snapshot.size === "number" ? snapshot.size : undefined,
        opacity: typeof snapshot.opacity === "number" ? snapshot.opacity : undefined,
        flow: typeof snapshot.flow === "number" ? snapshot.flow : undefined,
        spacing: typeof snapshot.spacing === "number" ? snapshot.spacing : undefined,
        family: typeof snapshot.family === "string" ? snapshot.family : undefined,
        blendMode: typeof snapshot.blendMode === "string" ? snapshot.blendMode : undefined,
        hardness: typeof snapshot.hardness === "number" ? snapshot.hardness : undefined,
        color: typeof snapshot.color === "string" && HEX_COLOR_PATTERN.test(snapshot.color) ? snapshot.color : undefined,
        tip: typeof snapshot.tip === "string" ? snapshot.tip : undefined,
      });
    }
  }
  return items.length > 0 ? items : null;
}

export function filterPreviewData(
  record: CreatorMarketplaceResourceRecord
): readonly FilterPreviewData[] | null {
  if (record.kind !== "filter") return null;
  const items: FilterPreviewData[] = [];
  for (const entry of record.entries) {
    if (entry.delivery.mode !== "portable-json") continue;
    const definition = entry.delivery.payload.definition as {
      engine?: unknown;
      values?: Record<string, unknown>;
    };
    if (typeof definition?.engine === "string" && definition.values && typeof definition.values === "object") {
      const cleanValues: Record<string, number | string | boolean> = {};
      for (const [k, v] of Object.entries(definition.values)) {
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
          cleanValues[k] = v;
        }
      }
      items.push({
        name: entry.name,
        engine: definition.engine,
        values: cleanValues,
      });
    }
  }
  return items.length > 0 ? items : null;
}

export function templatePreviewData(
  record: CreatorMarketplaceResourceRecord
): readonly TemplatePreviewData[] | null {
  if (record.kind !== "template") return null;
  const items: TemplatePreviewData[] = [];
  for (const entry of record.entries) {
    if (entry.delivery.mode === "portable-json") {
      const definition = entry.delivery.payload.definition as { templateId?: unknown };
      if (typeof definition?.templateId === "string") {
        items.push({ name: entry.name, templateId: definition.templateId });
      }
    } else if (entry.delivery.mode === "builtin-ref") {
      items.push({ name: entry.name, templateId: entry.delivery.runtimeRef });
    }
  }
  return items.length > 0 ? items : null;
}

export function recipePreviewData(
  record: CreatorMarketplaceResourceRecord
): readonly RecipePreviewData[] | null {
  if (record.kind !== "asset" && record.kind !== "3d-preset" && record.kind !== "3d-asset") return null;
  const items: RecipePreviewData[] = [];
  for (const entry of record.entries) {
    if (entry.delivery.mode === "procedural-recipe") {
      const definition = entry.delivery.payload.definition as {
        recipeId?: unknown;
        parameters?: Record<string, unknown>;
      };
      if (typeof definition?.recipeId === "string") {
        items.push({
          name: entry.name,
          recipeId: definition.recipeId,
          parameters: definition.parameters,
        });
      }
    } else if (entry.delivery.mode === "builtin-ref") {
      items.push({
        name: entry.name,
        recipeId: entry.delivery.runtimeRef,
        runtimeRef: entry.delivery.runtimeRef,
      });
    }
  }
  return items.length > 0 ? items : null;
}
