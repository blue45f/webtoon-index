/**
 * Creator Market 개발 시드 — 테스트 계정 생성 후 실제 API(signup→login→publish)로
 * 다양한 종류·라이선스·태그의 샘플 리소스를 게시한다.
 *
 * Usage:
 *   TEST_DATABASE_URL="postgresql://.../toonspectrum_market_test" \
 *   TOONSPECTRUM_MARKET_SEED_EMAIL="..." \
 *   TOONSPECTRUM_MARKET_SEED_PASSWORD="..." \
 *   TOONSPECTRUM_MARKET_SEED_NAME="마켓 시드" \
 *   node --import tsx scripts/seed/market-dev-seed.mts --api http://127.0.0.1:4001
 *
 * Manifest-only validation does not require account credentials:
 *   node --import tsx scripts/seed/market-dev-seed.mts --dry-run
 */
import { createHash } from "node:crypto";

import {
  CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE,
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplaceResourceManifestSchema,
  CreatorMarketplaceResourceListPageSchema,
  CreatorMarketplaceResourceRecordSchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "../../apps/web/src/shared/lib/creator-marketplace-resource-contract";
import {
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK,
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
} from "../../apps/web/src/domains/creator/bg3d/studio-bg3d-procedural-starter-pack";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
} from "../../apps/web/src/domains/creator/brush/studio-brush-library";
import {
  projectCreatorMarketplaceRecordToAssets,
  projectCreatorMarketplaceRecordToStudioPack,
} from "../../apps/web/src/domains/creator/studio-community-marketplace";
import {
  validateStudioCreatorPack,
} from "../../apps/web/src/domains/creator/studio-creator-pack-runtime";
import {
  findStudioOriginalFreeAsset,
} from "../../apps/web/src/domains/creator/studio-original-free-asset-packs";
import {
  startIsolatedMarketApi,
  stopIsolatedMarketApi,
  validateIsolatedMarketApiTarget,
} from "../isolated-market-api.mjs";

import {
  inspectOwnedMarketSeed,
  isExactLegacyMarketSeed,
  sameMarketSeedPackageVersion,
} from "./market-dev-seed-integrity";

import type {
  CreatorMarketplaceResourceEngine,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceListPage,
  CreatorMarketplaceResourceManifest,
  CreatorMarketplaceResourceRecord,
} from "../../apps/web/src/shared/lib/creator-marketplace-resource-contract";
import type { ChildProcess } from "node:child_process";

const MEDIA_TYPE_BY_KIND = {
  asset: "application/vnd.toonspectrum.asset+json",
  brush: "application/vnd.toonspectrum.brush+json",
  filter: "application/vnd.toonspectrum.filter+json",
  palette: "application/vnd.toonspectrum.palette+json",
  template: "application/vnd.toonspectrum.template+json",
  "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
  "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface SeedSpec {
  readonly packageId: string;
  readonly resourceVersion?: string;
  readonly name: string;
  readonly description: string;
  readonly kind: CreatorMarketplaceResourceKind;
  readonly tags: string[];
  readonly license: CreatorMarketplaceResourceLicense;
  readonly attributionText?: string;
  readonly containsAi?: boolean;
  readonly engines: readonly CreatorMarketplaceResourceEngine[];
  readonly entryName: string;
  readonly definition: Record<string, unknown>;
  readonly expectedStudioTarget?:
    | Readonly<{ kind: "asset"; id: string }>
    | Readonly<{ kind: "builtin-ref"; runtimeRef: string }>;
}

function requiredOriginalAsset(id: string) {
  const asset = findStudioOriginalFreeAsset(id);
  if (!asset) throw new Error(`Studio original asset is missing: ${id}`);
  return asset;
}

const CAFE_TRAY_ASSET = requiredOriginalAsset("original-cafe-tray-set");
const CITY_BICYCLE_ASSET = requiredOriginalAsset("original-city-bicycle");

