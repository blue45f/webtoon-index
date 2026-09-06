/**
 * Renderer-neutral VRM license metadata admission.
 *
 * This module intentionally reads only the already-decoded glTF JSON extension. It does not load
 * model bytes, execute third-party code, or infer permission from a file name. The normalized DTO
 * follows the VRM Consortium's VRM 0.x and VRM 1.0 metadata fields and keeps the declared tokens in
 * `rawIntent` so a later audit can distinguish an omitted default from malformed input.
 */

export const STUDIO_VRM_LICENSE_METADATA_LIMITS = Object.freeze({
  maxMetadataJsonBytes: 64 * 1024,
  maxDepth: 8,
  maxContainers: 64,
  maxEntries: 256,
  maxArrayItems: 128,
  maxStringBytes: 4 * 1024,
  maxKeyBytes: 256,
  maxAuthors: 32,
  maxDiagnostics: 32,
});

export const STUDIO_VRM_1_PUBLIC_LICENSE_URL = "https://vrm.dev/licenses/1.0/";
export const STUDIO_VRM_CC0_1_LICENSE_URL =
  "https://creativecommons.org/publicdomain/zero/1.0/";
export const STUDIO_VRM_CC_BY_4_LICENSE_URL =
  "https://creativecommons.org/licenses/by/4.0/";
export const STUDIO_VRM_CC_BY_NC_4_LICENSE_URL =
  "https://creativecommons.org/licenses/by-nc/4.0/";

export type StudioVrmLicenseSpec = "vrm0" | "vrm1";
export type StudioVrmCommercialPermission =
  | "allow"
  | "disallow"
  | "personal-nonprofit"
  | "personal-profit"
  | "corporation"
  | "unknown";
export type StudioVrmModificationPermission =
  | "prohibited"
  | "allow-modification"
  | "allow-modification-redistribution"
  | "unknown";
export type StudioVrmBinaryPermission = "allow" | "disallow" | "unknown";
export type StudioVrmCreditPermission = "required" | "unnecessary" | "unknown";
export type StudioVrmShareAlikePermission = "required" | "not-required" | "unknown";
export type StudioVrmAvatarPermission =
  | "only-author"
  | "only-separately-licensed-person"
  | "everyone"
  | "unknown";

export type StudioVrmLicenseDiagnosticCode =
  | "missing-required-field"
  | "invalid-field-type"
  | "invalid-field-value"
  | "invalid-url"
  | "unsupported-license-document"
  | "conflicting-license-declarations";

export interface StudioVrmLicenseDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: StudioVrmLicenseDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

/** Selected declarations exactly as they occurred in the bounded metadata object. */
export interface StudioVrmLicenseRawIntent {
  readonly title: string | null;
  readonly authors: readonly string[] | null;
  readonly licenseUrl: string | null;
  readonly otherLicenseUrl: string | null;
  readonly otherPermissionUrl: string | null;
  readonly legacyLicenseName: string | null;
  readonly avatarPermission: string | null;
  readonly commercial: string | null;
  readonly modification: string | null;
  readonly redistribution: boolean | string | null;
  readonly credit: string | null;
  readonly violent: boolean | string | null;
  readonly sexual: boolean | string | null;
  readonly politicalOrReligious: boolean | string | null;
  readonly antisocialOrHate: boolean | string | null;
  readonly thirdPartyLicenses: string | null;
}

/**
 * Plain, deterministic JSON data suitable for canonical serialization and a caller-owned hash.
 * No `undefined`, Date, URL, Map, Set, class instance, or mutable nested value is admitted.
 */
export interface StudioVrmLicenseMetadataReceipt {
  readonly schema: "toonspectrum.vrm-license-metadata";
  readonly version: 1;
  readonly spec: StudioVrmLicenseSpec;
  readonly sourcePath: "extensions.VRM.meta" | "extensions.VRMC_vrm.meta";
  readonly declaredSpecVersion: string | null;
  readonly conformance: "conformant" | "nonconformant";
  readonly metadataJsonBytes: number;
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly licenseIdentifier: string | null;
  readonly licenseUrl: string | null;
  readonly additionalLicenseUrl: string | null;
  readonly additionalPermissionUrl: string | null;
  readonly avatarPermission: StudioVrmAvatarPermission;
  readonly commercial: StudioVrmCommercialPermission;
  readonly modification: StudioVrmModificationPermission;
  readonly redistribution: StudioVrmBinaryPermission;
  readonly credit: StudioVrmCreditPermission;
  readonly violent: StudioVrmBinaryPermission;
  readonly sexual: StudioVrmBinaryPermission;
  readonly politicalOrReligious: StudioVrmBinaryPermission;
  readonly antisocialOrHate: StudioVrmBinaryPermission;
  readonly thirdPartyLicenses: string | null;
  readonly shareAlike: StudioVrmShareAlikePermission;
  readonly rawIntent: StudioVrmLicenseRawIntent;
  readonly diagnostics: readonly StudioVrmLicenseDiagnostic[];
}

