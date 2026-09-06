import { describe, expect, it } from "vitest";

import { createDefaultStudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import {
  commitStudioLinked3dPreparedPass,
  isStudioLinked3dPassRevisionForScene,
  prepareStudioLinked3dLinePass,
  validateStudioLinked3dPassRevisionDescriptor,
  type StudioLinked3dPassCasAuthority,
  type StudioLinked3dPreparedPass,
} from "./studio-linked-3d-pass-transaction";
import { createStudioLinked3dPassRevisionFixture } from "./studio-linked-3d-render-test-fixture";
import { sha256HexPortable } from "./studio-sha256";
import { hashStudioShared3dStageBackground } from "./studio-shared-3d-stage-document";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zcy8AAAAASUVORK5CYII=";
function createAuthority(options: {
  readonly kind?: StudioLinked3dPassCasAuthority["kind"];
  readonly delayHash?: `sha256:${string}`;
  readonly sharedOwners?: Map<string, string[]>;
  readonly runOwnerMutationExclusive?: <T>(owner: string, task: () => Promise<T>) => Promise<T>;
} = {}) {
  const blobs = new Map<string, Uint8Array>();
  const owners = options.sharedOwners ?? new Map<string, string[]>();
  const authority: StudioLinked3dPassCasAuthority = {
    kind: options.kind ?? "opfs",
    async put(bytes, putOptions) {
      const hash = `sha256:${sha256HexPortable(bytes)}` as const;
      blobs.set(hash, Uint8Array.from(bytes));
      return {
        ref: { hash, bytes: bytes.byteLength, mime: putOptions?.mime ?? "application/octet-stream" },
        entry: {
          hash,
          path: `blobs/${hash.slice(7)}.bin`,
          bytes: bytes.byteLength,
          storedBytes: bytes.byteLength,
          codec: "identity",
          mime: putOptions?.mime ?? "application/octet-stream",
          createdAt: 1,
          lastAccessAt: 1,
        },
        deduped: false,
      };
    },
    async get(hash) {
      const bytes = blobs.get(hash);
      return bytes ? Uint8Array.from(bytes) : null;
    },
    async ownerRefs(owner) {
      return [...(owners.get(owner) ?? [])] as `sha256:${string}`[];
    },
    async setOwnerRefs(owner, hashes) {
      if (options.delayHash && hashes.includes(options.delayHash)) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      const next = [...hashes].toSorted() as `sha256:${string}`[];
      owners.set(owner, next);
      return next;
    },
  };
  if (options.runOwnerMutationExclusive) {
    authority.runOwnerMutationExclusive = options.runOwnerMutationExclusive;
  }
  return { authority, blobs, owners };
}

function prepared(
  fill: string,
  revision: number,
): StudioLinked3dPreparedPass {
  const scene = createDefaultStudioBg3dSceneDocument();
  const sourceHash = hashStudioShared3dStageBackground(scene)!;
  return Object.freeze({
    descriptor: createStudioLinked3dPassRevisionFixture(scene, sourceHash, {
      revision,
      contentHash: `sha256:${fill.repeat(64)}`,
    }),
    originalDataUrl: PNG_DATA_URL,
  });
}

describe("Studio linked 3D pass transaction", () => {
  it("stores and verifies exact PNG bytes while keeping only a bounded CAS descriptor", async () => {
    const { authority } = createAuthority();
    const scene = createDefaultStudioBg3dSceneDocument();
    const sourceHash = hashStudioShared3dStageBackground(scene)!;
    const result = await prepareStudioLinked3dLinePass({
      authority,
      sourceHash,
      scene,
      layers: [{ role: "main-line", pngDataUrl: PNG_DATA_URL, width: 1, height: 1 }],
    });

    expect(validateStudioLinked3dPassRevisionDescriptor(result.descriptor)).toBe(true);
    expect(isStudioLinked3dPassRevisionForScene(result.descriptor, scene)).toBe(true);
    expect(result.descriptor.artifact.locator).toBe(
      `studio-opfs-cas:${result.descriptor.artifact.contentHash}`,
    );
    expect(JSON.stringify(result.descriptor)).not.toContain("data:image");
    expect(result.originalDataUrl).toBe(PNG_DATA_URL);
  });

  it("rejects non-durable fallback stores and descriptor extension keys", async () => {
    const { authority } = createAuthority({ kind: "memory" });
    const scene = createDefaultStudioBg3dSceneDocument();
    await expect(prepareStudioLinked3dLinePass({
      authority,
      sourceHash: hashStudioShared3dStageBackground(scene)!,
      scene,
      layers: [{ role: "main-line", pngDataUrl: PNG_DATA_URL, width: 1, height: 1 }],
    })).rejects.toMatchObject({
      code: "opfs-unavailable",
    });

    const descriptor = prepared("b", 1).descriptor;
    expect(validateStudioLinked3dPassRevisionDescriptor({
      ...descriptor,
      unexpectedUrl: "https://example.test/pass.png",
    })).toBe(false);
    expect(validateStudioLinked3dPassRevisionDescriptor({
      ...descriptor,
      artifact: { ...descriptor.artifact, unexpected: true },
    })).toBe(false);
  });

  it("rejects a source hash that is not the canonical Scene hash before writing CAS bytes", async () => {
    const { authority, blobs } = createAuthority();
    const scene = createDefaultStudioBg3dSceneDocument();
    const canonicalHash = hashStudioShared3dStageBackground(scene)!;
    const wrongHash = `sha256:${canonicalHash[7] === "0" ? "1" : "0"}${canonicalHash.slice(8)}` as const;

    await expect(prepareStudioLinked3dLinePass({
      authority,
      sourceHash: wrongHash,
      scene,
      layers: [{ role: "main-line", pngDataUrl: PNG_DATA_URL, width: 1, height: 1 }],
    })).rejects.toMatchObject({ code: "invalid-input" });
    expect(blobs.size).toBe(0);
  });

  it("rejects a declared raster size that differs from the PNG IHDR before writing CAS bytes", async () => {
    const { authority, blobs } = createAuthority();
    const scene = createDefaultStudioBg3dSceneDocument();

    await expect(prepareStudioLinked3dLinePass({
      authority,
      sourceHash: hashStudioShared3dStageBackground(scene)!,
      scene,
      layers: [{ role: "main-line", pngDataUrl: PNG_DATA_URL, width: 2, height: 1 }],
    })).rejects.toMatchObject({ code: "invalid-png" });
    expect(blobs.size).toBe(0);
  });

  it("serializes same-owner ref updates so concurrent commits cannot lose a successful hash", async () => {
    const first = prepared("b", 1);
    const second = prepared("c", 2);
    const { authority, owners } = createAuthority({
      delayHash: first.descriptor.artifact.contentHash,
    });

    await Promise.all([
      commitStudioLinked3dPreparedPass({
        authority,
        ownerId: "page-1:bundle-1",
        prepared: first,
        apply: () => "first",
      }),
      commitStudioLinked3dPreparedPass({
        authority,
        ownerId: "page-1:bundle-1",
        prepared: second,
        apply: () => "second",
      }),
    ]);

    expect(owners.get("page-1:bundle-1")).toEqual([
      first.descriptor.artifact.contentHash,
      second.descriptor.artifact.contentHash,
    ]);
  });

  it("uses the origin-wide owner seam across independent product authority instances", async () => {
    const first = prepared("6", 1);
    const second = prepared("7", 2);
    const sharedOwners = new Map<string, string[]>();
    const tails = new Map<string, Promise<void>>();
    const runOwnerMutationExclusive = <T>(owner: string, task: () => Promise<T>): Promise<T> => {
      const previous = tails.get(owner) ?? Promise.resolve();
      const run = previous.then(task, task);
      const settled = run.then(() => undefined, () => undefined);
      tails.set(owner, settled);
      return run.finally(() => {
        if (tails.get(owner) === settled) tails.delete(owner);
      });
    };
    const firstAuthority = createAuthority({
      sharedOwners,
      delayHash: first.descriptor.artifact.contentHash,
      runOwnerMutationExclusive,
    }).authority;
    const secondAuthority = createAuthority({
      sharedOwners,
      runOwnerMutationExclusive,
    }).authority;

    await Promise.all([
      commitStudioLinked3dPreparedPass({
        authority: firstAuthority,
        ownerId: "page-cross-tab:bundle",
        prepared: first,
        apply: () => "first",
      }),
      commitStudioLinked3dPreparedPass({
        authority: secondAuthority,
        ownerId: "page-cross-tab:bundle",
        prepared: second,
        apply: () => "second",
      }),
    ]);

    expect(sharedOwners.get("page-cross-tab:bundle")).toEqual([
      first.descriptor.artifact.contentHash,
      second.descriptor.artifact.contentHash,
    ]);
  });

  it("rolls back only the rejected transaction before admitting the next same-owner commit", async () => {
    const first = prepared("d", 1);
    const second = prepared("e", 2);
    const { authority, owners } = createAuthority();

    const rejected = commitStudioLinked3dPreparedPass({
      authority,
      ownerId: "page-2:bundle-2",
      prepared: first,
      apply: () => false,
    });
    const accepted = commitStudioLinked3dPreparedPass({
      authority,
      ownerId: "page-2:bundle-2",
      prepared: second,
      apply: () => true,
    });

    await expect(rejected).rejects.toMatchObject({ code: "commit-rejected" });
    await expect(accepted).resolves.toBe(true);
    expect(owners.get("page-2:bundle-2")).toEqual([
      second.descriptor.artifact.contentHash,
    ]);
  });

  it("restores the exact previous refs when forward publication mutates then throws", async () => {
    const next = prepared("8", 2);
    const { authority, owners } = createAuthority();
    const ownerId = "page-commit-unknown:bundle";
    const previousHash = `sha256:${"9".repeat(64)}`;
    owners.set(ownerId, [previousHash]);
    const setOwnerRefs = authority.setOwnerRefs.bind(authority);
    const forwardError = new Error("forward-owner-ack-lost");
    let publications = 0;
    let applyCalled = false;
    authority.setOwnerRefs = async (owner, hashes) => {
      publications += 1;
      const result = await setOwnerRefs(owner, hashes);
      if (publications === 1) throw forwardError;
      return result;
    };

    await expect(commitStudioLinked3dPreparedPass({
      authority,
      ownerId,
      prepared: next,
      apply: () => {
        applyCalled = true;
        return true;
      },
    })).rejects.toBe(forwardError);

    expect(applyCalled).toBe(false);
    expect(publications).toBe(2);
    expect(owners.get(ownerId)).toEqual([previousHash]);
  });

  it("surfaces original and rollback failures when exact previous-ref restoration throws", async () => {
    const next = prepared("a", 2);
    const { authority, owners } = createAuthority();
    const ownerId = "page-rollback-failure:bundle";
    const previousHash = `sha256:${"b".repeat(64)}`;
    owners.set(ownerId, [previousHash]);
    const setOwnerRefs = authority.setOwnerRefs.bind(authority);
    const forwardError = new Error("forward-owner-ack-lost");
    const rollbackError = new Error("rollback-owner-ack-lost");
    let publications = 0;
    authority.setOwnerRefs = async (owner, hashes) => {
      publications += 1;
      await setOwnerRefs(owner, hashes);
      if (publications === 1) throw forwardError;
      throw rollbackError;
    };

    let rejected: unknown;
    try {
      await commitStudioLinked3dPreparedPass({
        authority,
        ownerId,
        prepared: next,
        apply: () => true,
      });
    } catch (cause) {
      rejected = cause;
    }

    expect(rejected).toBeInstanceOf(AggregateError);
    expect((rejected as AggregateError).errors).toEqual([forwardError, rollbackError]);
    expect((rejected as AggregateError).cause).toBe(forwardError);
    expect(publications).toBe(2);
    expect(owners.get(ownerId)).toEqual([previousHash]);
  });
});
