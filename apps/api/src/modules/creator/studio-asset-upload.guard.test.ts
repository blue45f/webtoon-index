import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import { STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN } from "../../../../web/src/shared/lib/studio-raster-asset-contract";
import { STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN } from "../../../../web/src/shared/lib/studio-work-asset-contract";

import {
  StudioRasterAssetUploadGuard,
  StudioWorkAssetUploadGuard,
} from "./studio-asset-upload.guard";

function context(userId?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: userId ? { "x-user-id": userId } : {} }),
    }),
  } as ExecutionContext;
}

describe("Studio experimental asset upload guards", () => {
  afterEach(() => {
    delete process.env.STUDIO_RASTER_ASSET_ADMISSION;
    delete process.env.STUDIO_WORK_ASSET_ADMISSION;
  });

  it("rejects unauthenticated or disabled raster requests before multipart interception", () => {
    const guard = new StudioRasterAssetUploadGuard();
    process.env.STUDIO_RASTER_ASSET_ADMISSION =
      STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN;
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
    delete process.env.STUDIO_RASTER_ASSET_ADMISSION;
    expect(() => guard.canActivate(context("editor"))).toThrow(ForbiddenException);
    process.env.STUDIO_RASTER_ASSET_ADMISSION = "true";
    expect(() => guard.canActivate(context("editor"))).toThrow(ForbiddenException);
    process.env.STUDIO_RASTER_ASSET_ADMISSION =
      STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN;
    expect(guard.canActivate(context("editor"))).toBe(true);
  });

  it("rejects unauthenticated or disabled work-asset requests before multipart interception", () => {
    const guard = new StudioWorkAssetUploadGuard();
    process.env.STUDIO_WORK_ASSET_ADMISSION =
      STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN;
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
    delete process.env.STUDIO_WORK_ASSET_ADMISSION;
    expect(() => guard.canActivate(context("editor"))).toThrow(ForbiddenException);
    process.env.STUDIO_WORK_ASSET_ADMISSION = "true";
    expect(() => guard.canActivate(context("editor"))).toThrow(ForbiddenException);
    process.env.STUDIO_WORK_ASSET_ADMISSION =
      STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN;
    expect(guard.canActivate(context("editor"))).toBe(true);
  });
});
