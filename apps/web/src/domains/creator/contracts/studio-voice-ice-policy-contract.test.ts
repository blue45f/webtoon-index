import { describe, expect, it } from "vitest";

import {
  StudioVoiceIcePolicyResponseSchema,
  StudioVoiceIceUrlSchema,
} from "./studio-voice-ice-policy-contract";

const ISSUED_AT = "2026-07-18T08:00:00.000Z";

describe("Studio voice ICE policy contract", () => {
  it("accepts a separated STUN plus credentialed TURN policy with an exact lifetime", () => {
    expect(StudioVoiceIcePolicyResponseSchema.safeParse({
      version: 1,
      mode: "turn",
      iceServers: [
        { urls: ["stun:voice.example.com:3478"] },
        {
          urls: [
            "turn:voice.example.com:3478?transport=udp",
            "turns:voice.example.com:5349?transport=tcp",
          ],
          username: "1784362200:opaque",
          credential: "ephemeral-credential",
          credentialType: "password",
        },
      ],
      issuedAt: ISSUED_AT,
      expiresAt: "2026-07-18T08:10:00.000Z",
      ttlSeconds: 600,
    }).success).toBe(true);
  });

  it("rejects credentialless TURN, mixed server entries and TURN hidden in STUN mode", () => {
    const policies = [
      {
        version: 1,
        mode: "turn",
        iceServers: [{ urls: ["turn:voice.example.com"] }],
        issuedAt: ISSUED_AT,
        expiresAt: "2026-07-18T08:10:00.000Z",
        ttlSeconds: 600,
      },
      {
        version: 1,
        mode: "turn",
        iceServers: [{
          urls: ["stun:voice.example.com", "turn:voice.example.com"],
          username: "user",
          credential: "credential",
          credentialType: "password",
        }],
        issuedAt: ISSUED_AT,
        expiresAt: "2026-07-18T08:10:00.000Z",
        ttlSeconds: 600,
      },
      {
        version: 1,
        mode: "stun",
        iceServers: [{
          urls: ["turn:voice.example.com"],
          username: "user",
          credential: "credential",
          credentialType: "password",
        }],
        issuedAt: ISSUED_AT,
        expiresAt: null,
        ttlSeconds: 0,
      },
    ];

    for (const policy of policies) {
      expect(StudioVoiceIcePolicyResponseSchema.safeParse(policy).success).toBe(false);
    }
  });

  it("rejects mismatched issuance, expiry and TTL values", () => {
    expect(StudioVoiceIcePolicyResponseSchema.safeParse({
      version: 1,
      mode: "turn",
      iceServers: [{
        urls: ["turn:voice.example.com"],
        username: "user",
        credential: "credential",
        credentialType: "password",
      }],
      issuedAt: ISSUED_AT,
      expiresAt: "2026-07-18T08:09:59.000Z",
      ttlSeconds: 600,
    }).success).toBe(false);
  });

  it("rejects userinfo, control characters, arbitrary queries and invalid secure transports", () => {
    const invalidUrls = [
      "stun:user@voice.example.com",
      "turn:voice.example.com\n?transport=udp",
      "turn:voice.example.com?region=kr",
      "turns:voice.example.com?transport=udp",
      "turn:voice.example.com:65536",
    ];

    for (const url of invalidUrls) {
      expect(StudioVoiceIceUrlSchema.safeParse(url).success).toBe(false);
    }
  });
});