const SEEDS: readonly SeedSpec[] = [
  {
    packageId: "seed/brush/ink-gpen-fine",
    resourceVersion: "2.0.0",
    name: "정석 G펜 파인 — 선화용 잉크 브러시",
    description:
      "웹툰 선화 작업에 바로 쓰는 압력 반응 G펜. 가는 복선과 굵은 주선을 하나의 필악 커브로 처리합니다.",
    kind: "brush",
    tags: ["브러시", "선화", "gpen", "ink"],
    license: "toonspectrum-standard",
    engines: ["canvas2d"],
    entryName: "정석 G펜 파인",
    definition: {
      snapshot: {
        ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
        sourcePresetId: "seed-gpen-fine",
        sourcePresetName: "정석 G펜 파인",
        brushId: "gpen",
        strokeWidth: 7,
        brushOpacity: 1,
        color: "#211a16",
        stabilizer: 5,
        stabilizerMode: "precision",
        postCorrection: 3,
        pressureCurve: 1.35,
        pressureMinSize: 0.08,
      },
    },
  },
  {
    packageId: "seed/brush/soft-water-wash",
    resourceVersion: "2.0.0",
    name: "수채 워시 소프트",
    description: "배경 하늘과 물감 번짐 표현용 수채 워시 브러시.",
    kind: "brush",
    tags: ["브러시", "watercolor", "배경"],
    license: "cc0-1.0",
    engines: ["canvas2d"],
    entryName: "수채 워시 소프트",
    definition: {
      snapshot: {
        ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
        sourcePresetId: "seed-soft-water-wash",
        sourcePresetName: "수채 워시 소프트",
        brushId: "watercolor",
        strokeWidth: 42,
        brushOpacity: 0.58,
        color: "#587f91",
        stabilizer: 2,
        pressureCurve: 0.78,
        pressureMinSize: 0.2,
      },
    },
  },
  {
    packageId: "seed/filter/webtoon-duotone-dusk",
    resourceVersion: "2.0.0",
    name: "두톤 던스크 색보정",
    description: "야간 장면의 어두운 영역은 보랏빛, 밝은 영역은 따뜻한 복숭아색으로 다시 매핑합니다.",
    kind: "filter",
    tags: ["필터", "색보정", "야간"],
    license: "cc-by-4.0",
    attributionText: "ToonSpectrum Market Seed (qa)",
    engines: ["canvas2d"],
    entryName: "두톤 던스크",
    definition: {
      engine: "duotone",
      values: {
        shadow: "#2a1f3d",
        highlight: "#ffd9b0",
      },
    },
  },
  {
    packageId: "seed/filter/poster-edges-pop",
    name: "포스터 엣지 팝",
    description: "색상 단계를 5단계로 줄이고 경계를 강조해 강한 그래픽 외곽을 만드는 필터입니다.",
    kind: "filter",
    tags: ["필터", "포스터", "윤곽선", "색면"],
    license: "toonspectrum-standard",
    engines: ["canvas2d"],
    entryName: "포스터 엣지 팝",
    definition: {
      engine: "poster-edges",
      values: { amount: 86, scale: 5, detail: 108 },
    },
  },
  {
    packageId: "seed/palette/neon-night-city",
    name: "네온 나이트 시티 8색",
    description: "사이버 도심 야경 장면의 8색 팔레트.",
    kind: "palette",
    tags: ["팔레트", "야경", "neon", "도시"],
    license: "cc0-1.0",
    engines: ["canvas2d"],
    entryName: "네온 나이트 시티",
    definition: {
      colors: [
        "#0b0e1a",
        "#141a33",
        "#23305c",
        "#3d4f8f",
        "#7a5fd0",
        "#38d6e0",
        "#ff5da2",
        "#ffe066",
      ],
    },
  },
  {
    packageId: "seed/palette/pastel-cafe-morning",
    resourceVersion: "2.0.0",
    name: "파스텔 카페 모닝 8색",
    description: "일상 힐링물의 카페 장면에 맞춘 크림·살구·장미·청회색 8색 팔레트입니다.",
    kind: "palette",
    tags: ["팔레트", "일상", "pastel"],
    license: "cc-by-nc-4.0",
    attributionText: "ToonSpectrum Market Seed (qa) — CC BY-NC",
    engines: ["canvas2d"],
    entryName: "파스텔 카페 모닝 8색",
    definition: {
      colors: [
        "#f7ede2",
        "#f0d9c0",
        "#e8b4a2",
        "#d795aa",
        "#a3b7c9",
        "#7d8ca3",
        "#5c6672",
        "#ffffff",
      ],
    },
  },
  {
    packageId: "seed/template/action-impact",
    name: "액션 임팩트 컷",
    description: "Studio 내장 ‘액션 컷’의 집중선·외침 말풍선·효과음을 불러오는 시작 템플릿입니다.",
    kind: "template",
    tags: ["템플릿", "액션", "구도"],
    license: "toonspectrum-standard",
    engines: ["canvas2d"],
    entryName: "액션 임팩트 컷",
    definition: { templateId: "action-impact" },
    expectedStudioTarget: {
      kind: "builtin-ref",
      runtimeRef: "studio-scene-template:action-impact",
    },
  },
  {
    packageId: "seed/template/confession-scene",
    name: "고백 장면",
    description: "Studio 내장 ‘고백 장면’의 포근한 프레임·대사 두 개·두근 효과음을 불러옵니다.",
    kind: "template",
    tags: ["템플릿", "대화", "로맨스"],
    license: "cc-by-4.0",
    attributionText: "ToonSpectrum Market Seed (qa)",
    engines: ["canvas2d"],
    entryName: "고백 장면",
    definition: { templateId: "confession" },
    expectedStudioTarget: {
      kind: "builtin-ref",
      runtimeRef: "studio-scene-template:confession",
    },
  },
  {
    packageId: "seed/bg3d/procedural-starter-v1",
    name: STUDIO_BG3D_PROCEDURAL_STARTER_PACK.label,
    description: STUDIO_BG3D_PROCEDURAL_STARTER_PACK.description,
    kind: "3d-preset",
    tags: ["3d프리셋", "절차형", "블록아웃", "CC0", "WebGL2", "WebGPU"],
    license: "cc0-1.0",
    engines: [...STUDIO_BG3D_PROCEDURAL_STARTER_PACK.compatibility.renderBackends],
    entryName: STUDIO_BG3D_PROCEDURAL_STARTER_PACK.label,
    definition: {
      recipeId: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
    },
    expectedStudioTarget: {
      kind: "builtin-ref",
      runtimeRef: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
    },
  },
  {
    packageId: "seed/asset/cafe-tray-set",
    name: CAFE_TRAY_ASSET.name,
    description: "Studio 내장 CC0 원본 SVG인 카페 트레이·컵·접시·디저트 구성을 현재 캔버스에 삽입합니다.",
    kind: "asset",
    tags: ["에셋", ...CAFE_TRAY_ASSET.tags].slice(0, 8),
    license: "cc0-1.0",
    engines: ["canvas2d"],
    entryName: CAFE_TRAY_ASSET.name,
    definition: {
      recipeId: CAFE_TRAY_ASSET.id,
    },
    expectedStudioTarget: { kind: "asset", id: CAFE_TRAY_ASSET.id },
  },
  {
    packageId: "seed/asset/city-bicycle",
    name: CITY_BICYCLE_ASSET.name,
    description: "Studio 내장 CC0 원본 SVG인 도시 자전거 한 점을 현재 캔버스에 삽입합니다.",
    kind: "asset",
    tags: ["에셋", ...CITY_BICYCLE_ASSET.tags].slice(0, 8),
    license: "cc0-1.0",
    engines: ["canvas2d"],
    entryName: CITY_BICYCLE_ASSET.name,
    definition: {
      recipeId: CITY_BICYCLE_ASSET.id,
    },
    expectedStudioTarget: { kind: "asset", id: CITY_BICYCLE_ASSET.id },
  },
];

