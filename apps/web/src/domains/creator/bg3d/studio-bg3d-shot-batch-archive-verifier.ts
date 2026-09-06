import { compareStudioValidationStrings } from "../studio-validation-string-order";

import {
  STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS,
  STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES,
  isStudioBg3dShotBatchManifestContext,
  isStudioBg3dShotBatchPublicRenderPlan,
  type StudioBg3dShotBatchContactSheet,
  type StudioBg3dShotBatchImage,
  type StudioBg3dShotBatchLayeredPsd,
  type StudioBg3dShotBatchLegacyManifestContext,
  type StudioBg3dShotBatchManifestContext,
  type StudioBg3dShotBatchPublicRenderPlan,
  type StudioBg3dShotBatchSkippedArtifact,
} from "./studio-bg3d-shot-batch";
import {
  STUDIO_BG3D_SHOT_BATCH_PASSES,
  computeStudioBg3dShotBatchRenderDigest,
  type StudioBg3dShotBatchPass,
} from "./studio-bg3d-shot-batch-plan";

const ZIP_LOCAL_SIGNATURE = 0x0403_4b50;
const ZIP_CENTRAL_SIGNATURE = 0x0201_4b50;
const ZIP_EOCD_SIGNATURE = 0x0605_4b50;
const ZIP_VERSION_20 = 20;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const MAX_PATH_BYTES = 256;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES;
const CRC_YIELD_CHUNKS = 32;
const CRC_FALLBACK_CHUNK_BYTES = 1024 * 1024;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UNSAFE_PATH_CHARACTER = /[<>:"|?*\\]/u;
const UNSAFE_BIDI_CHARACTER = /[\u202a-\u202e\u2066-\u2069]/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const PRIVATE_MANIFEST_KEY_SET = new Set([
  "authUserId",
  "elementId",
  "pageId",
  "planDigest",
  "recoveryDigest",
  "scope",
  "scopeDigest",
  "sourceRevision",
  "workId",
]);

interface CentralEntry {
  readonly path: string;
  readonly pathBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc32: number;
  readonly size: number;
  readonly localOffset: number;
  readonly dataOffset: number;
}

export interface StudioBg3dShotBatchArchiveExpectedInput {
  readonly images: readonly StudioBg3dShotBatchImage[];
  readonly manifest?: StudioBg3dShotBatchManifestContext;
  readonly layeredPsds?: readonly StudioBg3dShotBatchLayeredPsd[];
  readonly contactSheets?: readonly StudioBg3dShotBatchContactSheet[];
}

export interface StudioBg3dShotBatchArchiveVerifyOptions {
  readonly signal?: AbortSignal;
  readonly expected?: StudioBg3dShotBatchArchiveExpectedInput;
}

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.length >= required.length && keys.length <= required.length + optional.length &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function equalJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function equalUnorderedJsonArrays(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  try {
    const leftValues = left.map((value) => JSON.stringify(value)).sort(compareStudioValidationStrings);
    const rightValues = right.map((value) => JSON.stringify(value)).sort(compareStudioValidationStrings);
    return leftValues.every((value, index) => value === rightValues[index]);
  } catch {
    return false;
  }
}

function abortError(): Error {
  return Object.assign(new Error("컷 배치 ZIP 검증을 취소했습니다."), { name: "AbortError" });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

async function yieldToBrowser(signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function decodeCanonicalPath(bytes: Uint8Array): string | null {
  let path: string;
  try {
    path = fatalTextDecoder.decode(bytes);
  } catch {
    return null;
  }
  if (
    path.length === 0 || path.normalize("NFKC") !== path || path.startsWith("/") ||
    path.startsWith("//") || /^[A-Za-z]:/u.test(path) || UNSAFE_PATH_CHARACTER.test(path) ||
    UNSAFE_BIDI_CHARACTER.test(path) || !sameBytes(textEncoder.encode(path), bytes)
  ) return null;
  const segments = path.split("/");
  if (segments.some((segment) =>
    segment.length === 0 || segment === "." || segment === ".." || segment.trim() !== segment ||
    /[. ]$/u.test(segment) || WINDOWS_RESERVED_NAME.test(segment) ||
    [...segment].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  )) return null;
  return path;
}

async function readBytes(blob: Blob, start: number, length: number): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 ||
    start + length > blob.size) return null;
  try {
    const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
    return bytes.byteLength === length ? bytes : null;
  } catch {
    return null;
  }
}

function crc32Update(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    next = (next >>> 8) ^ (crc32Table[(next ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return next;
}

async function verifyEntryCrc(
  blob: Blob,
  entry: CentralEntry,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  throwIfAborted(signal);
  const slice = blob.slice(entry.dataOffset, entry.dataOffset + entry.size);
  if (typeof (slice as Blob & { stream?: unknown }).stream !== "function") {
    let crc = 0xffff_ffff;
    let bytesRead = 0;
    while (bytesRead < entry.size) {
      throwIfAborted(signal);
      const length = Math.min(CRC_FALLBACK_CHUNK_BYTES, entry.size - bytesRead);
      const chunk = await readBytes(slice, bytesRead, length);
      if (!chunk) return false;
      crc = crc32Update(crc, chunk);
      bytesRead += chunk.byteLength;
      await yieldToBrowser(signal);
    }
    return bytesRead === entry.size && ((crc ^ 0xffff_ffff) >>> 0) === entry.crc32;
  }
  const reader = slice.stream().getReader();
  let crc = 0xffff_ffff;
  let bytesRead = 0;
  let chunks = 0;
  const cancel = () => { void reader.cancel(abortError()).catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      bytesRead += chunk.byteLength;
      if (!Number.isSafeInteger(bytesRead) || bytesRead > entry.size) return false;
      crc = crc32Update(crc, chunk);
      chunks += 1;
      if (chunks % CRC_YIELD_CHUNKS === 0) await yieldToBrowser(signal);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return bytesRead === entry.size && ((crc ^ 0xffff_ffff) >>> 0) === entry.crc32;
}

function containsPrivateManifestKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateManifestKey);
  if (!isRecord(value)) return false;
  return Object.keys(value).some((key) =>
    PRIVATE_MANIFEST_KEY_SET.has(key) || containsPrivateManifestKey(value[key]));
}

function validPasses(value: unknown, requireCanonicalOrder: boolean): value is StudioBg3dShotBatchPass[] {
  return Array.isArray(value) && value.length >= 1 &&
    value.length <= STUDIO_BG3D_SHOT_BATCH_PASSES.length &&
    value.every((pass) => typeof pass === "string" && STUDIO_BG3D_SHOT_BATCH_PASSES.includes(
      pass as StudioBg3dShotBatchPass,
    )) && new Set(value).size === value.length && (!requireCanonicalOrder ||
      STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) => value.includes(pass))
        .every((pass, index) => value[index] === pass));
}

async function verifyPublicRenderDigest(plan: StudioBg3dShotBatchPublicRenderPlan): Promise<boolean> {
  const digest = await computeStudioBg3dShotBatchRenderDigest({
    sourceDigest: plan.sourceDigest,
    captureOwner: {
      backend: plan.implementation.backend,
      engineId: plan.implementation.engineId,
      engineRevision: plan.implementation.engineRevision,
      implementationRevision: plan.implementation.adapterImplementationRevision,
      graphicsApi: plan.implementation.graphicsApi,
      profileId: plan.captureProfile.profileId,
      sourceWidth: plan.captureProfile.sourceWidth,
      sourceHeight: plan.captureProfile.sourceHeight,
      maxPixels: plan.captureProfile.maxPixels,
      maxEdge: plan.captureProfile.maxEdge,
      deviceProfile: plan.captureProfile.deviceProfile,
      textureScale: plan.captureProfile.textureScale,
      lodBias: plan.captureProfile.lodBias,
      ltPipelineId: plan.captureProfile.ltPipelineId,
      pngEncodingId: plan.captureProfile.pngEncodingId,
      psdEncodingId: plan.artifactProfiles.psdProfileId,
    },
    shots: plan.shots.map((shot) => ({
      shotId: shot.shotId,
      shotName: shot.shotName,
      shotIndex: shot.shotIndex,
      capture: {
        width: shot.capture.width,
        height: shot.capture.height,
        requestedHeight: shot.capture.requestedHeight,
        wasReduced: shot.capture.wasReduced,
        includeDepth: shot.capture.includeDepth,
        shadows: shot.capture.shadows,
        shadowMapSize: shot.capture.shadowMapSize,
        background: { ...shot.capture.background },
      },
      files: shot.files.map((file) => ({
        key: `${file.shotId}:${file.pass}`,
        shotId: file.shotId,
        shotName: file.shotName,
        shotIndex: file.shotIndex,
        pass: file.pass,
        path: file.path,
      })),
    })),
    passes: [...plan.passes],
    exportHeight: plan.exportHeight,
    includeLayeredPsd: plan.artifactRequests.layeredPsd,
    includeContactSheet: plan.artifactRequests.contactSheet,
  });
  return digest !== null && digest === plan.renderDigest;
}

interface ManifestArtifactSummary {
  readonly paths: Set<string>;
  readonly producedPasses: Set<StudioBg3dShotBatchPass>;
  readonly skipped: StudioBg3dShotBatchSkippedArtifact[];
}

function safeDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 8_192;
}

