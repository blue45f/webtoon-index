import { describe, expect, it, vi } from "vitest";

import {
  compensateStudioLinked3dPassCloudUploads,
  createStudioLinked3dPassCloudAssetDescriptor,
  ensureStudioLinked3dPassCloudArtifacts,
  hydrateStudioLinked3dPassCloudArtifacts,
  studioLinked3dPassCloudAssetReference,
} from "./studio-linked-3d-pass-cloud-sync";
import { collectStudioLinked3dPassProjectArchiveReferences } from "./studio-linked-3d-pass-project-archive";
import {
  computeStudioLinked3dPassRootHash,
  prepareStudioLinked3dLinePass,
  type StudioLinked3dPassArtifactDescriptor,
  type StudioLinked3dPassCasAuthority,
  type StudioLinked3dPassRevisionDescriptor,
} from "./studio-linked-3d-pass-transaction";
import {
  materializeStudioLinked3dLinePassLocator,
  parseStudioLinked3dRenderDocument,
  upsertStudioLinked3dRenderLink,
} from "./studio-linked-3d-render-document";
import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import { parseStudioProjectFile, type StudioProjectFile } from "./studio-project-file";
import { sha256HexPortable } from "./studio-sha256";
import { studioShared3dStageEntryAsDocument } from "./studio-shared-3d-stage-collection";

import type { StudioWorkAssetReference } from "./studio-work-asset-client";
import type {
  StudioWorkAssetDescriptor,
  StudioWorkAssetManifest,
} from "@/shared/lib/studio-work-asset-contract";

const ONE_BY_ONE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zcy8AAAAASUVORK5CYII=";
const FOUR_BY_ONE_BACKGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";
const FOUR_BY_ONE_FOREGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR42mMQ0bBxCEipaGCAAgAbbQJlJs9SqgAAAABJRU5ErkJggg==";

