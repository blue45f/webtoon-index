/**
 * Renderer-neutral cache/dirty planner for a linked 3D → 2D render bridge.
 *
 * The caller owns scene projections and rendering. This leaf module only hashes canonical
 * revisions, validates a bounded pass DAG, decides cache reuse, and emits idempotent operations
 * that can be recorded by the Studio command/CRDT layer.
 */

export const STUDIO_BG3D_LINKED_RENDER_PASSES = [
  "line",
  "depth",
  "object-id",
  "normal",
  "combined",
] as const;

export type StudioBg3dLinkedRenderPass =
  (typeof STUDIO_BG3D_LINKED_RENDER_PASSES)[number];

export const STUDIO_BG3D_LINKED_RENDER_DOMAINS = [
  "camera",
  "geometry",
  "visibility",
  "material",
  "object-identity",
  "line-options",
  "depth-options",
  "object-id-options",
  "normal-options",
  "combined-options",
] as const;

export type StudioBg3dLinkedRenderDomain =
  (typeof STUDIO_BG3D_LINKED_RENDER_DOMAINS)[number];

export type StudioBg3dLinkedRenderDependencyKey =
  | "pipeline"
  | "source"
  | StudioBg3dLinkedRenderDomain
  | `pass:${StudioBg3dLinkedRenderPass}`;

export const STUDIO_BG3D_LINKED_RENDER_MAX_GRAPH_EDGES = 12;
export const STUDIO_BG3D_LINKED_RENDER_MAX_OPERATIONS =
  STUDIO_BG3D_LINKED_RENDER_PASSES.length;
export const STUDIO_BG3D_LINKED_RENDER_MAX_SCENE_BYTES = 512 * 1024;
export const STUDIO_BG3D_LINKED_RENDER_MAX_SOURCE_BYTES = 320 * 1024;
export const STUDIO_BG3D_LINKED_RENDER_MAX_OPTIONS_BYTES = 128 * 1024;
export const STUDIO_BG3D_LINKED_RENDER_MAX_PROJECTION_BYTES = 128 * 1024;
export const STUDIO_BG3D_LINKED_RENDER_MAX_TOTAL_BYTES = 1024 * 1024;

const PASS_SET = new Set<string>(STUDIO_BG3D_LINKED_RENDER_PASSES);
const DOMAIN_SET = new Set<string>(STUDIO_BG3D_LINKED_RENDER_DOMAINS);
const PASS_ORDER = new Map(
  STUDIO_BG3D_LINKED_RENDER_PASSES.map((pass, index) => [pass, index] as const),
);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,79}$/u;
const PIPELINE_PATTERN = /^[a-z0-9][a-z0-9._:+/-]{0,119}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UTF8_ENCODER = new TextEncoder();

const DIRECT_DOMAINS = {
  line: [
    "camera",
    "geometry",
    "visibility",
    "material",
    "line-options",
  ],
  depth: [
    "camera",
    "geometry",
    "visibility",
    "depth-options",
  ],
  "object-id": [
    "camera",
    "geometry",
    "visibility",
    "object-identity",
    "object-id-options",
  ],
  normal: [
    "camera",
    "geometry",
    "visibility",
    "normal-options",
  ],
  combined: ["combined-options"],
} as const satisfies Readonly<
  Record<StudioBg3dLinkedRenderPass, readonly StudioBg3dLinkedRenderDomain[]>
>;

export const DEFAULT_STUDIO_BG3D_LINKED_RENDER_GRAPH: Readonly<
  Record<StudioBg3dLinkedRenderPass, readonly StudioBg3dLinkedRenderPass[]>
> = {
  line: [],
  depth: [],
  "object-id": [],
  normal: [],
  combined: ["line", "depth", "object-id", "normal"],
} as const;

export interface StudioBg3dLinkedRenderCanonicalRevision {
  readonly canonical: string;
  /** Optional caller-side stale-read guard. Null computes without an assertion. */
  readonly expectedSignature: string | null;
}

export interface StudioBg3dLinkedRenderProjectionRevision
  extends StudioBg3dLinkedRenderCanonicalRevision {
  readonly domain: StudioBg3dLinkedRenderDomain;
}

export interface StudioBg3dLinkedRenderCachedDependency {
  readonly key: StudioBg3dLinkedRenderDependencyKey;
  readonly signature: string;
}

