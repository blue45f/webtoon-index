/** One independently replaceable read request (e.g. a list OR a detail panel).
 * Cancellation alone is insufficient: a completed response can already be
 * queued when abort() is called. Consumers must guard every state update with
 * isCurrent(), including catch and finally. Never use this to imply a mutation
 * was rolled back: aborting HTTP does not undo a server-side write.
 */
export class AdminRequestScope {
  private current: AbortController | null = null;

  begin(): Readonly<{ signal: AbortSignal; isCurrent: () => boolean }> {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => this.current === controller && !controller.signal.aborted,
    };
  }

  cancel(): void {
    const previous = this.current;
    this.current = null;
    previous?.abort();
  }
}

/** UI affordance only. The server must independently authorize every mutation. */
export function canManageAdminMembers(role: unknown): boolean {
  return role === "admin";
}