function summarizeArtifacts(
  artifacts: unknown,
  publicPlan?: StudioBg3dShotBatchPublicRenderPlan,
): ManifestArtifactSummary | null {
  if (!Array.isArray(artifacts) || artifacts.length > STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS) {
    return null;
  }
  const paths = new Set<string>();
  const producedPasses = new Set<StudioBg3dShotBatchPass>();
  const skipped: StudioBg3dShotBatchSkippedArtifact[] = [];
  const publicShots = new Map(publicPlan?.shots.map((shot) => [shot.shotId, shot]) ?? []);
  const accountedPasses = new Set<string>();
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) return null;
    if (artifact.status === "skipped") {
      if (!exactKeys(artifact, ["shotId", "name", "pass", "status", "reason"]) ||
        typeof artifact.shotId !== "string" || typeof artifact.name !== "string" ||
        !STUDIO_BG3D_SHOT_BATCH_PASSES.includes(artifact.pass as StudioBg3dShotBatchPass) ||
        (artifact.reason !== "disabled" && artifact.reason !== "unavailable")) return null;
      const shot = publicShots.get(artifact.shotId);
      if (publicPlan && (!shot || shot.shotName !== artifact.name ||
        !publicPlan.passes.includes(artifact.pass as StudioBg3dShotBatchPass))) return null;
      const key = `${artifact.shotId}:${String(artifact.pass)}`;
      if (accountedPasses.has(key)) return null;
      accountedPasses.add(key);
      skipped.push({
        shotId: artifact.shotId,
        shotName: artifact.name,
        pass: artifact.pass as StudioBg3dShotBatchPass,
        reason: artifact.reason,
      });
      continue;
    }
    if (artifact.status !== "completed" || typeof artifact.path !== "string" || paths.has(artifact.path)) {
      return null;
    }
    paths.add(artifact.path);
    if (artifact.kind === "layered-psd") {
      if (!exactKeys(artifact, [
        "shotId", "name", "kind", "path", "width", "height", "status", "encoding",
      ]) || artifact.encoding !== "psd-v1-rle-rgba8" ||
        typeof artifact.shotId !== "string" || typeof artifact.name !== "string" ||
        !safeDimension(artifact.width) || !safeDimension(artifact.height)) return null;
      const shot = publicShots.get(artifact.shotId);
      if (publicPlan && (!publicPlan.artifactRequests.layeredPsd || !shot ||
        shot.shotName !== artifact.name || shot.capture.width !== artifact.width ||
        shot.capture.height !== artifact.height ||
        artifact.path !== `shots/${String(shot.shotIndex).padStart(3, "0")}/layers.psd`)) return null;
      continue;
    }
    if (artifact.kind === "contact-sheet") {
      if (!exactKeys(artifact, [
        "kind", "path", "sheetNumber", "width", "height", "shotIds", "status", "encoding",
      ]) || artifact.encoding !== "srgb-opaque-rgb8" ||
        !Number.isSafeInteger(artifact.sheetNumber) || (artifact.sheetNumber as number) < 1 ||
        !safeDimension(artifact.width) || !safeDimension(artifact.height) ||
        !Array.isArray(artifact.shotIds) || artifact.shotIds.length < 1 ||
        artifact.shotIds.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)) ||
        new Set(artifact.shotIds).size !== artifact.shotIds.length) return null;
      if (publicPlan && (!publicPlan.artifactRequests.contactSheet ||
        artifact.shotIds.some((id) => !publicShots.has(id)))) return null;
      continue;
    }
    if (!exactKeys(artifact, [
      "shotId", "name", "path", "width", "height", "pass", "status", "encoding",
    ], ["requestedHeight", "wasReduced", "nearIs", "farIs"]) ||
      typeof artifact.shotId !== "string" || typeof artifact.name !== "string" ||
      !safeDimension(artifact.width) || !safeDimension(artifact.height) ||
      !STUDIO_BG3D_SHOT_BATCH_PASSES.includes(artifact.pass as StudioBg3dShotBatchPass)) return null;
    const pass = artifact.pass as StudioBg3dShotBatchPass;
    producedPasses.add(pass);
    if (artifact.encoding !== (pass === "depth"
      ? "normalized-device-depth-u8"
      : "srgb-straight-alpha-rgba8")) return null;
    if ((pass === "depth") !== (artifact.nearIs === "black" && artifact.farIs === "white")) return null;
    if ((artifact.requestedHeight === undefined) !== (artifact.wasReduced === undefined) ||
      (artifact.requestedHeight !== undefined && (
        !Number.isSafeInteger(artifact.requestedHeight) || typeof artifact.wasReduced !== "boolean"
      ))) return null;
    const key = `${artifact.shotId}:${pass}`;
    if (accountedPasses.has(key)) return null;
    accountedPasses.add(key);
    const shot = publicShots.get(artifact.shotId);
    const plannedFile = shot?.files.find((file) => file.pass === pass);
    if (publicPlan && (!shot || !plannedFile || shot.shotName !== artifact.name ||
      plannedFile.path !== artifact.path || shot.capture.width !== artifact.width ||
      shot.capture.height !== artifact.height || shot.capture.requestedHeight !== artifact.requestedHeight ||
      shot.capture.wasReduced !== artifact.wasReduced)) return null;
  }
  if (publicPlan) {
    for (const shot of publicPlan.shots) {
      for (const pass of publicPlan.passes) {
        if (!accountedPasses.has(`${shot.shotId}:${pass}`)) return null;
      }
    }
  }
  return { paths, producedPasses, skipped };
}