export interface StudioBg3dLinkedRenderCachedArtifact {
  readonly pass: StudioBg3dLinkedRenderPass;
  readonly renderSignature: string;
  readonly renderedRevision: number;
  readonly dependencies: readonly StudioBg3dLinkedRenderCachedDependency[];
}

export interface CreateStudioBg3dLinkedRenderPlanInput {
  readonly linkId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly lamportBase: number;
  readonly pipelineRevision: string;
  readonly scene: StudioBg3dLinkedRenderCanonicalRevision;
  readonly source: StudioBg3dLinkedRenderCanonicalRevision;
  readonly options: StudioBg3dLinkedRenderCanonicalRevision;
  readonly projections: readonly StudioBg3dLinkedRenderProjectionRevision[];
  readonly requestedPasses: readonly StudioBg3dLinkedRenderPass[];
  readonly supportedPasses: readonly StudioBg3dLinkedRenderPass[];
  readonly dependencyGraph:
    | Readonly<Record<StudioBg3dLinkedRenderPass, readonly StudioBg3dLinkedRenderPass[]>>
    | null;
  readonly previousArtifacts: readonly StudioBg3dLinkedRenderCachedArtifact[];
}

export type StudioBg3dLinkedRenderDirtyReason =
  | "cache-miss"
  | "pipeline-changed"
  | "render-signature-mismatch"
  | "source-changed"
  | `dependency-changed:${StudioBg3dLinkedRenderDomain}`
  | `dependency-missing:${StudioBg3dLinkedRenderDependencyKey}`
  | `upstream-changed:${StudioBg3dLinkedRenderPass}`;

export interface StudioBg3dLinkedRenderPassPlan {
  readonly pass: StudioBg3dLinkedRenderPass;
  readonly action: "refresh" | "reuse";
  readonly renderSignature: string;
  readonly cacheKey: string;
  readonly dependencies: readonly StudioBg3dLinkedRenderCachedDependency[];
  readonly dirtyReasons: readonly StudioBg3dLinkedRenderDirtyReason[];
}

export interface StudioBg3dLinkedRenderOperation {
  /** Content-addressed and actor-independent, so concurrent identical refreshes coalesce. */
  readonly operationId: string;
  readonly kind: "refresh-linked-3d-pass";
  readonly actorId: string;
  readonly lamport: number;
  readonly baseRevision: number;
  readonly pass: StudioBg3dLinkedRenderPass;
  readonly renderSignature: string;
  readonly cacheKey: string;
  readonly dependsOn: readonly string[];
}

export interface StudioBg3dLinkedRenderPlan {
  readonly kind: "toonspectrum.bg3d-linked-render-plan";
  readonly version: 1;
  readonly linkId: string;
  readonly baseRevision: number;
  readonly sceneSignature: string;
  readonly sourceSignature: string;
  readonly optionsSignature: string;
  readonly pipelineSignature: string;
  readonly passes: readonly StudioBg3dLinkedRenderPassPlan[];
  readonly operations: readonly StudioBg3dLinkedRenderOperation[];
}

export type StudioBg3dLinkedRenderFailureCode =
  | "cache-budget-exceeded"
  | "dependency-cycle"
  | "digest-unavailable"
  | "graph-budget-exceeded"
  | "invalid-cache"
  | "invalid-dependency"
  | "invalid-input"
  | "invalid-pass"
  | "invalid-revision"
  | "operation-budget-exceeded"
  | "serialized-budget-exceeded"
  | "signature-mismatch"
  | "stale-render"
  | "unsupported-pass";

export interface StudioBg3dLinkedRenderFailure {
  readonly ok: false;
  readonly code: StudioBg3dLinkedRenderFailureCode;
  readonly message: string;
}

export interface StudioBg3dLinkedRenderSuccess {
  readonly ok: true;
  readonly plan: StudioBg3dLinkedRenderPlan;
}

export type StudioBg3dLinkedRenderResult =
  | StudioBg3dLinkedRenderFailure
  | StudioBg3dLinkedRenderSuccess;