function buildManifest(spec: SeedSpec): CreatorMarketplaceResourceManifest {
  const runtime = CREATOR_MARKETPLACE_RUNTIME_BY_KIND[spec.kind];
  const mode = spec.kind === "asset" || spec.kind === "3d-preset"
    ? "procedural-recipe"
    : "portable-json";
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: spec.kind,
    runtime,
    definition: spec.definition,
  };
  const canonical = canonicalizeCreatorMarketplaceJson(payload);
  const manifest = {
    schemaVersion: 1 as const,
    packageId: spec.packageId,
    name: spec.name,
    description: spec.description,
    kind: spec.kind,
    resourceVersion: spec.resourceVersion ?? "1.0.0",
    minimumStudioVersion: "1.0.0",
    tags: spec.tags,
    license: spec.license,
    attributionText: spec.attributionText ?? "",
    containsAi: spec.containsAi ?? false,
    rightsConfirmed: true as const,
    provenance: { origin: "original", authoredByPublisher: true } as const,
    compatibility: { engines: [...spec.engines] },
    entries: [
      {
        id: `${spec.kind}/${spec.packageId.split("/").pop()}`,
        kind: spec.kind,
        name: spec.entryName,
        delivery: {
          mode,
          mediaType: MEDIA_TYPE_BY_KIND[spec.kind],
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: sha256(canonical),
        },
      },
    ],
  };
  return CreatorMarketplaceResourceManifestSchema.parse(manifest);
}