function matchesProducedPasses(
  declared: readonly StudioBg3dShotBatchPass[],
  produced: ReadonlySet<StudioBg3dShotBatchPass>,
): boolean {
  const canonical = STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) => produced.has(pass));
  return canonical.length === declared.length && canonical.every((pass, index) => declared[index] === pass);
}

function exactPathInventory(paths: Set<string>, entries: readonly CentralEntry[]): boolean {
  const archivePaths = new Set(entries.slice(1).map((entry) => entry.path));
  return paths.size === archivePaths.size && [...paths].every((path) => archivePaths.has(path));
}

function expectedPathInventory(expected: StudioBg3dShotBatchArchiveExpectedInput): Set<string> | null {
  const layeredPsds = expected.layeredPsds ?? [];
  const contactSheets = expected.contactSheets ?? [];
  const manifest = expected.manifest;
  const publicPlan = manifest && "publicRenderPlan" in manifest ? manifest.publicRenderPlan : undefined;
  const legacyManifest = publicPlan ? undefined : manifest;
  const initialShots = publicPlan
    ? publicPlan.shots.map((shot) => ({ id: shot.shotId, index: shot.shotIndex }))
    : legacyManifest?.shots?.map((shot, index) => ({ id: shot.id, index: index + 1 })) ?? [];
  const shotIndexes = new Map(initialShots.map((shot) => [shot.id, shot.index]));
  for (const artifact of [...expected.images, ...layeredPsds]) {
    if (!shotIndexes.has(artifact.shotId)) shotIndexes.set(artifact.shotId, shotIndexes.size + 1);
  }
  const legacyV1 = !publicPlan && layeredPsds.length === 0 && contactSheets.length === 0 &&
    expected.images.every((image) => image.pass === undefined) &&
    expected.images.length === shotIndexes.size && manifest === undefined;
  const paths = new Set<string>();
  for (const [index, image] of expected.images.entries()) {
    const shotIndex = shotIndexes.get(image.shotId);
    if (!shotIndex) return null;
    const pass = image.pass ?? image.output ?? "beauty";
    const path = legacyV1
      ? `shots/${String(index + 1).padStart(3, "0")}.png`
      : `shots/${String(shotIndex).padStart(3, "0")}/${pass}.png`;
    if (paths.has(path)) return null;
    paths.add(path);
  }
  for (const artifact of layeredPsds) {
    const shotIndex = shotIndexes.get(artifact.shotId);
    if (!shotIndex) return null;
    const path = `shots/${String(shotIndex).padStart(3, "0")}/layers.psd`;
    if (paths.has(path)) return null;
    paths.add(path);
  }
  for (const artifact of contactSheets) {
    const path = `contact/${artifact.fileName}`;
    if (paths.has(path)) return null;
    paths.add(path);
  }
  return paths;
}

