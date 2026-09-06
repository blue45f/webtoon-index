import type {
  CreateCreatorMarketplaceSocialComment,
  CreatorMarketplaceSocialPage,
  UpsertCreatorMarketplaceSocialReview,
} from "@/shared/lib/creator-marketplace-social-contract";

import {
  CreateCreatorMarketplaceSocialCommentSchema,
  CreatorMarketplaceSocialPageSchema,
  UpsertCreatorMarketplaceSocialReviewSchema,
} from "@/shared/lib/creator-marketplace-social-contract";
import { api, toApiError } from "@/src/infrastructure/api";

const BASE = "/creator/marketplace/resources";

function resourceBase(resourceId: string): string {
  return `${BASE}/${encodeURIComponent(resourceId)}`;
}

function parsePage(value: unknown): CreatorMarketplaceSocialPage {
  return CreatorMarketplaceSocialPageSchema.parse(value);
}

export async function getCreatorMarketplaceSocialPage(
  resourceId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  try {
    return parsePage(await api.get<unknown>(
      `${resourceBase(resourceId)}/social`,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "마켓 댓글과 리뷰를 불러오지 못했습니다.");
  }
}

export async function createCreatorMarketplaceComment(
  resourceId: string,
  input: CreateCreatorMarketplaceSocialComment,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  const body = CreateCreatorMarketplaceSocialCommentSchema.parse(input);
  try {
    return parsePage(await api.post<unknown>(
      `${resourceBase(resourceId)}/comments`,
      body,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "댓글을 등록하지 못했습니다.");
  }
}

export async function deleteCreatorMarketplaceComment(
  resourceId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  try {
    return parsePage(await api.delete<unknown>(
      `${resourceBase(resourceId)}/comments/${encodeURIComponent(commentId)}`,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "댓글을 삭제하지 못했습니다.");
  }
}

export async function toggleCreatorMarketplaceCommentLike(
  resourceId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  try {
    return parsePage(await api.post<unknown>(
      `${resourceBase(resourceId)}/comments/${encodeURIComponent(commentId)}/like`,
      undefined,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "댓글 반응을 변경하지 못했습니다.");
  }
}

export async function upsertCreatorMarketplaceReview(
  resourceId: string,
  input: UpsertCreatorMarketplaceSocialReview,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  const body = UpsertCreatorMarketplaceSocialReviewSchema.parse(input);
  try {
    return parsePage(await api.put<unknown>(
      `${resourceBase(resourceId)}/review`,
      body,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "리뷰를 저장하지 못했습니다.");
  }
}

export async function deleteCreatorMarketplaceReview(
  resourceId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  try {
    return parsePage(await api.delete<unknown>(
      `${resourceBase(resourceId)}/review`,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "리뷰를 삭제하지 못했습니다.");
  }
}

export async function toggleCreatorMarketplaceReviewHelpful(
  resourceId: string,
  reviewId: string,
  signal?: AbortSignal,
): Promise<CreatorMarketplaceSocialPage> {
  try {
    return parsePage(await api.post<unknown>(
      `${resourceBase(resourceId)}/reviews/${encodeURIComponent(reviewId)}/helpful`,
      undefined,
      { signal },
    ));
  } catch (error) {
    throw await toApiError(error, "리뷰 도움 반응을 변경하지 못했습니다.");
  }
}
