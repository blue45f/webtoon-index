import { projectStudioAiProvenanceForPublish } from "../../../web/src/domains/creator/ai/studio-ai-provenance";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PRIVATE_PUBLIC_FIELD = /^(?:api[-_]?key|authorization|secret|private[-_]?notes?|provider[-_]?request[-_]?id|request[-_]?id|seed|raw[-_]?prompt|prompt(?:[-_]?(?:text|hash|sha256))?|reference(?:s|[-_]?assets?)?)$/iu;

/**
 * Creator documents are client-authored JSON and can contain provider-specific fields added by a
 * newer editor. Public projection therefore removes credential, private-note, raw-prompt,
 * request-correlation, seed, and reference-hash shaped fields recursively instead of relying on
 * today's exact element type. Known public fields such as promptVersion and referenceCount
 * intentionally do not match.
 */
function redactPrivateAiFields(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (depth > 64) return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const result = value
      .map((item) => redactPrivateAiFields(item, depth + 1, seen))
      .filter((item) => item !== undefined);
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_PUBLIC_FIELD.test(key)) continue;
    const redacted = redactPrivateAiFields(nested, depth + 1, seen);
    if (redacted !== undefined) result[key] = redacted;
  }
  seen.delete(value);
  return result;
}

function publicPage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { review: _review, ...page } = value;
  return redactPrivateAiFields(page);
}

function publicPublishPack(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  if (value.profile === "generic" || value.profile === "webtoon" || value.profile === "tapas") {
    result.profile = value.profile;
  }
  if (value.aiUsage === "none" || value.aiUsage === "assisted" || value.aiUsage === "generated") {
    result.aiUsage = value.aiUsage;
  }
  if (typeof value.disclosure === "string") result.disclosure = value.disclosure.slice(0, 1_000);
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Projects an owner-editable Studio document into the subset safe to return with a public work.
 * Render/layout data and explicit AI disclosure remain available; private editorial discussion,
 * character-planning notes, rights self-check answers, and page review assignments are removed.
 */
export function toPublicCreatorDoc(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const {
    comments: _comments,
    characterBible: _characterBible,
    writerRoom: _writerRoom,
    releaseSchedule: _releaseSchedule,
    publicationAnalytics: _publicationAnalytics,
    aiProvenance,
    publishPack,
    pagesList,
    ...rest
  } = value;
  const result: Record<string, unknown> = { ...rest };
  if (Array.isArray(pagesList)) result.pagesList = pagesList.map(publicPage);
  if (aiProvenance !== undefined) {
    result.aiProvenance = projectStudioAiProvenanceForPublish(aiProvenance);
  }
  const safePublishPack = publicPublishPack(publishPack);
  if (safePublishPack) result.publishPack = safePublishPack;
  const redacted = redactPrivateAiFields(result);
  return isRecord(redacted) ? redacted : {};
}
