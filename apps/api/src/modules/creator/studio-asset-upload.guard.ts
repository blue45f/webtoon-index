import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import { isStudioRasterAssetAdmissionOptedIn } from "../../../../web/src/shared/lib/studio-raster-asset-contract";
import { isStudioWorkAssetAdmissionOptedIn } from "../../../../web/src/shared/lib/studio-work-asset-contract";

interface StudioAssetUploadRequest {
  headers?: Record<string, string | string[] | undefined>;
}

function requireAuthenticatedUploadRequest(context: ExecutionContext): void {
  const request = context.switchToHttp().getRequest<StudioAssetUploadRequest>();
  const userId = request.headers?.["x-user-id"];
  if (typeof userId !== "string" || userId.length === 0) {
    throw new ForbiddenException("로그인이 필요해요.");
  }
}

/** Runs before Multer, so a disabled experiment never buffers an upload body. */
@Injectable()
export class StudioRasterAssetUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    requireAuthenticatedUploadRequest(context);
    if (!isStudioRasterAssetAdmissionOptedIn(
      process.env.STUDIO_RASTER_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "래스터 공동 편집 저장은 검증된 렌더러 인계가 준비될 때까지 비활성화되어 있습니다."
      );
    }
    return true;
  }
}

/** Runs before Multer, keeping every unfinished work-asset body path fail-closed. */
@Injectable()
export class StudioWorkAssetUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    requireAuthenticatedUploadRequest(context);
    if (!isStudioWorkAssetAdmissionOptedIn(
      process.env.STUDIO_WORK_ASSET_ADMISSION
    )) {
      throw new ForbiddenException(
        "협업 에셋 입장은 안전한 버전 교체 기능을 준비하는 동안 비활성화되어 있습니다."
      );
    }
    return true;
  }
}
