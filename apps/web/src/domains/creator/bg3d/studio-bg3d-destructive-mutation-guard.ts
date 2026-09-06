/**
 * Synchronous close fence for an unabortable persistent deletion.
 *
 * React state can lag a click by one render. This token guard is therefore the authority used by
 * every modal-dismiss path from immediately before the IndexedDB mutation is queued until the
 * matching logical scene commit has completed.
 */

export interface StudioBg3dDestructiveMutationLease {
  readonly token: symbol;
}

export class StudioBg3dDestructiveMutationGuard {
  #activeLease: StudioBg3dDestructiveMutationLease | null = null;

  get blocksClose(): boolean {
    return this.#activeLease !== null;
  }

  begin(): StudioBg3dDestructiveMutationLease | null {
    if (this.#activeLease) return null;
    const lease = Object.freeze({ token: Symbol("studio-bg3d-destructive-mutation") });
    this.#activeLease = lease;
    return lease;
  }

  finish(lease: StudioBg3dDestructiveMutationLease): boolean {
    if (this.#activeLease !== lease) return false;
    this.#activeLease = null;
    return true;
  }
}