function assertStudioCompatibleRecord(
  record: CreatorMarketplaceResourceRecord,
  spec: SeedSpec,
): void {
  if (record.kind !== spec.kind) {
    throw new Error(`${record.name}: expected ${spec.kind}, received ${record.kind}`);
  }
  if (
    canonicalizeCreatorMarketplaceJson(record.compatibility.engines)
    !== canonicalizeCreatorMarketplaceJson(spec.engines)
  ) {
    throw new Error(`${record.name}: Studio capability engines do not match the seed specification.`);
  }

  if (record.kind === "asset") {
    const projection = projectCreatorMarketplaceRecordToAssets(record);
    const target = spec.expectedStudioTarget;
    if (target?.kind !== "asset") {
      throw new Error(`${record.name}: expected Studio asset identity is not declared.`);
    }
    if (
      projection.assets.length !== 1
      || projection.assets[0]?.id !== target.id
      || projection.unsupportedCount !== 0
    ) {
      throw new Error(`${record.name}: ${projection.reason ?? "Studio 에셋으로 투영할 수 없습니다."}`);
    }
    return;
  }

  const projection = projectCreatorMarketplaceRecordToStudioPack(record);
  if (projection.status !== "installable") {
    throw new Error(`${record.name}: ${projection.reason}`);
  }
  const validation = validateStudioCreatorPack(projection.pack);
  if (!validation.valid) {
    throw new Error(`${record.name}: ${validation.issues.join("; ")}`);
  }
  const target = spec.expectedStudioTarget;
  if (target?.kind === "asset") {
    throw new Error(`${record.name}: asset target cannot be used by a Studio pack.`);
  }
  if (target?.kind === "builtin-ref") {
    const [entry] = projection.pack.entries;
    if (
      projection.pack.entries.length !== 1
      || entry?.delivery.mode !== "builtin-ref"
      || entry.delivery.runtimeRef !== target.runtimeRef
    ) {
      throw new Error(`${record.name}: projected Studio builtin reference does not match ${target.runtimeRef}.`);
    }
  }
}

function assertStudioCompatible(
  manifest: CreatorMarketplaceResourceManifest,
  spec: SeedSpec,
): void {
  const { rightsConfirmed: _rightsConfirmed, ...publicManifest } = manifest;
  const record = CreatorMarketplaceResourceRecordSchema.parse({
    ...publicManifest,
    id: "00000000-0000-4000-8000-000000000001",
    manifestHash: sha256(canonicalizeCreatorMarketplaceJson(manifest)),
    manifestByteSize: creatorMarketplaceJsonByteSize(manifest),
    publisher: {
      id: "market-dev-seed",
      name: "마켓 개발 시드",
      avatar: null,
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    isOwner: true,
    access: "free",
  });
  assertStudioCompatibleRecord(record, spec);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1]?.startsWith("--") ? "" : (argv[index + 1] ?? "");
    args[key] = value;
  }
  return args;
}

