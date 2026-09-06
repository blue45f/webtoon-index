import {
  isAttestedStudioBg3dKtx2TranscoderCapability,
  issueAttestedStudioBg3dKtx2TranscoderCapability,
  type StudioBg3dKtx2TranscoderCapability,
} from "./studio-bg3d-ktx2-transcoder-capability";
import {
  inspectStudioBg3dBasisKtx2,
  type StudioBg3dBasisKtx2Info,
} from "./studio-bg3d-ktx2-validation";

export {
  isAttestedStudioBg3dKtx2TranscoderCapability,
  type StudioBg3dKtx2TranscoderCapability,
} from "./studio-bg3d-ktx2-transcoder-capability";

const SHA256_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/iu;

/**
 * Hard admission ceilings applied before a Basis transcoder may observe untrusted bytes.
 * Per-document GLB texture budgets remain stricter when applicable.
 */
export const STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const STUDIO_BG3D_KTX2_TRANSCODE_MAX_DECODED_BYTES = 256 * 1024 * 1024;

export interface StudioBg3dKtx2TranscoderAssetManifestEntry {
  readonly fileName: "basis_transcoder.js" | "basis_transcoder.wasm";
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
}

/**
 * Three r184 ships these Apache-2.0 Basis Universal runtime files. Their exact byte contracts are
 * pinned so a package upgrade cannot silently replace executable JS/WASM at the renderer boundary.
 */
export const STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST = Object.freeze({
  id: "three@0.184.0/basis_transcoder" as const,
  javascript: Object.freeze({
    fileName: "basis_transcoder.js" as const,
    byteLength: 57_529,
    sha256: "sha256:8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1" as const,
  }),
  wasm: Object.freeze({
    fileName: "basis_transcoder.wasm" as const,
    byteLength: 527_333,
    sha256: "sha256:6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a" as const,
  }),
});

export type StudioBg3dKtx2Digest = (
  bytes: Uint8Array,
) => Promise<ArrayBuffer | Uint8Array | string>;

export interface StudioBg3dKtx2TranscoderAssets {
  readonly javascript: Uint8Array;
  readonly wasm: Uint8Array;
}

export interface StudioBg3dAttestedKtx2Transcoder
  extends StudioBg3dKtx2TranscoderCapability {
  /** Fresh copies of the exact private snapshots that passed executable-asset attestation. */
  readonly copyVerifiedAssets: () => StudioBg3dKtx2TranscoderAssets;
}

export interface StudioBg3dKtx2TranscodeAdmissionOptions {
  /** Must have been issued by an asset attestation in this execution realm. */
  readonly capability: StudioBg3dAttestedKtx2Transcoder;
  /** Optional content-address supplied by a trusted attachment manifest. */
  readonly expectedSha256?: string;
  /** A caller may lower, but never raise, either hard ceiling. */
  readonly maxSourceBytes?: number;
  readonly maxDecodedBytes?: number;
  /** Dependency injection for restricted workers and deterministic tests. */
  readonly digest?: StudioBg3dKtx2Digest;
}

export interface StudioBg3dKtx2TranscodeAdmission extends StudioBg3dBasisKtx2Info {
  readonly transcoderId: typeof STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.id;
  readonly sourceByteLength: number;
  readonly sourceSha256: `sha256:${string}`;
  /** Fresh copy of the exact private payload snapshot that passed every admission gate. */
  readonly copyVerifiedSource: () => Uint8Array;
}

