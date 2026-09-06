import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminI18nAssetUrl,
  loadAdminI18nLocale,
} from "./admin-i18n-loader";

import { resolveI18nValue, useI18n } from "@/shared/lib/i18n";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin lazy i18n loader", () => {
  it("keeps en-US and ko-KR on the embedded base-root dictionaries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("base admin locale must not fetch"));

    await loadAdminI18nLocale("en-US", "/preview/");
    await loadAdminI18nLocale("ko-KR", "/preview/");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveI18nValue("en-US", "admin.title")).toBe("Admin Console");
    expect(resolveI18nValue("ko-KR", "admin.title")).toBe("관리자 콘솔");
  });

  it("normalizes a region locale to its available root asset and publishes it", async () => {
    const beforeRevision = useI18n.getState().translationBundleRevision;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ "admin.title": "Console français" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await loadAdminI18nLocale("fr-CA", "/preview");

    expect(fetchSpy).toHaveBeenCalledTimes(25);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/preview/i18n/admin/dashboard/fr.json",
      {
        cache: "force-cache",
        credentials: "same-origin",
      },
    );
    expect(resolveI18nValue("fr-CA", "admin.title")).toBe("Console français");
    expect(useI18n.getState().translationBundleRevision).toBe(beforeRevision + 1);
  });

  it("deduplicates concurrent requests for the same locale", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(response);

    const first = loadAdminI18nLocale("de-DE", "/preview");
    const second = loadAdminI18nLocale("de-AT", "/preview");

    expect(fetchSpy).toHaveBeenCalledTimes(25);

    resolveResponse(
      new Response(JSON.stringify({ "admin.title": "Admin-Konsole" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await Promise.all([first, second]);

    expect(fetchSpy).toHaveBeenCalledTimes(25);
    expect(resolveI18nValue("de-DE", "admin.title")).toBe("Admin-Konsole");
    expect(resolveI18nValue("de-AT", "admin.title")).toBe("Admin-Konsole");
  });

  it("starts a fresh request after a transient fetch rejection", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ "admin.title": "Consola de administración" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      loadAdminI18nLocale("es-MX", "/preview"),
    ).resolves.toBeUndefined();
    await expect(
      loadAdminI18nLocale("es-MX", "/preview"),
    ).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(25);
    expect(resolveI18nValue("es-MX", "admin.title")).toBe(
      "Consola de administración",
    );
  });

  it("constructs an asset URL without duplicating separators", () => {
    expect(adminI18nAssetUrl("zh-hant", "/preview")).toBe(
      "/preview/i18n/admin/dashboard/zh-hant.json",
    );
  });
});
