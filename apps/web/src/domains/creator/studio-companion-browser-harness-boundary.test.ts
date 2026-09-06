import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const harness = readFileSync(
  resolve(root, "scripts/verify-studio-companion.mts"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("Studio companion browser harness boundary", () => {
  it("keeps a runnable package entry for the production-preview gate", () => {
    expect(packageJson.scripts?.["verify:studio-companion"]).toBe(
      "tsx scripts/verify-studio-companion.mts",
    );
  });

  it("uses real top-level pages and popup transport instead of an in-process channel fake", () => {
    expect(harness).toContain("context.newPage()");
    expect(harness.split('waitForEvent("popup"')).toHaveLength(3);
    expect(harness).toContain('data-testid="studio-tools-companion-root"');
    expect(harness).toContain("verifyToolRoundTrip");
    expect(harness).toContain("navigatorReconnected");
    expect(harness).toContain("workspaceReconnected");
    expect(harness).not.toContain("class FakeBroadcastChannel");
    expect(harness).not.toContain("class SharedBroadcastChannel");
  });

  it("observes popup boot before awaiting layout and verifies both transport directions", () => {
    const workspacePopup = harness.indexOf(
      "async function openWorkspaceCompanion(",
    );
    const navigatorPopup = harness.indexOf(
      "async function openNavigatorCompanion(",
    );
    const roundTrip = harness.indexOf("async function verifyToolRoundTrip(");

    expect(workspacePopup).toBeGreaterThanOrEqual(0);
    expect(navigatorPopup).toBeGreaterThan(workspacePopup);
    expect(roundTrip).toBeGreaterThan(navigatorPopup);
    expect(
      harness.indexOf("observePopup(popup);", workspacePopup),
    ).toBeLessThan(
      harness.indexOf("popup.setViewportSize", workspacePopup),
    );
    expect(
      harness.indexOf("observePopup(popup);", navigatorPopup),
    ).toBeLessThan(
      harness.indexOf("popup.setViewportSize", navigatorPopup),
    );

    const roundTripSource = harness.slice(roundTrip, harness.indexOf(
      "async function installStudioPreferences(",
      roundTrip,
    ));
    expect(roundTripSource).toContain(
      'palette.getByRole("button", { name: "지우개", exact: true }).click()',
    );
    expect(roundTripSource).toContain(
      'primary.getByRole("button", { name: "펜 (B)", exact: true })',
    );
    expect(roundTripSource).toContain(
      "palette.locator('button[aria-pressed=\"true\"]', { hasText: /^펜$/u })",
    );
  });

  it("fails on unexpected page, console, or server errors", () => {
    expect(harness).toContain('page.on("console"');
    expect(harness).toContain('page.on("pageerror"');
    expect(harness).toContain('page.on("response"');
    expect(harness).toContain('page.on("requestfailed"');
    expect(harness).toContain("diagnosticsAreClean");
    expect(harness).toContain('parsed.protocol === "http:"');
    expect(harness).toContain('parsed.hostname === "127.0.0.1"');
    expect(harness).toContain("parsed.port.length > 0");
    expect(harness).toContain("parsed.origin === preview.origin");
    expect(harness).toContain(
      "'ws://127.0.0.1:${preview.port}/socket.io/?EIO=4&transport=websocket' failed: ",
    );
    expect(harness).toContain(
      "isExpectedStaticPreviewSocketIoHandshakeClose(text, previewBaseUrl)",
    );
    expect(harness).not.toContain(
      "text.includes(\"WebSocket connection to 'ws://127.0.0.1:\")",
    );
    expect(harness).not.toContain(
      '"/api/v1/apps/toonspectrum/visits/ping"',
    );
  });

  it("validates decoded Navigator pixels and awaits the in-process preview shutdown", () => {
    expect(harness).toContain("navigatorImage.evaluate(async (image)");
    expect(harness).toContain("await (image as HTMLImageElement).decode()");
    expect(harness).toContain("(image as HTMLImageElement).naturalWidth > 0");
    expect(harness).toContain("(image as HTMLImageElement).naturalHeight > 0");
    expect(harness).not.toContain("document.querySelector<HTMLImageElement>");
    expect(harness.split("await waitForNavigatorPreview(navigator)").length).toBe(3);
    expect(harness).toContain("previewServer = await preview({");
    expect(harness).toContain("await previewServer?.close()");
    expect(harness).not.toContain('spawn("pnpm"');
    expect(harness).not.toContain('preview.kill("SIGTERM")');
  });
});
