/** Rare PNG/CAS implementation loaded only when a linked 3D pass is persisted. */

import {
  computeStudioLinked3dPassRootHash,
  computeStudioLinked3dSceneRevisionSignatures,
  inspectStudioLinked3dPassPng,
  STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES,
  StudioLinked3dPassAuthorityError,
  studioLinked3dPassLocator,
} from "./studio-linked-3d-pass-transaction";
import { sha256HexPortable } from "./studio-sha256";

import type {
  CommitStudioLinked3dPreparedPassInput,
  PrepareStudioLinked3dLinePassInput,
  StudioLinked3dPassCasAuthority,
  StudioLinked3dPreparedPass,
} from "./studio-linked-3d-pass-transaction";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function passError(
  code: StudioLinked3dPassAuthorityError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new StudioLinked3dPassAuthorityError(code, message, cause);
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function finitePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function decodePngDataUrl(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    passError("invalid-png", "연결형 3D 패스가 PNG data URL이 아닙니다.");
  }
  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  if (
    base64.length === 0
    || base64.length > Math.ceil(STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES / 3) * 4 + 4
    || base64.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)
    || typeof globalThis.atob !== "function"
  ) {
    passError("invalid-png", "연결형 3D PNG 인코딩이 손상되었거나 안전 한도를 넘었습니다.");
  }
  let binary: string;
  try {
    binary = globalThis.atob(base64);
  } catch (cause) {
    passError("invalid-png", "연결형 3D PNG를 해독하지 못했습니다.", cause);
  }
  if (binary.length === 0 || binary.length > STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES) {
    passError("invalid-png", "연결형 3D PNG 바이트 수가 안전 한도를 벗어났습니다.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    passError("invalid-png", "연결형 3D 패스의 PNG signature가 올바르지 않습니다.");
  }
  return bytes;
}

export async function prepareStudioLinked3dLinePassRuntime(
  input: PrepareStudioLinked3dLinePassInput,
): Promise<StudioLinked3dPreparedPass> {
  if (input.authority.kind !== "opfs") {
    passError("opfs-unavailable", "연결형 3D 패스에는 durable OPFS CAS가 필요합니다.");
  }
  if (!SHA256_PATTERN.test(input.sourceHash)) {
    passError("invalid-input", "연결형 3D 패스 source hash가 올바르지 않습니다.");
  }
  const signatures = computeStudioLinked3dSceneRevisionSignatures(input.scene);
  if (input.sourceHash !== signatures.sceneHash) {
    passError("invalid-input", "연결형 3D 패스 source hash가 canonical Scene과 다릅니다.");
  }
  const lineLayers = input.layers.filter(({ role }) => role === "main-line");
  if (lineLayers.length !== 1) {
    passError("invalid-input", "연결형 3D line pass는 main-line 레이어를 정확히 하나 요구합니다.");
  }
  const layer = lineLayers[0]!;
  if (!finitePositiveInteger(layer.width) || !finitePositiveInteger(layer.height)) {
    passError("invalid-input", "연결형 3D line pass 크기가 올바르지 않습니다.");
  }
  const bytes = decodePngDataUrl(layer.pngDataUrl);
  const pngHeader = inspectStudioLinked3dPassPng(bytes);
  if (!pngHeader || pngHeader.width !== layer.width || pngHeader.height !== layer.height) {
    passError("invalid-png", "연결형 3D PNG의 실제 IHDR 크기가 line pass receipt와 다릅니다.");
  }
  const put = await input.authority.put(bytes, { mime: "image/png" });
  const actualHash = sha256Bytes(bytes);
  if (
    put.ref.hash !== actualHash
    || put.ref.bytes !== bytes.byteLength
    || put.ref.mime !== "image/png"
  ) {
    passError("integrity-mismatch", "OPFS CAS 영수증이 3D line pass 바이트와 다릅니다.");
  }
  const verified = await input.authority.get(actualHash, { verify: true });
  if (!verified || verified.byteLength !== bytes.byteLength || sha256Bytes(verified) !== actualHash) {
    passError("integrity-mismatch", "OPFS CAS에서 3D line pass를 정확히 다시 읽지 못했습니다.");
  }
  const artifact = Object.freeze({
    pass: "line" as const,
    role: "main-line" as const,
    contentHash: actualHash,
    byteSize: bytes.byteLength,
    mime: "image/png" as const,
    width: layer.width,
    height: layer.height,
    locator: studioLinked3dPassLocator(actualHash),
  });
  const contentMatchesPrevious = Boolean(
    input.previous
    && input.previous.sourceHash === input.sourceHash
    && input.previous.sceneHash === signatures.sceneHash
    && input.previous.cameraHash === signatures.cameraHash
    && input.previous.baseGeometryHash === signatures.baseGeometryHash
    && input.previous.topologyHash === signatures.topologyHash
    && input.previous.objectIdentityHash === signatures.objectIdentityHash
    && input.previous.artifact.contentHash === artifact.contentHash
  );
  if (contentMatchesPrevious) {
    return Object.freeze({ descriptor: input.previous!, originalDataUrl: layer.pngDataUrl });
  }
  const withoutRoot = Object.freeze({
    revision: (input.previous?.revision ?? 0) + 1,
    sourceHash: input.sourceHash,
    ...signatures,
    artifact,
  });
  const descriptor = Object.freeze({
    ...withoutRoot,
    passRootHash: computeStudioLinked3dPassRootHash(withoutRoot),
  });
  return Object.freeze({ descriptor, originalDataUrl: layer.pngDataUrl });
}

