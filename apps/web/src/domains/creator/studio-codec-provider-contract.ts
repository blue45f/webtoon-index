import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_CODEC_PROVIDER_CONTRACT_VERSION = 1 as const;

export const STUDIO_CODEC_PROVIDER_LIMITS = Object.freeze({
  maxProviders: 32,
  maxIdentifierCodeUnits: 128,
  maxMimeTypes: 16,
  maxExtensions: 16,
  maxLicenseScopes: 16,
  maxInputBytes: 1024 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024 * 1024,
} as const);

export type StudioCodecProviderMode =
  | "browser-runtime"
  | "licensed-sdk"
  | "public-clean-room"
  | "remote-provider";

export type StudioCodecDirection = "decode" | "encode";

export type StudioCodecLicenseScope =
  | StudioCodecDirection
  | StudioCodecProviderMode
  | "commercial-use";

export interface StudioCodecLicenseGrant {
  readonly id: string;
  readonly scope: readonly StudioCodecLicenseScope[];
  readonly expiresAt: string | null;
}

export interface StudioCodecOfficialClaimPolicy {
  readonly requiresVerifiedExternalAttestation: true;
  readonly maySelfAssertCertification: false;
  readonly maySelfAssertTrademark: false;
}

export interface StudioCodecProviderManifest {
  readonly schemaVersion: typeof STUDIO_CODEC_PROVIDER_CONTRACT_VERSION;
  readonly providerId: string;
  readonly mode: StudioCodecProviderMode;
  readonly format: string;
  readonly profile: string;
  readonly version: string;
  readonly encode: boolean;
  readonly decode: boolean;
  readonly mimeTypes: readonly string[];
  readonly extensions: readonly string[];
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly deterministic: boolean;
  readonly licenseGrant: StudioCodecLicenseGrant;
  readonly officialClaimPolicy: StudioCodecOfficialClaimPolicy;
}

export interface StudioCodecExecutionRequest {
  readonly schemaVersion: typeof STUDIO_CODEC_PROVIDER_CONTRACT_VERSION;
  readonly direction: StudioCodecDirection;
  readonly format: string;
  readonly profile: string;
  readonly version: string;
  readonly mimeType: string;
  readonly extension: string;
  /** Preference order. A provider mode not listed here cannot be selected. */
  readonly allowedModes: readonly StudioCodecProviderMode[];
  readonly requireDeterministic: boolean;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface StudioCodecProviderExecution {
  readonly request: StudioCodecExecutionRequest;
  /**
   * A provider-owned working copy. The boundary rejects the result if the provider mutates it.
   * Providers that need mutable scratch storage must allocate their own buffer.
   */
  readonly inputBytes: Uint8Array;
  readonly inputSha256: `sha256:${string}`;
}

export interface StudioCodecProviderRawResult {
  readonly schemaVersion: typeof STUDIO_CODEC_PROVIDER_CONTRACT_VERSION;
  readonly providerId: string;
  readonly direction: StudioCodecDirection;
  readonly format: string;
  readonly profile: string;
  readonly version: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly inputSha256: `sha256:${string}`;
  readonly outputSha256: `sha256:${string}`;
  readonly bytes: Uint8Array;
}

export interface StudioCodecProvider {
  readonly manifest: StudioCodecProviderManifest;
  readonly execute: (
    execution: StudioCodecProviderExecution
  ) => unknown | Promise<unknown>;
}

export interface StudioCodecExecutionReceipt {
  readonly schemaVersion: typeof STUDIO_CODEC_PROVIDER_CONTRACT_VERSION;
  readonly kind: "toonspectrum-codec-provider-execution";
  readonly providerId: string;
  readonly mode: StudioCodecProviderMode;
  readonly direction: StudioCodecDirection;
  readonly format: string;
  readonly profile: string;
  readonly version: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly deterministic: boolean;
  readonly input: {
    readonly byteLength: number;
    readonly sha256: `sha256:${string}`;
  };
  readonly output: {
    readonly byteLength: number;
    readonly sha256: `sha256:${string}`;
  };
  readonly licenseGrant: StudioCodecLicenseGrant;
  readonly officialClaims: {
    readonly externalAttestationAccepted: false;
    readonly officialCodec: false;
    readonly certified: false;
    readonly trademarkAuthorized: false;
  };
}

export type StudioCodecProviderFailureCode =
  | "ambiguous-provider"
  | "input-budget-exceeded"
  | "input-mutated"
  | "invalid-manifest"
  | "invalid-provider"
  | "invalid-registry"
  | "invalid-request"
  | "license-expired"
  | "no-provider"
  | "output-budget-exceeded"
  | "provider-result-invalid"
  | "provider-runtime-error"
  | "receipt-mismatch";

export type StudioCodecProviderFailureStage =
  | "execution"
  | "input"
  | "negotiation"
  | "output"
  | "registry";

export interface StudioCodecProviderFailure {
  readonly ok: false;
  readonly code: StudioCodecProviderFailureCode;
  readonly stage: StudioCodecProviderFailureStage;
  readonly providerId: string | null;
  /** Stable product-owned text. Provider-thrown messages are never exposed. */
  readonly message: string;
}

export interface StudioCodecProviderNegotiationSuccess {
  readonly ok: true;
  readonly provider: StudioCodecProvider;
  readonly manifest: StudioCodecProviderManifest;
}

export type StudioCodecProviderNegotiationResult =
  | StudioCodecProviderFailure
  | StudioCodecProviderNegotiationSuccess;

export type StudioCodecProviderExecutionResult =
  | StudioCodecProviderFailure
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      receipt: StudioCodecExecutionReceipt;
    }>;

