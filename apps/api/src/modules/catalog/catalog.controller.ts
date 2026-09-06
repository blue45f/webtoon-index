import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";

import { buildAffiliateUrl } from "../../../../web/src/shared/lib/affiliate";
import { coverImagePolicy } from "../../../../../packages/core/src/server";
import { getAppConfig } from "../../server/app-config";

import { CatalogService } from "./catalog.service";

import type { Request, Response } from "express";

type QueryMap = Record<string, string | string[] | undefined>;

interface TitleQuery {
  ids?: string;
  q?: string;
  limit?: string | number;
  sort?: string;
}

interface ReviewLikePostPayload {
  picked?: unknown;
  seedId?: unknown;
  ratings?: unknown;
  reads?: unknown;
}

interface SearchQuery {
  sort?: string;
  q?: string;
  types?: string;
  genres?: string;
  tags?: string;
  status?: string;
  platforms?: string;
  ages?: string;
  minRating?: string;
  yearMin?: string;
  yearMax?: string;
  freeOnly?: string;
  adaptedOnly?: string;
}

interface CatalogIngestPayload {
  token?: unknown;
  requestedBy?: unknown;
  force?: unknown;
}

interface KmasBookAndWebtoonQuery {
  title?: string;
  isbn?: string;
  listSeCd?: string;
  pictrWritrNm?: string;
  sntncWritrNm?: string;
  pltfomCdNm?: string;
  plscmpnIdNm?: string;
  startDate?: string;
  endDate?: string;
  pageNo?: string;
  viewItemCnt?: string;
}

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  @Get("/cover")
  async proxyCover(@Query("u") rawUrl: string | undefined, @Res() res: Response) {
    // 표지 정책이 off 면(저작권 킬스위치) 제3자 표지를 일절 중계하지 않는다 — 이미 배포·캐시된
    // 정적 JSON 의 /api/cover URL 도 여기서 무력화되고, 클라이언트는 타이포그래픽 커버로 폴백한다.
    if (coverImagePolicy() === "off") return res.status(404).send("cover image disabled");
    if (!rawUrl) return res.status(400).send("missing u");

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return res.status(400).send("bad url");
    }

    if (!allowedCoverUrl(url)) return res.status(403).send("forbidden host");

    try {
      let upstream: globalThis.Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        // Referer 를 플랫폼 도메인으로 위조하지 않는다(핫링크 보호 우회 금지). 원본 CDN 이
        // 핫링크를 거부하면 그 거부를 존중해 표지를 표시하지 않고 타이포그래픽 커버로 폴백한다.
        const response = await fetch(url.toString(), {
          headers: {
            "User-Agent": COVER_USER_AGENT,
            Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          },
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) return res.status(502).send("bad redirect");
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, url);
          } catch {
            return res.status(502).send("bad redirect");
          }
          if (!allowedCoverUrl(nextUrl)) return res.status(403).send("forbidden redirect");
          url = nextUrl;
          continue;
        }
        upstream = response;
        break;
      }

      if (!upstream) return res.status(502).send("too many redirects");
      if (!upstream.ok) return res.status(502).send("upstream error");

      const headerType = upstream.headers.get("content-type") ?? "";
      const body = Buffer.from(await upstream.arrayBuffer());
      // 헤더가 이미지 타입이거나 매직바이트가 이미지면 통과. 일부 CDN(예: 네이버 확장자 없는 썸네일)은
      // 실제 이미지를 application/octet-stream 으로 응답하므로 헤더만 신뢰하지 않고 바이트로 판별한다.
      const sniffed = sniffImageType(body);
      if (!COVER_OK_TYPE.test(headerType) && !sniffed) {
        return res.status(415).send("not an image");
      }
      res.setHeader("Content-Type", sniffed ?? headerType);
      // 표지는 제3자 저작물이라 권리침해 신고·정책 변경(킬스위치) 시 빠르게 빠져야 한다 →
      // immutable 을 쓰지 않고 재검증 가능한 캐시로 둔다(브라우저 1시간·엣지 1일·SWR 1일).
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
      return res.status(200).send(body);
    } catch {
      return res.status(502).send("fetch failed");
    }
  }

  @Get("/config")
  @Header("Cache-Control", "no-store")
  async getConfig() {
    return getAppConfig();
  }

  @Get("/home")
  @Header("Cache-Control", "no-store, max-age=0")
  async getHome() {
    return this.catalogService.getHomeData();
  }

  @Get("/calendar")
  @Header("Cache-Control", "no-store, max-age=0")
  async getCalendar() {
    return this.catalogService.getCalendarData();
  }

  @Get("/insights")
  @Header("Cache-Control", "no-store")
  async getInsights() {
    return this.catalogService.getInsightsData();
  }

  @Get("/ranking")
  @Header("Cache-Control", "no-store, max-age=0")
  async getRanking(@Query() query: QueryMap) {
    return this.catalogService.getRankingData(normalizeQueryMap(query));
  }

  @Get("/catalog/ingest/status")
  @Header("Cache-Control", "no-store, max-age=0")
  async getCatalogIngestStatus() {
    return this.catalogService.getCatalogIngestStatus();
  }

  @Post("/catalog/ingest/run")
  @Header("Cache-Control", "no-store, max-age=0")
  async runCatalogIngest(
    @Req() req: Request,
    @Body() body: CatalogIngestPayload,
    @Headers("x-catalog-ingest-token") token?: string,
    @Headers("x-user-id") userId?: string
  ) {
    return this.catalogService.runCatalogIngest(body ?? {}, token, userId, clientKeyFromRequest(req));
  }

  @Post("/catalog/refresh")
  @Header("Cache-Control", "no-store, max-age=0")
  async refreshCatalog(@Req() req: Request, @Headers("x-catalog-ingest-token") token?: string) {
    return this.catalogService.refreshCatalog(token, clientKeyFromRequest(req));
  }

  @Get("/explore")
  @Header("Cache-Control", "no-store")
  async getExplore(@Query() query: QueryMap) {
    return this.catalogService.getExploreData(normalizeQueryMap(query));
  }

  @Get("/tags")
  @Header("Cache-Control", "no-store")
  async getTags() {
    return this.catalogService.getTagCloud();
  }

  @Get("/authors")
  @Header("Cache-Control", "no-store")
  async getAuthors() {
    return this.catalogService.getAuthorDirectory();
  }

  @Get("/search")
  @Header("Cache-Control", "no-store, max-age=0")
  async getSearch(@Query() query: SearchQuery) {
    return this.catalogService.getSearchData(query);
  }

  @Get("/kmas/book-webtoons")
  @Header("Cache-Control", "no-store, max-age=0")
  async getKmasBookAndWebtoons(@Query() query: KmasBookAndWebtoonQuery) {
    return this.catalogService.getKmasBookAndWebtoonData(query);
  }

  @Post("/kmas/merge-on-access")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, max-age=0")
  async mergeKmasOnAccess(@Query("force") force?: string) {
    return this.catalogService.mergeKmasOnSiteAccess({ force: force === "1" || force === "true" });
  }

  @Post("/recommend")
  @Header("Cache-Control", "no-store, max-age=0")
  async postRecommend(@Body() body: ReviewLikePostPayload) {
    return this.catalogService.getRecommendData(body);
  }

  @Get("/titles")
  @Header("Cache-Control", "no-store, max-age=0")
  async listTitles(@Query() query: TitleQuery) {
    return this.catalogService.getTitles(query);
  }

  @Get("/titles/:id")
  @Header("Cache-Control", "no-store")
  async getTitleDetail(@Param("id") id: string) {
    const data = await this.catalogService.getTitleDetail(id);
    if (!data) throw new NotFoundException("not_found");
    return data;
  }

  @Get("/titles/:id/reviews")
  @Header("Cache-Control", "no-store, max-age=0")
  async getTitleReviews(@Param("id") id: string) {
    return this.catalogService.getTitleReviews(id);
  }

  @Get("/authors/:name")
  @Header("Cache-Control", "no-store")
  async getAuthor(@Param("name") name: string) {
    const data = await this.catalogService.getAuthorData(name);
    if (!data) throw new NotFoundException("not_found");
    return data;
  }

  @Get("/api/go/:platformId")
  @Header("Cache-Control", "no-store, max-age=0")
  async redirectAffiliate(
    @Param("platformId") platformId: string,
    @Query("to") toUrl: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (!toUrl) {
      return res.status(400).send("missing destination url ('to')");
    }

    const referrer = req.headers["referer"] || "direct";
    const userAgent = req.headers["user-agent"] || "unknown";
    const timestamp = new Date().toISOString();
    console.log(`[Affiliate Click] platform=${platformId} timestamp=${timestamp} to=${toUrl} referrer=${referrer} ua=${userAgent}`);

    const finalUrl = buildAffiliateUrl(platformId, toUrl);
    res.redirect(302, finalUrl);
  }
}

