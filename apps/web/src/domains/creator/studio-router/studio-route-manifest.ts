import { STUDIO_LIFT3D_SUBJECTS } from "../lift3d/studio-lift3d-contract";
import {
  resolveStudioProductionScope,
  studioProductionLifecycleKey,
} from "../studio-production/studio-production-scope";
import {
  parseStudioWorkspaceRoute,
  studioWorkspaceCanonicalHref,
  studioWorkspaceDocumentIdentity,
  type InvalidStudioWorkspaceRoute,
  type StudioWorkspaceLocationInput,
  type StudioWorkspaceRoute,
  type StudioWorkspaceRouteErrorCode,
} from "../studio-workspace-route";

export const STUDIO_COMPANION_SURFACES = [
  "workspace",
  "navigator",
  "review",
  "reference",
] as const;

export type StudioCompanionRouteSurface =
  (typeof STUDIO_COMPANION_SURFACES)[number];

export type StudioRouteKind =
  | "companion"
  | "editor"
  | "invalid"
  | "lift3d"
  | "placeholder"
  | "production"
  | "publish"
  | "storyworld";

export interface StudioRouteManifestEntry {
  readonly id: string;
  readonly kind: Exclude<StudioRouteKind, "invalid">;
  readonly ownsDocumentTitle: boolean;
  readonly pattern: string;
}

/**
 * The single source of route ownership for the Studio shell. Patterns are descriptive; the pure
 * resolver below owns alias validation and canonicalization so React component lifetime is not
 * coupled to a second, competing route table.
 */
export const STUDIO_ROUTE_MANIFEST = Object.freeze([
  {
    id: "studio-editor",
    kind: "editor",
    ownsDocumentTitle: true,
    pattern: "/studio/(work/:workId|remix/:sourceWorkId)?/:surface(canvas|comic|animation|brushes|bg3d|poser|character)?",
  },
  {
    id: "studio-publish",
    kind: "publish",
    ownsDocumentTitle: true,
    pattern: "/studio/(work/:workId/)?publish",
  },
  {
    id: "studio-lift3d",
    kind: "lift3d",
    ownsDocumentTitle: true,
    pattern: "/studio/lift3d",
  },
  {
    id: "studio-storyworld",
    kind: "storyworld",
    ownsDocumentTitle: true,
    pattern: "/studio/(work/:workId|remix/:sourceWorkId)?/storyworld",
  },
  {
    id: "studio-companion",
    kind: "companion",
    ownsDocumentTitle: true,
    pattern: "/studio/companion/:surface",
  },
  {
    id: "studio-production",
    kind: "production",
    ownsDocumentTitle: true,
    pattern: "/studio/(join|present|projects|review|share|versions)",
  },
  {
    id: "studio-work-production",
    kind: "production",
    ownsDocumentTitle: true,
    pattern: "/studio/work/:workId/:surface(present|review|versions)",
  },
  {
    id: "studio-remix-production",
    kind: "production",
    ownsDocumentTitle: true,
    pattern: "/studio/remix/:sourceWorkId/:surface(present|review|versions)",
  },
  {
    id: "studio-placeholder",
    kind: "placeholder",
    ownsDocumentTitle: false,
    pattern: "/studio/assets",
  },
  {
    id: "studio-work-placeholder",
    kind: "placeholder",
    ownsDocumentTitle: false,
    pattern: "/studio/work/:workId/assets",
  },
  {
    id: "studio-remix-placeholder",
    kind: "placeholder",
    ownsDocumentTitle: false,
    pattern: "/studio/remix/:sourceWorkId/assets",
  },
] as const satisfies readonly StudioRouteManifestEntry[]);

export interface StudioRouteLocationInput extends StudioWorkspaceLocationInput {
  readonly hash?: string;
}

interface StudioResolvedRouteBase {
  readonly canonicalHref: string;
  readonly canonicalPathname: string;
  readonly kind: StudioRouteKind;
  readonly lifecycleKey: string;
  readonly ownsDocumentTitle: boolean;
}

export interface StudioEditorRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "editor";
  readonly workspaceRoute: StudioWorkspaceRoute;
}

export interface StudioPublishRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "publish";
  readonly workId: string | null;
}

