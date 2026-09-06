/**
 * Rare-action product OPFS acquisition for linked 3D passes.
 *
 * Canonical descriptor parsing stays in the lightweight transaction contract; native OPFS and
 * asset-store implementations enter the graph only when a pass is saved, restored, or presented.
 */

import {
  STUDIO_LINKED_3D_PASS_CAS_ROOT,
  StudioLinked3dPassAuthorityError,
  type StudioLinked3dPassCasAuthority,
} from "./studio-linked-3d-pass-transaction";
import { createStudioOpfsAssetStore } from "./studio-opfs-asset-store";
import {
  createStudioOpfsNativeFileSystem,
  StudioOpfsError,
  type StudioOpfsStorageManagerLike,
} from "./studio-opfs-filesystem";

export const STUDIO_LINKED_3D_PASS_CAS_INDEX_LOCK_NAME =
  "toonspectrum-studio-linked-3d-passes:cas-index";
export const STUDIO_LINKED_3D_PASS_OWNER_LOCK_PREFIX =
  "toonspectrum-studio-linked-3d-passes:owner:";

interface BrowserLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

let productAuthorityPromise: Promise<StudioLinked3dPassCasAuthority> | null = null;

export async function acquireStudioLinked3dPassProductAuthority(): Promise<
  StudioLinked3dPassCasAuthority
> {
  productAuthorityPromise ??= (async () => {
    const navigatorValue = globalThis.navigator as Navigator & {
      readonly locks?: BrowserLockManagerLike;
    };
    const locks = navigatorValue?.locks;
    if (!locks || typeof locks.request !== "function") {
      throw new StudioLinked3dPassAuthorityError(
        "opfs-unavailable",
        "Web Locks가 없어 연결형 3D pass OPFS를 탭 간 안전하게 갱신할 수 없습니다.",
      );
    }
    const manager = navigatorValue?.storage as StudioOpfsStorageManagerLike | undefined;
    if (!manager || typeof manager.getDirectory !== "function") {
      throw new StudioLinked3dPassAuthorityError(
        "opfs-unavailable",
        "이 브라우저에는 연결형 3D pass용 OPFS가 없습니다.",
      );
    }
    const store = createStudioOpfsAssetStore({
      fs: createStudioOpfsNativeFileSystem(manager, STUDIO_LINKED_3D_PASS_CAS_ROOT),
      estimator: typeof manager.estimate === "function"
        ? { estimate: () => manager.estimate!() }
        : null,
      mutationRunExclusive: <T>(task: () => Promise<T>) => locks.request(
        STUDIO_LINKED_3D_PASS_CAS_INDEX_LOCK_NAME,
        { mode: "exclusive" },
        task,
      ),
    });
    try {
      await store.list();
    } catch (cause) {
      throw new StudioLinked3dPassAuthorityError(
        "opfs-unavailable",
        "연결형 3D pass OPFS를 열지 못했습니다.",
        cause,
      );
    }
    return Object.freeze({
      kind: store.kind,
      put: store.put.bind(store),
      get: store.get.bind(store),
      ownerRefs: store.ownerRefs.bind(store),
      setOwnerRefs: store.setOwnerRefs.bind(store),
      runOwnerMutationExclusive<T>(owner: string, task: () => Promise<T>) {
        const canonicalOwner = owner.trim();
        if (!canonicalOwner || canonicalOwner !== owner) {
          throw new StudioLinked3dPassAuthorityError(
            "invalid-input",
            "연결형 3D pass owner ID가 올바르지 않습니다.",
          );
        }
        return locks.request(
          `${STUDIO_LINKED_3D_PASS_OWNER_LOCK_PREFIX}${encodeURIComponent(canonicalOwner)}`,
          { mode: "exclusive" },
          task,
        );
      },
    });
  })().catch((cause) => {
    productAuthorityPromise = null;
    if (cause instanceof StudioLinked3dPassAuthorityError) throw cause;
    if (cause instanceof StudioOpfsError) {
      throw new StudioLinked3dPassAuthorityError(
        "opfs-unavailable",
        cause.message,
        cause,
      );
    }
    throw cause;
  });
  return await productAuthorityPromise;
}
