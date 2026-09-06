import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const harness = readFileSync(
  resolve(process.cwd(), "scripts/verify-studio-mobile-top.mts"),
  "utf8",
);

describe("Studio mobile top browser harness boundary", () => {
  it("honors the dedicated temporary artifact directory before the legacy alias", () => {
    const dedicated = harness.indexOf(
      "process.env.TOONSPECTRUM_MOBILE_TOP_VERIFY_DIR",
    );
    const legacy = harness.indexOf("process.env.TOONSPECTRUM_VERIFY_DIR");
    const fallback = harness.indexOf(
      'join(tmpdir(), "toonspectrum-studio-mobile-top")',
    );

    expect(dedicated).toBeGreaterThanOrEqual(0);
    expect(legacy).toBeGreaterThan(dedicated);
    expect(fallback).toBeGreaterThan(legacy);
  });

  it("allows only the exact current local preview Socket.IO handshake shutdown", () => {
    expect(harness).toContain('previewUrl.hostname !== "127.0.0.1"');
    expect(harness).toContain("previewUrl.port.length === 0");
    expect(harness).toContain(
      "`ws://127.0.0.1:${previewUrl.port}/socket.io/?EIO=4&transport=websocket`",
    );
    expect(harness).toContain(
      '"Connection closed before receiving a handshake response"',
    );
    expect(harness).toContain(
      '"Error during WebSocket handshake: Unexpected response code: 400"',
    );
    expect(harness).toContain("expectedMessages.includes");
    expect(harness).toContain("sourceUrl.origin === previewUrl.origin");
    expect(harness).toContain(
      "/^\\/assets\\/[A-Za-z0-9._-]+\\.js$/u.test(sourceUrl.pathname)",
    );
    expect(harness).not.toContain(
      `message.includes("WebSocket connection to 'ws://127.0.0.1:")`,
    );
  });

  it("measures the canvas-sticky presence dock as top-chrome, not as canvas content", () => {
    // The immersive pill (absolute, shell-owned) and the presence dock (sticky, viewport-owned)
    // cannot see each other's width. Leaving the dock out of the container set is what let it
    // cover the publish CTA at 320/360px while only an anonymous hit-test loss was reported.
    expect(harness).toContain(
      'const presenceDock = document.querySelector(\'[data-studio-presence-dock="true"]\');',
    );
    expect(harness).toContain("presenceDock,");
    expect(harness).toContain("mobileDock,");
  });

  it("excuses only transport-level failures at the third-party font CDNs", () => {
    // 이 게이트는 글자 모양이 아니라 기하학을 잰다. 폰트 CDN 도달 실패로 빨간불이 나면
    // 제품 회귀가 아닌 것으로 CI 를 막게 되므로 면제하되, 두 겹으로 좁혀 둔다.
    const start = harness.indexOf("const EXTERNAL_FONT_CDN_HOSTS");
    expect(start).toBeGreaterThanOrEqual(0);
    const hosts = harness.slice(start, harness.indexOf("]);", start));
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"]) {
      expect(hosts).toContain(host);
    }
    // 동일 출처로는 절대 넓어지면 안 된다 — 그쪽 자산 실패가 이 수집기의 존재 이유다.
    expect(hosts).not.toContain("localhost");
    expect(hosts).not.toContain("127.0.0.1");
    // 전송 계층 실패만. 이 접두사가 느슨해지면 폰트 href 오타가 만드는 404/403 까지 통과한다.
    expect(harness).toContain('message.startsWith("Failed to load resource: net::ERR_")');
    expect(harness).not.toContain('message.startsWith("Failed to load resource")\n');
    // 호스트는 정확히 일치해야 한다. 부분 문자열이면 동일 출처 URL 이 호스트명을 품기만 해도 샌다.
    expect(harness).toContain("EXTERNAL_FONT_CDN_HOSTS.has(url.hostname)");
    // pageerror(앱이 던진 예외)는 이 면제와 무관하게 그대로 실패여야 한다.
    expect(harness).toContain('page.on("pageerror", (error) => consoleErrors.push(String(error)));');
  });

  it("does not suppress the retired visit ping from browser health failures", () => {
    expect(harness).not.toContain("/api/v1/apps/toonspectrum/visits/ping");
    expect(harness).toContain('"/api/kmas/merge-on-access"');
    expect(harness).toContain('"/api/studio-ai/status"');
  });

  it("measures the mobile dock as an overlay while preserving scroll-safe canvas content", () => {
    expect(harness).toContain("canvasViewportPaddingBottom");
    expect(harness).toContain("canvasViewportBottom < metrics.viewportHeight - 1");
    expect(harness).toContain(
      "mobile dock still shrinks the canvas instead of overlaying its scrollport",
    );
    expect(harness).toContain("metrics.canvasViewportPaddingBottom < metrics.dockHeight - 1");
    expect(harness).toContain("dockSmallTargets");
    expect(harness).toContain("small dock target:");
    expect(harness).toContain("expanded mobile dock changes the canvas viewport height");
    expect(harness).toContain(
      "expanded mobile dock is not covered by canvas scroll-safe padding",
    );
    expect(harness).toContain("small expanded dock target:");
  });
});