const CSRF_HEADERS = { "x-toonspectrum-csrf": "1" } as const;
const TERMINATION_SIGNAL_EXIT_CODE = {
  SIGINT: 130,
  SIGTERM: 143,
} as const;

let receivedTerminationSignal: keyof typeof TERMINATION_SIGNAL_EXIT_CODE | null = null;
let signalCleanupFailed = false;

interface PreparedSeed {
  readonly spec: SeedSpec;
  readonly manifest: CreatorMarketplaceResourceManifest;
  readonly manifestHash: string;
}

function prepareSeeds(): readonly PreparedSeed[] {
  const packageVersions = new Set<string>();
  const manifestHashes = new Set<string>();
  return SEEDS.map((spec) => {
    const manifest = buildManifest(spec);
    assertStudioCompatible(manifest, spec);
    const manifestHash = sha256(canonicalizeCreatorMarketplaceJson(manifest));
    const packageVersion = `${manifest.packageId}\0${manifest.resourceVersion}`;
    if (packageVersions.has(packageVersion)) {
      throw new Error(`Duplicate seed package/version: ${manifest.packageId}@${manifest.resourceVersion}`);
    }
    if (manifestHashes.has(manifestHash)) {
      throw new Error(`Duplicate seed manifest hash: ${manifestHash}`);
    }
    packageVersions.add(packageVersion);
    manifestHashes.add(manifestHash);
    return { spec, manifest, manifestHash };
  });
}

async function responseBody(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: null };
  }
}