export type StudioVrmLicenseMetadataFailureCode =
  | "invalid-root"
  | "unsafe-container"
  | "missing-metadata"
  | "ambiguous-metadata"
  | "metadata-not-json"
  | "metadata-budget-exceeded";

export type StudioVrmLicenseMetadataParseResult =
  | {
      readonly ok: true;
      readonly receipt: StudioVrmLicenseMetadataReceipt;
    }
  | {
      readonly ok: false;
      readonly code: StudioVrmLicenseMetadataFailureCode;
      readonly message: string;
    };

type JsonRecord = Record<string, unknown>;

class MetadataAdmissionError extends Error {
  readonly code: StudioVrmLicenseMetadataFailureCode;

  constructor(code: StudioVrmLicenseMetadataFailureCode, message: string) {
    super(message);
    this.name = "MetadataAdmissionError";
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const LEGACY_LICENSE_NAMES = new Set([
  "Redistribution_Prohibited",
  "CC0",
  "CC_BY",
  "CC_BY_NC",
  "CC_BY_SA",
  "CC_BY_NC_SA",
  "CC_BY_ND",
  "CC_BY_NC_ND",
  "Other",
]);

type StudioVrmCanonicalCreativeCommonsLicense = Readonly<{
  identifier: "CC0" | "CC_BY" | "CC_BY_NC";
  url: string;
  commercial: StudioVrmCommercialPermission;
  modification: StudioVrmModificationPermission;
  redistribution: StudioVrmBinaryPermission;
  credit: StudioVrmCreditPermission;
  shareAlike: StudioVrmShareAlikePermission;
}>;

const STUDIO_VRM_CANONICAL_CREATIVE_COMMONS_LICENSES = new Map<
  string,
  StudioVrmCanonicalCreativeCommonsLicense
>([
  [
    STUDIO_VRM_CC0_1_LICENSE_URL,
    Object.freeze({
      identifier: "CC0",
      url: STUDIO_VRM_CC0_1_LICENSE_URL,
      commercial: "allow",
      modification: "allow-modification-redistribution",
      redistribution: "allow",
      credit: "unnecessary",
      shareAlike: "not-required",
    }),
  ],
  [
    STUDIO_VRM_CC_BY_4_LICENSE_URL,
    Object.freeze({
      identifier: "CC_BY",
      url: STUDIO_VRM_CC_BY_4_LICENSE_URL,
      commercial: "allow",
      modification: "allow-modification-redistribution",
      redistribution: "allow",
      credit: "required",
      shareAlike: "not-required",
    }),
  ],
  [
    STUDIO_VRM_CC_BY_NC_4_LICENSE_URL,
    Object.freeze({
      identifier: "CC_BY_NC",
      url: STUDIO_VRM_CC_BY_NC_4_LICENSE_URL,
      commercial: "disallow",
      modification: "allow-modification-redistribution",
      redistribution: "allow",
      credit: "required",
      shareAlike: "not-required",
    }),
  ],
]);

function explicitVrm1CreativeCommonsLicense(
  mandatoryLicenseUrl: string | null,
  otherLicenseUrl: string | null,
): StudioVrmCanonicalCreativeCommonsLicense | null {
  if (mandatoryLicenseUrl !== STUDIO_VRM_1_PUBLIC_LICENSE_URL || !otherLicenseUrl) return null;
  return STUDIO_VRM_CANONICAL_CREATIVE_COMMONS_LICENSES.get(otherLicenseUrl) ?? null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(
  code: StudioVrmLicenseMetadataFailureCode,
  message: string
): StudioVrmLicenseMetadataParseResult {
  return deepFreeze({ ok: false as const, code, message });
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedRecord(value: unknown, path: string): JsonRecord {
  if (!isPlainRecord(value)) {
    throw new MetadataAdmissionError("unsafe-container", `${path} must be a plain JSON object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxEntries) {
    throw new MetadataAdmissionError(
      "metadata-budget-exceeded",
      `${path} exceeds the object-entry budget.`
    );
  }
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new MetadataAdmissionError("metadata-not-json", `${path} contains a symbol key.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new MetadataAdmissionError(
        "metadata-not-json",
        `${path}.${key} is not an enumerable JSON data property.`
      );
    }
  }
  return value;
}

function ownValue(record: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function jsonStringBytes(value: string): number {
  return TEXT_ENCODER.encode(JSON.stringify(value)).byteLength;
}

/** Validates the whole selected meta object without serializing it into one monolithic string. */
function inspectMetadataJson(value: unknown): number {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let containers = 0;
  let entries = 0;
  let bytes = 0;

  const addBytes = (amount: number): void => {
    bytes += amount;
    if (bytes > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxMetadataJsonBytes) {
      throw new MetadataAdmissionError(
        "metadata-budget-exceeded",
        "VRM license metadata exceeds the canonical JSON byte budget."
      );
    }
  };

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxDepth) {
      throw new MetadataAdmissionError(
        "metadata-budget-exceeded",
        "VRM license metadata exceeds the nesting-depth budget."
      );
    }
    if (current.value === null) {
      addBytes(4);
      continue;
    }
    if (typeof current.value === "boolean") {
      addBytes(current.value ? 4 : 5);
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw new MetadataAdmissionError(
          "metadata-not-json",
          "VRM license metadata contains a non-finite number."
        );
      }
      addBytes(TEXT_ENCODER.encode(JSON.stringify(current.value)).byteLength);
      continue;
    }
    if (typeof current.value === "string") {
      if (
        TEXT_ENCODER.encode(current.value).byteLength
        > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxStringBytes
      ) {
        throw new MetadataAdmissionError(
          "metadata-budget-exceeded",
          "VRM license metadata contains an over-budget string."
        );
      }
      addBytes(jsonStringBytes(current.value));
      continue;
    }
    if (typeof current.value !== "object") {
      throw new MetadataAdmissionError(
        "metadata-not-json",
        "VRM license metadata contains a non-JSON value."
      );
    }
    if (seen.has(current.value)) {
      throw new MetadataAdmissionError(
        "metadata-not-json",
        "VRM license metadata contains a cyclic or shared object reference."
      );
    }
    seen.add(current.value);
    containers += 1;
    if (containers > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxContainers) {
      throw new MetadataAdmissionError(
        "metadata-budget-exceeded",
        "VRM license metadata exceeds the container-count budget."
      );
    }

    if (Array.isArray(current.value)) {
      if (current.value.length > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxArrayItems) {
        throw new MetadataAdmissionError(
          "metadata-budget-exceeded",
          "VRM license metadata exceeds the array-item budget."
        );
      }
      const keys = Reflect.ownKeys(current.value);
      if (keys.some((key) => key !== "length" && (
        typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)
      ))) {
        throw new MetadataAdmissionError(
          "metadata-not-json",
          "VRM license metadata array contains a non-index property."
        );
      }
      for (let index = 0; index < current.value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new MetadataAdmissionError(
            "metadata-not-json",
            "VRM license metadata contains a sparse or accessor-backed array entry."
          );
        }
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      entries += current.value.length;
      addBytes(2 + Math.max(0, current.value.length - 1));
    } else {
      const record = boundedRecord(current.value, "VRM metadata");
      const keys = Object.keys(record);
      entries += keys.length;
      addBytes(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        if (TEXT_ENCODER.encode(key).byteLength > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxKeyBytes) {
          throw new MetadataAdmissionError(
            "metadata-budget-exceeded",
            "VRM license metadata contains an over-budget object key."
          );
        }
        addBytes(jsonStringBytes(key) + 1);
        pending.push({ value: record[key], depth: current.depth + 1 });
      }
    }
    if (entries > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxEntries) {
      throw new MetadataAdmissionError(
        "metadata-budget-exceeded",
        "VRM license metadata exceeds the total-entry budget."
      );
    }
  }
  return bytes;
}

function rawString(record: JsonRecord, key: string): string | null {
  const value = ownValue(record, key);
  return typeof value === "string" ? value : null;
}

function rawBooleanOrString(record: JsonRecord, key: string): boolean | string | null {
  const value = ownValue(record, key);
  return typeof value === "boolean" || typeof value === "string" ? value : null;
}

function rawStringArray(record: JsonRecord, key: string): readonly string[] | null {
  const value = ownValue(record, key);
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }
  return Object.freeze([...value]);
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || /\p{Cf}/u.test(character)
    ) return null;
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || TEXT_ENCODER.encode(normalized).byteLength > 512) return null;
  return normalized;
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    const normalized = parsed.toString();
    return TEXT_ENCODER.encode(normalized).byteLength <= 2_048 ? normalized : null;
  } catch {
    return null;
  }
}