/**
 * Product core intentionally trusts no codec implementation by default. Deployments and callers
 * must supply every provider explicitly after their own distribution and procurement review.
 */
export const STUDIO_CODEC_DEFAULT_PROVIDERS:
  readonly StudioCodecProvider[] = Object.freeze([]);

export const STUDIO_CODEC_OFFICIAL_CLAIM_BOUNDARY = Object.freeze({
  codecExecutionReceiptIsCertification: false,
  codecExecutionReceiptIsTrademarkAuthorization: false,
  externalAttestationVerificationOwnedByThisModule: false,
  officialClaimsWithoutVerifiedExternalAttestation: false,
} as const);

const MODES = Object.freeze([
  "public-clean-room",
  "browser-runtime",
  "licensed-sdk",
  "remote-provider",
] as const satisfies readonly StudioCodecProviderMode[]);
const MODE_SET = new Set<StudioCodecProviderMode>(MODES);
const DIRECTIONS = new Set<StudioCodecDirection>(["decode", "encode"]);
const LICENSE_SCOPES = new Set<StudioCodecLicenseScope>([
  "browser-runtime",
  "commercial-use",
  "decode",
  "encode",
  "licensed-sdk",
  "public-clean-room",
  "remote-provider",
]);
const MANIFEST_KEYS = [
  "schemaVersion",
  "providerId",
  "mode",
  "format",
  "profile",
  "version",
  "encode",
  "decode",
  "mimeTypes",
  "extensions",
  "maxInputBytes",
  "maxOutputBytes",
  "deterministic",
  "licenseGrant",
  "officialClaimPolicy",
] as const;
const LICENSE_GRANT_KEYS = ["id", "scope", "expiresAt"] as const;
const OFFICIAL_POLICY_KEYS = [
  "requiresVerifiedExternalAttestation",
  "maySelfAssertCertification",
  "maySelfAssertTrademark",
] as const;
const REQUEST_KEYS = [
  "schemaVersion",
  "direction",
  "format",
  "profile",
  "version",
  "mimeType",
  "extension",
  "allowedModes",
  "requireDeterministic",
  "maxInputBytes",
  "maxOutputBytes",
] as const;
const PROVIDER_KEYS = ["manifest", "execute"] as const;
const RAW_RESULT_KEYS = [
  "schemaVersion",
  "providerId",
  "direction",
  "format",
  "profile",
  "version",
  "mimeType",
  "extension",
  "inputSha256",
  "outputSha256",
  "bytes",
] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const MIME_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const EXTENSION = /^\.[a-z0-9][a-z0-9._+-]{0,31}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const FAILURE_MESSAGES: Readonly<Record<StudioCodecProviderFailureCode, string>> =
  Object.freeze({
    "ambiguous-provider": "동일한 codec provider identity가 중복되었습니다.",
    "input-budget-exceeded": "코덱 입력이 요청 또는 공급자 예산을 초과했습니다.",
    "input-mutated": "코덱 공급자가 경계 입력을 변경했습니다.",
    "invalid-manifest": "코덱 공급자 capability manifest가 유효하지 않습니다.",
    "invalid-provider": "코덱 공급자 계약이 유효하지 않습니다.",
    "invalid-registry": "코덱 공급자 registry가 유효하지 않습니다.",
    "invalid-request": "코덱 실행 요청이 유효하지 않습니다.",
    "license-expired": "코덱 공급자의 명시적 라이선스 grant가 만료되었습니다.",
    "no-provider": "요청을 정확히 충족하는 명시적 코덱 공급자가 없습니다.",
    "output-budget-exceeded": "코덱 출력이 요청 또는 공급자 예산을 초과했습니다.",
    "provider-result-invalid": "코덱 공급자 결과 envelope가 유효하지 않습니다.",
    "provider-runtime-error": "코덱 공급자 실행이 안전하게 완료되지 않았습니다.",
    "receipt-mismatch": "코덱 공급자 결과와 경계에서 재계산한 영수증이 일치하지 않습니다.",
  });

