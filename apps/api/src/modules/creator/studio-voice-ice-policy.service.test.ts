import { createHmac } from "node:crypto";

import {
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { StudioVoiceIcePolicyResponseSchema } from "../../../../web/src/shared/lib/studio-voice-ice-policy-contract";

import { CreatorService } from "./creator.service";
import {
  StudioVoiceIcePolicyService,
  issueStudioVoiceIcePolicy,
  resolveStudioVoiceIceConfiguration,
  type StudioVoiceIceConfiguration,
} from "./studio-voice-ice-policy.service";

const TURN_SECRET = "turn-shared-secret-with-at-least-thirty-two-characters";

function configuration(
  overrides: Partial<StudioVoiceIceConfiguration> = {}
): StudioVoiceIceConfiguration {
  return {
    stunUrls: [],
    turnUrls: [],
    turnSharedSecret: null,
    turnTtlSeconds: 900,
    turnRequired: false,
    production: false,
    ...overrides,
  };
}

function team(options: { userId: string; workId: string; role?: string }) {
  const role = options.role ?? "editor";
  return {
    workId: options.workId,
    viewer: {
      userId: options.userId,
      role,
      status: "active",
      capabilities: {
        view: true,
        comment: role !== "viewer",
        edit: role === "editor" || role === "admin" || role === "owner",
        manageMembers: role === "admin" || role === "owner",
        respondInvite: false,
      },
    },
    members: [],
  };
}

describe("Studio voice ICE configuration", () => {
  it("defaults to a privacy-preserving direct mode without contacting third parties", () => {
    expect(resolveStudioVoiceIceConfiguration({})).toEqual({
      stunUrls: [],
      turnUrls: [],
      turnSharedSecret: null,
      turnTtlSeconds: 900,
      turnRequired: false,
      production: false,
    });
  });

  it("parses, deduplicates and bounds deployment-owned STUN/TURN settings", () => {
    expect(resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_STUN_URLS: "stun:voice.example.com, stun:voice.example.com",
      STUDIO_VOICE_TURN_URLS: "turn:voice.example.com?transport=udp turns:voice.example.com:5349?transport=tcp",
      STUDIO_VOICE_TURN_SHARED_SECRET: TURN_SECRET,
      STUDIO_VOICE_TURN_REQUIRED: "true",
      STUDIO_VOICE_TURN_TTL_SECONDS: "600",
    })).toEqual({
      stunUrls: ["stun:voice.example.com"],
      turnUrls: [
        "turn:voice.example.com?transport=udp",
        "turns:voice.example.com:5349?transport=tcp",
      ],
      turnSharedSecret: TURN_SECRET,
      turnTtlSeconds: 600,
      turnRequired: true,
      production: false,
    });
  });

  it("fails application configuration when commercial TURN is required but incomplete", () => {
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_TURN_REQUIRED: "true",
    })).toThrow(/TURN 필수 모드/u);
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_TURN_URLS: "turn:voice.example.com",
    })).toThrow(/함께 설정/u);
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_TURN_URLS: "turn:voice.example.com",
      STUDIO_VOICE_TURN_SHARED_SECRET: "too-short",
    })).toThrow(/최소 32자/u);
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_STUN_URLS: "https://voice.example.com",
    })).toThrow(/stun:/u);
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_TURN_REQUIRED: "true",
      STUDIO_VOICE_TURN_URLS: "turn:voice.example.com?transport=udp",
      STUDIO_VOICE_TURN_SHARED_SECRET: TURN_SECRET,
    })).toThrow(/TCP\/TLS/u);
    expect(resolveStudioVoiceIceConfiguration({
      NODE_ENV: "production",
    })).toMatchObject({ production: true, turnRequired: false });
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_STUN_URLS: "stun:user@voice.example.com",
    })).toThrow(/유효한 stun:/u);
    expect(() => resolveStudioVoiceIceConfiguration({
      STUDIO_VOICE_TURN_URLS: "turn:voice.example.com?arbitrary=true",
      STUDIO_VOICE_TURN_SHARED_SECRET: TURN_SECRET,
    })).toThrow(/유효한 stun:/u);
  });
});