interface PngFixture {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

const PNG_FIXTURES: readonly PngFixture[] = [
  { dataUrl: ONE_BY_ONE_PNG, width: 1, height: 1 },
  { dataUrl: FOUR_BY_ONE_BACKGROUND_PNG, width: 4, height: 1 },
  { dataUrl: FOUR_BY_ONE_FOREGROUND_PNG, width: 4, height: 1 },
];

function createAuthority(options: {
  readonly kind?: StudioLinked3dPassCasAuthority["kind"];
  readonly wrongPutReceipt?: boolean;
} = {}) {
  const blobs = new Map<string, Uint8Array>();
  const owners = new Map<string, string[]>();
  const stats = { gets: 0, puts: 0, ownerSets: 0 };
  const authority: StudioLinked3dPassCasAuthority = {
    kind: options.kind ?? "opfs",
    async put(bytes, putOptions) {
      stats.puts += 1;
      const hash = `sha256:${sha256HexPortable(bytes)}` as const;
      const copy = Uint8Array.from(bytes);
      const deduped = blobs.has(hash);
      blobs.set(hash, copy);
      const mime = putOptions?.mime ?? "application/octet-stream";
      const receiptHash = options.wrongPutReceipt
        ? `sha256:${"f".repeat(64)}` as const
        : hash;
      return {
        ref: { hash: receiptHash, bytes: copy.byteLength, mime },
        entry: {
          hash,
          path: `blobs/${hash.slice(7)}.bin`,
          bytes: copy.byteLength,
          storedBytes: copy.byteLength,
          codec: "identity",
          mime,
          createdAt: 1,
          lastAccessAt: 1,
        },
        deduped,
      };
    },
    async get(hash) {
      stats.gets += 1;
      const bytes = blobs.get(hash);
      return bytes ? Uint8Array.from(bytes) : null;
    },
    async ownerRefs(owner) {
      return [...(owners.get(owner) ?? [])] as `sha256:${string}`[];
    },
    async setOwnerRefs(owner, hashes) {
      stats.ownerSets += 1;
      const next = [...hashes].toSorted() as `sha256:${string}`[];
      owners.set(owner, next);
      return next;
    },
  };
  return { authority, blobs, owners, stats };
}

async function linkedPage(
  pageId: string,
  authority: StudioLinked3dPassCasAuthority,
  png: PngFixture,
) {
  const page = createStudioLinked3dRenderPageFixture(pageId);
  const current = page.linked3dRender!.links[0]!;
  const stage = studioShared3dStageEntryAsDocument(page.shared3dStage, current.bundleId);
  const sceneElement = page.elements.find((element) =>
    element.type === "image" && element.bg3dScene);
  const scene = sceneElement?.type === "image" ? sceneElement.bg3dScene : undefined;
  if (!stage || !scene?.activeShotId) throw new Error("linked cloud fixture setup failed");
  const prepared = await prepareStudioLinked3dLinePass({
    authority,
    sourceHash: stage.background.sourceHash,
    scene,
    layers: [{
      role: "main-line",
      pngDataUrl: png.dataUrl,
      width: png.width,
      height: png.height,
    }],
  });
  const elements = materializeStudioLinked3dLinePassLocator(
    page.elements,
    current.bundleId,
    prepared.descriptor,
  );
  if (!elements) throw new Error("linked cloud locator fixture setup failed");
  const linked3dRender = upsertStudioLinked3dRenderLink({
    value: page.linked3dRender,
    bundleId: current.bundleId,
    shotId: scene.activeShotId,
    passRevision: prepared.descriptor,
    elements,
    shared3dStage: page.shared3dStage!,
  });
  if (!linked3dRender) throw new Error("linked cloud receipt fixture setup failed");
  return { ...page, elements, linked3dRender };
}

async function projectWithPngs(
  authority: StudioLinked3dPassCasAuthority,
  pngs: readonly PngFixture[],
): Promise<StudioProjectFile> {
  const pagesList = await Promise.all(pngs.map(async (png, index) =>
    await linkedPage(`cloud-page-${index + 1}`, authority, png)));
  return parseStudioProjectFile({
    version: 2,
    title: "Linked pass cloud",
    description: "cross-device exact PNG",
    tagsText: "3d",
    pagesList,
    currentPageId: pagesList[0]!.id,
    webtoonTheme: "classic",
    panelGutter: 24,
  });
}

function rewriteFirstArtifact(
  project: StudioProjectFile,
  patch: Partial<StudioLinked3dPassArtifactDescriptor>,
): StudioProjectFile {
  const page = project.pagesList[0]!;
  const document = parseStudioLinked3dRenderDocument(page.linked3dRender);
  const link = document?.links[0];
  if (!document || !link) throw new Error("linked cloud rewrite fixture setup failed");
  const artifact = { ...link.passRevision.artifact, ...patch };
  const passInput: Omit<StudioLinked3dPassRevisionDescriptor, "passRootHash"> = {
    revision: link.passRevision.revision,
    sourceHash: link.passRevision.sourceHash,
    sceneHash: link.passRevision.sceneHash,
    cameraHash: link.passRevision.cameraHash,
    baseGeometryHash: link.passRevision.baseGeometryHash,
    topologyHash: link.passRevision.topologyHash,
    objectIdentityHash: link.passRevision.objectIdentityHash,
    objectStableIds: link.passRevision.objectStableIds,
    artifact,
  };
  const passRevision = {
    ...passInput,
    passRootHash: computeStudioLinked3dPassRootHash(passInput),
  };
  return parseStudioProjectFile({
    ...project,
    pagesList: [{
      ...page,
      linked3dRender: {
        ...document,
        links: [{ ...link, passRevision }, ...document.links.slice(1)],
      },
    }, ...project.pagesList.slice(1)],
  });
}

async function exactManifest(
  reference: StudioWorkAssetReference,
  descriptor: StudioWorkAssetDescriptor,
  blob: Blob,
): Promise<StudioWorkAssetManifest> {
  if (reference.elementType !== "image") throw new Error("linked cloud test expected image asset");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    version: 1,
    assetId: reference.assetId,
    elementType: reference.elementType,
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: sha256HexPortable(bytes),
    intrinsicImage: {
      width: descriptor.element.width,
      height: descriptor.element.height,
      decodedRgbaBytes: descriptor.element.width * descriptor.element.height * 4,
    },
    descriptor,
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

interface CloudEntry {
  readonly manifest: StudioWorkAssetManifest;
  readonly blob: Blob;
}

async function captureCloudEntries(
  project: StudioProjectFile,
  authority: StudioLinked3dPassCasAuthority,
): Promise<ReadonlyMap<string, CloudEntry>> {
  const entries = new Map<string, CloudEntry>();
  await ensureStudioLinked3dPassCloudArtifacts({
    workId: "work-cloud",
    project,
    authority,
    upload: async (_workId, reference, descriptor, blob) => {
      const copy = new Blob([Uint8Array.from(new Uint8Array(await blob.arrayBuffer()))], {
        type: blob.type,
      });
      const manifest = await exactManifest(reference, descriptor, copy);
      entries.set(reference.assetId, { manifest, blob: copy });
      return manifest;
    },
  });
  return entries;
}

describe("Studio linked 3D pass cloud sync", () => {
  it("derives one strict deterministic image asset ID and rejects widened hashes", () => {
    const hash = `sha256:${"a".repeat(64)}` as const;
    expect(studioLinked3dPassCloudAssetReference(hash)).toEqual({
      assetId: `linked3d-pass-sha256-${"a".repeat(64)}`,
      elementType: "image",
    });
    expect(() => studioLinked3dPassCloudAssetReference(
      `sha256:${"A".repeat(64)}` as `sha256:${string}`,
    )).toThrow(expect.objectContaining({ code: "invalid-input" }));
    expect(() => studioLinked3dPassCloudAssetReference(
      "sha256:abc" as `sha256:${string}`,
    )).toThrow(expect.objectContaining({ code: "invalid-input" }));
  });

  it("deduplicates same-hash uploads, verifies OPFS PNG receipts, and leaves canonical project untouched", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!, PNG_FIXTURES[0]!]);
    const before = JSON.stringify(project);
    const upload = vi.fn(async (
      workId: string,
      reference: StudioWorkAssetReference,
      descriptor: StudioWorkAssetDescriptor,
      blob: Blob,
      signal?: AbortSignal,
    ) => {
      expect(workId).toBe("work-cloud");
      expect(signal?.aborted).toBe(false);
      expect(blob.type).toBe("image/png");
      expect(reference.assetId).toMatch(/^linked3d-pass-sha256-[a-f0-9]{64}$/u);
      return await exactManifest(reference, descriptor, blob);
    });

    const receipts = await ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      upload,
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.ownerIds).toHaveLength(2);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("compensates every attempted immutable upload after a partial transfer failure", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, PNG_FIXTURES);
    const primaryFailure = new Error("second upload response was lost");
    let calls = 0;
    const cleanup = vi.fn(async (
      _workId: string,
      _reference: StudioWorkAssetReference,
      _expectedSha256: string,
    ) => true);
    await expect(ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      maximumConcurrentTransfers: 1,
      upload: async (_workId, reference, descriptor, blob) => {
        calls += 1;
        if (calls === 2) throw primaryFailure;
        return await exactManifest(reference, descriptor, blob);
      },
      cleanup,
    })).rejects.toBe(primaryFailure);

    expect(cleanup).toHaveBeenCalledTimes(2);
    for (const [workId, reference, expectedSha256] of cleanup.mock.calls) {
      expect(workId).toBe("work-cloud");
      expect(reference.assetId).toBe(`linked3d-pass-sha256-${expectedSha256}`);
      expect(reference.elementType).toBe("image");
      expect(expectedSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("preserves cleanup failures alongside the primary upload error", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const uploadFailure = new Error("upload response lost");
    const cleanupFailure = new Error("cleanup unavailable");
    const pending = ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      upload: async () => { throw uploadFailure; },
      cleanup: async () => { throw cleanupFailure; },
    });
    try {
      await pending;
      throw new Error("expected aggregate upload cleanup failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([uploadFailure, cleanupFailure]);
      expect((error as Error).cause).toBe(uploadFailure);
    }
  });

  it("replays successful upload receipts through the server-authoritative compensation fence", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const receipts = await ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      upload: async (_workId, reference, descriptor, blob) =>
        await exactManifest(reference, descriptor, blob),
    });
    const cleanup = vi.fn(async (
      _workId: string,
      _reference: StudioWorkAssetReference,
      _expectedSha256: string,
    ) => true);
    await compensateStudioLinked3dPassCloudUploads({
      workId: "work-cloud",
      receipts,
      cleanup,
    });
    expect(cleanup).toHaveBeenCalledWith(
      "work-cloud",
      receipts[0]!.reference,
      receipts[0]!.manifest.sha256,
    );
  });

  it("fails before OPFS/network I/O at the 8 MiB, 16 MP, and 16,384-axis admission gates", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const upload = vi.fn();
    const overBytes = rewriteFirstArtifact(project, { byteSize: 8 * 1024 * 1024 + 1 });
    const overPixels = rewriteFirstArtifact(project, { width: 4_097, height: 4_096 });
    const overAxis = rewriteFirstArtifact(project, { width: 16_385, height: 1 });

    for (const candidate of [overBytes, overPixels, overAxis]) {
      await expect(ensureStudioLinked3dPassCloudArtifacts({
        workId: "work-cloud",
        project: candidate,
        authority: source.authority,
        upload,
      })).rejects.toMatchObject({ code: "unsupported-artifact" });
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails closed on a corrupt OPFS hash, IHDR mismatch, or non-exact cloud manifest", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const reference = collectStudioLinked3dPassProjectArchiveReferences(project)[0]!;
    const original = source.blobs.get(reference.contentHash)!;
    const corrupt = Uint8Array.from(original);
    corrupt[corrupt.length - 1] ^= 1;
    source.blobs.set(reference.contentHash, corrupt);
    const upload = vi.fn();
    await expect(ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      upload,
    })).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(upload).not.toHaveBeenCalled();

    source.blobs.set(reference.contentHash, original);
    await expect(ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project: rewriteFirstArtifact(project, { width: 2 }),
      authority: source.authority,
      upload,
    })).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(upload).not.toHaveBeenCalled();

    await expect(ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      upload: async (_workId, assetReference, descriptor, blob) => ({
        ...(await exactManifest(assetReference, descriptor, blob)),
        sha256: "0".repeat(64),
      }),
    })).rejects.toMatchObject({ code: "manifest-mismatch" });
  });

  it("downloads once per hash, restores and re-reads OPFS, then pins every owner before apply", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!, PNG_FIXTURES[0]!]);
    const before = JSON.stringify(project);
    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority();
    const download = vi.fn(async (
      _workId: string,
      reference: { readonly assetId: string },
    ) => cloud.get(reference.assetId)!);
    const references = collectStudioLinked3dPassProjectArchiveReferences(project);

    const result = await hydrateStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: target.authority,
      download,
      apply: (restored) => {
        expect(restored).toBe(project);
        for (const reference of references) {
          expect(target.blobs.has(reference.contentHash)).toBe(true);
          expect(target.owners.get(reference.ownerId)).toContain(reference.contentHash);
        }
        return "applied" as const;
      },
    });

    expect(result).toBe("applied");
    expect(download).toHaveBeenCalledOnce();
    expect(target.stats.puts).toBe(1);
    expect(target.stats.gets).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("rejects a false OPFS put receipt and never installs owners or applies the project", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority({ wrongPutReceipt: true });
    const apply = vi.fn();

    await expect(hydrateStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: target.authority,
      download: async (_workId, reference) => cloud.get(reference.assetId)!,
      apply,
    })).rejects.toMatchObject({ code: "artifact-mismatch" });
    expect(target.owners.size).toBe(0);
    expect(apply).not.toHaveBeenCalled();
  });

  it("restores every previous owner reference when apply rejects", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!, PNG_FIXTURES[0]!]);
    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority();
    const previousHash = `sha256:${"e".repeat(64)}`;
    const owners = [...new Set(collectStudioLinked3dPassProjectArchiveReferences(project)
      .map(({ ownerId }) => ownerId))];
    for (const owner of owners) target.owners.set(owner, [previousHash]);

    await expect(hydrateStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: target.authority,
      download: async (_workId, reference) => cloud.get(reference.assetId)!,
      apply: () => false,
    })).rejects.toMatchObject({ code: "commit-rejected" });
    for (const owner of owners) expect(target.owners.get(owner)).toEqual([previousHash]);
  });

  it("restores the attempted owner when cloud publication mutates then throws", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority();
    const owner = collectStudioLinked3dPassProjectArchiveReferences(project)[0]!.ownerId;
    const previousHash = `sha256:${"c".repeat(64)}`;
    target.owners.set(owner, [previousHash]);
    const setOwnerRefs = target.authority.setOwnerRefs.bind(target.authority);
    const forwardError = new Error("cloud-owner-ack-lost");
    let publications = 0;
    const apply = vi.fn();
    target.authority.setOwnerRefs = async (currentOwner, hashes) => {
      publications += 1;
      const result = await setOwnerRefs(currentOwner, hashes);
      if (publications === 1) throw forwardError;
      return result;
    };

    await expect(hydrateStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: target.authority,
      download: async (_workId, reference) => cloud.get(reference.assetId)!,
      apply,
    })).rejects.toBe(forwardError);

    expect(apply).not.toHaveBeenCalled();
    expect(publications).toBe(2);
    expect(target.owners.get(owner)).toEqual([previousHash]);
  });

  it("surfaces cloud publication and rollback failures without reporting success", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority();
    const owner = collectStudioLinked3dPassProjectArchiveReferences(project)[0]!.ownerId;
    const previousHash = `sha256:${"d".repeat(64)}`;
    target.owners.set(owner, [previousHash]);
    const setOwnerRefs = target.authority.setOwnerRefs.bind(target.authority);
    const forwardError = new Error("cloud-owner-ack-lost");
    const rollbackError = new Error("cloud-owner-rollback-ack-lost");
    let publications = 0;
    const apply = vi.fn();
    target.authority.setOwnerRefs = async (currentOwner, hashes) => {
      publications += 1;
      await setOwnerRefs(currentOwner, hashes);
      if (publications === 1) throw forwardError;
      throw rollbackError;
    };

    let rejected: unknown;
    try {
      await hydrateStudioLinked3dPassCloudArtifacts({
        workId: "work-cloud",
        project,
        authority: target.authority,
        download: async (_workId, reference) => cloud.get(reference.assetId)!,
        apply,
      });
    } catch (cause) {
      rejected = cause;
    }

    expect(rejected).toBeInstanceOf(AggregateError);
    expect((rejected as AggregateError).errors).toEqual([forwardError, rollbackError]);
    expect((rejected as AggregateError).cause).toBe(forwardError);
    expect(apply).not.toHaveBeenCalled();
    expect(publications).toBe(2);
    expect(target.owners.get(owner)).toEqual([previousHash]);
  });

  it("bounds concurrent uploads and stops scheduling after AbortSignal cancellation", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, PNG_FIXTURES);
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const upload = vi.fn(async (
      _workId: string,
      reference: StudioWorkAssetReference,
      descriptor: StudioWorkAssetDescriptor,
      blob: Blob,
    ) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return await exactManifest(reference, descriptor, blob);
    });
    const pending = ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      maximumConcurrentTransfers: 2,
      upload,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(upload).toHaveBeenCalledTimes(2);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    expect(maximumActive).toBe(2);
    releases.splice(0).forEach((release) => release());
    await expect(pending).resolves.toHaveLength(3);

    const cloud = await captureCloudEntries(project, source.authority);
    const target = createAuthority();
    const controller = new AbortController();
    const abortError = new DOMException("test cancellation", "AbortError");
    const apply = vi.fn();
    const download = vi.fn(async (
      _workId: string,
      reference: { readonly assetId: string },
      signal?: AbortSignal,
    ) => {
      expect(signal).not.toBe(controller.signal);
      controller.abort(abortError);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBe(abortError);
      return cloud.get(reference.assetId)!;
    });
    await expect(hydrateStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: target.authority,
      maximumConcurrentTransfers: 1,
      signal: controller.signal,
      download,
      apply,
    })).rejects.toBe(abortError);
    expect(download).toHaveBeenCalledOnce();
    expect(target.stats.puts).toBe(0);
    expect(target.owners.size).toBe(0);
    expect(apply).not.toHaveBeenCalled();
  });

  it("aborts sibling transfers, waits for their cleanup, and preserves the first failure", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, PNG_FIXTURES);
    const primaryError = new Error("primary upload failure");
    let releasePrimary = (): void => undefined;
    const primaryGate = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    });
    const releaseSiblings: Array<() => void> = [];
    const siblingReasons: unknown[] = [];
    let siblingAborts = 0;
    let siblingSettlements = 0;
    let callIndex = 0;
    const upload = vi.fn(async (
      _workId: string,
      _reference: StudioWorkAssetReference,
      _descriptor: StudioWorkAssetDescriptor,
      _blob: Blob,
      signal?: AbortSignal,
    ): Promise<StudioWorkAssetManifest> => {
      if (!signal) throw new Error("transfer signal was not installed");
      const current = callIndex;
      callIndex += 1;
      if (current === 0) {
        await primaryGate;
        throw primaryError;
      }
      await new Promise<void>((_resolve, reject) => {
        const onAbort = (): void => {
          siblingAborts += 1;
          siblingReasons.push(signal.reason);
          releaseSiblings.push(() => {
            siblingSettlements += 1;
            reject(signal.reason);
          });
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new Error("aborted sibling unexpectedly resolved");
    });
    const pending = ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      maximumConcurrentTransfers: 3,
      upload,
    });
    let completed = false;
    void pending.then(
      () => { completed = true; },
      () => { completed = true; },
    );
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    releasePrimary();
    await vi.waitFor(() => expect(siblingAborts).toBe(2));
    expect(completed).toBe(false);
    expect(siblingReasons).toEqual([primaryError, primaryError]);
    releaseSiblings.splice(0).forEach((release) => release());

    await expect(pending).rejects.toBe(primaryError);
    expect(siblingSettlements).toBe(2);
    expect(completed).toBe(true);
  });

  it("relays caller abort, quiesces every active transfer, and returns the caller reason", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, PNG_FIXTURES);
    const controller = new AbortController();
    const callerError = new DOMException("caller stopped save", "AbortError");
    const releaseTransfers: Array<() => void> = [];
    const transferSignals: AbortSignal[] = [];
    let settledTransfers = 0;
    const upload = vi.fn(async (
      _workId: string,
      _reference: StudioWorkAssetReference,
      _descriptor: StudioWorkAssetDescriptor,
      _blob: Blob,
      signal?: AbortSignal,
    ): Promise<StudioWorkAssetManifest> => {
      if (!signal) throw new Error("transfer signal was not installed");
      transferSignals.push(signal);
      await new Promise<void>((_resolve, reject) => {
        const onAbort = (): void => {
          releaseTransfers.push(() => {
            settledTransfers += 1;
            reject(signal.reason);
          });
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new Error("cancelled transfer unexpectedly resolved");
    });
    const pending = ensureStudioLinked3dPassCloudArtifacts({
      workId: "work-cloud",
      project,
      authority: source.authority,
      maximumConcurrentTransfers: 3,
      signal: controller.signal,
      upload,
    });
    let completed = false;
    void pending.then(
      () => { completed = true; },
      () => { completed = true; },
    );
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    controller.abort(callerError);
    await vi.waitFor(() => expect(releaseTransfers).toHaveLength(3));
    expect(completed).toBe(false);
    expect(transferSignals.every((signal) =>
      signal !== controller.signal
      && signal.aborted
      && signal.reason === callerError)).toBe(true);
    releaseTransfers.splice(0).forEach((release) => release());

    await expect(pending).rejects.toBe(callerError);
    expect(settledTransfers).toBe(3);
    expect(completed).toBe(true);
  });

  it("uses the same exact descriptor contract for a collected artifact", async () => {
    const source = createAuthority();
    const project = await projectWithPngs(source.authority, [PNG_FIXTURES[0]!]);
    const reference = collectStudioLinked3dPassProjectArchiveReferences(project)[0]!;
    const artifact: StudioLinked3dPassArtifactDescriptor = {
      pass: "line",
      role: "main-line",
      contentHash: reference.contentHash,
      byteSize: reference.byteSize,
      mime: "image/png",
      width: reference.width,
      height: reference.height,
      locator: reference.locator,
    };
    const descriptor = createStudioLinked3dPassCloudAssetDescriptor(artifact);
    expect(descriptor).toEqual({
      version: 1,
      element: {
        id: studioLinked3dPassCloudAssetReference(reference.contentHash).assetId,
        type: "image",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
      },
    });
  });
});