function createDiagnosticWriter(): {
  readonly diagnostics: StudioVrmLicenseDiagnostic[];
  readonly add: (
    severity: StudioVrmLicenseDiagnostic["severity"],
    code: StudioVrmLicenseDiagnosticCode,
    path: string,
    message: string
  ) => void;
} {
  const diagnostics: StudioVrmLicenseDiagnostic[] = [];
  return {
    diagnostics,
    add(severity, code, path, message) {
      if (diagnostics.length >= STUDIO_VRM_LICENSE_METADATA_LIMITS.maxDiagnostics) return;
      diagnostics.push({ severity, code, path, message });
    },
  };
}

function validateOptionalUrl(
  meta: JsonRecord,
  key: string,
  path: string,
  add: ReturnType<typeof createDiagnosticWriter>["add"]
): string | null {
  const raw = ownValue(meta, key);
  if (raw === undefined) return null;
  const url = normalizeHttpUrl(raw);
  if (!url) {
    add("error", typeof raw === "string" ? "invalid-url" : "invalid-field-type", path,
      `${path} must be an absolute HTTP(S) URL.`);
  }
  return url;
}

function validateEnum<T extends string>(
  meta: JsonRecord,
  key: string,
  allowed: ReadonlySet<string>,
  path: string,
  add: ReturnType<typeof createDiagnosticWriter>["add"]
): T | null {
  const value = ownValue(meta, key);
  if (value === undefined) return null;
  if (typeof value !== "string") {
    add("error", "invalid-field-type", path, `${path} must be a string enum value.`);
    return null;
  }
  if (!allowed.has(value)) {
    add("error", "invalid-field-value", path, `${path} contains an unknown enum value.`);
    return null;
  }
  return value as T;
}