describe("Studio voice ICE credential issuance", () => {
  it("issues coturn REST-compatible, opaque, expiring credentials", () => {
    const nowMs = Date.parse("2026-07-18T08:00:00.000Z");
    const policy = issueStudioVoiceIcePolicy({
      configuration: configuration({
        stunUrls: ["stun:voice.example.com"],
        turnUrls: ["turn:voice.example.com?transport=udp"],
        turnSharedSecret: TURN_SECRET,
        turnTtlSeconds: 600,
        turnRequired: true,
      }),
      userId: "private-user-id",
      workId: "private-work-id",
      nowMs,
    });

    expect(StudioVoiceIcePolicyResponseSchema.parse(policy)).toEqual(policy);
    expect(policy).toMatchObject({
      version: 1,
      mode: "turn",
      issuedAt: "2026-07-18T08:00:00.000Z",
      expiresAt: "2026-07-18T08:10:00.000Z",
      ttlSeconds: 600,
    });
    const turn = policy.iceServers[1];
    const opaqueIdentity = createHmac("sha256", TURN_SECRET)
      .update("toonspectrum-studio-voice-identity-v1\0")
      .update("private-work-id")
      .update("\0")
      .update("private-user-id")
      .digest("base64url")
      .slice(0, 32);
    expect(turn?.username).toBe(`1784362200:${opaqueIdentity}`);
    expect(turn?.username).not.toContain("private-user-id");
    expect(turn?.username).not.toContain("private-work-id");
    expect(turn?.credential).toBe(
      createHmac("sha1", TURN_SECRET).update(turn?.username ?? "").digest("base64")
    );
  });

  it("returns explicit direct or STUN-only policies when relay is optional", () => {
    expect(issueStudioVoiceIcePolicy({
      configuration: configuration(),
      userId: "direct-user",
      workId: "direct-work",
      nowMs: 1,
    })).toEqual({
      version: 1,
      mode: "direct",
      iceServers: [],
      issuedAt: "1970-01-01T00:00:00.000Z",
      expiresAt: null,
      ttlSeconds: 0,
    });
    expect(issueStudioVoiceIcePolicy({
      configuration: configuration({ stunUrls: ["stun:voice.example.com"] }),
      userId: "stun-user",
      workId: "stun-work",
      nowMs: 1,
    })).toEqual({
      version: 1,
      mode: "stun",
      iceServers: [{ urls: ["stun:voice.example.com"] }],
      issuedAt: "1970-01-01T00:00:00.000Z",
      expiresAt: null,
      ttlSeconds: 0,
    });
  });
});

describe("StudioVoiceIcePolicyService", () => {
  it("rate-limits screen-share relay credential issuance per user and work", async () => {
    const userId = "screen-rate-user-unique-0720";
    const workId = "screen-rate-work-unique-0720";
    const getWorkTeam = vi.fn().mockResolvedValue(team({ userId, workId }));
    const service = new StudioVoiceIcePolicyService(
      { getWorkTeam } as unknown as CreatorService,
      configuration()
    );

    for (let count = 0; count < 12; count += 1) {
      await expect(service.issueScreenShare(userId, workId)).resolves.toMatchObject({
        mode: "direct",
      });
    }
    await expect(service.issueScreenShare(userId, workId)).rejects.toBeInstanceOf(
      HttpException
    );
    expect(getWorkTeam).toHaveBeenCalledTimes(12);
  });

  it("issues screen-share ICE credentials to active viewers", async () => {
    const userId = "screen-viewer-unique-a";
    const workId = "screen-work-unique-a";
    const getWorkTeam = vi.fn().mockResolvedValue(team({
      userId,
      workId,
      role: "viewer",
    }));
    const service = new StudioVoiceIcePolicyService(
      { getWorkTeam } as unknown as CreatorService,
      configuration()
    );

    await expect(service.issueScreenShare(userId, workId)).resolves.toMatchObject({
      mode: "direct",
    });
    expect(getWorkTeam).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a screen-share ICE caller has no active view capability", async () => {
    const userId = "screen-revoked-unique-a";
    const workId = "screen-work-unique-b";
    const snapshot = team({ userId, workId, role: "viewer" });
    const getWorkTeam = vi.fn().mockResolvedValue({
      ...snapshot,
      viewer: {
        ...snapshot.viewer,
        capabilities: { ...snapshot.viewer.capabilities, view: false },
      },
    });
    const service = new StudioVoiceIcePolicyService(
      { getWorkTeam } as unknown as CreatorService,
      configuration()
    );

    await expect(service.issueScreenShare(userId, workId)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("keeps production screen sharing on the zero-relay-cost direct path when TURN is optional", async () => {
    const userId = "screen-production-unique-a";
    const workId = "screen-production-work-unique-a";
    const getWorkTeam = vi.fn().mockResolvedValue(team({ userId, workId }));
    const service = new StudioVoiceIcePolicyService(
      { getWorkTeam } as unknown as CreatorService,
      configuration({ production: true, turnRequired: false })
    );

    await expect(service.issueScreenShare(userId, workId)).resolves.toMatchObject({
      mode: "direct",
      iceServers: [],
    });
  });
});
