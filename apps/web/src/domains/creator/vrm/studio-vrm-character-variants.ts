/**
 * Character variant presets (CHR-017): named hair/body/accent recipes applied on top of an
 * Avatar Forge state without destroying the user's face parameters or colors they set.
 * Application is deterministic: same state + same variant id → identical serialized result.
 */

import {
  sanitizeAvatarForgeState,
  type AvatarForgeFaceAccent,
  type AvatarForgeFaceAccentId,
  type AvatarForgeBangStyle,
  type AvatarForgeBodyPresetId,
  type AvatarForgeHairStyle,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";

export const STUDIO_VRM_CHARACTER_VARIANT_REVISION = 1 as const;

export interface StudioVrmCharacterVariantHairOverride {
  readonly style?: AvatarForgeHairStyle;
  readonly bangStyle?: AvatarForgeBangStyle;
  readonly baseColor?: string;
  readonly tipColor?: string;
  readonly volume?: number;
  readonly length?: number;
  readonly strandWidth?: number;
  readonly fringe?: number;
  readonly curl?: number;
  readonly wave?: number;
  readonly ahoge?: number;
  readonly tailHeight?: number;
  readonly shine?: number;
}

export interface StudioVrmCharacterVariantAccentToggle {
  readonly id: AvatarForgeFaceAccentId;
  readonly enabled?: boolean;
  readonly color?: string;
  readonly intensity?: number;
}

export interface StudioVrmCharacterVariant {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly emoji: string;
  readonly tags: readonly string[];
  readonly bodyPresetId?: AvatarForgeBodyPresetId;
  readonly hair: StudioVrmCharacterVariantHairOverride;
  readonly accents?: readonly StudioVrmCharacterVariantAccentToggle[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

function validHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function clampUnit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function resolveAccents(
  current: readonly AvatarForgeFaceAccent[] | undefined,
  toggles: readonly StudioVrmCharacterVariantAccentToggle[] | undefined,
): readonly AvatarForgeFaceAccent[] | undefined {
  if (!toggles || toggles.length === 0) return current;
  const merged = new Map<AvatarForgeFaceAccentId, AvatarForgeFaceAccent>();
  for (const accent of current ?? []) merged.set(accent.id, { ...accent });
  for (const toggle of toggles) {
    const existing = merged.get(toggle.id);
    merged.set(toggle.id, {
      id: toggle.id,
      enabled: typeof toggle.enabled === "boolean" ? toggle.enabled : existing?.enabled ?? true,
      color: validHexColor(toggle.color) ? toggle.color : existing?.color ?? "#f43f5e",
      intensity: clampUnit(toggle.intensity, existing?.intensity ?? 0.6),
    });
  }
  return [...merged.values()].toSorted((left, right) => left.id < right.id ? -1 : 1);
}

export function sanitizeStudioVrmCharacterVariant(
  raw: unknown,
): StudioVrmCharacterVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id.length === 0 || source.id.length > 64) {
    return null;
  }
  if (typeof source.label !== "string" || typeof source.description !== "string") return null;
  if (!Array.isArray(source.tags)) return null;
  const hairSource = (source.hair ?? {}) as Record<string, unknown>;
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    emoji: typeof source.emoji === "string" ? source.emoji : "✨",
    tags: source.tags.filter((tag): tag is string => typeof tag === "string"),
    ...(source.bodyPresetId !== undefined
      ? { bodyPresetId: source.bodyPresetId as AvatarForgeBodyPresetId }
      : {}),
    hair: {
      ...(hairSource.style !== undefined ? { style: hairSource.style as AvatarForgeHairStyle } : {}),
      ...(hairSource.bangStyle !== undefined
        ? { bangStyle: hairSource.bangStyle as AvatarForgeBangStyle }
        : {}),
      ...(validHexColor(hairSource.baseColor) ? { baseColor: hairSource.baseColor } : {}),
      ...(validHexColor(hairSource.tipColor) ? { tipColor: hairSource.tipColor } : {}),
      ...(hairSource.volume !== undefined ? { volume: Number(hairSource.volume) } : {}),
      ...(hairSource.length !== undefined ? { length: Number(hairSource.length) } : {}),
      ...(hairSource.strandWidth !== undefined
        ? { strandWidth: Number(hairSource.strandWidth) }
        : {}),
      ...(hairSource.fringe !== undefined ? { fringe: Number(hairSource.fringe) } : {}),
      ...(hairSource.curl !== undefined ? { curl: Number(hairSource.curl) } : {}),
      ...(hairSource.wave !== undefined ? { wave: Number(hairSource.wave) } : {}),
      ...(hairSource.ahoge !== undefined ? { ahoge: Number(hairSource.ahoge) } : {}),
      ...(hairSource.tailHeight !== undefined
        ? { tailHeight: Number(hairSource.tailHeight) }
        : {}),
      ...(hairSource.shine !== undefined ? { shine: Number(hairSource.shine) } : {}),
    },
    ...(Array.isArray(source.accents)
      ? {
          accents: source.accents.filter((entry): entry is StudioVrmCharacterVariantAccentToggle =>
            Boolean(entry) && typeof entry === "object"
            && typeof (entry as Record<string, unknown>).id === "string"),
        }
      : {}),
  };
}