function failure(
  code: StudioCodecProviderFailureCode,
  stage: StudioCodecProviderFailureStage,
  providerId: string | null = null
): StudioCodecProviderFailure {
  return Object.freeze({
    ok: false,
    code,
    stage,
    providerId,
    message: FAILURE_MESSAGES[code],
  });
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function exactDenseArray(value: unknown, maxLength: number): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!ownKeys.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
  }
  return value;
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length <= STUDIO_CODEC_PROVIDER_LIMITS.maxIdentifierCodeUnits
    && IDENTIFIER.test(value)
  );
}

function safeBudget(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= maximum
  );
}

function uniqueStringArray(
  value: unknown,
  maximum: number,
  predicate: (entry: unknown) => entry is string
): readonly string[] | null {
  const array = exactDenseArray(value, maximum);
  if (!array || !array.every(predicate)) return null;
  const strings = array as readonly string[];
  if (new Set(strings).size !== strings.length) return null;
  return [...strings];
}

function isMode(value: unknown): value is StudioCodecProviderMode {
  return typeof value === "string" && MODE_SET.has(value as StudioCodecProviderMode);
}

function isDirection(value: unknown): value is StudioCodecDirection {
  return (
    typeof value === "string"
    && DIRECTIONS.has(value as StudioCodecDirection)
  );
}

function isMimeType(value: unknown): value is string {
  return typeof value === "string" && MIME_TYPE.test(value);
}

function isExtension(value: unknown): value is string {
  return typeof value === "string" && EXTENSION.test(value);
}

function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value
    ? epoch
    : null;
}

function parseLicenseGrant(value: unknown): StudioCodecLicenseGrant | null {
  const record = ownDataRecord(value, LICENSE_GRANT_KEYS);
  if (!record || !safeIdentifier(record.id)) return null;
  const scope = exactDenseArray(
    record.scope,
    STUDIO_CODEC_PROVIDER_LIMITS.maxLicenseScopes
  );
  if (
    !scope
    || !scope.every(
      entry =>
        typeof entry === "string"
        && LICENSE_SCOPES.has(entry as StudioCodecLicenseScope)
    )
  ) {
    return null;
  }
  const normalizedScope = scope as readonly StudioCodecLicenseScope[];
  if (new Set(normalizedScope).size !== normalizedScope.length) return null;
  if (
    record.expiresAt !== null
    && parseUtcTimestamp(record.expiresAt) === null
  ) {
    return null;
  }
  return Object.freeze({
    id: record.id,
    scope: Object.freeze([...normalizedScope]),
    expiresAt: record.expiresAt as string | null,
  });
}

