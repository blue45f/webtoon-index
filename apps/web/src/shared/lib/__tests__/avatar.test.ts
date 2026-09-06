import { describe, expect, it } from "vitest";

import {
  AVATAR_PRESETS,
  MAX_AVATAR_IMAGE_BYTES,
  pickAvatarPreset,
  resolveSignupAvatar,
  resolveSignupAvatarImage,
} from "../avatar";

describe("signup avatar presets", () => {
  it("resolves preset ids to the stored avatar color", () => {
    const preset = AVATAR_PRESETS[2];

    expect(resolveSignupAvatar(preset.id)).toBe(preset.color);
  });

  it("keeps legacy color values accepted by the old signup flow", () => {
    expect(resolveSignupAvatar("#9b7bff")).toBe("#9b7bff");
  });

  it("falls back to the first preset for invalid input", () => {
    expect(resolveSignupAvatar("not-an-avatar")).toBe(AVATAR_PRESETS[0].color);
    expect(resolveSignupAvatar(undefined)).toBe(AVATAR_PRESETS[0].color);
  });

  it("picks a deterministic preset from signup identity", () => {
    expect(pickAvatarPreset("밤서가", "reader@example.com")).toEqual(
      pickAvatarPreset("밤서가", "reader@example.com")
    );
    expect(AVATAR_PRESETS).toContain(pickAvatarPreset("", "reader@example.com"));
  });
});

describe("signup avatar image uploads", () => {
  it("accepts small png, jpeg, and webp data urls", () => {
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64")}`;
    const webp = `data:image/webp;base64,${Buffer.from("RIFFxxxxWEBP").toString("base64")}`;

    expect(resolveSignupAvatarImage(png)).toBe(png);
    expect(resolveSignupAvatarImage(jpeg)).toBe(jpeg);
    expect(resolveSignupAvatarImage(webp)).toBe(webp);
  });

  it("rejects unsafe or malformed image payloads", () => {
    expect(resolveSignupAvatarImage("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
    expect(resolveSignupAvatarImage("https://example.com/avatar.png")).toBeNull();
    expect(resolveSignupAvatarImage("not-an-image")).toBeNull();
    expect(resolveSignupAvatarImage(undefined)).toBeNull();
  });

  it("rejects spoofed data urls without a matching image signature", () => {
    const spoofed = `data:image/png;base64,${Buffer.from("not actually png").toString("base64")}`;

    expect(resolveSignupAvatarImage(spoofed)).toBeNull();
  });

  it("rejects images over the signup payload limit", () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_AVATAR_IMAGE_BYTES + 1).toString("base64")}`;

    expect(resolveSignupAvatarImage(oversized)).toBeNull();
  });
});
