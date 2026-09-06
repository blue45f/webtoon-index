export const STUDIO_DCC_WORKBENCH_MODES = [
  "model",
  "build",
  "cad",
  "sculpt",
  "material",
  "shot",
] as const;

export const STUDIO_2D_WORKSPACE_SURFACES = [
  "canvas",
  "comic",
  "animation",
  "brushes",
  "bg3d",
  "poser",
  "character",
] as const;

export type StudioDccWorkbenchMode =
  (typeof STUDIO_DCC_WORKBENCH_MODES)[number];

export type Studio2dWorkspaceSurface =
  (typeof STUDIO_2D_WORKSPACE_SURFACES)[number];

export type StudioWorkspaceSurface = Studio2dWorkspaceSurface | "dcc";

export type StudioWorkspacePresentation = "editor" | "publish";

export type StudioWorkspaceRouteErrorCode =
  | "identity-conflict"
  | "invalid-mode"
  | "invalid-path"
  | "invalid-remix-id"
  | "invalid-work-id"
  | "work-id-conflict";

export interface StudioWorkspaceRoute {
  readonly canonicalPathname: string;
  readonly dccMode: StudioDccWorkbenchMode | null;
  readonly legacyPublishQuery: boolean;
  readonly legacyRemixQuery: boolean;
  readonly legacyWorkIdQuery: boolean;
  readonly presentation: StudioWorkspacePresentation;
  readonly remixSourceWorkId: string | null;
  readonly surface: StudioWorkspaceSurface;
  readonly valid: true;
  readonly workId: string | null;
}

export interface InvalidStudioWorkspaceRoute {
  readonly errorCode: StudioWorkspaceRouteErrorCode;
  readonly valid: false;
}

export type StudioWorkspaceRouteResolution =
  | StudioWorkspaceRoute
  | InvalidStudioWorkspaceRoute;

export interface StudioWorkspaceLocationInput {
  readonly pathname: string;
  readonly search?: string | URLSearchParams;
}

type StudioWorkspaceLocationLike = StudioWorkspaceLocationInput | string;

interface StudioWorkspaceHrefInput {
  readonly remixSourceWorkId?: string | null;
  readonly search?: string | URLSearchParams;
  readonly workId: string | null;
}

interface Studio2dWorkspaceHrefInput extends StudioWorkspaceHrefInput {
  readonly surface: Studio2dWorkspaceSurface;
}

interface StudioDccWorkspaceHrefInput extends StudioWorkspaceHrefInput {
  readonly mode: StudioDccWorkbenchMode;
}

interface StudioWorkspaceNavigationLocation {
  readonly key: string;
  readonly pathname: string;
  readonly search: string;
}

interface StudioWorkspaceReturnReceipt {
  readonly entryKey: string;
  readonly pathname: string;
  readonly remixSourceWorkId: string | null;
  readonly search: string;
  readonly version: 1;
  readonly workId: string | null;
}

export interface StudioDccNavigationState {
  readonly studioWorkspaceReturn: StudioWorkspaceReturnReceipt;
}

function invalidStudioWorkspaceRoute(
  errorCode: StudioWorkspaceRouteErrorCode,
): InvalidStudioWorkspaceRoute {
  return Object.freeze({ errorCode, valid: false });
}

function queryParams(search: string | URLSearchParams | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams(search ?? "");
}

