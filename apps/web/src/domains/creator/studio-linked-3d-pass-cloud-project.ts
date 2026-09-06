import { hasStudioLinked3dPassProjectArchiveReferences } from "./studio-linked-3d-pass-project-archive";

import type { StudioLinked3dPassCloudUploadReceipt } from "./studio-linked-3d-pass-cloud-sync";
import type { StudioProjectFile } from "./studio-project-file";

export class StudioLinked3dPassCloudProjectError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StudioLinked3dPassCloudProjectError";
  }
}

/**
 * Uploads only when the exact canonical project contains linked-pass receipts. Ordinary documents
 * never probe OPFS or load the work-asset transport chunk.
 */
export async function ensureStudioLinked3dPassCloudProject(input: {
  readonly workId: string;
  readonly project: StudioProjectFile;
  readonly signal?: AbortSignal;
}): Promise<readonly StudioLinked3dPassCloudUploadReceipt[]> {
  if (!hasStudioLinked3dPassProjectArchiveReferences(input.project)) {
    return Object.freeze([]);
  }
  const [
    { ensureStudioLinked3dPassCloudArtifacts },
    { acquireStudioLinked3dPassProductAuthority },
  ] = await Promise.all([
    import("./studio-linked-3d-pass-cloud-sync"),
    import("./studio-linked-3d-pass-product-authority"),
  ]);
  return await ensureStudioLinked3dPassCloudArtifacts({
    workId: input.workId,
    project: input.project,
    authority: await acquireStudioLinked3dPassProductAuthority(),
    signal: input.signal,
  });
}

/**
 * Restores every exact cloud PNG and owner receipt before exposing a canonical project to Studio.
 * The callback is the sole apply boundary and may reject a stale route by returning `false`.
 */
export async function hydrateStudioLinked3dPassCloudProject<T>(input: {
  readonly workId: string;
  readonly project: StudioProjectFile;
  readonly apply: (project: StudioProjectFile) => T | false | Promise<T | false>;
  readonly signal?: AbortSignal;
}): Promise<T> {
  if (!hasStudioLinked3dPassProjectArchiveReferences(input.project)) {
    const result = await input.apply(input.project);
    if (result === false) {
      throw new StudioLinked3dPassCloudProjectError(
        "Studio가 현재 경로와 다른 작품의 cloud hydration을 거절했습니다.",
      );
    }
    return result;
  }
  const [
    { hydrateStudioLinked3dPassCloudArtifacts },
    { acquireStudioLinked3dPassProductAuthority },
  ] = await Promise.all([
    import("./studio-linked-3d-pass-cloud-sync"),
    import("./studio-linked-3d-pass-product-authority"),
  ]);
  return await hydrateStudioLinked3dPassCloudArtifacts({
    workId: input.workId,
    project: input.project,
    authority: await acquireStudioLinked3dPassProductAuthority(),
    apply: input.apply,
    signal: input.signal,
  });
}
