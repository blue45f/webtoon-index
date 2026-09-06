import * as THREE from "three";

import { makeGeometry, type BgPrimitiveKind } from "../studio-background-3d-primitives";

export interface StudioBg3dPrimitiveGeometryResources {
  readonly geometry: THREE.BufferGeometry;
  readonly edges: THREE.EdgesGeometry;
}

/**
 * One editor-local geometry pool. Repeated primitives share immutable vertex/index buffers while
 * retaining separate materials, transforms, hierarchy, raycast identity, and undo state.
 */
export class StudioBg3dPrimitiveGeometryPool {
  readonly #resources = new Map<BgPrimitiveKind, StudioBg3dPrimitiveGeometryResources>();
  #pendingDisposalToken: object | null = null;

  get(kind: BgPrimitiveKind): StudioBg3dPrimitiveGeometryResources {
    const cached = this.#resources.get(kind);
    if (cached) return cached;
    const geometry = makeGeometry(kind);
    const resources = Object.freeze({
      geometry,
      edges: new THREE.EdgesGeometry(geometry, 20),
    });
    this.#resources.set(kind, resources);
    return resources;
  }

  get size(): number {
    return this.#resources.size;
  }

  /** Cancels a pending StrictMode/unmount disposal when the same editor immediately remounts. */
  retain(): void {
    this.#pendingDisposalToken = null;
  }

  /** Defers teardown one microtask so React StrictMode's setup→cleanup→setup replay can retain it. */
  releaseSoon(): void {
    const token = {};
    this.#pendingDisposalToken = token;
    queueMicrotask(() => {
      if (this.#pendingDisposalToken !== token) return;
      this.#pendingDisposalToken = null;
      this.dispose();
    });
  }

  /** Clears GPU resources after all React consumers have unmounted. The pool remains reusable. */
  dispose(): number {
    this.#pendingDisposalToken = null;
    const disposed = this.#resources.size;
    for (const resources of this.#resources.values()) {
      resources.geometry.dispose();
      resources.edges.dispose();
    }
    this.#resources.clear();
    return disposed;
  }
}

/**
 * Static editor roots do not need to recompose the same local matrix on every render frame.
 * Selection/TransformControls opts the root back into Three's live matrix updates.
 */
export function synchronizeStudioBg3dRootMatrix(
  object: THREE.Object3D,
  interactive: boolean,
): void {
  object.updateMatrix();
  object.matrixAutoUpdate = interactive;
  object.matrixWorldNeedsUpdate = true;
}
