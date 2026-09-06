import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appRoutes } from "../../../app/routes/route-manifest";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface ManifestShortcut {
  name: string;
  short_name?: string;
  url: string;
}

interface ManifestScreenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: "wide" | "narrow";
  label: string;
}

interface WebManifest {
  id?: string;
  start_url: string;
  scope: string;
  categories?: string[];
  icons: ManifestIcon[];
  shortcuts?: ManifestShortcut[];
  screenshots?: ManifestScreenshot[];
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "apps/web/public/manifest.webmanifest"), "utf8")
) as WebManifest;

describe("PWA manifest", () => {
  it("pins the app identity with an explicit id matching the scope", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("declares any/maskable icon purposes separately (no combined 'any maskable')", () => {
    const purposes = manifest.icons.map((icon) => icon.purpose);
    for (const purpose of purposes) {
      expect(["any", "maskable"]).toContain(purpose);
    }
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("backs maskable entries with safe-zone padded PNGs that exist in public/", () => {
    const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of maskable) {
      expect(icon.type).toBe("image/png");
      expect(existsSync(join(process.cwd(), "apps/web/public", icon.src))).toBe(true);
    }
  });

  it("exposes shortcuts that resolve to declared in-scope app routes", () => {
    const shortcuts = manifest.shortcuts ?? [];
    expect(shortcuts.map((shortcut) => shortcut.url)).toEqual(["/search", "/ranking", "/calendar"]);

    const routePaths = appRoutes.map((route) => route.path);
    for (const shortcut of shortcuts) {
      expect(routePaths).toContain(shortcut.url);
    }
  });

  it("declares store categories for richer install surfaces", () => {
    expect(manifest.categories).toEqual(["entertainment", "books"]);
  });

  it("ships wide and narrow install-UI screenshots whose declared sizes match the PNGs", () => {
    const screenshots = manifest.screenshots ?? [];
    expect(screenshots.map((shot) => shot.form_factor).sort()).toEqual(["narrow", "wide"]);

    for (const shot of screenshots) {
      expect(shot.type).toBe("image/png");
      expect(shot.label).not.toBe("");

      const file = join(process.cwd(), "apps/web/public", shot.src);
      expect(existsSync(file)).toBe(true);

      // PNG IHDR: width/height live at byte offsets 16/20, big-endian.
      const png = readFileSync(file);
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(shot.sizes);

      // Chrome's richer install UI rejects screenshots wider/taller than 2.3:1.
      const [width, height] = shot.sizes.split("x").map(Number);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2.3);
    }
  });

  it("serves a raster apple-touch-icon (iOS does not render SVG touch icons)", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const href = html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)?.[1];

    expect(href).toBe("/apple-touch-icon.png");
    expect(existsSync(join(process.cwd(), "apps/web/public/apple-touch-icon.png"))).toBe(true);
  });
});