export interface StudioCompanionRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "companion";
  readonly surface: StudioCompanionRouteSurface;
}

export interface StudioLift3dRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "lift3d";
  /** 주소에 실린 피사체 프리셋. 알 수 없는 값은 정규화 단계에서 떨어진다. */
  readonly subject: string | null;
}

export interface StudioStoryworldRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "storyworld";
  readonly remixSourceWorkId: string | null;
  readonly workId: string | null;
}

export const STUDIO_PRODUCTION_ROUTE_IDS = [
  "join",
  "present",
  "projects",
  "review",
  "share",
  "versions",
] as const;

export type StudioProductionRouteId =
  (typeof STUDIO_PRODUCTION_ROUTE_IDS)[number];

export type StudioPlaceholderRouteId = "assets";

export interface StudioProductionRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "production";
  readonly surface: StudioProductionRouteId;
  readonly editorHref: string;
}

export interface StudioPlaceholderRouteResolution extends StudioResolvedRouteBase {
  readonly kind: "placeholder";
  readonly placeholderId: StudioPlaceholderRouteId;
}

export interface StudioInvalidRouteResolution
  extends Omit<StudioResolvedRouteBase, "canonicalHref" | "canonicalPathname"> {
  readonly errorCode: StudioWorkspaceRouteErrorCode;
  readonly kind: "invalid";
  readonly ownsDocumentTitle: false;
}

export type StudioRouteResolution =
  | StudioCompanionRouteResolution
  | StudioEditorRouteResolution
  | StudioInvalidRouteResolution
  | StudioLift3dRouteResolution
  | StudioPlaceholderRouteResolution
  | StudioProductionRouteResolution
  | StudioPublishRouteResolution
  | StudioStoryworldRouteResolution;

const PRODUCTION_ROUTE_IDS = new Set<StudioProductionRouteId>(
  STUDIO_PRODUCTION_ROUTE_IDS,
);
const WORK_SCOPE_PRODUCTION_SURFACES = new Set<StudioProductionRouteId>([
  "present",
  "review",
  "versions",
]);

function queryParams(search: string | URLSearchParams | undefined): URLSearchParams {
  return search instanceof URLSearchParams
    ? new URLSearchParams(search)
    : new URLSearchParams(search ?? "");
}

