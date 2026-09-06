import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pingVisit,
  shouldSendVisitPing,
  VISIT_PING_PRODUCTION_ORIGIN,
} from "../visits-api";

describe("visit ping environment policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps production visits off until the desk-platform API is explicitly re-enabled", () => {
    expect(
      shouldSendVisitPing({
        isProductionBuild: true,
        origin: VISIT_PING_PRODUCTION_ORIGIN,
      })
    ).toBe(false);
  });

  it.each([
    "http://localhost:4173",
    "http://127.0.0.1:5199",
    "http://192.168.0.12:4173",
    "https://toonspectrum-git-feature-example.vercel.app",
  ])("blocks non-production preview origin %s even for a production bundle", (origin) => {
    expect(
      shouldSendVisitPing({
        isProductionBuild: true,
        origin,
      })
    ).toBe(false);
  });

  it("blocks dev and test builds even when their location is the production origin", () => {
    expect(
      shouldSendVisitPing({
        isProductionBuild: false,
        origin: VISIT_PING_PRODUCTION_ORIGIN,
      })
    ).toBe(false);
  });

  it.each([undefined, "", "not a url"])("fails closed for an unavailable or invalid origin", (origin) => {
    expect(
      shouldSendVisitPing({
        isProductionBuild: true,
        origin,
      })
    ).toBe(false);
  });

  it("returns before storage and network access in the Vitest development environment", async () => {
    const fetchSpy = vi.fn();
    const getItem = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", { getItem, setItem });

    await pingVisit();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
