import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  inspectStudioVrmLicenseAuthority,
  unknownStudioVrmLicenseAuthority,
  type StudioVrmLicenseAuthority,
} from "./studio-vrm-license-product-gate";

import type { StudioLocalDatabase } from "../studio-local-database";
import type { StudioVrmLicenseMetadataFailureCode } from "./studio-vrm-license-metadata";

export const STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE =
  "studio-vrm-license-authority-v1";
export const STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES = 72 * 1024;

const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TEXT_ENCODER = new TextEncoder();
const FAILURE_CODES = new Set<StudioVrmLicenseMetadataFailureCode>([
  "invalid-root",
  "unsafe-container",
  "missing-metadata",
  "ambiguous-metadata",
  "metadata-not-json",
  "metadata-budget-exceeded",
]);

type JsonRecord = Record<string, unknown>;
type DatabasePort = Pick<StudioLocalDatabase, "kvDelete" | "kvGet" | "kvSet">;

type PersistedSource =
  | {
      readonly kind: "vrm0";
      readonly meta: JsonRecord;
    }
  | {
      readonly kind: "vrm1";
      readonly specVersion?: string | null;
      readonly meta: JsonRecord;
    }
  | {
      readonly kind: "unknown";
      readonly code: StudioVrmLicenseMetadataFailureCode;
      readonly message: string;
    };

interface PersistedEnvelope {
  readonly schema: "toonspectrum.vrm-license-authority-source";
  readonly version: 1;
  readonly contentHash: string;
  readonly source: PersistedSource;
}

export interface StudioVrmLicenseAuthorityStore {
  /** Revalidates the persisted bounded source; a corrupt receipt becomes explicit unknown. */
  get(contentHash: string): Promise<StudioVrmLicenseAuthority | null>;
  /** Persists only the selected VRM extension metadata, never the model's full glTF JSON. */
  put(contentHash: string, gltfJson: unknown): Promise<StudioVrmLicenseAuthority>;
  delete(contentHash: string): Promise<void>;
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalContentHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CONTENT_HASH_PATTERN.test(normalized)) {
    throw new TypeError("VRM license receipt에는 canonical sha256 콘텐츠 해시가 필요합니다.");
  }
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("VRM license source는 JSON 값이어야 합니다.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainRecord(value)) {
    throw new TypeError("VRM license source는 plain JSON 객체여야 합니다.");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function selectedSource(
  gltfJson: unknown,
  authority: StudioVrmLicenseAuthority,
): PersistedSource {
  if (authority.status === "unknown") {
    const code = FAILURE_CODES.has(authority.code as StudioVrmLicenseMetadataFailureCode)
      ? authority.code as StudioVrmLicenseMetadataFailureCode
      : "invalid-root";
    return { kind: "unknown", code, message: authority.message };
  }
  if (!isPlainRecord(gltfJson) || !isPlainRecord(gltfJson.extensions)) {
    throw new TypeError("검증된 VRM license source를 다시 선택할 수 없습니다.");
  }
  if (authority.receipt.spec === "vrm1") {
    const extension = gltfJson.extensions.VRMC_vrm;
    if (!isPlainRecord(extension) || !isPlainRecord(extension.meta)) {
      throw new TypeError("검증된 VRM 1.0 license source가 없습니다.");
    }
    // Persist only the already bounded normalized scalar. A malformed raw specVersion may be an
    // arbitrary object; retaining it would reopen an unbounded JSON traversal outside the parser.
    return {
      kind: "vrm1",
      ...(Object.hasOwn(extension, "specVersion")
        ? { specVersion: authority.receipt.declaredSpecVersion }
        : {}),
      meta: extension.meta,
    };
  }
  const extension = gltfJson.extensions.VRM;
  if (!isPlainRecord(extension) || !isPlainRecord(extension.meta)) {
    throw new TypeError("검증된 VRM 0.x license source가 없습니다.");
  }
  return { kind: "vrm0", meta: extension.meta };
}

function parsePersistedAuthority(raw: string, expectedHash: string): StudioVrmLicenseAuthority {
  if (TEXT_ENCODER.encode(raw).byteLength > STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES) {
    return unknownStudioVrmLicenseAuthority(
      "receipt-unavailable",
      "저장된 VRM 이용 조건 receipt가 byte budget을 초과했습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unknownStudioVrmLicenseAuthority(
      "receipt-unavailable",
      "저장된 VRM 이용 조건 receipt JSON이 손상되었습니다.",
    );
  }
  if (
    !isPlainRecord(parsed)
    || parsed.schema !== "toonspectrum.vrm-license-authority-source"
    || parsed.version !== 1
    || parsed.contentHash !== expectedHash
    || !isPlainRecord(parsed.source)
  ) {
    return unknownStudioVrmLicenseAuthority(
      "receipt-unavailable",
      "저장된 VRM 이용 조건 receipt의 schema 또는 콘텐츠 해시가 일치하지 않습니다.",
    );
  }
  const source = parsed.source;
  if (source.kind === "unknown") {
    return typeof source.code === "string"
      && FAILURE_CODES.has(source.code as StudioVrmLicenseMetadataFailureCode)
      && typeof source.message === "string"
      ? unknownStudioVrmLicenseAuthority(
          source.code as StudioVrmLicenseMetadataFailureCode,
          source.message,
        )
      : unknownStudioVrmLicenseAuthority("receipt-unavailable");
  }
  if (source.kind === "vrm0" && isPlainRecord(source.meta)) {
    return inspectStudioVrmLicenseAuthority({ extensions: { VRM: { meta: source.meta } } });
  }
  if (source.kind === "vrm1" && isPlainRecord(source.meta)) {
    return inspectStudioVrmLicenseAuthority({
      extensions: {
        VRMC_vrm: { specVersion: source.specVersion, meta: source.meta },
      },
    });
  }
  return unknownStudioVrmLicenseAuthority(
    "receipt-unavailable",
    "저장된 VRM 이용 조건 source가 올바르지 않습니다.",
  );
}

export function createStudioVrmLicenseAuthorityStore(
  acquireDatabase: () => Promise<DatabasePort> = acquireStudioLocalDatabase,
): StudioVrmLicenseAuthorityStore {
  return Object.freeze({
    async get(contentHash: string) {
      const canonicalHash = canonicalContentHash(contentHash);
      const raw = await (await acquireDatabase()).kvGet(
        STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE,
        canonicalHash,
      );
      return raw === null ? null : parsePersistedAuthority(raw, canonicalHash);
    },
    async put(contentHash: string, gltfJson: unknown) {
      const canonicalHash = canonicalContentHash(contentHash);
      const authority = inspectStudioVrmLicenseAuthority(gltfJson);
      const envelope: PersistedEnvelope = {
        schema: "toonspectrum.vrm-license-authority-source",
        version: 1,
        contentHash: canonicalHash,
        source: selectedSource(gltfJson, authority),
      };
      const raw = canonicalJson(envelope);
      if (TEXT_ENCODER.encode(raw).byteLength > STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES) {
        throw new RangeError("VRM license receipt가 저장 byte budget을 초과했습니다.");
      }
      await (await acquireDatabase()).kvSet(
        STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE,
        canonicalHash,
        raw,
      );
      return authority;
    },
    async delete(contentHash: string) {
      await (await acquireDatabase()).kvDelete(
        STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE,
        canonicalContentHash(contentHash),
      );
    },
  });
}

let productStore: StudioVrmLicenseAuthorityStore | null = null;

export function getProductStudioVrmLicenseAuthorityStore(): StudioVrmLicenseAuthorityStore {
  productStore ??= createStudioVrmLicenseAuthorityStore();
  return productStore;
}