const ownerMutationTails = new WeakMap<
StudioLinked3dPassCasAuthority,
Map<string, Promise<void>>
>();

export async function sequenceStudioLinked3dPassOwnerMutationRuntime<T>(
  authority: StudioLinked3dPassCasAuthority,
  ownerId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (authority.runOwnerMutationExclusive) {
    return await authority.runOwnerMutationExclusive(ownerId, task);
  }
  let tails = ownerMutationTails.get(authority);
  if (!tails) {
    tails = new Map();
    ownerMutationTails.set(authority, tails);
  }
  const previous = tails.get(ownerId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  tails.set(ownerId, settled);
  try {
    return await run;
  } finally {
    if (tails.get(ownerId) === settled) tails.delete(ownerId);
  }
}

export async function commitStudioLinked3dPreparedPassRuntime<T>(
  input: CommitStudioLinked3dPreparedPassInput<T>,
): Promise<T> {
  if (input.authority.kind !== "opfs" || !input.ownerId.trim()) {
    passError("opfs-unavailable", "연결형 3D pass owner를 durable OPFS에 결박하지 못했습니다.");
  }
  return await sequenceStudioLinked3dPassOwnerMutationRuntime(
    input.authority,
    input.ownerId,
    async () => {
      const previousRefs = await input.authority.ownerRefs(input.ownerId);
      const nextRefs = [...new Set([
        ...previousRefs,
        input.prepared.descriptor.artifact.contentHash,
      ])].toSorted();
      try {
        // Publication may mutate durable owner state and then lose its acknowledgement. Keep the
        // attempted write inside the compensation boundary so every forward failure restores the
        // exact snapshot captured under this same owner fence.
        await input.authority.setOwnerRefs(input.ownerId, nextRefs);
        const result = input.apply(input.prepared.descriptor);
        if (result === false) {
          passError("commit-rejected", "Studio 문서가 3D pass commit을 거절했습니다.");
        }
        return result;
      } catch (cause) {
        let rollbackFailure: unknown;
        try {
          await input.authority.setOwnerRefs(input.ownerId, previousRefs);
        } catch (rollbackCause) {
          rollbackFailure = rollbackCause;
        }
        if (rollbackFailure !== undefined) {
          throw new AggregateError(
            [cause, rollbackFailure],
            "연결형 3D pass commit 실패 뒤 owner 참조를 되돌리지 못했습니다.",
            { cause },
          );
        }
        throw cause;
      }
    },
  );
}
