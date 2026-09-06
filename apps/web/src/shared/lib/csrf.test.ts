import { describe, expect, it } from "vitest";

import { withCsrfProtection } from "./csrf";

describe("browser CSRF request helper", () => {
  it("preserves caller headers and overwrites the proof on mutations", () => {
    const init = withCsrfProtection({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-toonspectrum-csrf": "wrong",
      },
    });
    const headers = new Headers(init.headers);

    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-toonspectrum-csrf")).toBe("1");
  });

  it("leaves safe methods unchanged", () => {
    const init: RequestInit = { method: "GET", headers: { Accept: "application/json" } };

    expect(withCsrfProtection(init)).toBe(init);
  });
});