function hasUnsafeStudioIdentityCharacter(value: string): boolean {
  if (value.includes("\\")) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function normalizeStudioIdentity(value: string | null): string | null | undefined {
  if (value === null) return null;
  if (
    value.length === 0
    || value.length > 160
    || value.trim() !== value
    || value === "."
    || value === ".."
    || hasUnsafeStudioIdentityCharacter(value)
  ) {
    return undefined;
  }
  return value;
}

function decodeStudioIdentity(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return normalizeStudioIdentity(decoded) ?? null;
}

function singleQueryIdentity(
  params: URLSearchParams,
  key: "id" | "remix",
): string | null | undefined {
  const values = params.getAll(key);
  if (values.length > 1) return undefined;
  return normalizeStudioIdentity(values[0] ?? null);
}

export function isStudioRoutePathname(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

function studioWorkspaceLocation(
  location: StudioWorkspaceLocationLike,
): StudioWorkspaceLocationInput {
  return typeof location === "string" ? { pathname: location } : location;
}

/** True only for paths owned by a Studio editor workspace route. */
export function isStudioWorkspaceRoutePathname(pathname: string): boolean {
  return parseStudioWorkspaceRoute({ pathname }).valid;
}

/** Full location predicate, including query identity and mode validation. */
export function isStudioWorkspaceLocation(
  location: StudioWorkspaceLocationInput,
): boolean {
  return parseStudioWorkspaceRoute(location).valid;
}

export function isStudioUploadWorkspaceLocation(
  location: StudioWorkspaceLocationInput,
): boolean {
  const route = parseStudioWorkspaceRoute(location);
  return route.valid && route.presentation === "publish";
}

export function studioWorkspaceDocumentIdentity(
  route: Pick<StudioWorkspaceRoute, "remixSourceWorkId" | "workId">,
): string {
  if (route.remixSourceWorkId !== null) {
    return `remix:${encodeURIComponent(route.remixSourceWorkId)}`;
  }
  return route.workId === null
    ? "draft"
    : `work:${encodeURIComponent(route.workId)}`;
}

export function studioRouteStageKey(locationLike: StudioWorkspaceLocationLike): string {
  const location = studioWorkspaceLocation(locationLike);
  const route = parseStudioWorkspaceRoute(location);
  if (!route.valid) {
    const search = queryParams(location.search).toString();
    return isStudioRoutePathname(location.pathname) && search.length > 0
      ? `${location.pathname}?${search}`
      : location.pathname;
  }
  const presentation = route.presentation === "publish" ? "upload" : "editor";
  return `/studio/${studioWorkspaceDocumentIdentity(route)}/${presentation}`;
}

export function shouldPreserveStudioRouteLifecycle(
  previousLocationLike: StudioWorkspaceLocationLike,
  nextLocationLike: StudioWorkspaceLocationLike,
): boolean {
  const previousRoute = parseStudioWorkspaceRoute(
    studioWorkspaceLocation(previousLocationLike),
  );
  const nextRoute = parseStudioWorkspaceRoute(studioWorkspaceLocation(nextLocationLike));
  if (!previousRoute.valid || !nextRoute.valid) return false;
  if (previousRoute.presentation !== "editor" || nextRoute.presentation !== "editor") {
    return false;
  }
  return studioWorkspaceDocumentIdentity(previousRoute)
    === studioWorkspaceDocumentIdentity(nextRoute);
}

export function isStudioDccWorkbenchMode(
  value: string,
): value is StudioDccWorkbenchMode {
  return (STUDIO_DCC_WORKBENCH_MODES as readonly string[]).includes(value);
}

export function isStudio2dWorkspaceSurface(
  value: string,
): value is Studio2dWorkspaceSurface {
  return (STUDIO_2D_WORKSPACE_SURFACES as readonly string[]).includes(value);
}

export function isValidStudioWorkspaceWorkId(value: unknown): value is string {
  return typeof value === "string" && normalizeStudioIdentity(value) === value;
}

function assertStudioHrefIdentity(
  workId: string | null,
  remixSourceWorkId: string | null,
): void {
  if (workId !== null && remixSourceWorkId !== null) {
    throw new Error("A Studio href cannot target work and remix identities together.");
  }
  if (workId !== null && !isValidStudioWorkspaceWorkId(workId)) {
    throw new Error("A Studio href requires a valid work identity.");
  }
  if (
    remixSourceWorkId !== null
    && !isValidStudioWorkspaceWorkId(remixSourceWorkId)
  ) {
    throw new Error("A Studio href requires a valid remix source identity.");
  }
}

export function studio2dPathname(
  workId: string | null,
  surface: Studio2dWorkspaceSurface,
  remixSourceWorkId: string | null = null,
): string {
  assertStudioHrefIdentity(workId, remixSourceWorkId);
  if (remixSourceWorkId !== null) {
    return `/studio/remix/${encodeURIComponent(remixSourceWorkId)}/${surface}`;
  }
  if (workId !== null) {
    return `/studio/work/${encodeURIComponent(workId)}/${surface}`;
  }
  return surface === "canvas" ? "/studio" : `/studio/${surface}`;
}

export function studioCanvasPathname(
  workId: string | null,
  remixSourceWorkId: string | null = null,
): string {
  return studio2dPathname(workId, "canvas", remixSourceWorkId);
}

export function studioDccPathname(
  workId: string | null,
  mode: StudioDccWorkbenchMode,
  remixSourceWorkId: string | null = null,
): string {
  assertStudioHrefIdentity(workId, remixSourceWorkId);
  const suffix = `3d/dcc/${mode}`;
  if (remixSourceWorkId !== null) {
    return `/studio/remix/${encodeURIComponent(remixSourceWorkId)}/${suffix}`;
  }
  return workId === null
    ? `/studio/${suffix}`
    : `/studio/work/${encodeURIComponent(workId)}/${suffix}`;
}

function workspaceQuery(search: string | URLSearchParams | undefined): string {
  const params = queryParams(search);
  params.delete("id");
  params.delete("mode");
  params.delete("remix");
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

export function studio2dHref({
  remixSourceWorkId = null,
  search,
  surface,
  workId,
}: Studio2dWorkspaceHrefInput): string {
  return `${studio2dPathname(workId, surface, remixSourceWorkId)}${workspaceQuery(search)}`;
}

export function studioCanvasHref({
  remixSourceWorkId = null,
  search,
  workId,
}: StudioWorkspaceHrefInput): string {
  return studio2dHref({ remixSourceWorkId, search, surface: "canvas", workId });
}

export function studioDccHref({
  mode,
  remixSourceWorkId = null,
  search,
  workId,
}: StudioDccWorkspaceHrefInput): string {
  return `${studioDccPathname(workId, mode, remixSourceWorkId)}${workspaceQuery(search)}`;
}

export function studioWorkspaceCanonicalHref(
  route: StudioWorkspaceRoute,
  search?: string | URLSearchParams,
): string {
  return `${route.canonicalPathname}${workspaceQuery(search)}`;
}

interface ParsedPathIdentity {
  readonly remixSourceWorkId: string | null;
  readonly tail: readonly string[];
  readonly workId: string | null;
}

function parsePathIdentity(
  segments: readonly string[],
): ParsedPathIdentity | InvalidStudioWorkspaceRoute {
  if (segments[1] !== "work" && segments[1] !== "remix") {
    return { remixSourceWorkId: null, tail: segments.slice(1), workId: null };
  }
  const identityKind = segments[1];
  if (segments.length < 3) {
    return invalidStudioWorkspaceRoute(
      identityKind === "work" ? "invalid-work-id" : "invalid-remix-id",
    );
  }
  const identity = decodeStudioIdentity(segments[2]);
  if (identity === null) {
    return invalidStudioWorkspaceRoute(
      identityKind === "work" ? "invalid-work-id" : "invalid-remix-id",
    );
  }
  return {
    remixSourceWorkId: identityKind === "remix" ? identity : null,
    tail: segments.slice(3),
    workId: identityKind === "work" ? identity : null,
  };
}

interface ParsedSurface {
  readonly dccMode: StudioDccWorkbenchMode | null;
  readonly surface: StudioWorkspaceSurface;
}

function parseSurface(tail: readonly string[]): ParsedSurface | null {
  if (tail.length === 0) return { dccMode: null, surface: "canvas" };
  if (tail.length === 1 && isStudio2dWorkspaceSurface(tail[0])) {
    return { dccMode: null, surface: tail[0] };
  }
  if (tail[0] !== "3d") return null;
  if (tail.length === 1 || (tail.length === 2 && tail[1] === "dcc")) {
    return { dccMode: "model", surface: "dcc" };
  }
  if (
    tail.length === 3
    && tail[1] === "dcc"
    && isStudioDccWorkbenchMode(tail[2])
  ) {
    return { dccMode: tail[2], surface: "dcc" };
  }
  return null;
}

export function parseStudioWorkspaceRoute({
  pathname,
  search,
}: StudioWorkspaceLocationInput): StudioWorkspaceRouteResolution {
  if (!isStudioRoutePathname(pathname)) {
    return invalidStudioWorkspaceRoute("invalid-path");
  }

  const rawSegments = pathname.split("/");
  if (rawSegments[0] !== "") return invalidStudioWorkspaceRoute("invalid-path");
  const segments = rawSegments.slice(1);
  if (segments.at(-1) === "") segments.pop();
  if (segments.some((segment) => segment.length === 0) || segments[0] !== "studio") {
    return invalidStudioWorkspaceRoute("invalid-path");
  }

  const pathIdentity = parsePathIdentity(segments);
  if ("valid" in pathIdentity) return pathIdentity;
  const parsedSurface = parseSurface(pathIdentity.tail);
  if (parsedSurface === null) return invalidStudioWorkspaceRoute("invalid-path");

  const params = queryParams(search);
  const queryWorkId = singleQueryIdentity(params, "id");
  if (queryWorkId === undefined) return invalidStudioWorkspaceRoute("invalid-work-id");
  const queryRemixId = singleQueryIdentity(params, "remix");
  if (queryRemixId === undefined) return invalidStudioWorkspaceRoute("invalid-remix-id");

  if (queryWorkId !== null && queryRemixId !== null) {
    return invalidStudioWorkspaceRoute("identity-conflict");
  }
  if (pathIdentity.workId !== null) {
    if (queryRemixId !== null) return invalidStudioWorkspaceRoute("identity-conflict");
    if (queryWorkId !== null && pathIdentity.workId !== queryWorkId) {
      return invalidStudioWorkspaceRoute("work-id-conflict");
    }
  }
  if (pathIdentity.remixSourceWorkId !== null) {
    if (queryWorkId !== null) return invalidStudioWorkspaceRoute("identity-conflict");
    if (
      queryRemixId !== null
      && pathIdentity.remixSourceWorkId !== queryRemixId
    ) {
      return invalidStudioWorkspaceRoute("identity-conflict");
    }
  }

  const workId = pathIdentity.workId ?? queryWorkId;
  const remixSourceWorkId = pathIdentity.remixSourceWorkId ?? queryRemixId;
  const modes = params.getAll("mode");
  if (modes.length > 1) return invalidStudioWorkspaceRoute("invalid-mode");
  const mode = modes[0] ?? null;
  if (mode !== null && mode !== "upload") {
    return invalidStudioWorkspaceRoute("invalid-mode");
  }
  const legacyPublishQuery = mode === "upload";
  if (
    legacyPublishQuery
    && (parsedSurface.surface !== "canvas" || remixSourceWorkId !== null)
  ) {
    return invalidStudioWorkspaceRoute("invalid-mode");
  }

  const canonicalPathname = parsedSurface.surface === "dcc"
    ? studioDccPathname(workId, parsedSurface.dccMode ?? "model", remixSourceWorkId)
    : studio2dPathname(workId, parsedSurface.surface, remixSourceWorkId);

  return Object.freeze({
    canonicalPathname,
    dccMode: parsedSurface.dccMode,
    legacyPublishQuery,
    legacyRemixQuery:
      pathIdentity.remixSourceWorkId === null && queryRemixId !== null,
    legacyWorkIdQuery: pathIdentity.workId === null && queryWorkId !== null,
    presentation: legacyPublishQuery ? "publish" : "editor",
    remixSourceWorkId,
    surface: parsedSurface.surface,
    valid: true,
    workId,
  });
}

export function createStudioDccNavigationState(
  route: StudioWorkspaceRoute,
  location: StudioWorkspaceNavigationLocation,
): StudioDccNavigationState {
  if (route.surface === "dcc") {
    throw new Error("Studio DCC navigation must start from a 2D workspace route.");
  }
  return Object.freeze({
    studioWorkspaceReturn: Object.freeze({
      entryKey: location.key,
      pathname: location.pathname,
      remixSourceWorkId: route.remixSourceWorkId,
      search: location.search,
      version: 1,
      workId: route.workId,
    }),
  });
}

function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function studioWorkspaceReturnHref(
  state: unknown,
  currentRoute: StudioWorkspaceRoute,
): string | null {
  if (currentRoute.surface !== "dcc" || !state || typeof state !== "object") return null;
  const receipt = ownData(state, "studioWorkspaceReturn");
  if (!receipt || typeof receipt !== "object") return null;
  if (ownData(receipt, "version") !== 1) return null;
  const entryKey = ownData(receipt, "entryKey");
  const pathname = ownData(receipt, "pathname");
  const search = ownData(receipt, "search");
  const workId = ownData(receipt, "workId");
  const rawRemixSourceWorkId = ownData(receipt, "remixSourceWorkId");
  const remixSourceWorkId = rawRemixSourceWorkId === undefined
    ? null
    : rawRemixSourceWorkId;
  if (
    typeof entryKey !== "string"
    || entryKey.length === 0
    || typeof pathname !== "string"
    || typeof search !== "string"
    || (workId !== null && typeof workId !== "string")
    || (remixSourceWorkId !== null && typeof remixSourceWorkId !== "string")
    || workId !== currentRoute.workId
    || remixSourceWorkId !== currentRoute.remixSourceWorkId
  ) {
    return null;
  }
  const returnRoute = parseStudioWorkspaceRoute({ pathname, search });
  if (!returnRoute.valid || returnRoute.surface === "dcc") return null;
  if (
    returnRoute.workId !== currentRoute.workId
    || returnRoute.remixSourceWorkId !== currentRoute.remixSourceWorkId
  ) {
    return null;
  }
  return `${pathname}${search}`;
}
