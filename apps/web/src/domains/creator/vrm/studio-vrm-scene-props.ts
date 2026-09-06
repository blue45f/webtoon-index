import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export const SCENE_PROPS_VERSION = 1 as const;

export type ScenePropBone = VRMHumanBoneName | "none";

export interface ScenePropAttachmentConfig {
  bone: ScenePropBone;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
}

export interface SerializedSceneProps {
  version: typeof SCENE_PROPS_VERSION;
  active: string[];
  attachments: Record<string, ScenePropAttachmentConfig>;
}

export const DEFAULT_SCENE_PROP_ATTACHMENT: ScenePropAttachmentConfig = {
  bone: "none",
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scale: 1,
};

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SCENE_PROP_BONES = new Set<ScenePropBone>(["none", "head", "chest", "rightHand", "leftHand", "hips"]);

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, next));
}

function parseAttachment(raw: unknown): ScenePropAttachmentConfig {
  const value = raw && typeof raw === "object" ? raw as Partial<Record<keyof ScenePropAttachmentConfig, unknown>> : {};
  const bone = typeof value.bone === "string" && SCENE_PROP_BONES.has(value.bone as ScenePropBone)
    ? value.bone as ScenePropBone
    : "none";
  return {
    bone,
    offsetX: finite(value.offsetX, 0, -3, 3),
    offsetY: finite(value.offsetY, 0, -3, 3),
    offsetZ: finite(value.offsetZ, 0, -3, 3),
    rotX: finite(value.rotX, 0, -180, 180),
    rotY: finite(value.rotY, 0, -180, 180),
    rotZ: finite(value.rotZ, 0, -180, 180),
    scale: finite(value.scale, 1, 0.2, 4),
  };
}

function allowedIdSet(allowedIds?: Iterable<string>): Set<string> | null {
  return allowedIds ? new Set(allowedIds) : null;
}

/**
 * 주변 장면 오브젝트 상태를 안전하게 정규화한다. `allowedIds`를 넘기면 현재 카탈로그에 없는
 * 항목을 제거하며, 없으면 외부 메타데이터를 읽는 공용 계층에서 문법적으로 안전한 id만 유지한다.
 */
export function parseSceneProps(raw: unknown, allowedIds?: Iterable<string>): SerializedSceneProps {
  const empty: SerializedSceneProps = { version: SCENE_PROPS_VERSION, active: [], attachments: {} };
  if (!raw || typeof raw !== "object") return empty;
  const value = raw as { active?: unknown; activeProps?: unknown; attachments?: unknown; propAttachments?: unknown };
  const activeRaw = Array.isArray(value.active) ? value.active : Array.isArray(value.activeProps) ? value.activeProps : [];
  const allowed = allowedIdSet(allowedIds);
  const active: string[] = [];
  for (const candidate of activeRaw) {
    if (typeof candidate !== "string" || !SAFE_ID.test(candidate) || (allowed && !allowed.has(candidate))) continue;
    if (!active.includes(candidate)) active.push(candidate);
    if (active.length >= 100) break;
  }

  const attachmentsRaw = value.attachments && typeof value.attachments === "object"
    ? value.attachments as Record<string, unknown>
    : value.propAttachments && typeof value.propAttachments === "object"
      ? value.propAttachments as Record<string, unknown>
      : {};
  const attachments: Record<string, ScenePropAttachmentConfig> = {};
  active.forEach((id) => {
    if (attachmentsRaw[id] != null) attachments[id] = parseAttachment(attachmentsRaw[id]);
  });
  return { version: SCENE_PROPS_VERSION, active, attachments };
}

export function serializeSceneProps(
  active: readonly string[],
  attachments: Record<string, ScenePropAttachmentConfig>
): SerializedSceneProps | undefined {
  if (active.length === 0) return undefined;
  return parseSceneProps({ version: SCENE_PROPS_VERSION, active, attachments });
}
