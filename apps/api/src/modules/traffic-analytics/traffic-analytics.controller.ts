import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from "@nestjs/common";

import {
  TOONSPECTRUM_CSRF_HEADER,
  TOONSPECTRUM_CSRF_HEADER_VALUE,
} from "../../../../web/src/shared/lib/csrf";
import { isAllowedCsrfOrigin, isSameRequestOrigin } from "../../csrf-middleware";

import { TrafficAnalyticsService } from "./traffic-analytics.service";

import type { TrafficRequestContext } from "./traffic-analytics-model";
import type { Request } from "express";

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requestContext(request: Request): TrafficRequestContext {
  return {
    userAgent: singleHeader(request.headers["user-agent"]),
    host: singleHeader(request.headers.host),
    referer: singleHeader(request.headers.referer),
    countryCode:
      singleHeader(request.headers["x-vercel-ip-country"])
      ?? singleHeader(request.headers["cf-ipcountry"]),
    privacyOptOut:
      singleHeader(request.headers.dnt) === "1"
      || singleHeader(request.headers["sec-gpc"]) === "1",
  };
}

function recordBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Controller("analytics/traffic")
export class TrafficAnalyticsController {
  constructor(
    @Inject(TrafficAnalyticsService)
    private readonly trafficAnalyticsService: TrafficAnalyticsService,
  ) {}

  private requireBrowserProof(
    request: Request,
    proof: string | undefined,
  ): void {
    if (proof !== TOONSPECTRUM_CSRF_HEADER_VALUE) {
      throw new ForbiddenException("트래픽 수집 요청의 출처를 확인할 수 없습니다.");
    }

    const origin = singleHeader(request.headers.origin);
    if (origin) {
      if (
        !isSameRequestOrigin(origin, request)
        && !isAllowedCsrfOrigin(origin)
      ) {
        throw new ForbiddenException("트래픽 수집 요청의 출처를 확인할 수 없습니다.");
      }
      return;
    }

    const fetchSite = singleHeader(request.headers["sec-fetch-site"]);
    const fetchMode = singleHeader(request.headers["sec-fetch-mode"]);
    if (
      fetchSite !== "same-origin"
      || (fetchMode !== "cors" && fetchMode !== "same-origin")
    ) {
      throw new ForbiddenException("트래픽 수집 요청의 출처를 확인할 수 없습니다.");
    }
  }

  @Post("page-view")
  @HttpCode(202)
  async recordPageView(
    @Req() request: Request,
    @Headers(TOONSPECTRUM_CSRF_HEADER) proof: string | undefined,
    @Body() body: unknown,
  ) {
    this.requireBrowserProof(request, proof);
    return this.trafficAnalyticsService.recordPageView(
      recordBody(body),
      requestContext(request),
    );
  }

  @Post("heartbeat")
  @HttpCode(202)
  async recordHeartbeat(
    @Req() request: Request,
    @Headers(TOONSPECTRUM_CSRF_HEADER) proof: string | undefined,
    @Body() body: unknown,
  ) {
    this.requireBrowserProof(request, proof);
    return this.trafficAnalyticsService.recordHeartbeat(
      recordBody(body),
      requestContext(request),
    );
  }
}