function validateBoolean(
  meta: JsonRecord,
  key: string,
  path: string,
  add: ReturnType<typeof createDiagnosticWriter>["add"]
): boolean | null {
  const value = ownValue(meta, key);
  if (value === undefined) return null;
  if (typeof value !== "boolean") {
    add("error", "invalid-field-type", path, `${path} must be a boolean.`);
    return null;
  }
  return value;
}

function validateOptionalLicenseText(
  meta: JsonRecord,
  key: string,
  path: string,
  add: ReturnType<typeof createDiagnosticWriter>["add"],
): string | null {
  const value = ownValue(meta, key);
  if (value === undefined) return null;
  if (typeof value !== "string") {
    add("error", "invalid-field-type", path, `${path} must be a string.`);
    return null;
  }
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (!normalized) return null;
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a)
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || /\p{Cf}/u.test(character)
    ) {
      add("error", "invalid-field-value", path, `${path} contains unsafe control text.`);
      return null;
    }
  }
  return normalized;
}

function buildVrm0Receipt(meta: JsonRecord, metadataJsonBytes: number): StudioVrmLicenseMetadataReceipt {
  const writer = createDiagnosticWriter();
  const basePath = "extensions.VRM.meta";
  const titleRaw = ownValue(meta, "title");
  const authorRaw = ownValue(meta, "author");
  const title = normalizeDisplayText(titleRaw);
  const author = normalizeDisplayText(authorRaw);
  if (titleRaw !== undefined && title === null) {
    writer.add("error", typeof titleRaw === "string" ? "invalid-field-value" : "invalid-field-type",
      `${basePath}.title`, "VRM 0.x title must be a bounded, display-safe string.");
  }
  if (authorRaw !== undefined && author === null) {
    writer.add("error", typeof authorRaw === "string" ? "invalid-field-value" : "invalid-field-type",
      `${basePath}.author`, "VRM 0.x author must be a bounded, display-safe string.");
  }

  const licenseName = validateEnum<string>(
    meta,
    "licenseName",
    LEGACY_LICENSE_NAMES,
    `${basePath}.licenseName`,
    writer.add
  );
  const declaredAvatarPermission = validateEnum<
    "OnlyAuthor" | "ExplicitlyLicensedPerson" | "Everyone"
  >(
    meta,
    "allowedUserName",
    new Set(["OnlyAuthor", "ExplicitlyLicensedPerson", "Everyone"]),
    `${basePath}.allowedUserName`,
    writer.add,
  );
  const declaredCommercial = validateEnum<"Allow" | "Disallow">(
    meta,
    "commercialUssageName",
    new Set(["Allow", "Disallow"]),
    `${basePath}.commercialUssageName`,
    writer.add
  );
  const declaredViolent = validateEnum<"Allow" | "Disallow">(
    meta,
    "violentUssageName",
    new Set(["Allow", "Disallow"]),
    `${basePath}.violentUssageName`,
    writer.add
  );
  const declaredSexual = validateEnum<"Allow" | "Disallow">(
    meta,
    "sexualUssageName",
    new Set(["Allow", "Disallow"]),
    `${basePath}.sexualUssageName`,
    writer.add
  );
  const otherLicenseUrl = validateOptionalUrl(
    meta,
    "otherLicenseUrl",
    `${basePath}.otherLicenseUrl`,
    writer.add
  );
  const otherPermissionUrl = validateOptionalUrl(
    meta,
    "otherPermissionUrl",
    `${basePath}.otherPermissionUrl`,
    writer.add
  );

  const isNc = licenseName === "CC_BY_NC"
    || licenseName === "CC_BY_NC_SA"
    || licenseName === "CC_BY_NC_ND";
  if (declaredCommercial === "Allow" && isNc) {
    writer.add(
      "error",
      "conflicting-license-declarations",
      `${basePath}.commercialUssageName`,
      "Commercial use is declared Allow while the selected Creative Commons license is noncommercial."
    );
  }

  let commercial: StudioVrmCommercialPermission = declaredCommercial === "Allow"
    ? "allow"
    : declaredCommercial === "Disallow"
      ? "disallow"
      : "unknown";
  if (isNc) commercial = "disallow";
  else if (commercial === "unknown" && licenseName?.startsWith("CC")) commercial = "allow";

  let modification: StudioVrmModificationPermission = "unknown";
  let redistribution: StudioVrmBinaryPermission = "unknown";
  let credit: StudioVrmCreditPermission = "unknown";
  let shareAlike: StudioVrmShareAlikePermission = "unknown";
  if (licenseName === "Redistribution_Prohibited") {
    redistribution = "disallow";
  } else if (licenseName === "CC0") {
    modification = "allow-modification-redistribution";
    redistribution = "allow";
    credit = "unnecessary";
    shareAlike = "not-required";
  } else if (licenseName?.startsWith("CC_BY")) {
    const noDerivatives = licenseName.endsWith("_ND");
    const requiresShareAlike = licenseName.endsWith("_SA");
    modification = noDerivatives ? "prohibited" : "allow-modification-redistribution";
    redistribution = "allow";
    credit = "required";
    shareAlike = requiresShareAlike ? "required" : "not-required";
  }

  const diagnostics = Object.freeze(writer.diagnostics.map((entry) => Object.freeze(entry)));
  return deepFreeze({
    schema: "toonspectrum.vrm-license-metadata" as const,
    version: 1 as const,
    spec: "vrm0" as const,
    sourcePath: basePath,
    declaredSpecVersion: null,
    conformance: diagnostics.some(({ severity }) => severity === "error")
      ? "nonconformant" as const
      : "conformant" as const,
    metadataJsonBytes,
    title,
    authors: Object.freeze(author ? [author] : []),
    licenseIdentifier: licenseName,
    licenseUrl: licenseName === "Other" ? otherLicenseUrl : null,
    additionalLicenseUrl: otherLicenseUrl,
    additionalPermissionUrl: otherPermissionUrl,
    avatarPermission: declaredAvatarPermission === "OnlyAuthor"
      ? "only-author"
      : declaredAvatarPermission === "ExplicitlyLicensedPerson"
        ? "only-separately-licensed-person"
        : declaredAvatarPermission === "Everyone"
          ? "everyone"
          : "unknown",
    commercial,
    modification,
    redistribution,
    credit,
    violent: declaredViolent === "Allow" ? "allow" : declaredViolent === "Disallow" ? "disallow" : "unknown",
    sexual: declaredSexual === "Allow" ? "allow" : declaredSexual === "Disallow" ? "disallow" : "unknown",
    politicalOrReligious: "unknown" as const,
    antisocialOrHate: "unknown" as const,
    thirdPartyLicenses: null,
    shareAlike,
    rawIntent: {
      title: rawString(meta, "title"),
      authors: rawString(meta, "author") === null
        ? null
        : Object.freeze([rawString(meta, "author")!]),
      licenseUrl: null,
      otherLicenseUrl: rawString(meta, "otherLicenseUrl"),
      otherPermissionUrl: rawString(meta, "otherPermissionUrl"),
      legacyLicenseName: rawString(meta, "licenseName"),
      avatarPermission: rawString(meta, "allowedUserName"),
      commercial: rawString(meta, "commercialUssageName"),
      modification: rawString(meta, "licenseName"),
      redistribution: rawString(meta, "licenseName"),
      credit: rawString(meta, "licenseName"),
      violent: rawBooleanOrString(meta, "violentUssageName"),
      sexual: rawBooleanOrString(meta, "sexualUssageName"),
      politicalOrReligious: null,
      antisocialOrHate: null,
      thirdPartyLicenses: null,
    },
    diagnostics,
  });
}

