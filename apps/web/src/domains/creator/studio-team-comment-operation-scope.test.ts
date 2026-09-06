import { describe, expect, it, vi } from "vitest";

import { StudioTeamCommentOperationScopeRegistry } from "./studio-team-comment-operation-scope";

const CURRENT_CONTEXT = {
  workId: "work-1",
  generation: 4,
  mounted: true,
} as const;

describe("StudioTeamCommentOperationScopeRegistry", () => {
  it("keeps a newly begun ticket current only for its exact mounted work generation", () => {
    const registry = new StudioTeamCommentOperationScopeRegistry();
    const ticket = registry.begin("work-1", 4);

    expect(ticket).toMatchObject({ workId: "work-1", generation: 4 });
    expect(ticket.signal.aborted).toBe(false);
    expect(registry.activeCount).toBe(1);
    expect(registry.isCurrent(ticket, CURRENT_CONTEXT)).toBe(true);
    expect(registry.isCurrent(ticket, { ...CURRENT_CONTEXT, workId: "work-2" })).toBe(false);
    expect(registry.isCurrent(ticket, { ...CURRENT_CONTEXT, generation: 5 })).toBe(false);
    expect(registry.isCurrent(ticket, { ...CURRENT_CONTEXT, mounted: false })).toBe(false);
  });

  it("makes a finished ticket permanently non-current without aborting its settled signal", () => {
    const registry = new StudioTeamCommentOperationScopeRegistry();
    const ticket = registry.begin("work-1", 4);

    expect(registry.finish(ticket)).toBe(true);
    expect(registry.finish(ticket)).toBe(false);
    expect(ticket.signal.aborted).toBe(false);
    expect(registry.isCurrent(ticket, CURRENT_CONTEXT)).toBe(false);
    expect(registry.activeCount).toBe(0);
  });

  it("invalidates one ticket without disturbing a parallel operation", () => {
    const registry = new StudioTeamCommentOperationScopeRegistry();
    const first = registry.begin("work-1", 4);
    const second = registry.begin("work-1", 4);

    expect(registry.invalidate(first)).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(registry.isCurrent(first, CURRENT_CONTEXT)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(registry.isCurrent(second, CURRENT_CONTEXT)).toBe(true);
    expect(registry.activeCount).toBe(1);
  });

  it("rejects tickets owned by another registry", () => {
    const owner = new StudioTeamCommentOperationScopeRegistry();
    const other = new StudioTeamCommentOperationScopeRegistry();
    const ticket = owner.begin("work-1", 4);

    expect(other.isCurrent(ticket, CURRENT_CONTEXT)).toBe(false);
    expect(other.finish(ticket)).toBe(false);
    expect(other.invalidate(ticket)).toBe(false);
    expect(owner.isCurrent(ticket, CURRENT_CONTEXT)).toBe(true);
  });

  it("aborts every active signal immediately, empties itself, and is reusable", () => {
    const registry = new StudioTeamCommentOperationScopeRegistry();
    const first = registry.begin("work-1", 4);
    const second = registry.begin("work-2", 7);
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    first.signal.addEventListener("abort", firstAbort);
    second.signal.addEventListener("abort", secondAbort);

    expect(registry.abortAll()).toBe(2);
    expect(firstAbort).toHaveBeenCalledTimes(1);
    expect(secondAbort).toHaveBeenCalledTimes(1);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(registry.activeCount).toBe(0);
    expect(registry.isCurrent(first, CURRENT_CONTEXT)).toBe(false);

    const next = registry.begin("work-1", 5);
    expect(next.signal.aborted).toBe(false);
    expect(registry.isCurrent(next, {
      workId: "work-1",
      generation: 5,
      mounted: true,
    })).toBe(true);
  });

  it("keeps abortAll atomic when an abort listener synchronously begins another ticket", () => {
    const registry = new StudioTeamCommentOperationScopeRegistry();
    const first = registry.begin("work-1", 4);
    const reentrantTickets: Array<ReturnType<typeof registry.begin>> = [];
    first.signal.addEventListener("abort", () => {
      reentrantTickets.push(registry.begin("work-1", 4));
    });

    registry.abortAll();
    expect(reentrantTickets[0]?.signal.aborted).toBe(true);
    expect(registry.activeCount).toBe(0);

    const reusable = registry.begin("work-1", 4);
    expect(registry.isCurrent(reusable, CURRENT_CONTEXT)).toBe(true);
  });
});