// 레이트리밋 키용 클라이언트 식별자. 주의: x-forwarded-for 맨 왼쪽은 위조 가능(베이스라인 한계,
// lib/rate-limit.ts 의 clientIp와 동일한 전제) — 신뢰 프록시 뒤에서는 플랫폼 보장 IP로 교체할 것.
function clientKeyFromRequest(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (typeof first === "string" && first.trim()) return first.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

function normalizeQueryMap(query: QueryMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string") out[key] = first;
    } else if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

const COVER_ALLOWED_HOST =
  /(^|\.)(pstatic\.net|kakaopagecdn\.com|kakaocdn\.net|ccdn\.lezhin\.com|ridicdn\.net|dn-img-page\.kakao\.com|cdn1\.munpia\.com|cf-image\.joara\.com|d3mcojo3jv0dbr\.cloudfront\.net|img\.mrblue\.com|bookimg\.bookcube\.com|img-books\.onestore\.co\.kr|image\.yes24\.com|novelpia\.com|balcony\.studio|toptoon\.com|toomics\.com|kyobobook\.co\.kr|comico\.kr)$/;
const COVER_OK_TYPE = /^image\/(jpeg|jpg|png|webp|avif|gif)\b/i;
const COVER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function allowedCoverUrl(url: URL) {
  return url.protocol === "https:" && COVER_ALLOWED_HOST.test(url.hostname);
}

// 응답 바이트의 매직넘버로 이미지 포맷 판별 (헤더가 octet-stream/누락이어도 실제 이미지면 인식).
// HTML 에러페이지 등 비이미지는 null → 415 유지.
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}
