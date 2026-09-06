export type StudioVrmBlenderPackageFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

export type StudioVrmBlenderCharacterPackage = Readonly<{
  schemaVersion: 1;
  kind: "toonstudio.character-package";
  characterId: string;
  displayName: string;
  configDigest: string;
  pipelineVersion: 1;
  capabilities: Readonly<{
    authoredHair: Readonly<{
      enabled: boolean;
      style: string | null;
      lodTriangles: readonly number[];
      replacedSourceMeshes: readonly string[];
    }>;
    semanticFaceShapes: Readonly<{
      mode: string;
      confidence: number;
      objects: readonly string[];
      shapeKeys: readonly string[];
    }>;
    mtoonReady: boolean;
    vrmCustomExpressions: Readonly<{
      status: string;
      names: readonly string[];
    }>;
    lods: boolean;
  }>;
  quality: Readonly<{
    score: number;
    passed: boolean;
    minimumScore: number;
    report: string;
  }>;
  files: Readonly<Record<string, StudioVrmBlenderPackageFile>>;
  provenance: Readonly<Record<string, string>>;
}>;

export type StudioVrmBlenderRuntimeAsset = Readonly<{
  role: "vrm" | "glb";
  file: StudioVrmBlenderPackageFile;
}>;

const HEX_64 = /^[0-9a-f]{64}$/u;
const CHARACTER_ID = /^[a-z0-9][a-z0-9._-]{1,62}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string up to ${maximum} characters`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number >= ${minimum}`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return Object.freeze([...value]);
}

function numberArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0)) {
    throw new Error(`${label} must be an array of non-negative finite numbers`);
  }
  return Object.freeze([...value]);
}

function safeRelativePath(value: unknown, label: string): string {
  const path = text(value, label, 300).replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-z]:\//iu.test(path)) {
    throw new Error(`${label} must be relative`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return path;
}

function parseFile(value: unknown, label: string): StudioVrmBlenderPackageFile {
  const source = record(value, label);
  const sha256 = text(source.sha256, `${label}.sha256`, 64).toLowerCase();
  if (!HEX_64.test(sha256)) throw new Error(`${label}.sha256 must be lowercase SHA-256`);
  return Object.freeze({
    path: safeRelativePath(source.path, `${label}.path`),
    bytes: (() => {
      const bytes = finiteNumber(source.bytes, `${label}.bytes`, 1);
      if (!Number.isSafeInteger(bytes)) throw new Error(`${label}.bytes must be a positive safe integer`);
      return bytes;
    })(),
    sha256,
  });
}

export function parseStudioVrmBlenderCharacterPackage(
  value: unknown,
): StudioVrmBlenderCharacterPackage {
  const source = record(value, "package");
  if (source.schemaVersion !== 1) throw new Error("package.schemaVersion must be 1");
  if (source.kind !== "toonstudio.character-package") {
    throw new Error("package.kind is unsupported");
  }
  const characterId = text(source.characterId, "package.characterId", 63);
  if (!CHARACTER_ID.test(characterId)) throw new Error("package.characterId is invalid");
  const capabilitiesSource = record(source.capabilities, "package.capabilities");
  const hairSource = record(capabilitiesSource.authoredHair, "package.capabilities.authoredHair");
  const faceSource = record(capabilitiesSource.semanticFaceShapes, "package.capabilities.semanticFaceShapes");
  const qualitySource = record(source.quality, "package.quality");
  const vrmCustomSource = record(
    capabilitiesSource.vrmCustomExpressions ?? { status: "unavailable", names: [] },
    "package.capabilities.vrmCustomExpressions",
  );
  const filesSource = record(source.files, "package.files");
  const files = Object.fromEntries(
    Object.entries(filesSource).map(([role, file]) => [role, parseFile(file, `package.files.${role}`)]),
  );
  if (!files.vrm && !files.glb) {
    throw new Error("package.files must contain a VRM or GLB runtime asset");
  }
  const provenance = Object.freeze(Object.fromEntries(
    Object.entries(record(source.provenance ?? {}, "package.provenance")).map(([key, entry]) => [
      text(key, "package.provenance key", 80),
      text(entry, `package.provenance.${key}`),
    ]),
  ));
  const configDigest = text(source.configDigest, "package.configDigest", 64).toLowerCase();
  if (!HEX_64.test(configDigest)) throw new Error("package.configDigest must be lowercase SHA-256");
  const score = finiteNumber(qualitySource.score, "package.quality.score");
  const minimumScore = finiteNumber(qualitySource.minimumScore, "package.quality.minimumScore");
  if (score > 100 || minimumScore > 100) throw new Error("package quality scores must be <= 100");
  return Object.freeze({
    schemaVersion: 1,
    kind: "toonstudio.character-package",
    characterId,
    displayName: text(source.displayName, "package.displayName", 100),
    configDigest,
    pipelineVersion: source.pipelineVersion === 1 ? 1 : (() => { throw new Error("package.pipelineVersion must be 1"); })(),
    capabilities: Object.freeze({
      authoredHair: Object.freeze({
        enabled: boolean(hairSource.enabled, "package.capabilities.authoredHair.enabled"),
        style: hairSource.style === null ? null : text(hairSource.style, "package.capabilities.authoredHair.style", 80),
        lodTriangles: numberArray(hairSource.lodTriangles, "package.capabilities.authoredHair.lodTriangles"),
        replacedSourceMeshes: stringArray(hairSource.replacedSourceMeshes, "package.capabilities.authoredHair.replacedSourceMeshes"),
      }),
      semanticFaceShapes: Object.freeze({
        mode: text(faceSource.mode, "package.capabilities.semanticFaceShapes.mode", 80),
        confidence: finiteNumber(faceSource.confidence, "package.capabilities.semanticFaceShapes.confidence"),
        objects: stringArray(faceSource.objects, "package.capabilities.semanticFaceShapes.objects"),
        shapeKeys: stringArray(faceSource.shapeKeys, "package.capabilities.semanticFaceShapes.shapeKeys"),
      }),
      mtoonReady: boolean(capabilitiesSource.mtoonReady, "package.capabilities.mtoonReady"),
      vrmCustomExpressions: Object.freeze({
        status: text(vrmCustomSource.status, "package.capabilities.vrmCustomExpressions.status", 80),
        names: stringArray(vrmCustomSource.names, "package.capabilities.vrmCustomExpressions.names"),
      }),
      lods: boolean(capabilitiesSource.lods, "package.capabilities.lods"),
    }),
    quality: Object.freeze({
      score,
      passed: boolean(qualitySource.passed, "package.quality.passed"),
      minimumScore,
      report: safeRelativePath(qualitySource.report, "package.quality.report"),
    }),
    files: Object.freeze(files),
    provenance,
  });
}

export function selectStudioVrmBlenderRuntimeAsset(
  packageValue: StudioVrmBlenderCharacterPackage,
  options: Readonly<{ requirePassed?: boolean; prefer?: "vrm" | "glb" }> = {},
): StudioVrmBlenderRuntimeAsset {
  if (options.requirePassed !== false && !packageValue.quality.passed) {
    throw new Error(`character package ${packageValue.characterId} did not pass its quality gate`);
  }
  const order = options.prefer === "glb" ? (["glb", "vrm"] as const) : (["vrm", "glb"] as const);
  for (const role of order) {
    const file = packageValue.files[role];
    if (file) return Object.freeze({ role, file });
  }
  throw new Error("character package has no runtime asset");
}