function buildVrm1Receipt(
  extension: JsonRecord,
  meta: JsonRecord,
  metadataJsonBytes: number
): StudioVrmLicenseMetadataReceipt {
  const writer = createDiagnosticWriter();
  const basePath = "extensions.VRMC_vrm.meta";
  const titleRaw = ownValue(meta, "name");
  const title = normalizeDisplayText(titleRaw);
  if (titleRaw === undefined) {
    writer.add("error", "missing-required-field", `${basePath}.name`, "VRM 1.0 requires meta.name.");
  } else if (title === null) {
    writer.add("error", typeof titleRaw === "string" ? "invalid-field-value" : "invalid-field-type",
      `${basePath}.name`, "VRM 1.0 meta.name must be a bounded, non-empty display string.");
  }

  const authorsRaw = ownValue(meta, "authors");
  const authors: string[] = [];
  if (authorsRaw === undefined) {
    writer.add("error", "missing-required-field", `${basePath}.authors`, "VRM 1.0 requires meta.authors.");
  } else if (!Array.isArray(authorsRaw)) {
    writer.add("error", "invalid-field-type", `${basePath}.authors`, "VRM 1.0 meta.authors must be an array.");
  } else if (authorsRaw.length < 1 || authorsRaw.length > STUDIO_VRM_LICENSE_METADATA_LIMITS.maxAuthors) {
    writer.add("error", "invalid-field-value", `${basePath}.authors`, "VRM 1.0 meta.authors must contain 1 to 32 authors.");
  } else {
    for (let index = 0; index < authorsRaw.length; index += 1) {
      const author = normalizeDisplayText(authorsRaw[index]);
      if (author === null) {
        writer.add("error", typeof authorsRaw[index] === "string" ? "invalid-field-value" : "invalid-field-type",
          `${basePath}.authors[${index}]`, "Every VRM 1.0 author must be a bounded, non-empty display string.");
      } else {
        authors.push(author);
      }
    }
  }

  const licenseRaw = ownValue(meta, "licenseUrl");
  const licenseUrl = normalizeHttpUrl(licenseRaw);
  if (licenseRaw === undefined) {
    writer.add("error", "missing-required-field", `${basePath}.licenseUrl`, "VRM 1.0 requires meta.licenseUrl.");
  } else if (!licenseUrl) {
    writer.add("error", typeof licenseRaw === "string" ? "invalid-url" : "invalid-field-type",
      `${basePath}.licenseUrl`, "VRM 1.0 meta.licenseUrl must be an absolute HTTP(S) URL.");
  } else if (licenseUrl !== STUDIO_VRM_1_PUBLIC_LICENSE_URL) {
    writer.add(
      "warning",
      "unsupported-license-document",
      `${basePath}.licenseUrl`,
      "This custom VRM 1.0 license URL is preserved but cannot be automatically authorized by the built-in policy."
    );
  }

  const declaredSpecVersionRaw = ownValue(extension, "specVersion");
  const declaredSpecVersion = typeof declaredSpecVersionRaw === "string"
    && TEXT_ENCODER.encode(declaredSpecVersionRaw).byteLength <= 64
    ? declaredSpecVersionRaw
    : null;
  if (declaredSpecVersionRaw === undefined) {
    writer.add("error", "missing-required-field", "extensions.VRMC_vrm.specVersion",
      "VRMC_vrm requires specVersion.");
  } else if (declaredSpecVersion !== "1.0") {
    writer.add("error", typeof declaredSpecVersionRaw === "string" ? "invalid-field-value" : "invalid-field-type",
      "extensions.VRMC_vrm.specVersion", "This parser only recognizes VRMC_vrm specVersion 1.0.");
  }

  const commercialRaw = ownValue(meta, "commercialUsage");
  const commercialEnum = validateEnum<"personalNonProfit" | "personalProfit" | "corporation">(
    meta,
    "commercialUsage",
    new Set(["personalNonProfit", "personalProfit", "corporation"]),
    `${basePath}.commercialUsage`,
    writer.add
  );
  const modificationRaw = ownValue(meta, "modification");
  const modificationEnum = validateEnum<"prohibited" | "allowModification" | "allowModificationRedistribution">(
    meta,
    "modification",
    new Set(["prohibited", "allowModification", "allowModificationRedistribution"]),
    `${basePath}.modification`,
    writer.add
  );
  const redistributionRaw = ownValue(meta, "allowRedistribution");
  const redistribution = validateBoolean(
    meta,
    "allowRedistribution",
    `${basePath}.allowRedistribution`,
    writer.add
  );
  const creditRaw = ownValue(meta, "creditNotation");
  const creditEnum = validateEnum<"required" | "unnecessary">(
    meta,
    "creditNotation",
    new Set(["required", "unnecessary"]),
    `${basePath}.creditNotation`,
    writer.add
  );
  const violentRaw = ownValue(meta, "allowExcessivelyViolentUsage");
  const violent = validateBoolean(
    meta,
    "allowExcessivelyViolentUsage",
    `${basePath}.allowExcessivelyViolentUsage`,
    writer.add
  );
  const sexualRaw = ownValue(meta, "allowExcessivelySexualUsage");
  const sexual = validateBoolean(
    meta,
    "allowExcessivelySexualUsage",
    `${basePath}.allowExcessivelySexualUsage`,
    writer.add
  );
  const avatarPermissionRaw = ownValue(meta, "avatarPermission");
  const avatarPermissionEnum = validateEnum<
    "onlyAuthor" | "onlySeparatelyLicensedPerson" | "everyone"
  >(
    meta,
    "avatarPermission",
    new Set(["onlyAuthor", "onlySeparatelyLicensedPerson", "everyone"]),
    `${basePath}.avatarPermission`,
    writer.add,
  );
  const politicalRaw = ownValue(meta, "allowPoliticalOrReligiousUsage");
  const political = validateBoolean(
    meta,
    "allowPoliticalOrReligiousUsage",
    `${basePath}.allowPoliticalOrReligiousUsage`,
    writer.add,
  );
  const antisocialRaw = ownValue(meta, "allowAntisocialOrHateUsage");
  const antisocial = validateBoolean(
    meta,
    "allowAntisocialOrHateUsage",
    `${basePath}.allowAntisocialOrHateUsage`,
    writer.add,
  );
  const thirdPartyLicenses = validateOptionalLicenseText(
    meta,
    "thirdPartyLicenses",
    `${basePath}.thirdPartyLicenses`,
    writer.add,
  );
  const otherLicenseUrl = validateOptionalUrl(
    meta,
    "otherLicenseUrl",
    `${basePath}.otherLicenseUrl`,
    writer.add
  );
  // VRM 1.0 requires its public-license document in `licenseUrl`. A second, exact canonical
  // Creative Commons URL is an explicit model license, not an opaque extra term. Anything else
  // remains in `additionalLicenseUrl` and therefore continues to fail closed in outgoing policy.
  const explicitCreativeCommonsLicense = explicitVrm1CreativeCommonsLicense(
    licenseUrl,
    otherLicenseUrl,
  );

  const diagnostics = Object.freeze(writer.diagnostics.map((entry) => Object.freeze(entry)));
  return deepFreeze({
    schema: "toonspectrum.vrm-license-metadata" as const,
    version: 1 as const,
    spec: "vrm1" as const,
    sourcePath: basePath,
    declaredSpecVersion,
    conformance: diagnostics.some(({ severity }) => severity === "error")
      ? "nonconformant" as const
      : "conformant" as const,
    metadataJsonBytes,
    title,
    authors: Object.freeze(authors),
    licenseIdentifier: explicitCreativeCommonsLicense?.identifier
      ?? (licenseUrl === STUDIO_VRM_1_PUBLIC_LICENSE_URL
        ? "VRM-Public-License-1.0"
        : null),
    licenseUrl: explicitCreativeCommonsLicense?.url ?? licenseUrl,
    additionalLicenseUrl: explicitCreativeCommonsLicense ? null : otherLicenseUrl,
    additionalPermissionUrl: null,
    avatarPermission: avatarPermissionRaw === undefined
      ? "only-author"
      : avatarPermissionEnum === "onlyAuthor"
        ? "only-author"
        : avatarPermissionEnum === "onlySeparatelyLicensedPerson"
          ? "only-separately-licensed-person"
          : avatarPermissionEnum === "everyone"
            ? "everyone"
            : "unknown",
    commercial: explicitCreativeCommonsLicense?.commercial
      ?? (commercialRaw === undefined
        ? "personal-nonprofit"
        : commercialEnum === "personalNonProfit"
          ? "personal-nonprofit"
          : commercialEnum === "personalProfit"
            ? "personal-profit"
            : commercialEnum === "corporation"
              ? "corporation"
              : "unknown"),
    modification: explicitCreativeCommonsLicense?.modification
      ?? (modificationRaw === undefined
        ? "prohibited"
        : modificationEnum === "prohibited"
          ? "prohibited"
          : modificationEnum === "allowModification"
            ? "allow-modification"
            : modificationEnum === "allowModificationRedistribution"
              ? "allow-modification-redistribution"
              : "unknown"),
    redistribution: explicitCreativeCommonsLicense?.redistribution
      ?? (redistributionRaw === undefined
        ? "disallow"
        : redistribution === true
          ? "allow"
          : redistribution === false
            ? "disallow"
            : "unknown"),
    credit: explicitCreativeCommonsLicense?.credit
      ?? (creditRaw === undefined
        ? "required"
        : creditEnum === "required"
          ? "required"
          : creditEnum === "unnecessary"
            ? "unnecessary"
            : "unknown"),
    violent: violentRaw === undefined
      ? "disallow"
      : violent === true
        ? "allow"
        : violent === false
          ? "disallow"
          : "unknown",
    sexual: sexualRaw === undefined
      ? "disallow"
      : sexual === true
        ? "allow"
        : sexual === false
          ? "disallow"
          : "unknown",
    politicalOrReligious: politicalRaw === undefined
      ? "disallow"
      : political === true
        ? "allow"
        : political === false
          ? "disallow"
          : "unknown",
    antisocialOrHate: antisocialRaw === undefined
      ? "disallow"
      : antisocial === true
        ? "allow"
        : antisocial === false
          ? "disallow"
          : "unknown",
    thirdPartyLicenses,
    shareAlike: explicitCreativeCommonsLicense?.shareAlike ?? "not-required" as const,
    rawIntent: {
      title: rawString(meta, "name"),
      authors: rawStringArray(meta, "authors"),
      licenseUrl: rawString(meta, "licenseUrl"),
      otherLicenseUrl: rawString(meta, "otherLicenseUrl"),
      otherPermissionUrl: null,
      legacyLicenseName: null,
      avatarPermission: rawString(meta, "avatarPermission"),
      commercial: rawString(meta, "commercialUsage"),
      modification: rawString(meta, "modification"),
      redistribution: rawBooleanOrString(meta, "allowRedistribution"),
      credit: rawString(meta, "creditNotation"),
      violent: rawBooleanOrString(meta, "allowExcessivelyViolentUsage"),
      sexual: rawBooleanOrString(meta, "allowExcessivelySexualUsage"),
      politicalOrReligious: rawBooleanOrString(meta, "allowPoliticalOrReligiousUsage"),
      antisocialOrHate: rawBooleanOrString(meta, "allowAntisocialOrHateUsage"),
      thirdPartyLicenses: rawString(meta, "thirdPartyLicenses"),
    },
    diagnostics,
  });
}

