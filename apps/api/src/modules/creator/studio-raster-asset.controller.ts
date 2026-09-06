import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { STUDIO_RASTER_ASSET_MAX_BYTES } from "../../../../web/src/shared/lib/studio-raster-asset-contract";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

import { StudioRasterAssetUploadGuard } from "./studio-asset-upload.guard";
import {
  DeleteStudioRasterAssetQueryDto,
  StudioRasterAssetParamsDto,
} from "./studio-raster-asset.dto";
import { StudioRasterAssetService } from "./studio-raster-asset.service";

import type { StudioRasterAssetUploadFile } from "./studio-raster-asset.service";
import type { Response } from "express";

function authenticatedUserId(userId: string | undefined): string {
  if (!userId) throw new ForbiddenException("로그인이 필요해요.");
  return userId;
}

@Controller()
export class StudioRasterAssetController {
  constructor(
    @Inject(StudioRasterAssetService)
    private readonly service: StudioRasterAssetService
  ) {}

  @Put("/creator/works/:id/raster-assets/:assetId")
  @UseGuards(StudioRasterAssetUploadGuard)
  @UseInterceptors(FileInterceptor("file", {
    limits: {
      fileSize: STUDIO_RASTER_ASSET_MAX_BYTES,
      files: 1,
      fields: 0,
      fieldNameSize: 64,
      parts: 1,
    },
  }))
  async upload(
    @Param(new ZodValidationPipe(StudioRasterAssetParamsDto)) params: StudioRasterAssetParamsDto,
    @UploadedFile() file: StudioRasterAssetUploadFile | undefined,
    @Headers("x-user-id") userId?: string
  ) {
    return this.service.upload(
      authenticatedUserId(userId),
      params.id,
      params.assetId,
      file
    );
  }

  @Get("/creator/works/:id/raster-assets/:assetId")
  @Header("Cache-Control", "private, no-store, max-age=0")
  async manifest(
    @Param(new ZodValidationPipe(StudioRasterAssetParamsDto)) params: StudioRasterAssetParamsDto,
    @Headers("x-user-id") userId?: string
  ) {
    return this.service.getManifest(
      authenticatedUserId(userId),
      params.id,
      params.assetId
    );
  }

  @Get("/creator/works/:id/raster-assets/:assetId/content")
  async content(
    @Param(new ZodValidationPipe(StudioRasterAssetParamsDto)) params: StudioRasterAssetParamsDto,
    @Headers("x-user-id") userId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const content = await this.service.getContent(
      authenticatedUserId(userId),
      params.id,
      params.assetId
    );
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("ETag", `"${content.manifest.sha256}"`);
    return new StreamableFile(Buffer.from(content.payload), {
      type: content.manifest.mediaType,
      length: content.manifest.byteLength,
      disposition: "inline",
    });
  }

  /**
   * Narrow upload-race compensation. The repository retains another uploader's payload and every
   * identity that has ever materialized in the durable raster CRDT frontier.
   */
  @Delete("/creator/works/:id/raster-assets/:assetId")
  async deleteUnreferencedUpload(
    @Param(new ZodValidationPipe(StudioRasterAssetParamsDto)) params: StudioRasterAssetParamsDto,
    @Query(new ZodValidationPipe(DeleteStudioRasterAssetQueryDto)) query: DeleteStudioRasterAssetQueryDto,
    @Headers("x-user-id") userId?: string
  ) {
    return {
      deleted: await this.service.deleteUnreferencedUpload(
        authenticatedUserId(userId),
        {
          workId: params.id,
          assetId: params.assetId,
          sha256: query.expectedSha256,
          mediaType: query.mediaType,
          byteLength: query.byteLength,
          width: query.width,
          height: query.height,
        }
      ),
    };
  }
}