/** Curated archetype variants; order is UI display order and part of the product contract. */
export const STUDIO_VRM_CHARACTER_VARIANTS: readonly StudioVrmCharacterVariant[] =
  Object.freeze([
    {
      id: "sunny-short",
      label: "쾌활한 숏컷",
      description: "밝은 갈색 숏컷에 짧은 앞머리. 활기찬 일상 소재에 어울립니다.",
      emoji: "☀️",
      tags: ["일상", "밝음", "숏컷"],
      bodyPresetId: "balanced",
      hair: {
        style: "short",
        bangStyle: "full",
        baseColor: "#8a5a33",
        tipColor: "#b07b46",
        volume: 0.45,
        length: 0.25,
        fringe: 0.55,
        curl: 0.1,
      },
    },
    {
      id: "hime-elegant",
      label: "우아한 히메컷",
      description: "곱게 늘어진 흑발 히메컷. 비장·판타지 여주인공 스타일.",
      emoji: "👑",
      tags: ["판타지", "우아", "흑발"],
      bodyPresetId: "long-line",
      hair: {
        style: "hime",
        bangStyle: "blunt",
        baseColor: "#17121c",
        tipColor: "#2c2136",
        volume: 0.5,
        length: 0.9,
        fringe: 0.4,
        shine: 0.7,
      },
    },
    {
      id: "sporty-ponytail",
      label: "운동장 포니테일",
      description: "높이 묶은 포니테일과 상큼한 블론드. 체육·학교 컷에 최적.",
      emoji: "🏐",
      tags: ["학교", "스포츠", "블론드"],
      bodyPresetId: "hero",
      hair: {
        style: "ponytail",
        bangStyle: "side-swept",
        baseColor: "#d8a94e",
        tipColor: "#efd28a",
        volume: 0.4,
        length: 0.65,
        tailHeight: 0.85,
        ahoge: 0.3,
      },
      accents: [{ id: "blush", enabled: true, color: "#fb7185", intensity: 0.35 }],
    },
    {
      id: "bookish-twin-braid",
      label: "차분한 트윈브레이드",
      description: "양갈래 땋은 머리와 안경빨 분위기의 차분한 톤.",
      emoji: "📚",
      tags: ["학교", "차분", "브레이드"],
      bodyPresetId: "compact",
      hair: {
        style: "twin-braid",
        bangStyle: "split",
        baseColor: "#4a3a52",
        tipColor: "#6b5675",
        volume: 0.35,
        length: 0.7,
        tailHeight: 0.45,
      },
      accents: [{ id: "freckles", enabled: true, color: "#c98a5e", intensity: 0.3 }],
    },
    {
      id: "idol-twintail",
      label: "아이돌 트윈테일",
      description: "파스텔 핑크 트윈테일에 볼터치 포인트. 무대 컷용 화려한 조합.",
      emoji: "🎀",
      tags: ["아이돌", "파스텔", "화려"],
      bodyPresetId: "soft",
      hair: {
        style: "twintail",
        bangStyle: "curtain",
        baseColor: "#f2a7c3",
        tipColor: "#ffd9e8",
        volume: 0.65,
        length: 0.8,
        wave: 0.45,
        tailHeight: 0.75,
        shine: 0.85,
      },
      accents: [
        { id: "blush", enabled: true, color: "#fb7185", intensity: 0.55 },
        { id: "beauty-mark", enabled: false },
      ],
    },
    {
      id: "street-wolf",
      label: "스트리트 울프컷",
      description: "무게감 있는 울프컷과 애쉬 톤. 도시·액션 장르에 잘 어울립니다.",
      emoji: "🌆",
      tags: ["도시", "액션", "애쉬"],
      bodyPresetId: "hero",
      hair: {
        style: "wolf",
        bangStyle: "full",
        baseColor: "#5b6068",
        tipColor: "#8b9099",
        volume: 0.7,
        length: 0.5,
        fringe: 0.65,
      },
      accents: [{ id: "beauty-mark", enabled: true, color: "#2d2226", intensity: 0.5 }],
    },
    {
      id: "gentle-bun",
      label: "단정한 올림머리",
      description: "깔끔하게 틀어 올린 번 헤어. 성숙한 직장인·교사 캐릭터용.",
      emoji: "🧷",
      tags: ["성숙", "단정", "업스타일"],
      bodyPresetId: "long-line",
      hair: {
        style: "bun",
        bangStyle: "side-swept",
        baseColor: "#31261f",
        tipColor: "#4c3b30",
        volume: 0.4,
        length: 0.3,
        tailHeight: 0.6,
      },
    },
    {
      id: "airy-wavy",
      label: "몽글 몽글 웨이브",
      description: "부드러운 웨이브가 흐르는 미디엄 헤어. 힐링·로맨스 물 결합.",
      emoji: "🌊",
      tags: ["로맨스", "힐링", "웨이브"],
      bodyPresetId: "soft",
      hair: {
        style: "wavy",
        bangStyle: "full",
        baseColor: "#6e4f3a",
        tipColor: "#a37b58",
        volume: 0.55,
        length: 0.6,
        wave: 0.6,
        curl: 0.35,
      },
    },
  ]);

