import { describe, expect, it } from "vitest";

import { AdminRequestScope, canManageAdminMembers } from "./admin-request-scope";

describe("admin read request lifecycle", () => {
  it("invalidates a request before abort listeners run", () => {
    const scope = new AdminRequestScope();
    const first = scope.begin();
    let staleWasCurrent: boolean | undefined;
    first.signal.addEventListener("abort", () => {
      staleWasCurrent = first.isCurrent();
    });
    const next = scope.begin();
    expect(staleWasCurrent).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(next.isCurrent()).toBe(true);
  });

  it("cancels independently, idempotently, and supports effect replay", () => {
    const list = new AdminRequestScope();
    const detail = new AdminRequestScope();
    const firstList = list.begin();
    const firstDetail = detail.begin();
    list.cancel();
    list.cancel();
    expect(firstList.isCurrent()).toBe(false);
    expect(firstDetail.isCurrent()).toBe(true);
    expect(list.begin().isCurrent()).toBe(true);
  });

  it.each(["operator", "creator", "user", "Admin", " admin ", null, undefined, {}])(
    "does not expose member mutation affordances to %j",
    (role) => expect(canManageAdminMembers(role)).toBe(false),
  );

  it("permits only the canonical admin role", () => {
    expect(canManageAdminMembers("admin")).toBe(true);
  });
});
