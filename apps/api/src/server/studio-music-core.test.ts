import { describe, expect, it, vi } from "vitest";

import { defaultMusicBrief, MUSIC_MAX_BYTES } from "@toonspectrum/core/studio-music";

import { composeMusic, musicStatus } from "./studio-music-core";

const env = { STUDIO_MUSIC_ENABLED: "true", STUDIO_MUSIC_LICENSE_ACKNOWLEDGED: "true", ELEVENLABS_API_KEY: "test-only-key", UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-only-token" };
const key = "00000000-0000-4000-8000-000000000001";
const brief = { ...defaultMusicBrief(), scene: "고요한 새벽의 재회", rightsConfirmed: true };
const audio = () => new Response(new Uint8Array([73, 68, 51, ...Array(20).fill(0)]), { headers: { "Content-Type": "audio/mpeg", "song-id": "song-1" } });
const redis = (result: string) => Response.json({ result });
const signal = () => new AbortController().signal;
describe("studio music paid request boundary", () => {
  it("fails closed without explicit enablement, license review, or distributed coordination", async () => {
    for (const name of Object.keys(env)) {
      const config = { ...env, [name]: "" };
      const transport = vi.fn<typeof fetch>();
      expect(musicStatus(config).enabled).toBe(false);
      await expect(composeMusic(config, "u", key, brief, signal(), transport)).rejects.toMatchObject({ status: 503 });
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("requires authentication and valid idempotency before any external request", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(composeMusic(env, undefined, key, brief, signal(), transport)).rejects.toMatchObject({ status: 401 });
    await expect(composeMusic(env, "u", "bad", brief, signal(), transport)).rejects.toMatchObject({ status: 400 });
    await expect(composeMusic(env, "u", key, { ...brief, rightsConfirmed: false }, signal(), transport)).rejects.toMatchObject({ status: 400 });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["duplicate", "conflict", "user-limit", "global-limit", "unrecognized"])("never contacts the paid provider after %s admission", async (result) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(redis(result));
    await expect(composeMusic(env, "u", key, brief, signal(), transport)).rejects.toBeInstanceOf(Error);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("fails closed when Redis is unreachable", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    await expect(composeMusic(env, "u", key, brief, signal(), transport)).rejects.toMatchObject({ status: 503 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("posts only the documented prompt API contract and returns actual audio", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(redis("accepted")).mockResolvedValueOnce(audio());
    const result = await composeMusic(env, "u", key, brief, signal(), transport);
    expect(result.audio.length).toBe(23);
    expect(result.songId).toBe("song-1");
    const [url, init] = transport.mock.calls[1];
    expect(url).toBe("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(init?.body as string);
    expect(body.force_instrumental).toBe(true);
    expect(body.music_length_ms).toBe(30000);
    expect(body.model_id).toBe("music_v1");
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("composition_plan");
    expect(body.prompt).not.toContain("test-only");
  });
  it("uses explicit original lyrics for vocals without forcing instrumental", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(redis("accepted")).mockResolvedValueOnce(audio());
    await composeMusic(env, "u", key, { ...brief, vocals: true, lyrics: "우리의 내일을 노래해" }, signal(), transport);
    expect(JSON.parse(transport.mock.calls[1][1]?.body as string)).toMatchObject({ force_instrumental: false });
  });
  it.each([400, 401, 403, 422, 429, 500])("does not retry or expose provider error body for HTTP %i", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(redis("accepted")).mockResolvedValueOnce(new Response("test-only-secret", { status }));
    await expect(composeMusic(env, "u", key, brief, signal(), transport)).rejects.not.toThrow("test-only-secret");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects fake audio, empty payload and oversized streams", async () => {
    const cases = [new Response("<html>failure</html>", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array(), { headers: { "content-type": "audio/mpeg" } }), new Response(new Uint8Array(MUSIC_MAX_BYTES + 1), { headers: { "content-type": "audio/mpeg" } })];
    for (const response of cases) {
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(redis("accepted")).mockResolvedValueOnce(response);
      await expect(composeMusic(env, "u", key, brief, signal(), transport)).rejects.toMatchObject({ status: 502 });
    }
  });
  it("does not dispatch a request that was already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(composeMusic(env, "u", key, brief, controller.signal, transport)).rejects.toMatchObject({ status: 499 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("has no hidden automatic retry after an unknown provider outcome", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(redis("accepted")).mockRejectedValueOnce(new Error("network disconnect"));
    await expect(composeMusic(env, "u", key, brief, signal(), transport)).rejects.toMatchObject({ status: 502 });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