function failure(
  code: StudioBg3dLinkedRenderFailureCode,
  message: string,
): StudioBg3dLinkedRenderFailure {
  return Object.freeze({ ok: false, code, message });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

function validSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validSignature(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validPass(value: unknown): value is StudioBg3dLinkedRenderPass {
  return typeof value === "string" && PASS_SET.has(value);
}

function validDependencyKey(value: unknown): value is StudioBg3dLinkedRenderDependencyKey {
  if (value === "pipeline" || value === "source") return true;
  if (typeof value !== "string") return false;
  if (DOMAIN_SET.has(value)) return true;
  return value.startsWith("pass:") && PASS_SET.has(value.slice(5));
}

function readCanonicalRevision(
  value: unknown,
  maximumBytes: number,
): StudioBg3dLinkedRenderCanonicalRevision | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["canonical", "expectedSignature"]) ||
    typeof value.canonical !== "string" ||
    value.canonical.length === 0 ||
    UTF8_ENCODER.encode(value.canonical).byteLength > maximumBytes ||
    !(value.expectedSignature === null || validSignature(value.expectedSignature))
  ) return null;
  return {
    canonical: value.canonical,
    expectedSignature: value.expectedSignature,
  };
}

function readPasses(value: unknown): StudioBg3dLinkedRenderPass[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > PASS_SET.size) return null;
  const passes: StudioBg3dLinkedRenderPass[] = [];
  const seen = new Set<StudioBg3dLinkedRenderPass>();
  for (const candidate of value) {
    if (!validPass(candidate) || seen.has(candidate)) return null;
    seen.add(candidate);
    passes.push(candidate);
  }
  passes.sort((left, right) => PASS_ORDER.get(left)! - PASS_ORDER.get(right)!);
  return passes;
}

function readGraph(
  value: unknown,
): Readonly<Record<StudioBg3dLinkedRenderPass, readonly StudioBg3dLinkedRenderPass[]>> | null {
  if (value === null) return DEFAULT_STUDIO_BG3D_LINKED_RENDER_GRAPH;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, STUDIO_BG3D_LINKED_RENDER_PASSES)
  ) return null;
  let edgeCount = 0;
  const graph = {} as Record<
    StudioBg3dLinkedRenderPass,
    readonly StudioBg3dLinkedRenderPass[]
  >;
  for (const pass of STUDIO_BG3D_LINKED_RENDER_PASSES) {
    const candidates = value[pass];
    if (!Array.isArray(candidates) || candidates.length > PASS_SET.size) return null;
    const dependencies: StudioBg3dLinkedRenderPass[] = [];
    const seen = new Set<StudioBg3dLinkedRenderPass>();
    for (const candidate of candidates) {
      if (!validPass(candidate) || seen.has(candidate)) return null;
      seen.add(candidate);
      dependencies.push(candidate);
      edgeCount += 1;
    }
    if (edgeCount > STUDIO_BG3D_LINKED_RENDER_MAX_GRAPH_EDGES) return null;
    dependencies.sort((left, right) => PASS_ORDER.get(left)! - PASS_ORDER.get(right)!);
    graph[pass] = Object.freeze(dependencies);
  }
  return Object.freeze(graph);
}

function resolvePassOrder(
  requested: readonly StudioBg3dLinkedRenderPass[],
  supported: ReadonlySet<StudioBg3dLinkedRenderPass>,
  graph: Readonly<Record<StudioBg3dLinkedRenderPass, readonly StudioBg3dLinkedRenderPass[]>>,
): { readonly ok: true; readonly passes: readonly StudioBg3dLinkedRenderPass[] } |
  StudioBg3dLinkedRenderFailure {
  const visited = new Set<StudioBg3dLinkedRenderPass>();
  const active = new Set<StudioBg3dLinkedRenderPass>();
  const ordered: StudioBg3dLinkedRenderPass[] = [];
  const visit = (
    pass: StudioBg3dLinkedRenderPass,
  ): StudioBg3dLinkedRenderFailure | null => {
    if (!supported.has(pass)) {
      return failure("unsupported-pass", `렌더 패스 '${pass}'를 현재 백엔드가 지원하지 않습니다.`);
    }
    if (active.has(pass)) {
      return failure("dependency-cycle", `렌더 패스 '${pass}'에서 의존성 순환을 발견했습니다.`);
    }
    if (visited.has(pass)) return null;
    active.add(pass);
    for (const dependency of graph[pass]) {
      const problem = visit(dependency);
      if (problem) return problem;
    }
    active.delete(pass);
    visited.add(pass);
    ordered.push(pass);
    return null;
  };
  for (const pass of requested) {
    const problem = visit(pass);
    if (problem) return problem;
  }
  return Object.freeze({ ok: true, passes: Object.freeze(ordered) });
}

