export interface StudioTeamCommentOperationTicket {
  readonly workId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface StudioTeamCommentOperationContext {
  readonly workId: string | null;
  readonly generation: number;
  readonly mounted: boolean;
}

/**
 * Owns the lifetime of in-flight team-comment requests without knowing React or the API client.
 * A response may update UI state only while its exact ticket remains current for the same work
 * generation. Tickets are identity-based, so another registry cannot forge or finish them.
 */
export class StudioTeamCommentOperationScopeRegistry {
  readonly #controllers = new Map<StudioTeamCommentOperationTicket, AbortController>();
  #abortingAll = false;

  get activeCount(): number {
    return this.#controllers.size;
  }

  begin(workId: string, generation: number): StudioTeamCommentOperationTicket {
    const controller = new AbortController();
    const ticket = Object.freeze({
      workId,
      generation,
      signal: controller.signal,
    });
    // An abort listener can synchronously try to start more work. Keep abortAll atomic: work
    // started during that invalidation is born canceled, while a later begin() remains reusable.
    if (this.#abortingAll) {
      controller.abort();
      return ticket;
    }
    this.#controllers.set(ticket, controller);
    return ticket;
  }

  isCurrent(
    ticket: StudioTeamCommentOperationTicket,
    context: StudioTeamCommentOperationContext
  ): boolean {
    return context.mounted
      && context.workId === ticket.workId
      && context.generation === ticket.generation
      && !ticket.signal.aborted
      && this.#controllers.has(ticket);
  }

  /** Completes one request without aborting its settled signal; check isCurrent before calling. */
  finish(ticket: StudioTeamCommentOperationTicket): boolean {
    return this.#controllers.delete(ticket);
  }

  /** Invalidates only one request; parallel tickets remain independently current. */
  invalidate(ticket: StudioTeamCommentOperationTicket): boolean {
    const controller = this.#controllers.get(ticket);
    if (!controller) return false;
    this.#controllers.delete(ticket);
    controller.abort();
    return true;
  }

  /** Atomically aborts every ticket that existed at entry and leaves the registry reusable. */
  abortAll(): number {
    const controllers = Array.from(this.#controllers.values());
    this.#controllers.clear();
    this.#abortingAll = true;
    try {
      for (const controller of controllers) controller.abort();
    } finally {
      this.#abortingAll = false;
    }
    return controllers.length;
  }
}