function parseOfficialClaimPolicy(
  value: unknown
): StudioCodecOfficialClaimPolicy | null {
  const record = ownDataRecord(value, OFFICIAL_POLICY_KEYS);
  if (
    !record
    || record.requiresVerifiedExternalAttestation !== true
    || record.maySelfAssertCertification !== false
    || record.maySelfAssertTrademark !== false
  ) {
    return null;
  }
  return Object.freeze({
    requiresVerifiedExternalAttestation: true,
    maySelfAssertCertification: false,
    maySelfAssertTrademark: false,
  });
}

export function parseStudioCodecProviderManifest(
  value: unknown
): StudioCodecProviderManifest | null {
  const record = ownDataRecord(value, MANIFEST_KEYS);
  if (
    !record
    || record.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || !safeIdentifier(record.providerId)
    || !isMode(record.mode)
    || !safeIdentifier(record.format)
    || !safeIdentifier(record.profile)
    || !safeIdentifier(record.version)
    || typeof record.encode !== "boolean"
    || typeof record.decode !== "boolean"
    || (!record.encode && !record.decode)
    || !safeBudget(
      record.maxInputBytes,
      STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes
    )
    || !safeBudget(
      record.maxOutputBytes,
      STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes
    )
    || typeof record.deterministic !== "boolean"
  ) {
    return null;
  }
  const mimeTypes = uniqueStringArray(
    record.mimeTypes,
    STUDIO_CODEC_PROVIDER_LIMITS.maxMimeTypes,
    isMimeType
  );
  const extensions = uniqueStringArray(
    record.extensions,
    STUDIO_CODEC_PROVIDER_LIMITS.maxExtensions,
    isExtension
  );
  const licenseGrant = parseLicenseGrant(record.licenseGrant);
  const officialClaimPolicy = parseOfficialClaimPolicy(
    record.officialClaimPolicy
  );
  if (
    !mimeTypes
    || !extensions
    || !licenseGrant
    || !officialClaimPolicy
    || !licenseGrant.scope.includes(record.mode)
    || (record.encode && !licenseGrant.scope.includes("encode"))
    || (record.decode && !licenseGrant.scope.includes("decode"))
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: record.providerId,
    mode: record.mode,
    format: record.format,
    profile: record.profile,
    version: record.version,
    encode: record.encode,
    decode: record.decode,
    mimeTypes: Object.freeze(mimeTypes),
    extensions: Object.freeze(extensions),
    maxInputBytes: record.maxInputBytes,
    maxOutputBytes: record.maxOutputBytes,
    deterministic: record.deterministic,
    licenseGrant,
    officialClaimPolicy,
  });
}

export function parseStudioCodecExecutionRequest(
  value: unknown
): StudioCodecExecutionRequest | null {
  const record = ownDataRecord(value, REQUEST_KEYS);
  if (
    !record
    || record.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || !isDirection(record.direction)
    || !safeIdentifier(record.format)
    || !safeIdentifier(record.profile)
    || !safeIdentifier(record.version)
    || !isMimeType(record.mimeType)
    || !isExtension(record.extension)
    || typeof record.requireDeterministic !== "boolean"
    || !safeBudget(
      record.maxInputBytes,
      STUDIO_CODEC_PROVIDER_LIMITS.maxInputBytes
    )
    || !safeBudget(
      record.maxOutputBytes,
      STUDIO_CODEC_PROVIDER_LIMITS.maxOutputBytes
    )
  ) {
    return null;
  }
  const allowedModes = exactDenseArray(record.allowedModes, MODES.length);
  if (
    !allowedModes
    || !allowedModes.every(isMode)
    || new Set(allowedModes).size !== allowedModes.length
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    direction: record.direction,
    format: record.format,
    profile: record.profile,
    version: record.version,
    mimeType: record.mimeType,
    extension: record.extension,
    allowedModes: Object.freeze([
      ...(allowedModes as readonly StudioCodecProviderMode[]),
    ]),
    requireDeterministic: record.requireDeterministic,
    maxInputBytes: record.maxInputBytes,
    maxOutputBytes: record.maxOutputBytes,
  });
}

