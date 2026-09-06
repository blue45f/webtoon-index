import { useMemo, useState, type ReactElement } from "react";

import {
  createCreatorMarketplaceAuthoringDraft,
  createCreatorMarketplaceDraftFromBrushStudio,
  normalizeCreatorMarketplaceAuthoringDraft,
  stageCreatorMarketplaceAuthoringHandoff,
  type CreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringKind,
} from "@/shared/lib/creator-marketplace-authoring-workshop";

const MAX_REMOTE_MANIFEST_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeKind(value: unknown): CreatorMarketplaceAuthoringKind {
  const source = text(value).toLowerCase();
  if (source === "brush") return "brush";
  if (source === "tone" || source === "pattern") return "tone";
  if (source === "palette" || source === "color-set") return "palette";
  if (source === "pose") return "pose";
  if (source === "3d" || source === "model" || source === "vrm") return "3d";
  if (source === "background") return "background";
  if (source === "bubble" || source === "speech-bubble") return "bubble";
  if (source === "template") return "template";
  return "material";
}

function findAuthoringEnvelope(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!isRecord(value) || depth > 6) return null;
  if (
    value.format === "toonspectrum.creator-marketplace-authoring"
    || (isRecord(value.brush) && (
      Array.isArray(value.brush.enginePrograms)
      || Array.isArray(value.brush.engineNodes)
      || value.brush.studioSnapshot !== undefined
    ))
    || (value.schemaVersion === 2 && value.resumeToken !== undefined && value.source !== undefined)
  ) return value;
  for (const key of [
    "authoring", "authoringManifest", "packageManifest", "manifest", "metadata",
    "payload", "package", "resource", "data", "extensions", "attributes",
  ]) {
    const nested = value[key];
    const found = findAuthoringEnvelope(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function draftFromEnvelope(
  envelope: Record<string, unknown>,
  fallbackRecord: Record<string, unknown>,
): CreatorMarketplaceAuthoringDraft {
  if (envelope.schemaVersion === 2 && envelope.resumeToken !== undefined) {
    return normalizeCreatorMarketplaceAuthoringDraft(envelope);
  }
  const resource = isRecord(envelope.resource) ? envelope.resource : {};
  const brush = isRecord(envelope.brush) ? envelope.brush : null;
  const kind = normalizeKind(resource.kind ?? fallbackRecord.kind ?? fallbackRecord.type);
  const base = kind === "brush"
    ? createCreatorMarketplaceDraftFromBrushStudio(
        brush?.studioSnapshot
        ?? brush?.originalSnapshot
        ?? brush
        ?? envelope,
      )
    : createCreatorMarketplaceAuthoringDraft(kind);
  const release = isRecord(envelope.release) ? envelope.release : {};
  const compatibility = isRecord(envelope.compatibility) ? envelope.compatibility : {};
  const rights = isRecord(envelope.rights) ? envelope.rights : {};
  return normalizeCreatorMarketplaceAuthoringDraft({
    ...base,
    kind,
    title: text(resource.title) || text(fallbackRecord.title) || text(fallbackRecord.name),
    summary: text(resource.summary) || text(fallbackRecord.summary),
    description: text(resource.description) || text(fallbackRecord.description),
    tags: stringArray(resource.tags).length > 0
      ? stringArray(resource.tags)
      : stringArray(fallbackRecord.tags),
    source: {
      ...base.source,
      mode: "marketplace-update",
      name: text(resource.title) || text(fallbackRecord.title) || "Marketplace asset",
      sourceResourceId: text(fallbackRecord.id) || text(fallbackRecord.resourceId) || undefined,
      studioSnapshot: brush?.studioSnapshot ?? base.source.studioSnapshot,
    },
    brush: kind === "brush" ? {
      ...base.brush,
      engineNodes: Array.isArray(brush?.engineNodes) ? brush.engineNodes : base.brush.engineNodes,
      originalEnginePrograms: Array.isArray(brush?.enginePrograms)
        ? brush.enginePrograms
        : base.brush.originalEnginePrograms,
      originalSnapshot: brush?.studioSnapshot ?? base.brush.originalSnapshot,
      deterministicSeed: brush?.deterministicSeed ?? base.brush.deterministicSeed,
      presetFamily: brush?.presetFamily ?? base.brush.presetFamily,
      intendedUse: brush?.intendedUse ?? base.brush.intendedUse,
    } : base.brush,
    technical: isRecord(envelope.technical) ? envelope.technical : base.technical,
    compatibility: { ...base.compatibility, ...compatibility },
    media: Array.isArray(envelope.media) ? envelope.media : base.media,
    bundle: Array.isArray(envelope.bundle) ? envelope.bundle : base.bundle,
    release: {
      ...base.release,
      ...release,
      mode: "update",
      previousResourceId: text(fallbackRecord.id)
        || text(fallbackRecord.resourceId)
        || text(release.previousResourceId)
        || undefined,
    },
    rights: { ...base.rights, ...rights },
  });
}

function draftFromLegacyRecord(record: Record<string, unknown>): CreatorMarketplaceAuthoringDraft {
  const kind = normalizeKind(record.kind ?? record.type ?? record.category);
  const base = kind === "brush"
    ? createCreatorMarketplaceDraftFromBrushStudio(record)
    : createCreatorMarketplaceAuthoringDraft(kind);
  return normalizeCreatorMarketplaceAuthoringDraft({
    ...base,
    title: text(record.title) || text(record.name),
    summary: text(record.summary) || text(record.subtitle),
    description: text(record.description),
    tags: stringArray(record.tags),
    source: {
      ...base.source,
      mode: "marketplace-update",
      name: text(record.title) || text(record.name) || "Marketplace asset",
      sourceResourceId: text(record.id) || text(record.resourceId) || undefined,
    },
    release: {
      ...base.release,
      mode: "update",
      version: text(record.version) || base.release.version,
      previousResourceId: text(record.id) || text(record.resourceId) || undefined,
      changelog: "마켓 에셋을 Studio에서 수정한 업데이트",
    },
  });
}

function findManifestUrl(record: Record<string, unknown>): string | null {
  for (const key of [
    "authoringManifestUrl", "manifestUrl", "packageUrl", "downloadUrl", "assetUrl", "fileUrl",
  ]) {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) continue;
    try {
      const url = new URL(value, window.location.origin);
      if (url.protocol === "https:" || url.origin === window.location.origin) return url.href;
    } catch {
      // Ignore malformed legacy URLs.
    }
  }
  return null;
}

async function loadRemoteEnvelope(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`제작 manifest를 불러오지 못했습니다 (${response.status}).`);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_REMOTE_MANIFEST_BYTES) throw new Error("제작 manifest가 허용 크기를 초과했습니다.");
  const contentType = response.headers.get("content-type") ?? "";
  if (!/(json|text)/iu.test(contentType) && !/\.json(?:$|\?)/iu.test(url)) return null;
  const body = await response.text();
  if (body.length > MAX_REMOTE_MANIFEST_BYTES) throw new Error("제작 manifest가 허용 크기를 초과했습니다.");
  const parsed: unknown = JSON.parse(body);
  return findAuthoringEnvelope(parsed);
}

