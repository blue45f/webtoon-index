import type { DeletedBrushRecord } from "./brush/studio-brush-library";
import type { LayerGroup } from "./studio-layers";
import type { NodeEditHandle } from "./studio-node-edit";
import type { StudioWorkspaceState } from "./studio-workspaces";
import type {
  StudioOptionalAssetPacks,
  StudioSceneTemplatePacks,
  StudioSfxPacks,
} from "./StudioToolBeltContent";

export interface PendingBrushDelete {
  id: string;
  deleted: DeletedBrushRecord;
  expiresAt: number;
}

export interface PendingStudioWorkspaceSync {
  readonly ownerScope: string;
  /** Broadcast metadata only; the state itself is always re-read from SQLite authority. */
  readonly authorityRevision: number;
  readonly sequence: number;
  /**
   * Last owner-verified state known before the first queued external write.
   * Later external events only replace the coalescing token, preserving one stable 3-way base.
   */
  readonly baseState: StudioWorkspaceState;
}

export const EMPTY_LAYER_GROUPS: LayerGroup[] = [];
export const EMPTY_NODE_EDIT_HANDLES: NodeEditHandle[] = [];

export const EMPTY_STUDIO_OPTIONAL_ASSETS: StudioOptionalAssetPacks = {
  bgSceneSections: [],
  bgSceneGenreGroups: [],
  comicVectorStickers: [],
  creatureStickers: [],
  propStickers: [],
  fxOverlays: [],
  emeresSections: [],
  emeresUnderlayOpacity: 0.42,
};

export const EMPTY_STUDIO_SCENE_TEMPLATE_PACKS: StudioSceneTemplatePacks = {
  categories: [],
  templates: [],
};

export const EMPTY_STUDIO_SFX_PACKS: StudioSfxPacks = {
  categories: [],
  presets: [],
};

export const FX_LINE_PRESETS: { id: "focus" | "speed"; label: string }[] = [
  { id: "focus", label: "집중선 생성" },
  { id: "speed", label: "속도선 생성" },
];

export const EMPTY_EFFECT_EMOJIS: string[] = [];
export const EMPTY_FX_LINE_PRESETS: typeof FX_LINE_PRESETS = [];
