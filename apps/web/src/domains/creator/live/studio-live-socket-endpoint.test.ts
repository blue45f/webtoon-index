import { describe, expect, it } from "vitest";

import { resolveStudioLiveSocketEndpoint } from "./studio-live-socket-endpoint";

describe("Studio live Socket.IO endpoint resolver", () => {
  it("keeps the production same-origin namespace when no API base is configured", () => {
    expect(resolveStudioLiveSocketEndpoint({})).toBe("/studio-live");
    expect(
      resolveStudioLiveSocketEndpoint({ viteApiBase: "  ", runtimeApiBase: "" })
    ).toBe("/studio-live");
  });

  it("reuses only the Vite API origin for a cross-origin long-running Nest endpoint", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        viteApiBase: "https://api.toonspectrum.example/base/api?token=never#fragment",
        runtimeApiBase: "https://runtime-ignored.example",
      })
    ).toBe("https://api.toonspectrum.example/studio-live");
  });

  it("prioritizes the explicit long-running realtime origin over every HTTP API base", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "https://realtime.toonspectrum.example/socket-host?ignored=yes",
        viteApiBase: "https://serverless.toonspectrum.example/api",
        runtimeApiBase: "https://runtime-api.toonspectrum.example/api",
      })
    ).toBe("https://realtime.toonspectrum.example/studio-live");
  });

  it("falls back to the runtime API base and resolves a relative shell base safely", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        runtimeApiBase: "https://runtime.toonspectrum.example/api",
      })
    ).toBe("https://runtime.toonspectrum.example/studio-live");
    expect(
      resolveStudioLiveSocketEndpoint({
        runtimeApiBase: "/api",
        locationOrigin: "https://shell.toonspectrum.example",
      })
    ).toBe("https://shell.toonspectrum.example/studio-live");
  });

  it("never inherits the production API origin from a local dev or preview shell", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        viteApiBase: "https://toonspectrum.vercel.app/api",
        runtimeApiBase: "https://toonspectrum.vercel.app/api",
        locationOrigin: "http://127.0.0.1:5199",
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        viteApiBase: "https://toonspectrum.vercel.app/api",
        locationOrigin: "https://dev-shell.internal.example",
        localDevelopment: true,
      })
    ).toBeNull();
  });

  it("retains an intentional same-origin or loopback local realtime server", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        localDevelopment: true,
      })
    ).toBe("/studio-live");
    expect(
      resolveStudioLiveSocketEndpoint({
        runtimeApiBase: "/api",
        locationOrigin: "http://localhost:5199",
        localDevelopment: true,
      })
    ).toBe("http://localhost:5199/studio-live");
    expect(
      resolveStudioLiveSocketEndpoint({
        viteApiBase: "http://127.0.0.1:4001/api",
        locationOrigin: "http://localhost:5199",
        localDevelopment: true,
      })
    ).toBe("http://127.0.0.1:4001/studio-live");
  });

  it("requires an explicit long-running realtime origin on Vercel serverless", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        locationOrigin: "https://toonspectrum.vercel.app",
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        viteApiBase: "https://toonspectrum.vercel.app/api",
        locationOrigin: "https://preview-branch.vercel.app",
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        locationOrigin: "https://www.toonstudio.cloud",
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        locationOrigin: "https://toonstudio.cloud",
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "https://realtime.toonspectrum.example",
        locationOrigin: "https://www.toonstudio.cloud",
      })
    ).toBe("https://realtime.toonspectrum.example/studio-live");
  });

  it("allows a deliberate realtime env origin in local development", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "https://realtime.toonspectrum.example/base",
        viteApiBase: "https://toonspectrum.vercel.app/api",
        locationOrigin: "http://localhost:5199",
        localDevelopment: true,
      })
    ).toBe("https://realtime.toonspectrum.example/studio-live");
  });

  it("allows insecure Socket.IO only on loopback in development", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "http://127.0.0.1:4001",
        allowInsecureLoopback: true,
      })
    ).toBe("http://127.0.0.1:4001/studio-live");
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "http://localhost:4001",
        allowInsecureLoopback: false,
      })
    ).toBeNull();
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "http://realtime.toonspectrum.example",
        allowInsecureLoopback: true,
      })
    ).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/socket",
    "http://api.toonspectrum.example",
    "https://user:secret@api.toonspectrum.example/api",
    "not a valid URL",
  ])("rejects an unsafe or malformed configured base: %s", (viteApiBase) => {
    expect(resolveStudioLiveSocketEndpoint({ viteApiBase })).toBeNull();
  });

  it("fails closed instead of falling through when the explicit override is unsafe", () => {
    expect(
      resolveStudioLiveSocketEndpoint({
        explicitOrigin: "https://artist:secret@realtime.example",
        viteApiBase: "https://api-fallback.example",
      })
    ).toBeNull();
  });
});