export function parseStudioVrmLicenseMetadata(
  input: unknown
): StudioVrmLicenseMetadataParseResult {
  try {
    const root = boundedRecord(input, "glTF root");
    const extensionsValue = ownValue(root, "extensions");
    if (extensionsValue === undefined) {
      return fail("missing-metadata", "The glTF document has no extensions object.");
    }
    const extensions = boundedRecord(extensionsValue, "extensions");
    const hasVrm0 = Object.prototype.hasOwnProperty.call(extensions, "VRM");
    const hasVrm1 = Object.prototype.hasOwnProperty.call(extensions, "VRMC_vrm");
    if (hasVrm0 && hasVrm1) {
      return fail(
        "ambiguous-metadata",
        "A glTF document cannot authorize actions through both VRM 0.x and VRM 1.0 metadata."
      );
    }
    if (!hasVrm0 && !hasVrm1) {
      return fail("missing-metadata", "The glTF document has no recognized VRM metadata extension.");
    }

    if (hasVrm1) {
      const extension = boundedRecord(ownValue(extensions, "VRMC_vrm"), "extensions.VRMC_vrm");
      const metaValue = ownValue(extension, "meta");
      if (metaValue === undefined) {
        return fail("missing-metadata", "extensions.VRMC_vrm.meta is required.");
      }
      const meta = boundedRecord(metaValue, "extensions.VRMC_vrm.meta");
      const metadataJsonBytes = inspectMetadataJson(meta);
      return deepFreeze({ ok: true as const, receipt: buildVrm1Receipt(extension, meta, metadataJsonBytes) });
    }

    const extension = boundedRecord(ownValue(extensions, "VRM"), "extensions.VRM");
    const metaValue = ownValue(extension, "meta");
    if (metaValue === undefined) {
      return fail("missing-metadata", "extensions.VRM.meta is required.");
    }
    const meta = boundedRecord(metaValue, "extensions.VRM.meta");
    const metadataJsonBytes = inspectMetadataJson(meta);
    return deepFreeze({ ok: true as const, receipt: buildVrm0Receipt(meta, metadataJsonBytes) });
  } catch (error) {
    if (error instanceof MetadataAdmissionError) return fail(error.code, error.message);
    return fail("invalid-root", "The glTF document could not be inspected as bounded JSON data.");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Receipt numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("Receipt must contain only plain JSON data.");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

/** Stable key ordering for a caller that wants to hash or sign an admitted receipt. */
export function canonicalStudioVrmLicenseMetadataReceiptJson(
  receipt: StudioVrmLicenseMetadataReceipt
): string {
  return canonicalJson(receipt);
}