function normalizeSha256(value: string): string | null {
  const match = SHA256_PATTERN.exec(value.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

async function calculateSha256(
  source: Uint8Array,
  digest?: StudioBg3dKtx2Digest,
): Promise<string | null> {
  try {
    if (digest) {
      const result = await digest(Uint8Array.from(source));
      if (typeof result === "string") return normalizeSha256(result);
      const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
      return bytes.byteLength === 32 ? bytesToHex(bytes) : null;
    }
    if (!globalThis.crypto?.subtle) return null;
    // Callers cannot reach these private snapshots. Avoid a second full-size allocation in the
    // production ArrayBuffer path; injected adapters and SharedArrayBuffer views remain copied.
    const digestSource = source.buffer instanceof ArrayBuffer
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : Uint8Array.from(source);
    const result = await globalThis.crypto.subtle.digest("SHA-256", digestSource);
    return bytesToHex(new Uint8Array(result));
  } catch {
    return null;
  }
}

function validLimit(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

/**
 * Hashes the exact executable assets before issuing a same-realm capability. This is an integrity
 * admission contract, not a remote-code signature or an authorization token.
 */
export async function attestStudioBg3dKtx2TranscoderAssets(
  assets: StudioBg3dKtx2TranscoderAssets,
  digest?: StudioBg3dKtx2Digest,
): Promise<StudioBg3dAttestedKtx2Transcoder | null> {
  if (
    !(assets.javascript instanceof Uint8Array) || !(assets.wasm instanceof Uint8Array) ||
    assets.javascript.byteLength !== STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.byteLength ||
    assets.wasm.byteLength !== STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.byteLength
  ) return null;

  // Retain the same private copies that are hashed. Downstream decoder setup can only obtain fresh
  // copies of these snapshots, never a second read from the caller-owned arrays.
  const javascriptSnapshot = Uint8Array.from(assets.javascript);
  const wasmSnapshot = Uint8Array.from(assets.wasm);
  const [javascriptDigest, wasmDigest] = await Promise.all([
    calculateSha256(javascriptSnapshot, digest),
    calculateSha256(wasmSnapshot, digest),
  ]);
  const expectedJavascript = normalizeSha256(
    STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.sha256,
  );
  const expectedWasm = normalizeSha256(STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.sha256);
  if (
    !javascriptDigest || !wasmDigest || !expectedJavascript || !expectedWasm ||
    !constantTimeHexEqual(javascriptDigest, expectedJavascript) ||
    !constantTimeHexEqual(wasmDigest, expectedWasm)
  ) return null;

  const capability: StudioBg3dAttestedKtx2Transcoder = Object.freeze({
    protocolVersion: 1,
    transcoderId: STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.id,
    javascriptSha256: STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.javascript.sha256,
    wasmSha256: STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.sha256,
    maxSourceBytes: STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES,
    maxDecodedBytes: STUDIO_BG3D_KTX2_TRANSCODE_MAX_DECODED_BYTES,
    copyVerifiedAssets: () => ({
      javascript: Uint8Array.from(javascriptSnapshot),
      wasm: Uint8Array.from(wasmSnapshot),
    }),
  });
  issueAttestedStudioBg3dKtx2TranscoderCapability(capability);
  return capability;
}

/**
 * Creates an immutable, content-addressed job only after structure, allocation, runtime integrity,
 * and optional attachment checksum gates pass. The actual decoder must still report success for
 * every mip; structural validation cannot prove arbitrary compressed payload semantics.
 */
export async function admitStudioBg3dKtx2Transcode(
  input: Uint8Array,
  options: StudioBg3dKtx2TranscodeAdmissionOptions,
): Promise<StudioBg3dKtx2TranscodeAdmission | null> {
  if (
    !(input instanceof Uint8Array) ||
    !options || !isAttestedStudioBg3dKtx2TranscoderCapability(options.capability) ||
    typeof options.capability.copyVerifiedAssets !== "function" ||
    (options.maxSourceBytes !== undefined && !validLimit(options.maxSourceBytes)) ||
    (options.maxDecodedBytes !== undefined && !validLimit(options.maxDecodedBytes))
  ) return null;

  const maxSourceBytes = Math.min(
    options.maxSourceBytes ?? STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES,
    STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES,
  );
  if (input.byteLength === 0 || input.byteLength > maxSourceBytes) return null;

  const snapshot = Uint8Array.from(input);
  const info = inspectStudioBg3dBasisKtx2(snapshot);
  const maxDecodedBytes = Math.min(
    options.maxDecodedBytes ?? STUDIO_BG3D_KTX2_TRANSCODE_MAX_DECODED_BYTES,
    STUDIO_BG3D_KTX2_TRANSCODE_MAX_DECODED_BYTES,
  );
  if (!info || info.estimatedDecodedBytes > maxDecodedBytes) return null;

  const expectedDigest = options.expectedSha256 === undefined
    ? null
    : normalizeSha256(options.expectedSha256);
  if (options.expectedSha256 !== undefined && !expectedDigest) return null;
  const sourceDigest = await calculateSha256(snapshot, options.digest);
  if (!sourceDigest || (expectedDigest && !constantTimeHexEqual(sourceDigest, expectedDigest))) {
    return null;
  }

  return Object.freeze({
    ...info,
    transcoderId: options.capability.transcoderId,
    sourceByteLength: snapshot.byteLength,
    sourceSha256: `sha256:${sourceDigest}`,
    copyVerifiedSource: () => Uint8Array.from(snapshot),
  });
}