function manifestMatchesRequest(
  manifest: StudioCodecProviderManifest,
  request: StudioCodecExecutionRequest,
  nowEpochMs: number
): boolean {
  if (
    manifest.format !== request.format
    || manifest.profile !== request.profile
    || manifest.version !== request.version
    || !manifest.mimeTypes.includes(request.mimeType)
    || !manifest.extensions.includes(request.extension)
    || !request.allowedModes.includes(manifest.mode)
    || (request.direction === "encode" ? !manifest.encode : !manifest.decode)
    || !manifest.licenseGrant.scope.includes(request.direction)
    || (request.requireDeterministic && !manifest.deterministic)
    || request.maxInputBytes > manifest.maxInputBytes
    || request.maxOutputBytes > manifest.maxOutputBytes
  ) {
    return false;
  }
  const expiry = manifest.licenseGrant.expiresAt;
  return expiry === null || (parseUtcTimestamp(expiry) ?? -1) > nowEpochMs;
}

function manifestIdentity(manifest: StudioCodecProviderManifest): string {
  return [
    manifest.providerId,
    manifest.mode,
    manifest.format,
    manifest.profile,
    manifest.version,
  ].join("\u0000");
}

export function negotiateStudioCodecProvider(
  requestValue: unknown,
  providerValues: readonly unknown[],
  nowEpochMs = Date.now()
): StudioCodecProviderNegotiationResult {
  const request = parseStudioCodecExecutionRequest(requestValue);
  if (!request || !Number.isFinite(nowEpochMs)) {
    return failure("invalid-request", "negotiation");
  }
  if (
    !Array.isArray(providerValues)
    || providerValues.length > STUDIO_CODEC_PROVIDER_LIMITS.maxProviders
  ) {
    return failure("invalid-registry", "registry");
  }
  const providers: StudioCodecProvider[] = [];
  const identities = new Set<string>();
  for (const value of providerValues) {
    const record = ownDataRecord(value, PROVIDER_KEYS);
    if (!record || typeof record.execute !== "function") {
      return failure("invalid-provider", "registry");
    }
    const manifest = parseStudioCodecProviderManifest(record.manifest);
    if (!manifest) return failure("invalid-manifest", "registry");
    const provider: StudioCodecProvider = Object.freeze({
      manifest,
      execute: record.execute as StudioCodecProvider["execute"],
    });
    const identity = manifestIdentity(provider.manifest);
    if (identities.has(identity)) {
      return failure(
        "ambiguous-provider",
        "registry",
        provider.manifest.providerId
      );
    }
    identities.add(identity);
    providers.push(provider);
  }

  const candidates = providers.filter(provider =>
    manifestMatchesRequest(provider.manifest, request, nowEpochMs)
  );
  if (candidates.length === 0) {
    const expired = providers.some(provider => {
      const manifest = provider.manifest;
      const expiresAt = manifest.licenseGrant.expiresAt;
      return (
        manifest.format === request.format
        && manifest.profile === request.profile
        && manifest.version === request.version
        && expiresAt !== null
        && (parseUtcTimestamp(expiresAt) ?? -1) <= nowEpochMs
      );
    });
    return failure(expired ? "license-expired" : "no-provider", "negotiation");
  }
  candidates.sort((left, right) => {
    const modeDelta =
      request.allowedModes.indexOf(left.manifest.mode)
      - request.allowedModes.indexOf(right.manifest.mode);
    return (
      modeDelta
      || left.manifest.providerId.localeCompare(right.manifest.providerId)
    );
  });
  const provider = candidates[0];
  return Object.freeze({
    ok: true,
    provider,
    manifest: provider.manifest,
  });
}