export type StudioVrmCharacterVariantSummary = Readonly<{
  id: string;
  label: string;
  description: string;
  emoji: string;
  tags: readonly string[];
}>;

export function listStudioVrmCharacterVariantSummaries():
  readonly StudioVrmCharacterVariantSummary[] {
  return STUDIO_VRM_CHARACTER_VARIANTS.map((variant) => ({
    id: variant.id,
    label: variant.label,
    description: variant.description,
    emoji: variant.emoji,
    tags: variant.tags,
  }));
}

/**
 * Applies a named variant on top of the current forge state.
 * Face geometry (head width/height/depth etc.) and non-overridden hair values are preserved.
 * Unknown ids sanitize-and-return so stale persisted variants can never corrupt a document.
 */
export function applyStudioVrmCharacterVariant(
  state: AvatarForgeState,
  variantId: string,
): AvatarForgeState {
  const current = sanitizeAvatarForgeState(state);
  const selected = STUDIO_VRM_CHARACTER_VARIANTS.find((variant) => variant.id === variantId);
  if (!selected) return current;
  return sanitizeAvatarForgeState({
    ...current,
    presetId: undefined,
    ...(selected.bodyPresetId ? { bodyPresetId: selected.bodyPresetId } : {}),
    hair: {
      ...current.hair,
      ...selected.hair,
    },
    ...(resolveAccents(current.faceAccents, selected.accents)
      ? { faceAccents: resolveAccents(current.faceAccents, selected.accents) }
      : {}),
  });
}