async function validateManifest(
  bytes: Uint8Array,
  entries: readonly CentralEntry[],
  expected: StudioBg3dShotBatchArchiveExpectedInput | undefined,
): Promise<boolean> {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_MANIFEST_BYTES) return false;
  let text: string;
  let value: unknown;
  try {
    text = fatalTextDecoder.decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(value) || JSON.stringify(value, null, 2) !== text || containsPrivateManifestKey(value) ||
    value.kind !== "toonspectrum-bg3d-shot-batch") return false;

  let paths: Set<string>;
  if (value.version === 1) {
    if (!exactKeys(value, ["kind", "version", "files"]) || !Array.isArray(value.files) ||
      value.files.length < 1 || value.files.length > STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS) return false;
    paths = new Set<string>();
    for (const file of value.files) {
      if (!exactKeys(file, ["shotId", "name", "path", "width", "height", "output"]) ||
        typeof file.shotId !== "string" || !ID_PATTERN.test(file.shotId) ||
        typeof file.name !== "string" || typeof file.path !== "string" ||
        !safeDimension(file.width) || !safeDimension(file.height) ||
        (file.output !== "beauty" && file.output !== "lt-composite") || paths.has(file.path)) return false;
      paths.add(file.path);
    }
    if (expected?.manifest !== undefined) return false;
  } else if (value.version === 2) {
    if (!exactKeys(value, [
      "kind", "version", "requestedPasses", "resolution", "producedPasses", "shots", "artifacts",
      "layeredPsdRequested", "psdFallbacks", "contactSheetRequested", "contactSheetFallback",
    ], ["resumeKey"]) || !validPasses(value.requestedPasses, false) ||
      !validPasses(value.producedPasses, true) || !Array.isArray(value.shots) ||
      !Array.isArray(value.psdFallbacks) || typeof value.layeredPsdRequested !== "boolean" ||
      typeof value.contactSheetRequested !== "boolean") return false;
    const summary = summarizeArtifacts(value.artifacts);
    if (!summary || !matchesProducedPasses(value.producedPasses, summary.producedPasses)) return false;
    const shots = value.shots.map((shot) => {
      if (!exactKeys(shot, ["id", "name", "index"]) || typeof shot.id !== "string" ||
        typeof shot.name !== "string" || !Number.isSafeInteger(shot.index)) return null;
      return { id: shot.id, name: shot.name };
    });
    if (shots.some((shot) => shot === null)) return false;
    const context: StudioBg3dShotBatchManifestContext = {
      ...(typeof value.resumeKey === "string" ? { resumeKey: value.resumeKey } : {}),
      shots: shots as Array<{ id: string; name: string }>,
      requestedPasses: value.requestedPasses,
      resolution: value.resolution as StudioBg3dShotBatchLegacyManifestContext["resolution"],
      skippedArtifacts: summary.skipped,
      psdFallbacks: value.psdFallbacks as never,
      layeredPsdRequested: value.layeredPsdRequested,
      contactSheetRequested: value.contactSheetRequested,
      ...(value.contactSheetFallback === null ? {} : { contactSheetFallback: value.contactSheetFallback as never }),
    } as StudioBg3dShotBatchManifestContext;
    if (!isStudioBg3dShotBatchManifestContext(context)) return false;
    if (expected?.manifest) {
      if ("publicRenderPlan" in expected.manifest) return false;
      const expectedManifest = expected.manifest;
      if ((expectedManifest.resumeKey ?? null) !== (value.resumeKey ?? null) ||
        (expectedManifest.requestedPasses !== undefined &&
          !equalJson(expectedManifest.requestedPasses, value.requestedPasses)) ||
        (expectedManifest.resolution !== undefined &&
          !equalJson(expectedManifest.resolution, value.resolution)) ||
        (expectedManifest.shots !== undefined && !equalJson(
          expectedManifest.shots,
          shots,
        )) ||
        (expectedManifest.layeredPsdRequested !== undefined &&
          expectedManifest.layeredPsdRequested !== value.layeredPsdRequested) ||
        (expectedManifest.contactSheetRequested !== undefined &&
          expectedManifest.contactSheetRequested !== value.contactSheetRequested) ||
        !equalUnorderedJsonArrays(expectedManifest.skippedArtifacts ?? [], summary.skipped) ||
        !equalUnorderedJsonArrays(expectedManifest.psdFallbacks ?? [], value.psdFallbacks) ||
        (expectedManifest.contactSheetFallback ?? null) !== value.contactSheetFallback) return false;
    }
    paths = summary.paths;
  } else if (value.version === 3) {
    if (!exactKeys(value, [
      "kind", "version", "publicRenderPlan", "producedPasses", "artifacts", "psdFallbacks",
      "contactSheetFallback",
    ]) || !isStudioBg3dShotBatchPublicRenderPlan(value.publicRenderPlan) ||
      !validPasses(value.producedPasses, true) || !Array.isArray(value.psdFallbacks)) return false;
    const publicPlan = value.publicRenderPlan;
    if (!await verifyPublicRenderDigest(publicPlan)) return false;
    const summary = summarizeArtifacts(value.artifacts, publicPlan);
    if (!summary || !matchesProducedPasses(value.producedPasses, summary.producedPasses)) return false;
    const context: StudioBg3dShotBatchManifestContext = {
      publicRenderPlan: publicPlan,
      skippedArtifacts: summary.skipped,
      psdFallbacks: value.psdFallbacks as never,
      ...(value.contactSheetFallback === null
        ? {}
        : { contactSheetFallback: value.contactSheetFallback as never }),
    };
    if (!isStudioBg3dShotBatchManifestContext(context)) return false;
    if (expected?.manifest && (!("publicRenderPlan" in expected.manifest) ||
      !equalJson(expected.manifest.publicRenderPlan, publicPlan) ||
      !equalUnorderedJsonArrays(expected.manifest.skippedArtifacts ?? [], summary.skipped) ||
      !equalUnorderedJsonArrays(expected.manifest.psdFallbacks ?? [], value.psdFallbacks) ||
      (expected.manifest.contactSheetFallback ?? null) !== value.contactSheetFallback)) return false;
    paths = summary.paths;
  } else {
    return false;
  }
  if (!exactPathInventory(paths, entries)) return false;
  if (expected) {
    const expectedPaths = expectedPathInventory(expected);
    if (!expectedPaths || expectedPaths.size !== paths.size ||
      [...expectedPaths].some((path) => !paths.has(path))) return false;
  }
  return true;
}

