import { Body, Controller, Get, Header, Headers, HttpCode, HttpException, Module, Post, Req, Res } from "@nestjs/common";

import { composeMusic, MusicError, musicStatus } from "../../server/studio-music-core";
import { MUSIC_TERMS_URL } from "@toonspectrum/core/studio-music";

import type { Request, Response } from "express";

@Controller("studio-music")
export class StudioMusicController {
  @Get("status")
  @Header("Cache-Control", "no-store, max-age=0")
  status() { return musicStatus(process.env); }

  @Post("generate")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, max-age=0")
  async generate(
    @Headers("x-user-id") userId: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // sessionAuth strips untrusted x-user-id values before this controller.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!response.writableEnded) abort(); };
    request.once("aborted", abort);
    response.once("close", close);
    if (request.aborted || response.destroyed) abort();
    try {
      const result = await composeMusic(process.env, userId, key, body, controller.signal);
      return {
        audioBase64: result.audio.toString("base64"),
        metadata: { id: key!.toLowerCase(), createdAt: new Date().toISOString(), provider: "elevenlabs", model: "music_v1", format: "mp3_44100_128", brief: result.brief, songId: result.songId, termsUrl: MUSIC_TERMS_URL },
      };
    } catch (error) {
      if (error instanceof MusicError) throw new HttpException(error.message, error.status);
      throw new HttpException("음악 생성 중 오류가 발생했습니다.", 500);
    } finally {
      request.off("aborted", abort);
      response.off("close", close);
    }
  }
}
@Module({ controllers: [StudioMusicController] })
export class StudioMusicModule {}