async function sha256(value: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest("SHA-256", UTF8_ENCODER.encode(value));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")}`;
  } catch {
    return null;
  }
}

function dirtyReasonForKey(
  key: StudioBg3dLinkedRenderDependencyKey,
): StudioBg3dLinkedRenderDirtyReason {
  if (key === "source") return "source-changed";
  if (key === "pipeline") return "pipeline-changed";
  if (key.startsWith("pass:")) {
    return `upstream-changed:${key.slice(5) as StudioBg3dLinkedRenderPass}`;
  }
  return `dependency-changed:${key as StudioBg3dLinkedRenderDomain}`;
}

/**
 * Builds a deterministic cache/refresh plan. Any malformed, stale, oversized, unsupported, cyclic,
 * or unverifiable input fails before an operation is emitted.
 */
export async function createStudioBg3dLinkedRenderPlan(
  raw: unknown,
): Promise<StudioBg3dLinkedRenderResult> {
  if (
    !isPlainRecord(raw) ||
    !hasExactKeys(raw, [
      "actorId",
      "baseRevision",
      "dependencyGraph",
      "lamportBase",
      "linkId",
      "options",
      "pipelineRevision",
      "previousArtifacts",
      "projections",
      "requestedPasses",
      "scene",
      "source",
      "supportedPasses",
    ]) ||
    typeof raw.linkId !== "string" || !ID_PATTERN.test(raw.linkId) ||
    typeof raw.actorId !== "string" || !ID_PATTERN.test(raw.actorId) ||
    !validSafeRevision(raw.baseRevision) ||
    !validSafeRevision(raw.lamportBase) ||
    typeof raw.pipelineRevision !== "string" ||
    !PIPELINE_PATTERN.test(raw.pipelineRevision)
  ) {
    return failure("invalid-input", "링크 ID, actor, revision 또는 파이프라인 입력이 올바르지 않습니다.");
  }
  // Preserve validated primitives across awaited digest boundaries.
  const linkId = raw.linkId;
  const actorId = raw.actorId;
  const baseRevision = raw.baseRevision;
  const lamportBase = raw.lamportBase;
  const pipelineRevision = raw.pipelineRevision;

  const scene = readCanonicalRevision(raw.scene, STUDIO_BG3D_LINKED_RENDER_MAX_SCENE_BYTES);
  const source = readCanonicalRevision(raw.source, STUDIO_BG3D_LINKED_RENDER_MAX_SOURCE_BYTES);
  const options = readCanonicalRevision(raw.options, STUDIO_BG3D_LINKED_RENDER_MAX_OPTIONS_BYTES);
  if (!scene || !source || !options) {
    return failure("invalid-revision", "scene/source/options canonical revision이 올바르지 않습니다.");
  }
  const requested = readPasses(raw.requestedPasses);
  const supported = readPasses(raw.supportedPasses);
  if (!requested || !supported) {
    return failure("invalid-pass", "요청/지원 렌더 패스 목록이 비었거나 중복·미지원 값을 포함합니다.");
  }
  const graph = readGraph(raw.dependencyGraph);
  if (!graph) {
    return failure("graph-budget-exceeded", "렌더 의존 그래프가 손상됐거나 edge 예산을 넘었습니다.");
  }
  const ordered = resolvePassOrder(requested, new Set(supported), graph);
  if (!ordered.ok) return ordered;

  if (
    !Array.isArray(raw.projections) ||
    raw.projections.length !== STUDIO_BG3D_LINKED_RENDER_DOMAINS.length
  ) {
    return failure("invalid-dependency", "렌더 projection revision은 모든 도메인을 정확히 한 번 포함해야 합니다.");
  }
  const projectionByDomain = new Map<
    StudioBg3dLinkedRenderDomain,
    StudioBg3dLinkedRenderCanonicalRevision
  >();
  let totalBytes =
    UTF8_ENCODER.encode(scene.canonical).byteLength +
    UTF8_ENCODER.encode(source.canonical).byteLength +
    UTF8_ENCODER.encode(options.canonical).byteLength;
  for (const candidate of raw.projections) {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["canonical", "domain", "expectedSignature"]) ||
      typeof candidate.domain !== "string" ||
      !DOMAIN_SET.has(candidate.domain) ||
      projectionByDomain.has(candidate.domain as StudioBg3dLinkedRenderDomain)
    ) {
      return failure("invalid-dependency", "렌더 projection domain이 누락·중복·손상됐습니다.");
    }
    const revision = readCanonicalRevision(
      { canonical: candidate.canonical, expectedSignature: candidate.expectedSignature },
      STUDIO_BG3D_LINKED_RENDER_MAX_PROJECTION_BYTES,
    );
    if (!revision) {
      return failure("invalid-dependency", `projection '${candidate.domain}' revision이 올바르지 않습니다.`);
    }
    totalBytes += UTF8_ENCODER.encode(revision.canonical).byteLength;
    projectionByDomain.set(
      candidate.domain as StudioBg3dLinkedRenderDomain,
      revision,
    );
  }
  if (totalBytes > STUDIO_BG3D_LINKED_RENDER_MAX_TOTAL_BYTES) {
    return failure("serialized-budget-exceeded", "링크드 렌더 입력의 합계 byte 예산을 넘었습니다.");
  }

  if (
    !Array.isArray(raw.previousArtifacts) ||
    raw.previousArtifacts.length > STUDIO_BG3D_LINKED_RENDER_PASSES.length
  ) {
    return failure("cache-budget-exceeded", "패스 cache 항목 예산을 넘었습니다.");
  }
  const artifacts = new Map<
    StudioBg3dLinkedRenderPass,
    StudioBg3dLinkedRenderCachedArtifact
  >();
  for (const candidate of raw.previousArtifacts) {
    const renderedRevisionValue = isPlainRecord(candidate)
      ? candidate.renderedRevision
      : undefined;
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["dependencies", "pass", "renderedRevision", "renderSignature"]) ||
      !validPass(candidate.pass) ||
      !validSignature(candidate.renderSignature) ||
      !validSafeRevision(candidate.renderedRevision) ||
      candidate.renderedRevision > baseRevision ||
      !Array.isArray(candidate.dependencies) ||
      candidate.dependencies.length > 2 + STUDIO_BG3D_LINKED_RENDER_DOMAINS.length +
        STUDIO_BG3D_LINKED_RENDER_PASSES.length ||
      artifacts.has(candidate.pass)
    ) {
      return validSafeRevision(renderedRevisionValue) &&
        renderedRevisionValue > baseRevision
        ? failure("stale-render", "미래 scene revision의 cache 결과는 현재 링크에 재사용할 수 없습니다.")
        : failure("invalid-cache", "이전 링크드 렌더 cache 항목이 손상됐습니다.");
    }
    const dependencies: StudioBg3dLinkedRenderCachedDependency[] = [];
    const dependencyKeys = new Set<StudioBg3dLinkedRenderDependencyKey>();
    for (const entry of candidate.dependencies) {
      if (
        !isPlainRecord(entry) ||
        !hasExactKeys(entry, ["key", "signature"]) ||
        !validDependencyKey(entry.key) ||
        !validSignature(entry.signature) ||
        dependencyKeys.has(entry.key)
      ) {
        return failure("invalid-cache", "cache dependency signature가 손상되거나 중복됐습니다.");
      }
      dependencyKeys.add(entry.key);
      dependencies.push({ key: entry.key, signature: entry.signature });
    }
    artifacts.set(candidate.pass, {
      pass: candidate.pass,
      renderSignature: candidate.renderSignature,
      renderedRevision: candidate.renderedRevision,
      dependencies,
    });
  }

  const revisions = [
    ["scene", scene] as const,
    ["source", source] as const,
    ["options", options] as const,
    ...STUDIO_BG3D_LINKED_RENDER_DOMAINS.map((domain) =>
      [domain, projectionByDomain.get(domain)!] as const
    ),
  ];
  const revisionSignatures = new Map<string, string>();
  for (const [name, revision] of revisions) {
    const signature = await sha256(revision.canonical);
    if (!signature) return failure("digest-unavailable", "SHA-256 digest를 사용할 수 없습니다.");
    if (revision.expectedSignature && revision.expectedSignature !== signature) {
      return failure("signature-mismatch", `${name} revision이 예상 signature와 일치하지 않습니다.`);
    }
    revisionSignatures.set(name, signature);
  }
  const pipelineSignature = await sha256(JSON.stringify(pipelineRevision));
  if (!pipelineSignature) return failure("digest-unavailable", "파이프라인 signature를 만들 수 없습니다.");

  const passPlans: StudioBg3dLinkedRenderPassPlan[] = [];
  const renderSignatureByPass = new Map<StudioBg3dLinkedRenderPass, string>();
  for (const pass of ordered.passes) {
    const dependencies: StudioBg3dLinkedRenderCachedDependency[] = [
      { key: "pipeline", signature: pipelineSignature },
      { key: "source", signature: revisionSignatures.get("source")! },
      ...DIRECT_DOMAINS[pass].map((domain) => ({
        key: domain,
        signature: revisionSignatures.get(domain)!,
      })),
      ...graph[pass].map((dependency) => ({
        key: `pass:${dependency}` as const,
        signature: renderSignatureByPass.get(dependency)!,
      })),
    ];
    const renderSignature = await sha256(JSON.stringify({
      kind: "toonspectrum.bg3d-linked-render-pass",
      version: 1,
      pass,
      dependencies,
    }));
    if (!renderSignature) return failure("digest-unavailable", `패스 '${pass}' signature를 만들 수 없습니다.`);
    renderSignatureByPass.set(pass, renderSignature);

    const previous = artifacts.get(pass);
    const dirtyReasons: StudioBg3dLinkedRenderDirtyReason[] = [];
    if (!previous) {
      dirtyReasons.push("cache-miss");
    } else {
      const previousByKey = new Map(
        previous.dependencies.map((entry) => [entry.key, entry.signature] as const),
      );
      for (const dependency of dependencies) {
        const previousSignature = previousByKey.get(dependency.key);
        if (!previousSignature) {
          dirtyReasons.push(`dependency-missing:${dependency.key}`);
        } else if (previousSignature !== dependency.signature) {
          dirtyReasons.push(dirtyReasonForKey(dependency.key));
        }
      }
      if (
        dirtyReasons.length === 0 &&
        previous.renderSignature !== renderSignature
      ) dirtyReasons.push("render-signature-mismatch");
    }
    passPlans.push(Object.freeze({
      pass,
      action: dirtyReasons.length === 0 ? "reuse" as const : "refresh" as const,
      renderSignature,
      cacheKey: `bg3d-linked/${linkId}/${pass}/${renderSignature.slice(7)}`,
      dependencies: Object.freeze(dependencies),
      dirtyReasons: Object.freeze(dirtyReasons),
    }));
  }

  const refreshPlans = passPlans.filter((pass) => pass.action === "refresh");
  if (
    refreshPlans.length > STUDIO_BG3D_LINKED_RENDER_MAX_OPERATIONS ||
    lamportBase + refreshPlans.length > Number.MAX_SAFE_INTEGER
  ) {
    return failure("operation-budget-exceeded", "링크드 렌더 operation 예산 또는 Lamport 범위를 넘었습니다.");
  }
  const operationIdByPass = new Map<StudioBg3dLinkedRenderPass, string>();
  const operations = refreshPlans.map((passPlan, index) => {
    const operationId =
      `linked-render:${linkId}:${passPlan.pass}:${passPlan.renderSignature.slice(7)}`;
    operationIdByPass.set(passPlan.pass, operationId);
    return Object.freeze({
      operationId,
      kind: "refresh-linked-3d-pass" as const,
      actorId,
      lamport: lamportBase + index + 1,
      baseRevision,
      pass: passPlan.pass,
      renderSignature: passPlan.renderSignature,
      cacheKey: passPlan.cacheKey,
      dependsOn: Object.freeze(
        graph[passPlan.pass].flatMap((dependency) => {
          const dependencyOperation = operationIdByPass.get(dependency);
          return dependencyOperation ? [dependencyOperation] : [];
        }),
      ),
    });
  });

  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      kind: "toonspectrum.bg3d-linked-render-plan" as const,
      version: 1 as const,
      linkId,
      baseRevision,
      sceneSignature: revisionSignatures.get("scene")!,
      sourceSignature: revisionSignatures.get("source")!,
      optionsSignature: revisionSignatures.get("options")!,
      pipelineSignature,
      passes: Object.freeze(passPlans),
      operations: Object.freeze(operations),
    }),
  });
}