function parseRawResult(value: unknown): StudioCodecProviderRawResult | null {
  const record = ownDataRecord(value, RAW_RESULT_KEYS);
  if (
    !record
    || record.schemaVersion !== STUDIO_CODEC_PROVIDER_CONTRACT_VERSION
    || !safeIdentifier(record.providerId)
    || !isDirection(record.direction)
    || !safeIdentifier(record.format)
    || !safeIdentifier(record.profile)
    || !safeIdentifier(record.version)
    || !isMimeType(record.mimeType)
    || !isExtension(record.extension)
    || typeof record.inputSha256 !== "string"
    || !SHA256.test(record.inputSha256)
    || typeof record.outputSha256 !== "string"
    || !SHA256.test(record.outputSha256)
    || !(record.bytes instanceof Uint8Array)
  ) {
    return null;
  }
  return {
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: record.providerId,
    direction: record.direction,
    format: record.format,
    profile: record.profile,
    version: record.version,
    mimeType: record.mimeType,
    extension: record.extension,
    inputSha256: record.inputSha256 as `sha256:${string}`,
    outputSha256: record.outputSha256 as `sha256:${string}`,
    bytes: record.bytes,
  };
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function rawResultMatches(
  result: StudioCodecProviderRawResult,
  request: StudioCodecExecutionRequest,
  manifest: StudioCodecProviderManifest
): boolean {
  return (
    result.providerId === manifest.providerId
    && result.direction === request.direction
    && result.format === request.format
    && result.profile === request.profile
    && result.version === request.version
    && result.mimeType === request.mimeType
    && result.extension === request.extension
  );
}

export async function executeStudioCodecProvider(
  requestValue: unknown,
  inputValue: unknown,
  providerValues: readonly unknown[],
  nowEpochMs = Date.now()
): Promise<StudioCodecProviderExecutionResult> {
  const request = parseStudioCodecExecutionRequest(requestValue);
  if (!request) return failure("invalid-request", "input");
  if (!(inputValue instanceof Uint8Array)) {
    return failure("invalid-request", "input");
  }
  if (inputValue.byteLength > request.maxInputBytes) {
    return failure("input-budget-exceeded", "input");
  }
  const negotiation = negotiateStudioCodecProvider(
    request,
    providerValues,
    nowEpochMs
  );
  if (!negotiation.ok) return negotiation;
  const { provider, manifest } = negotiation;
  if (inputValue.byteLength > manifest.maxInputBytes) {
    return failure("input-budget-exceeded", "input", manifest.providerId);
  }

  const workingInput = Uint8Array.from(inputValue);
  const inputSha256 = hashBytes(workingInput);
  const execution = Object.freeze({
    request,
    inputBytes: workingInput,
    inputSha256,
  });

  let rawValue: unknown;
  try {
    rawValue = await provider.execute(execution);
  } catch {
    return failure("provider-runtime-error", "execution", manifest.providerId);
  }
  if (hashBytes(workingInput) !== inputSha256) {
    return failure("input-mutated", "execution", manifest.providerId);
  }

  const raw = parseRawResult(rawValue);
  if (!raw || !rawResultMatches(raw, request, manifest)) {
    return failure(
      "provider-result-invalid",
      "output",
      manifest.providerId
    );
  }
  if (
    raw.bytes.byteLength > request.maxOutputBytes
    || raw.bytes.byteLength > manifest.maxOutputBytes
  ) {
    return failure(
      "output-budget-exceeded",
      "output",
      manifest.providerId
    );
  }

  const outputBytes = Uint8Array.from(raw.bytes);
  const outputSha256 = hashBytes(outputBytes);
  if (
    raw.inputSha256 !== inputSha256
    || raw.outputSha256 !== outputSha256
  ) {
    return failure("receipt-mismatch", "output", manifest.providerId);
  }

  const receipt: StudioCodecExecutionReceipt = Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    kind: "toonspectrum-codec-provider-execution",
    providerId: manifest.providerId,
    mode: manifest.mode,
    direction: request.direction,
    format: request.format,
    profile: request.profile,
    version: request.version,
    mimeType: request.mimeType,
    extension: request.extension,
    deterministic: manifest.deterministic,
    input: Object.freeze({
      byteLength: workingInput.byteLength,
      sha256: inputSha256,
    }),
    output: Object.freeze({
      byteLength: outputBytes.byteLength,
      sha256: outputSha256,
    }),
    licenseGrant: manifest.licenseGrant,
    officialClaims: Object.freeze({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    }),
  });
  return Object.freeze({
    ok: true,
    bytes: outputBytes,
    receipt,
  });
}
