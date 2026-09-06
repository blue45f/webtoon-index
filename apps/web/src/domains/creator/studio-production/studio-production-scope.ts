import {
  parseStudioWorkspaceRoute,
  type StudioWorkspaceLocationInput,
  type StudioWorkspaceRouteErrorCode,
} from "../studio-workspace-route";

export interface StudioProductionScope {
  readonly key: string;
  readonly label: string;
  readonly editorHref: string;
}

export type StudioProductionScopeResult =
  | { readonly valid: true; readonly scope: StudioProductionScope }
  | { readonly valid: false; readonly errorCode: StudioWorkspaceRouteErrorCode };

function scopeFromWorkspace(
  input: StudioWorkspaceLocationInput,
): StudioProductionScopeResult {
  const parsed = parseStudioWorkspaceRoute(input);
  if (!parsed.valid) return parsed;
  if (parsed.workId !== null) {
    return {
      valid: true,
      scope: {
        key: `work:${parsed.workId}`,
        label: `작품 ${parsed.workId}`,
        editorHref: `/studio/work/${encodeURIComponent(parsed.workId)}/canvas`,
      },
    };
  }
  if (parsed.remixSourceWorkId !== null) {
    return {
      valid: true,
      scope: {
        key: `remix:${parsed.remixSourceWorkId}`,
        label: `리믹스 ${parsed.remixSourceWorkId}`,
        editorHref: `/studio/remix/${encodeURIComponent(parsed.remixSourceWorkId)}/canvas`,
      },
    };
  }
  return { valid: true, scope: { key: "draft", label: "새 프로젝트", editorHref: "/studio" } };
}

/** Reuse the editor's opaque-ID validator; never fall back to draft on bad scope. */
export function resolveStudioProductionScope({
  pathname,
  search,
}: StudioWorkspaceLocationInput): StudioProductionScopeResult {
  const params = new URLSearchParams(search);
  const values = params.getAll("scope");
  if (values.length > 1) return { valid: false, errorCode: "identity-conflict" };
  const segments = pathname.replace(/\/$/u, "").split("/");
  const pathScoped = segments.length === 5
    && (segments[2] === "work" || segments[2] === "remix");
  const surface = segments.at(-1);
  const supported = ["projects", "review", "versions", "present", "share", "join"];
  if (segments[0] !== "" || segments[1] !== "studio" || !surface
    || !supported.includes(surface) || (!pathScoped && segments.length !== 3)) {
    return { valid: false, errorCode: "invalid-path" };
  }
  const pathResult = scopeFromWorkspace({
    pathname: pathScoped ? `/${segments.slice(1, 4).join("/")}/canvas` : "/studio",
    search: params,
  });
  if (!pathResult.valid) return pathResult;
  const explicit = values[0];
  if (explicit === undefined) return pathResult;
  let scoped: StudioProductionScopeResult;
  if (explicit === "draft") {
    scoped = scopeFromWorkspace({ pathname: "/studio" });
  } else {
    const separator = explicit.indexOf(":");
    const kind = explicit.slice(0, separator);
    const identity = explicit.slice(separator + 1);
    if (separator < 0 || (kind !== "work" && kind !== "remix")) {
      return { valid: false, errorCode: "identity-conflict" };
    }
    // encodeURIComponent rejects unpaired surrogates rather than crashing a render.
    let encoded: string;
    try {
      encoded = encodeURIComponent(identity);
    } catch {
      return { valid: false, errorCode: "identity-conflict" };
    }
    scoped = scopeFromWorkspace({ pathname: `/studio/${kind}/${encoded}/canvas` });
  }
  if (!scoped.valid) return scoped;
  const hasOtherIdentity = pathScoped || params.has("id") || params.has("remix");
  if (hasOtherIdentity && scoped.scope.key !== pathResult.scope.key) {
    return { valid: false, errorCode: "identity-conflict" };
  }
  return scoped;
}

/** Scope is part of component lifetime, even when it travels in a query parameter. */
export function studioProductionLifecycleKey(
  surface: string,
  scope: StudioProductionScope,
): string {
  if (scope.key === "draft") return `/studio/${surface}`;
  const separator = scope.key.indexOf(":");
  return `/studio/${scope.key.slice(0, separator)}:${encodeURIComponent(scope.key.slice(separator + 1))}/${surface}`;
}