function href(pathname: string, params: URLSearchParams): string {
  const search = params.toString();
  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

function invalidResolution(
  pathname: string,
  search: string | URLSearchParams | undefined,
  error: InvalidStudioWorkspaceRoute | StudioWorkspaceRouteErrorCode,
): StudioInvalidRouteResolution {
  const params = queryParams(search);
  const errorCode = typeof error === "string" ? error : error.errorCode;
  return Object.freeze({
    errorCode,
    kind: "invalid",
    lifecycleKey: href(pathname, params),
    ownsDocumentTitle: false,
  });
}

function normalizedSegments(pathname: string): readonly string[] | null {
  if (pathname !== "/studio" && !pathname.startsWith("/studio/")) return null;
  const segments = pathname.split("/").slice(1);
  if (segments.at(-1) === "") segments.pop();
  if (segments.some((segment) => segment.length === 0)) return null;
  return segments;
}

function publishPathname(workId: string | null): string {
  return workId === null
    ? "/studio/publish"
    : `/studio/work/${encodeURIComponent(workId)}/publish`;
}

function cleanIdentityQuery(
  search: string | URLSearchParams | undefined,
): URLSearchParams {
  const params = queryParams(search);
  params.delete("id");
  params.delete("mode");
  params.delete("remix");
  return params;
}

function resolveCanonicalPublish(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioPublishRouteResolution | StudioInvalidRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (segments === null) return invalidResolution(pathname, search, "invalid-path");
  const isDraftPublish = segments.length === 2
    && (segments[1] === "publish" || segments[1] === "upload");
  if (isDraftPublish) {
    const params = queryParams(search);
    if (params.has("remix")) {
      return invalidResolution(pathname, search, "identity-conflict");
    }
    const legacyIdentity = parseStudioWorkspaceRoute({ pathname: "/studio", search });
    if (!legacyIdentity.valid) {
      return invalidResolution(pathname, search, legacyIdentity);
    }
    const canonicalPathname = publishPathname(legacyIdentity.workId);
    const lifecycleIdentity = legacyIdentity.workId === null
      ? "draft"
      : `work:${encodeURIComponent(legacyIdentity.workId)}`;
    return Object.freeze({
      canonicalHref: href(canonicalPathname, cleanIdentityQuery(search)),
      canonicalPathname,
      kind: "publish",
      lifecycleKey: `/studio/${lifecycleIdentity}/publish`,
      ownsDocumentTitle: true,
      workId: legacyIdentity.workId,
    });
  }
  if (
    segments.length !== 4
    || segments[1] !== "work"
    || (segments[3] !== "publish" && segments[3] !== "upload")
  ) {
    return null;
  }
  const workspace = parseStudioWorkspaceRoute({
    pathname: `/studio/work/${segments[2]}/canvas`,
    search,
  });
  if (!workspace.valid) {
    return invalidResolution(pathname, search, workspace);
  }
  if (workspace.workId === null) {
    return invalidResolution(pathname, search, "invalid-work-id");
  }
  const canonicalPathname = publishPathname(workspace.workId);
  return Object.freeze({
    canonicalHref: href(canonicalPathname, cleanIdentityQuery(search)),
    canonicalPathname,
    kind: "publish",
    lifecycleKey: `/studio/work:${encodeURIComponent(workspace.workId)}/publish`,
    ownsDocumentTitle: true,
    workId: workspace.workId,
  });
}

function isCompanionSurface(value: string): value is StudioCompanionRouteSurface {
  return (STUDIO_COMPANION_SURFACES as readonly string[]).includes(value);
}

function resolveCompanion(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioCompanionRouteResolution | StudioInvalidRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (segments === null) return invalidResolution(pathname, search, "invalid-path");
  const params = queryParams(search);
  let surface: StudioCompanionRouteSurface;
  if (segments.length === 2 && segments[1] === "tools-companion") {
    const views = params.getAll("view");
    if (views.length > 1 || (views.length === 1 && !isCompanionSurface(views[0]))) {
      return invalidResolution(pathname, search, "invalid-path");
    }
    surface = views.length === 1 ? views[0] as StudioCompanionRouteSurface : "workspace";
  } else if (
    segments.length === 3
    && segments[1] === "companion"
    && isCompanionSurface(segments[2])
  ) {
    surface = segments[2];
    const views = params.getAll("view");
    if (views.length > 1 || (views.length === 1 && views[0] !== surface)) {
      return invalidResolution(pathname, search, "invalid-path");
    }
  } else {
    return null;
  }
  const canonicalPathname = `/studio/companion/${surface}`;
  // The detached page still consumes `view`; the identity nevertheless lives in the path. Keeping
  // this redundant compatibility value lets old and new companion builds interoperate safely.
  params.set("view", surface);
  return Object.freeze({
    canonicalHref: href(canonicalPathname, params),
    canonicalPathname,
    kind: "companion",
    lifecycleKey: `${canonicalPathname}`,
    ownsDocumentTitle: true,
    surface,
  });
}

/**
 * 2D → 3D 리프트 작업대. 편집 문서와 독립된 도구 화면이라 문서 런타임을 열지 않는다.
 * 알 수 없는 `subject` 값은 정규화하면서 떨어뜨려, 주소로 프리셋을 밀어 넣지 못하게 한다.
 */
function resolveLift3d(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioLift3dRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (segments === null || segments.length !== 2 || segments[1] !== "lift3d") return null;
  const params = queryParams(search);
  const requested = params.getAll("subject");
  const subject = requested.length === 1
    && (STUDIO_LIFT3D_SUBJECTS as readonly string[]).includes(requested[0]!)
    ? requested[0]!
    : null;
  params.delete("subject");
  if (subject !== null) params.set("subject", subject);
  const canonicalPathname = "/studio/lift3d";
  return Object.freeze({
    canonicalHref: href(canonicalPathname, params),
    canonicalPathname,
    kind: "lift3d",
    lifecycleKey: canonicalPathname,
    ownsDocumentTitle: true,
    subject,
  });
}

function resolveProduction(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioProductionRouteResolution | StudioInvalidRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (
    segments === null
    || segments.length !== 2
    || !PRODUCTION_ROUTE_IDS.has(segments[1] as StudioProductionRouteId)
  ) {
    return null;
  }
  const resolvedScope = resolveStudioProductionScope({ pathname, search });
  if (!resolvedScope.valid) return invalidResolution(pathname, search, resolvedScope.errorCode);
  const surface = segments[1] as StudioProductionRouteId;
  const canonicalPathname = `/studio/${surface}`;
  return Object.freeze({
    canonicalHref: href(canonicalPathname, queryParams(search)),
    canonicalPathname,
    kind: "production",
    lifecycleKey: studioProductionLifecycleKey(surface, resolvedScope.scope),
    editorHref: resolvedScope.scope.editorHref,
    ownsDocumentTitle: true,
    surface,
  });
}

function storyworldPathname(workId: string | null, remixSourceWorkId: string | null): string {
  if (workId !== null) return `/studio/work/${encodeURIComponent(workId)}/storyworld`;
  if (remixSourceWorkId !== null) return `/studio/remix/${encodeURIComponent(remixSourceWorkId)}/storyworld`;
  return "/studio/storyworld";
}

function resolveStoryworld(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioStoryworldRouteResolution | StudioInvalidRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (segments === null) return invalidResolution(pathname, search, "invalid-path");
  let probePathname: string;
  if (segments.length === 2 && segments[1] === "storyworld") {
    probePathname = "/studio";
  } else if (
    segments.length === 4
    && (segments[1] === "work" || segments[1] === "remix")
    && segments[3] === "storyworld"
  ) {
    probePathname = `/studio/${segments[1]}/${segments[2]}/canvas`;
  } else {
    return null;
  }
  const workspace = parseStudioWorkspaceRoute({ pathname: probePathname, search });
  if (!workspace.valid) return invalidResolution(pathname, search, workspace);
  if (workspace.presentation !== "editor") return invalidResolution(pathname, search, "invalid-mode");
  const canonicalPathname = storyworldPathname(workspace.workId, workspace.remixSourceWorkId);
  return Object.freeze({
    canonicalHref: href(canonicalPathname, cleanIdentityQuery(search)),
    canonicalPathname,
    kind: "storyworld",
    lifecycleKey: `/studio/${studioWorkspaceDocumentIdentity(workspace)}/storyworld`,
    ownsDocumentTitle: true,
    remixSourceWorkId: workspace.remixSourceWorkId,
    workId: workspace.workId,
  });
}

function resolvePlaceholder(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioPlaceholderRouteResolution | null {
  const segments = normalizedSegments(pathname);
  if (segments === null || segments.length !== 2 || segments[1] !== "assets") {
    return null;
  }
  const canonicalPathname = "/studio/assets";
  return Object.freeze({
    canonicalHref: href(canonicalPathname, queryParams(search)),
    canonicalPathname,
    kind: "placeholder",
    lifecycleKey: canonicalPathname,
    ownsDocumentTitle: false,
    placeholderId: "assets",
  });
}

function resolveWorkScopedSurface(
  pathname: string,
): {
  readonly scope: "work" | "remix";
  readonly parsed: StudioWorkspaceRoute;
  readonly candidateSurface: string;
} | null {
  const segments = normalizedSegments(pathname);
  if (segments === null || segments.length !== 4) return null;
  const [, scope, encodedIdentity, candidateSurface] = segments;
  if (scope !== "work" && scope !== "remix") return null;
  const parsed = parseStudioWorkspaceRoute({
    pathname: `/studio/${scope}/${encodedIdentity}/canvas`,
  });
  if (!parsed.valid) return null;
  return { scope, parsed, candidateSurface };
}

function scopedCanonicalPathname(
  scope: "work" | "remix",
  parsed: StudioWorkspaceRoute,
  surface: string,
): string {
  return scope === "work"
    ? `/studio/work/${encodeURIComponent(parsed.workId ?? "")}/${surface}`
    : `/studio/remix/${encodeURIComponent(parsed.remixSourceWorkId ?? "")}/${surface}`;
}

function scopedLifecycleKey(
  scope: "work" | "remix",
  parsed: StudioWorkspaceRoute,
  surface: string,
): string {
  return `/studio/${scope === "work"
    ? `work:${encodeURIComponent(parsed.workId ?? "")}`
    : `remix:${encodeURIComponent(parsed.remixSourceWorkId ?? "")}`}/${surface}`;
}

function resolveWorkScopedProduction(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioProductionRouteResolution | StudioInvalidRouteResolution | null {
  const scoped = resolveWorkScopedSurface(pathname);
  if (
    scoped === null
    || !WORK_SCOPE_PRODUCTION_SURFACES.has(
      scoped.candidateSurface as StudioProductionRouteId,
    )
  ) {
    return null;
  }
  const resolvedScope = resolveStudioProductionScope({ pathname, search });
  if (!resolvedScope.valid) return invalidResolution(pathname, search, resolvedScope.errorCode);
  const surface = scoped.candidateSurface as StudioProductionRouteId;
  const canonicalPathname = scopedCanonicalPathname(scoped.scope, scoped.parsed, surface);
  return Object.freeze({
    canonicalHref: href(canonicalPathname, queryParams(search)),
    canonicalPathname,
    kind: "production",
    lifecycleKey: studioProductionLifecycleKey(surface, resolvedScope.scope),
    editorHref: resolvedScope.scope.editorHref,
    ownsDocumentTitle: true,
    surface,
  });
}

function resolveWorkScopedPlaceholder(
  pathname: string,
  search: string | URLSearchParams | undefined,
): StudioPlaceholderRouteResolution | null {
  const scoped = resolveWorkScopedSurface(pathname);
  if (scoped === null || scoped.candidateSurface !== "assets") return null;
  const canonicalPathname = scopedCanonicalPathname(scoped.scope, scoped.parsed, "assets");
  return Object.freeze({
    canonicalHref: href(canonicalPathname, queryParams(search)),
    canonicalPathname,
    kind: "placeholder",
    lifecycleKey: scopedLifecycleKey(scoped.scope, scoped.parsed, "assets"),
    ownsDocumentTitle: false,
    placeholderId: "assets",
  });
}

export function resolveStudioRoute({
  pathname,
  search,
}: StudioRouteLocationInput): StudioRouteResolution {
  const publish = resolveCanonicalPublish(pathname, search);
  if (publish !== null) return publish;
  const companion = resolveCompanion(pathname, search);
  if (companion !== null) return companion;
  const lift3d = resolveLift3d(pathname, search);
  if (lift3d !== null) return lift3d;
  const storyworld = resolveStoryworld(pathname, search);
  if (storyworld !== null) return storyworld;
  const production = resolveProduction(pathname, search);
  if (production !== null) return production;
  const workScopedProduction = resolveWorkScopedProduction(pathname, search);
  if (workScopedProduction !== null) return workScopedProduction;
  const placeholder = resolvePlaceholder(pathname, search);
  if (placeholder !== null) return placeholder;
  const workScopedPlaceholder = resolveWorkScopedPlaceholder(pathname, search);
  if (workScopedPlaceholder !== null) return workScopedPlaceholder;

  const workspaceRoute = parseStudioWorkspaceRoute({ pathname, search });
  if (!workspaceRoute.valid) return invalidResolution(pathname, search, workspaceRoute);
  if (workspaceRoute.presentation === "publish") {
    const canonicalPathname = publishPathname(workspaceRoute.workId);
    return Object.freeze({
      canonicalHref: href(canonicalPathname, cleanIdentityQuery(search)),
      canonicalPathname,
      kind: "publish",
      lifecycleKey: `/studio/${studioWorkspaceDocumentIdentity(workspaceRoute)}/publish`,
      ownsDocumentTitle: true,
      workId: workspaceRoute.workId,
    });
  }
  return Object.freeze({
    canonicalHref: studioWorkspaceCanonicalHref(workspaceRoute, search),
    canonicalPathname: workspaceRoute.canonicalPathname,
    kind: "editor",
    lifecycleKey: `/studio/${studioWorkspaceDocumentIdentity(workspaceRoute)}/editor`,
    ownsDocumentTitle: true,
    workspaceRoute,
  });
}

export function studioRouteOwnsDocumentTitle(
  location: StudioRouteLocationInput,
): boolean {
  return resolveStudioRoute(location).ownsDocumentTitle;
}