export function MarketplaceAuthoringInstallAction({
  record: recordInput,
  className = "",
}: {
  record: unknown;
  className?: string;
}): ReactElement | null {
  const record = useMemo(
    () => isRecord(recordInput) ? recordInput : null,
    [recordInput],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!record) return null;

  const kind = normalizeKind(record.kind ?? record.type ?? record.category);
  const envelope = findAuthoringEnvelope(record);
  const targetLabel = kind === "brush"
    ? envelope ? "Brush Studio에서 원본 편집" : "Brush Studio에서 업데이트"
    : "Studio에서 업데이트";

  const open = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let resolved = envelope;
      const url = findManifestUrl(record);
      if (!resolved && url) resolved = await loadRemoteEnvelope(url);
      const draft = resolved
        ? draftFromEnvelope(resolved, record)
        : draftFromLegacyRecord(record);
      stageCreatorMarketplaceAuthoringHandoff(draft);
      const target = new URL("/studio", window.location.origin);
      target.searchParams.set(
        "workspace",
        draft.kind === "brush" ? "brush-studio" : "asset-authoring",
      );
      target.searchParams.set("assetKind", draft.kind);
      target.searchParams.set("marketResource", draft.source.sourceResourceId ?? "");
      target.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}`);
      window.location.assign(`${target.pathname}${target.search}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Studio 업데이트 초안을 만들지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="marketplace-authoring-install-action"
      className={`rounded-xl border border-accent/30 bg-accent/5 p-3 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong className="text-sm text-fg">제작 원본과 연결</strong>
          <p className="mt-1 text-xs leading-5 text-fg-2">
            {envelope
              ? "등록 당시 엔진·구성·호환성 manifest를 복구해 새 버전을 만듭니다."
              : "구형 에셋 메타데이터로 업데이트 초안을 만들고 원본을 다시 연결합니다."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void open()}
          className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-xs font-bold text-accent-fg disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "준비 중" : targetLabel}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
