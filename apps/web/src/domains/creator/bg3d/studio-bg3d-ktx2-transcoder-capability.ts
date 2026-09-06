/**
 * Minimal same-realm capability registry kept separate from the hash manifest so GLB structural
 * validation does not pull release-only asset metadata into the Studio entry chunk.
 */

export interface StudioBg3dKtx2TranscoderCapability {
  readonly protocolVersion: 1;
  readonly transcoderId: "three@0.184.0/basis_transcoder";
  readonly javascriptSha256: `sha256:${string}`;
  readonly wasmSha256: `sha256:${string}`;
  readonly maxSourceBytes: number;
  readonly maxDecodedBytes: number;
}

const ISSUED_CAPABILITIES = new WeakSet<object>();

/** @internal Called only after the full executable-asset attestation succeeds. */
export function issueAttestedStudioBg3dKtx2TranscoderCapability(
  capability: StudioBg3dKtx2TranscoderCapability,
): void {
  ISSUED_CAPABILITIES.add(capability);
}

/**
 * True only for a capability produced after hashing the pinned assets in this JavaScript realm.
 * Structured cloning intentionally drops this proof: a validation/transcode Worker must attest
 * the assets it will execute instead of trusting a main-thread message.
 */
export function isAttestedStudioBg3dKtx2TranscoderCapability(
  value: unknown,
): value is StudioBg3dKtx2TranscoderCapability {
  return typeof value === "object" && value !== null && ISSUED_CAPABILITIES.has(value);
}
