import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";

import {
  isCreatorMarketplaceSocialNamespaceValue,
  isCreatorMarketplaceSocialThreadId,
} from "../../../../web/src/shared/lib/creator-marketplace-social-namespace";
import { findCreatorMarketplaceSocialInteractionIds } from "../../common/creator-marketplace-social-boundary";

interface BoundaryRequest {
  readonly originalUrl?: unknown;
  readonly url?: unknown;
  readonly path?: unknown;
  readonly params?: Record<string, unknown>;
  readonly body?: unknown;
}

type InteractionResolver = (
  values: readonly unknown[],
) => Promise<ReadonlySet<string>>;

const MARKET_BOUNDARY_MESSAGE =
  "마켓 댓글과 평가는 마켓 전용 API에서만 변경할 수 있습니다.";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requestPath(request: BoundaryRequest): string {
  const source = [request.originalUrl, request.url, request.path]
    .find((value): value is string => typeof value === "string") ?? "";
  try {
    return new URL(source, "http://localhost").pathname;
  } catch {
    return source.split("?", 1)[0] ?? "";
  }
}

function decoded(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function titleMapKeys(body: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const field of ["ratings", "reads", "subscriptions", "reviews"]) {
    const value = record(body[field]);
    if (value) keys.push(...Object.keys(value));
  }
  const collections = Array.isArray(body.collections) ? body.collections : [];
  for (const value of collections) {
    const collection = record(value);
    if (!collection) continue;
    if (typeof collection.titleId === "string") keys.push(collection.titleId);
    if (Array.isArray(collection.titleIds)) {
      keys.push(...collection.titleIds.filter(
        (item): item is string => typeof item === "string",
      ));
    }
  }
  return keys;
}

function mergeInteractionIds(body: Record<string, unknown>): string[] {
  const likedReviews = record(body.likedReviews);
  return likedReviews ? Object.keys(likedReviews) : [];
}

function genericReplyRouteValues(
  path: string,
  params: BoundaryRequest["params"],
): string[] {
  const match = /\/reviews\/([^/]+)\/replies(?:\/([^/]+))?\/?$/u.exec(path);
  if (!match) return [];
  return [
    params?.id,
    params?.replyId,
    decoded(match[1]),
    decoded(match[2]),
  ].filter((value): value is string => typeof value === "string");
}

function genericTitleReviewValue(
  path: string,
  params: BoundaryRequest["params"],
): string | undefined {
  const match = /\/titles\/([^/]+)\/reviews\/?$/u.exec(path);
  if (!match) return undefined;
  return typeof params?.id === "string" ? params.id : decoded(match[1]);
}

export function directCreatorMarketplaceSocialBoundaryViolation(
  request: BoundaryRequest,
): string | null {
  const path = requestPath(request);
  const body = record(request.body) ?? {};

  if (
    [
      "/me/review",
      "/me/rating",
      "/me/read",
      "/me/subscription",
      "/me/collection",
    ].some((suffix) => path.endsWith(suffix))
    && isCreatorMarketplaceSocialThreadId(body.titleId)
  ) {
    return MARKET_BOUNDARY_MESSAGE;
  }

  if (path.endsWith("/me/merge")) {
    if (titleMapKeys(body).some(isCreatorMarketplaceSocialThreadId)) {
      return MARKET_BOUNDARY_MESSAGE;
    }
    if (mergeInteractionIds(body).some(
      isCreatorMarketplaceSocialNamespaceValue,
    )) {
      return MARKET_BOUNDARY_MESSAGE;
    }
  }

  if (
    path.endsWith("/me/review-like")
    && isCreatorMarketplaceSocialNamespaceValue(body.reviewId)
  ) {
    return MARKET_BOUNDARY_MESSAGE;
  }

  if (genericReplyRouteValues(path, request.params).some(
    isCreatorMarketplaceSocialNamespaceValue,
  )) {
    return MARKET_BOUNDARY_MESSAGE;
  }

  if (isCreatorMarketplaceSocialThreadId(
    genericTitleReviewValue(path, request.params),
  )) {
    return MARKET_BOUNDARY_MESSAGE;
  }

  return null;
}

export function creatorMarketplaceSocialInteractionCandidates(
  request: BoundaryRequest,
): string[] {
  const path = requestPath(request);
  const body = record(request.body) ?? {};
  if (path.endsWith("/me/review-like")) {
    return typeof body.reviewId === "string" ? [body.reviewId] : [];
  }
  if (path.endsWith("/me/merge")) return mergeInteractionIds(body);
  return genericReplyRouteValues(path, request.params);
}

export async function enforceCreatorMarketplaceSocialBoundary(
  request: BoundaryRequest,
  resolveInteractions: InteractionResolver =
    findCreatorMarketplaceSocialInteractionIds,
): Promise<void> {
  const direct = directCreatorMarketplaceSocialBoundaryViolation(request);
  if (direct) throw new BadRequestException(direct);

  const candidates = creatorMarketplaceSocialInteractionCandidates(request);
  if (candidates.length === 0) return;
  const marketplaceOwned = await resolveInteractions(candidates);
  if (marketplaceOwned.size > 0) {
    throw new BadRequestException(MARKET_BOUNDARY_MESSAGE);
  }
}

@Injectable()
export class CreatorMarketplaceSocialBoundaryGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== "http") return true;
    const request = context.switchToHttp().getRequest<BoundaryRequest>();
    await enforceCreatorMarketplaceSocialBoundary(request);
    return true;
  }
}