async function parseArchiveEntries(blob: Blob, signal: AbortSignal | undefined): Promise<CentralEntry[] | null> {
  if (!(blob instanceof Blob) || blob.type !== "application/zip" || blob.size < EOCD_BYTES ||
    blob.size > 400 * 1024 * 1024) return null;
  throwIfAborted(signal);
  const eocdBytes = await readBytes(blob, blob.size - EOCD_BYTES, EOCD_BYTES);
  if (!eocdBytes) return null;
  const eocd = new DataView(eocdBytes.buffer, eocdBytes.byteOffset, eocdBytes.byteLength);
  const entryCount = uint16(eocd, 10);
  const centralBytes = uint32(eocd, 12);
  const centralOffset = uint32(eocd, 16);
  if (uint32(eocd, 0) !== ZIP_EOCD_SIGNATURE || uint16(eocd, 4) !== 0 || uint16(eocd, 6) !== 0 ||
    uint16(eocd, 8) !== entryCount || entryCount < 2 ||
    entryCount > STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS + 1 || uint16(eocd, 20) !== 0 ||
    centralBytes < entryCount * (CENTRAL_HEADER_BYTES + 1) ||
    centralBytes > entryCount * (CENTRAL_HEADER_BYTES + MAX_PATH_BYTES) ||
    centralOffset + centralBytes !== blob.size - EOCD_BYTES) return null;
  const centralData = await readBytes(blob, centralOffset, centralBytes);
  if (!centralData) return null;
  const central = new DataView(centralData.buffer, centralData.byteOffset, centralData.byteLength);
  const entries: CentralEntry[] = [];
  const seenPaths = new Set<string>();
  let cursor = 0;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > centralData.byteLength ||
      uint32(central, cursor) !== ZIP_CENTRAL_SIGNATURE) return null;
    const flags = uint16(central, cursor + 8);
    const method = uint16(central, cursor + 10);
    const time = uint16(central, cursor + 12);
    const date = uint16(central, cursor + 14);
    const crc32 = uint32(central, cursor + 16);
    const compressedSize = uint32(central, cursor + 20);
    const size = uint32(central, cursor + 24);
    const pathLength = uint16(central, cursor + 28);
    const extraLength = uint16(central, cursor + 30);
    const commentLength = uint16(central, cursor + 32);
    const recordBytes = CENTRAL_HEADER_BYTES + pathLength + extraLength + commentLength;
    if (uint16(central, cursor + 4) !== ZIP_VERSION_20 ||
      uint16(central, cursor + 6) !== ZIP_VERSION_20 || flags !== ZIP_UTF8_FLAG ||
      method !== ZIP_STORE_METHOD || compressedSize !== size || pathLength < 1 ||
      pathLength > MAX_PATH_BYTES || extraLength !== 0 || commentLength !== 0 ||
      uint16(central, cursor + 34) !== 0 || uint16(central, cursor + 36) !== 0 ||
      uint32(central, cursor + 38) !== 0 || cursor + recordBytes > centralData.byteLength) return null;
    const pathBytes = centralData.slice(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + pathLength);
    const path = decodeCanonicalPath(pathBytes);
    const comparisonKey = path?.toLowerCase();
    if (!path || !comparisonKey || seenPaths.has(comparisonKey)) return null;
    seenPaths.add(comparisonKey);
    totalSize += size;
    if (!Number.isSafeInteger(totalSize) || totalSize > MAX_UNCOMPRESSED_BYTES) return null;
    entries.push({
      path,
      pathBytes,
      flags,
      method,
      time,
      date,
      crc32,
      size,
      localOffset: uint32(central, cursor + 42),
      dataOffset: 0,
    });
    cursor += recordBytes;
  }
  if (cursor !== centralData.byteLength || entries[0]?.path !== "manifest.json") return null;

  const hydrated: CentralEntry[] = [];
  let expectedLocalOffset = 0;
  for (const entry of entries) {
    throwIfAborted(signal);
    if (entry.localOffset !== expectedLocalOffset || entry.localOffset + LOCAL_HEADER_BYTES > centralOffset) {
      return null;
    }
    const localBytes = await readBytes(blob, entry.localOffset, LOCAL_HEADER_BYTES + entry.pathBytes.byteLength);
    if (!localBytes) return null;
    const local = new DataView(localBytes.buffer, localBytes.byteOffset, localBytes.byteLength);
    if (uint32(local, 0) !== ZIP_LOCAL_SIGNATURE || uint16(local, 4) !== ZIP_VERSION_20 ||
      uint16(local, 6) !== entry.flags || uint16(local, 8) !== entry.method ||
      uint16(local, 10) !== entry.time || uint16(local, 12) !== entry.date ||
      uint32(local, 14) !== entry.crc32 || uint32(local, 18) !== entry.size ||
      uint32(local, 22) !== entry.size || uint16(local, 26) !== entry.pathBytes.byteLength ||
      uint16(local, 28) !== 0 || !sameBytes(localBytes.slice(LOCAL_HEADER_BYTES), entry.pathBytes)) return null;
    const dataOffset = entry.localOffset + LOCAL_HEADER_BYTES + entry.pathBytes.byteLength;
    expectedLocalOffset = dataOffset + entry.size;
    if (!Number.isSafeInteger(expectedLocalOffset) || expectedLocalOffset > centralOffset) return null;
    const hydratedEntry = { ...entry, dataOffset };
    if (!await verifyEntryCrc(blob, hydratedEntry, signal)) return null;
    hydrated.push(hydratedEntry);
  }
  return expectedLocalOffset === centralOffset ? hydrated : null;
}

/**
 * Verifies the exact bounded ZIP32 subset emitted by Studio without ever materializing the whole
 * archive. Central metadata is bounded, while file data is CRC-checked one Blob stream at a time.
 */
export async function verifyStudioBg3dShotBatchArchiveBlob(
  archive: Blob,
  options: StudioBg3dShotBatchArchiveVerifyOptions = {},
): Promise<boolean> {
  try {
    const entries = await parseArchiveEntries(archive, options.signal);
    if (!entries) return false;
    const manifestEntry = entries[0];
    if (!manifestEntry || manifestEntry.size > MAX_MANIFEST_BYTES) return false;
    throwIfAborted(options.signal);
    const manifestBytes = await readBytes(archive, manifestEntry.dataOffset, manifestEntry.size);
    if (!manifestBytes) return false;
    return await validateManifest(manifestBytes, entries, options.expected);
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    return false;
  }
}