async function listOwnedResources(
  api: string,
  cookie: string,
): Promise<CreatorMarketplaceResourceRecord[]> {
  const items: CreatorMarketplaceResourceRecord[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const url = new URL(`${api}/api/creator/marketplace/resources/mine`);
    url.searchParams.set("limit", String(CREATOR_MARKETPLACE_RESOURCE_MAX_PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { cookie } });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(`owned resource list failed (${response.status}): ${body.text.slice(0, 300)}`);
    }
    const page: CreatorMarketplaceResourceListPage =
      CreatorMarketplaceResourceListPageSchema.parse(body.json);
    for (const item of page.items) {
      if (!item.isOwner) {
        throw new Error(`/mine returned a resource without owner projection: ${item.id}`);
      }
      if (seenIds.has(item.id)) {
        throw new Error(`/mine pagination repeated resource: ${item.id}`);
      }
      seenIds.add(item.id);
      items.push(item);
    }
    if (!page.hasMore) break;
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      throw new Error("/mine pagination returned a missing or repeated continuation cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

async function removeExactLegacySeeds(
  api: string,
  cookie: string,
  owned: readonly CreatorMarketplaceResourceRecord[],
): Promise<void> {
  const legacyRecords = owned.filter(isExactLegacyMarketSeed);
  for (const record of legacyRecords) {
    const response = await fetch(
      `${api}/api/creator/marketplace/resources/${encodeURIComponent(record.id)}`,
      {
        method: "DELETE",
        headers: { Origin: api, cookie, ...CSRF_HEADERS },
      },
    );
    if (!response.ok) {
      throw new Error(
        `legacy seed cleanup failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }
    console.log(`removedLegacy: ${record.packageId}@${record.resourceVersion}`);
  }
}

function verifyExactRecord(
  record: CreatorMarketplaceResourceRecord,
  seed: PreparedSeed,
): void {
  if (!record.isOwner) throw new Error(`${seed.spec.name}: resource is not owned by the seed account.`);
  if (
    !sameMarketSeedPackageVersion(record, seed)
    || record.manifestHash !== seed.manifestHash
  ) {
    throw new Error(`${seed.spec.name}: published record identity does not match the intended manifest.`);
  }
  assertStudioCompatibleRecord(record, seed.spec);
}

function mismatchMessage(
  records: readonly CreatorMarketplaceResourceRecord[],
  seed: PreparedSeed,
): string {
  const conflicts = records.filter((record) => sameMarketSeedPackageVersion(record, seed));
  if (conflicts.length > 0) {
    return `package/version exists with a different manifest hash (expected ${seed.manifestHash}, found ${conflicts.map((record) => record.manifestHash).join(", ")})`;
  }
  return "the conflict was not backed by an exact owned package/version/hash record";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  for (const key of ["email", "password", "name"] as const) {
    if (Object.hasOwn(args, key)) {
      throw new Error(`--${key} is not accepted; seed account identity must be supplied through environment variables.`);
    }
  }
  const seeds = prepareSeeds();
  if ("dry-run" in args) {
    console.log(`validated ${seeds.length} Studio-compatible, semantically aligned market manifests`);
    return;
  }

  const email = process.env.TOONSPECTRUM_MARKET_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.TOONSPECTRUM_MARKET_SEED_PASSWORD;
  const name = process.env.TOONSPECTRUM_MARKET_SEED_NAME?.trim() || "마켓 시드";
  if (!email || !password) {
    throw new Error(
      "TOONSPECTRUM_MARKET_SEED_EMAIL and TOONSPECTRUM_MARKET_SEED_PASSWORD are required outside --dry-run.",
    );
  }

  const target = validateIsolatedMarketApiTarget({
    rawApiUrl: args.api ?? "http://127.0.0.1:4001",
    rawDatabaseUrl: process.env.TEST_DATABASE_URL,
  });
  const api = target.apiOrigin;
  let apiProcess: ChildProcess | null = null;
  let apiCleanup: Promise<void> | null = null;
  const cleanupApi = async (): Promise<void> => {
    if (!apiProcess) return;
    apiCleanup ??= stopIsolatedMarketApi(apiProcess);
    await apiCleanup;
  };
  const signalHandlers = new Map<
    keyof typeof TERMINATION_SIGNAL_EXIT_CODE,
    () => void
  >();
  for (const signal of Object.keys(
    TERMINATION_SIGNAL_EXIT_CODE,
  ) as Array<keyof typeof TERMINATION_SIGNAL_EXIT_CODE>) {
    const handler = (): void => {
      if (receivedTerminationSignal) return;
      receivedTerminationSignal = signal;
      void cleanupApi()
        .catch((error: unknown) => {
          signalCleanupFailed = true;
          const message = error instanceof Error ? error.message : "unknown API cleanup failure";
          console.error(`market-dev-seed signal cleanup failed: ${message}`);
          process.exitCode = 1;
        })
        .finally(() => {
          if (!signalCleanupFailed) {
            process.exitCode = TERMINATION_SIGNAL_EXIT_CODE[signal];
          }
        });
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    apiProcess = await startIsolatedMarketApi(target, {
      onSpawn(child: ChildProcess) {
        apiProcess = child;
        if (receivedTerminationSignal) {
          throw new Error("The marketplace seed was interrupted during API startup.");
        }
      },
    });
    if (receivedTerminationSignal) return;

    const signup = await fetch(`${api}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: api, ...CSRF_HEADERS },
      body: JSON.stringify({ email, password, name }),
    });
    if (!signup.ok && signup.status !== 409) {
      throw new Error(`signup failed (${signup.status}): ${(await signup.text()).slice(0, 300)}`);
    }

    const login = await fetch(`${api}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: api, ...CSRF_HEADERS },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) {
      throw new Error(`login failed (${login.status}): ${(await login.text()).slice(0, 300)}`);
    }
    const setCookie = login.headers.getSetCookie?.() ?? [];
    const cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
    if (!cookie) {
      throw new Error("login returned no session cookie");
    }
    const session = await fetch(`${api}/api/auth/session`, { headers: { cookie } });
    const sessionBody = await responseBody(session);
    const sessionRecord = sessionBody.json && typeof sessionBody.json === "object"
      ? sessionBody.json as { authenticated?: unknown; user?: { email?: unknown } }
      : null;
    if (
      !session.ok
      || sessionRecord?.authenticated !== true
      || sessionRecord.user?.email !== email
    ) {
      throw new Error(`authenticated session verification failed (${session.status})`);
    }
    console.log("session: authenticated seed account verified");

    let published = 0;
    let exactExisting = 0;
    let failed = 0;
    let owned = await listOwnedResources(api, cookie);
    for (const seed of seeds) {
      try {
        const beforePublish = inspectOwnedMarketSeed(owned, seed);
        if (beforePublish.status === "exact") {
          verifyExactRecord(beforePublish.record, seed);
          exactExisting += 1;
          console.log(`exactExisting: ${seed.spec.name}`);
          continue;
        }
        if (beforePublish.status === "duplicate-exact") {
          throw new Error("authenticated /mine returned duplicate exact records");
        }
        if (beforePublish.status === "mismatch") {
          throw new Error(mismatchMessage(owned, seed));
        }

        const response = await fetch(`${api}/api/creator/marketplace/resources`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: api, cookie, ...CSRF_HEADERS },
          body: JSON.stringify(seed.manifest),
        });
        if (response.ok) {
          const body = await responseBody(response);
          const record = CreatorMarketplaceResourceRecordSchema.parse(body.json);
          verifyExactRecord(record, seed);
          owned = [...owned, record];
          published += 1;
          console.log(`published: ${seed.spec.name}`);
          continue;
        }
        if (response.status === 409) {
          // A conflict can also mean the package/version or manifest hash belongs to some other
          // record. Only a complete authenticated /mine walk proving all three identity fields is
          // safe to treat as an idempotent retry.
          owned = await listOwnedResources(api, cookie);
          const afterConflict = inspectOwnedMarketSeed(owned, seed);
          if (afterConflict.status !== "exact") {
            throw new Error(`409 rejected: ${mismatchMessage(owned, seed)}`);
          }
          verifyExactRecord(afterConflict.record, seed);
          exactExisting += 1;
          console.log(`exactExisting (409 verified): ${seed.spec.name}`);
          continue;
        }
        throw new Error(`publish failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "unknown seed failure";
        console.error(`FAILED: ${seed.spec.name}: ${message}`);
      }
    }

    owned = await listOwnedResources(api, cookie);
    let verified = 0;
    let verificationFailed = 0;
    for (const seed of seeds) {
      try {
        const inspection = inspectOwnedMarketSeed(owned, seed);
        if (inspection.status !== "exact") {
          throw new Error(
            inspection.status === "duplicate-exact"
              ? `expected one exact owned record, found ${inspection.records.length}`
              : mismatchMessage(owned, seed),
          );
        }
        verifyExactRecord(inspection.record, seed);
        verified += 1;
      } catch (error) {
        verificationFailed += 1;
        const message = error instanceof Error ? error.message : "unknown verification failure";
        console.error(`POST-RUN VERIFY FAILED: ${seed.spec.name}: ${message}`);
      }
    }
    if (failed > 0 || verificationFailed > 0) {
      throw new Error(
        `market seed integrity failed: publishFailures=${failed}, verificationFailures=${verificationFailed}`,
      );
    }

    // 현재 세대 11종이 모두 인증된 뒤에만 구세대를 지운다. publish rate-limit, 네트워크
    // 오류 또는 충돌이 생겨도 기존의 완전한 QA 카탈로그를 먼저 훼손하지 않는다.
    await removeExactLegacySeeds(api, cookie, owned);
    owned = await listOwnedResources(api, cookie);
    const remainingLegacy = owned.filter(isExactLegacyMarketSeed);
    if (remainingLegacy.length > 0) {
      throw new Error(`legacy seed cleanup left ${remainingLegacy.length} exact record(s)`);
    }
    console.log(
      `done. published=${published} exactExisting=${exactExisting} verified=${verified}/${seeds.length}`,
    );
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    await cleanupApi();
    if (receivedTerminationSignal && !signalCleanupFailed) {
      process.exitCode = TERMINATION_SIGNAL_EXIT_CODE[receivedTerminationSignal];
    }
  }
}

await main().catch((error: unknown) => {
  if (receivedTerminationSignal) {
    if (signalCleanupFailed) process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : "unknown market seed failure";
  console.error(`market-dev-seed failed: ${message}`);
  process.exitCode = 1;
});
