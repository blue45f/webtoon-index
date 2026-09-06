/**
 * Studio 스톡 사진 검색 — BYOK(Bring Your Own Key) Unsplash API 클라이언트.
 *
 * studio-ai-client.ts와 **동일한 아키텍처 원칙**(sessionStorage에만 키 저장·throw하지 않는 Result
 * 계약·키 미설정 시 fetch 자체를 호출하지 않음)을 따르되, 벤더 중립(OpenAI 호환) 설계는 아니다 —
 * Unsplash Search Photos API(`GET /search/photos`, `Authorization: Client-ID {ACCESS_KEY}` 헤더,
 * `{ errors: string[] }` 에러 응답)는 다른 스톡 사진 서비스(Pexels·Pixabay 등)와 공유하는 업계
 * 표준 요청/응답 형태가 없다 — OpenAI Images/Chat Completions처럼 여러 벤더가 일부러 흉내 내는
 * "호환 API" 생태계가 스톡 사진 쪽엔 없어서다. 그래서 studio-ai-client.ts의 `baseUrl` 필드 같은
 * "엔드포인트 스왑" 여지를 두지 않고 baseURL(https://api.unsplash.com)을 고정한다 — 사용자는 Access
 * Key 하나만 입력한다.
 *
 * **서버를 거치지 않는다** — Access Key는 이 앱 백엔드로 절대 전송되지 않고 브라우저
 * 현재 탭의 sessionStorage에만 저장되며, fetch도 브라우저 → Unsplash로 직접 나간다("$0 서버비용" 원칙과 일치 —
 * 사용자가 자기 키로 자기 무료 할당량을 쓴다). 코드 어디에도 Access Key를 하드코딩하지 않는다.
 *
 * 순수 로직이다(DOM/Konva 의존 없음, 결정적) — 유일한 예외는 맨 아래 `inlineStockPhotoForCanvas`
 * (선택한 사진을 `Image`/`canvas`로 디코딩해 이 앱의 "이미지 요소 src는 항상 data: URL" 불변식에
 * 맞게 변환)로, 이 함수만 DOM에 의존해 vitest(jsdom)로 픽셀 디코딩을 검증할 수 없다
 * (studio-image-utils.ts의 downscaleImageFile/downscaleDataUrl과 동일하게 테스트 스코프 밖 —
 * 아래 §5-2 참고).
 *
 * 에러 계약: studio-ai-client.ts와 동일 — 이 모듈의 모든 async 함수는 **절대 throw하지 않는다**,
 * 항상 `StudioStockImageResult<T>`(성공 `{ok:true,data}` / 실패 `{ok:false,code,error}`)를
 * resolve한다. Access Key 미설정·빈 검색어는 fetch를 아예 호출하지 않고 즉시
 * `{ok:false,code:"not_configured"|"invalid_input",...}`을 반환한다.
 *
 * 이 기능은 studio-ai-client.ts의 "AI 어시스트"(생성형 AI 배경 생성·자동 채색·구도 제안)와
 * **완전히 별개의 독립 경로**다 — Unsplash 사진은 실사진(라이선스 사진)이지 AI 생성물이 아니므로,
 * StudioPage.tsx 통합 시 "생성형 AI 최초 사용 고지" 모달(aiNoticeOpen/runWithAiNotice)로 게이팅하지
 * **않는다**. 대신 이 모듈만의 출처 표시 의무(§5)를 진다 — docs/studio-stock-image-integration.md
 * 참고.
 *
 * §5 — Unsplash API Guidelines(이용약관) 준수를 위해 이 모듈이 하는 일:
 *   1. **크레딧(출처) 표시.** 사진마다 작가(photographer)와 Unsplash 양쪽에, 각자의 프로필/사진
 *      페이지로 연결되는 링크와 함께 출처를 표시해야 한다(권장 UTM 파라미터
 *      `utm_source=<앱 이름>&utm_medium=referral` 포함). `searchStockPhotos`가 반환하는
 *      `credit.photographerProfileUrl`/`credit.unsplashPhotoPageUrl`은 이미 이 UTM 파라미터가 붙어
 *      있다(`appendUtmParams`) — 호출부(패널)는 이 두 링크를 그대로 하이퍼링크로 노출하기만 하면
 *      된다. 캔버스에 삽입한 뒤에도 크레딧을 잃지 않도록, 이 크레딧 객체를 캔버스 요소에 영구
 *      보존하는 것을 권장한다(통합 설계 참고 — `ImageEl.stockImageCredit`).
 *   2. **download_location 트리거.** 사용자가 사진을 실제로 "사용"(이 앱에서는 캔버스에
 *      삽입하는 행위 — 검색 결과에 그냥 보여주기만 하는 것은 트리거 대상이 아니다)할 때마다, 그
 *      사진의 `links.download_location` 엔드포인트에 GET 요청을 보내야 한다. `triggerStockImageDownload`가
 *      이 역할을 한다 — 호출부는 삽입 직전/직후에 이 함수를 호출하되, **결과를 기다려 삽입 자체를
 *      막을 필요는 없다**(fire-and-forget으로 호출해도 안전하도록 이 함수의 부수효과는 오직 이 GET
 *      요청 하나뿐이다 — 실패해도 사용자의 삽입 동작에 영향이 없어야 한다).
 */

// ── 설정 저장 ──────────────────────────────────────────────────────────────

/**
 * Web Storage 호환 인터페이스 — studio-ai-client.ts의 `StudioAiStorage`와 구조가 동일한 DI
 * 패턴이지만, 의도적으로 **독립된 타입**이다(studio-ai-client.ts를 import하지 않는다) — 두 BYOK
 * 기능(AI 어시스트 / 스톡 사진 검색)을 코드 레벨에서도 완전히 분리해 두어, 한쪽을 건드려도 다른
 * 쪽이 영향받지 않게 한다.
 */
export interface StudioStockImageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * studio-ai-client.ts와 독립된 sessionStorage 키. 같은 문자열의 과거 localStorage 값은
 * 보안상 자동 마이그레이션하지 않고 설정 패널 마운트 시 명시적으로 폐기한다.
 * 값은 JSON이 아니라 원문 Access Key 문자열 그대로 저장한다 — 저장할 필드가 이거 하나뿐이라 JSON
 * 래핑(및 필드별 관대한 폴백 파싱)이 불필요한 의례이기 때문이다(studio-ai-client.ts의 다중 필드
 * 설정 객체와의 유일한 구조적 차이 — §5 대신 통합 설계 문서의 "설계 결정" 절 참고).
 */
export const STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY = "studio_unsplash_access_key";

/** 저장된 Access Key 로드 — 저장소 부재·조회 실패는 빈 문자열(미설정 상태)로 취급한다. */
export function loadStudioStockImageAccessKey(storage: StudioStockImageStorage | null | undefined): string {
  if (!storage) return "";
  try {
    return storage.getItem(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 현재 탭 세션 저장 — 실패(쿼터 초과·시크릿 모드 등)는 조용히 무시한다. */
export function saveStudioStockImageAccessKey(
  storage: StudioStockImageStorage | null | undefined,
  accessKey: string
): void {
  if (!storage) return;
  try {
    storage.setItem(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY, accessKey);
  } catch {
    // 무시.
  }
}

/** 과거 영구 localStorage 자격 증명을 값 읽기 없이 폐기한다. */
export function discardLegacyStudioStockImageAccessKey(
  storage: StudioStockImageStorage | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY);
  } catch {
    // Legacy cleanup failure must not break the settings surface.
  }
}

/** Access Key가 비어 있지 않아야 "설정 완료"로 간주한다(studio-ai-client.ts isStudioAiConfigured와 동일 정책). */
export function isStudioStockImageConfigured(accessKey: string): boolean {
  return accessKey.trim().length > 0;
}

// ── 공통 타입 ──────────────────────────────────────────────────────────────

export type StudioStockImageErrorCode =
  | "not_configured" // Access Key 미설정 — fetch를 아예 호출하지 않는다.
  | "invalid_input" // 빈 검색어, 빈 download_location URL 등 호출 전 검증 실패.
  | "network_error" // fetch 자체가 reject(오프라인, CORS, DNS 등).
  | "http_error" // 2xx 아닌 응답(401 잘못된 키/403 rate limit/500 등).
  | "parse_error"; // 2xx이지만 JSON이 아니거나 기대한 필드가 없음.

export type StudioStockImageResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: StudioStockImageErrorCode; error: string };

/**
 * 사진 1장의 출처 크레딧 — 링크 두 개 모두 Unsplash API Guidelines가 권장하는 UTM 파라미터가 이미
 * 붙어 있다(appendUtmParams). 캔버스 요소(`ImageEl.stockImageCredit`)에 영구 보존해 삽입 이후에도
 * (선택 시 사이드바 등에서) 다시 보여줄 수 있게 하는 것을 권장한다 — §5 참고.
 */
export interface StudioStockImageCredit {
  photographerName: string;
  /** Unsplash 프로필 URL(UTM 파라미터 포함) — 작가 크레딧 링크. */
  photographerProfileUrl: string;
  /** Unsplash 사진 페이지 URL(UTM 파라미터 포함) — "Unsplash" 크레딧 링크. */
  unsplashPhotoPageUrl: string;
}

export interface StudioStockImageRateLimit {
  limit: number;
  remaining: number;
}

export interface StudioStockPhoto {
  id: string;
  /** alt_description ?? description ?? "" (Unsplash 응답에 둘 다 없는 경우가 흔하다). */
  description: string;
  width: number;
  height: number;
  /** 지배적 색상(hex) — 썸네일 로딩 전 배경색 플레이스홀더 등에 쓸 수 있다. */
  color: string;
  /** 검색 결과 그리드용 축소 이미지(urls.small). */
  thumbUrl: string;
  /** 캔버스 삽입용 웹 해상도 이미지(urls.regular, 약 1080px 폭). urls.raw/full은 의도적으로
   *  노출하지 않는다 — 이 앱이 삽입하는 해상도엔 과하다(필요해지면 추후 확장). */
  insertUrl: string;
  /** "다운로드"(=이 앱에서는 캔버스 삽입) 시 호출해야 하는 Unsplash 엔드포인트(links.download_location). */
  downloadLocationUrl: string;
  credit: StudioStockImageCredit;
}

export interface StudioStockPhotoSearchResult {
  photos: StudioStockPhoto[];
  page: number;
  totalPages: number;
  total: number;
  /** 응답 헤더(X-Ratelimit-Limit/Remaining)에서 뽑은 시간당 요청 한도/잔여량 — 헤더가 없으면 null. */
  rateLimit: StudioStockImageRateLimit | null;
}

const UNSPLASH_API_BASE_URL = "https://api.unsplash.com";

/** 한 페이지당 결과 수 — Unsplash 기본값(10)보다 넉넉하게, 최대(30)보다는 보수적으로 고정. */
export const STUDIO_STOCK_IMAGE_RESULTS_PER_PAGE = 20;

/** Unsplash API 가입 안내 — 설정 UI의 "Access Key 발급받기" 링크용. */
export const STUDIO_STOCK_IMAGE_DEVELOPER_SIGNUP_URL = "https://unsplash.com/developers";

/** Unsplash API Guidelines가 권장하는 UTM 어트리뷰션 파라미터 중 이 앱의 식별자 값. */
const UTM_SOURCE = "toonspectrum";

/** 크레딧 링크에 UTM 파라미터를 붙인다 — 이미 쿼리스트링이 있는 URL도 안전하게 병합한다. */
function appendUtmParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", UTM_SOURCE);
    url.searchParams.set("utm_medium", "referral");
    return url.toString();
  } catch {
    return rawUrl; // 파싱 실패(형식이 이상한 URL) — UTM 없이 원본이라도 보여주는 편이 낫다.
  }
}

function buildSearchUrl(query: string, page: number): string {
  const url = new URL(`${UNSPLASH_API_BASE_URL}/search/photos`);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(STUDIO_STOCK_IMAGE_RESULTS_PER_PAGE));
  url.searchParams.set("content_filter", "low"); // Unsplash 기본값과 동일 — 명시적으로 고정해 둔다.
  return url.toString();
}

// ── 내부 파싱 헬퍼(테스트에서 fetch만 모킹하면 URL/헤더/응답 매핑을 전부 검증할 수 있다) ──────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Unsplash류 에러 응답(`{ errors: ["메시지1", "메시지2"] }`)을 최대한 뽑아본다 — OpenAI류
 *  `{error:{message}}`와 다른 형태라 studio-ai-client.ts의 extractErrorMessage를 재사용하지 않고
 *  이 모듈 안에 독립적으로 둔다. */
function extractUnsplashErrorMessage(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const body = asRecord(parsed);
    const errors = body?.errors;
    if (Array.isArray(errors)) {
      const messages = errors.filter((e): e is string => typeof e === "string");
      if (messages.length > 0) return messages.join(", ");
    }
  } catch {
    // 본문이 JSON이 아니면(HTML 에러 페이지 등) 무시하고 null.
  }
  return null;
}

/** 시간당 요청 한도/잔여량 헤더 — 둘 중 하나라도 없으면(테스트 환경, 일부 프록시 등) null. */
function parseUnsplashRateLimit(res: Response): StudioStockImageRateLimit | null {
  const limitHeader = res.headers.get("X-Ratelimit-Limit");
  const remainingHeader = res.headers.get("X-Ratelimit-Remaining");
  if (limitHeader === null || remainingHeader === null) return null;
  const limit = Number(limitHeader);
  const remaining = Number(remainingHeader);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  return { limit, remaining };
}

async function parseUnsplashResponse(res: Response): Promise<StudioStockImageResult<unknown>> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, code: "parse_error", error: "응답 본문을 읽지 못했습니다." };
  }
  if (!res.ok) {
    const message = extractUnsplashErrorMessage(text) ?? (res.statusText || "알 수 없는 오류");
    return { ok: false, code: "http_error", error: `요청이 실패했습니다 (HTTP ${res.status}): ${message}` };
  }
  if (!text) return { ok: false, code: "parse_error", error: "응답이 비어 있습니다." };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, code: "parse_error", error: "응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
}

/** Unsplash 검색 결과 항목 1개를 정규화한다. 필수 필드가 하나라도 없으면 그 항목만 조용히
 *  건너뛴다(null 반환) — 응답 하나가 지저분하다고 검색 전체를 실패시키지 않는다. */
function normalizePhoto(raw: unknown): StudioStockPhoto | null {
  const r = asRecord(raw);
  if (!r) return null;
  const urls = asRecord(r.urls);
  const links = asRecord(r.links);
  const user = asRecord(r.user);
  const userLinks = asRecord(user?.links);

  const id = r.id;
  const thumbUrl = urls?.small;
  const insertUrl = urls?.regular;
  const downloadLocationUrl = links?.download_location;
  const photoPageUrl = links?.html;
  const photographerName = user?.name;
  const photographerProfileUrl = userLinks?.html;

  if (
    typeof id !== "string" ||
    typeof thumbUrl !== "string" ||
    typeof insertUrl !== "string" ||
    typeof downloadLocationUrl !== "string" ||
    typeof photoPageUrl !== "string" ||
    typeof photographerName !== "string" ||
    typeof photographerProfileUrl !== "string"
  ) {
    return null;
  }

  const description =
    (typeof r.alt_description === "string" && r.alt_description) ||
    (typeof r.description === "string" && r.description) ||
    "";

  return {
    id,
    description,
    width: typeof r.width === "number" ? r.width : 0,
    height: typeof r.height === "number" ? r.height : 0,
    color: typeof r.color === "string" ? r.color : "#e5e5e5",
    thumbUrl,
    insertUrl,
    downloadLocationUrl,
    credit: {
      photographerName,
      photographerProfileUrl: appendUtmParams(photographerProfileUrl),
      unsplashPhotoPageUrl: appendUtmParams(photoPageUrl),
    },
  };
}

// ── 공개 API ──────────────────────────────────────────────────────────────

/**
 * Unsplash Search Photos API로 사진을 검색한다(`GET /search/photos`). Access Key 미설정·빈
 * 검색어는 fetch를 호출하지 않고 즉시 실패를 반환한다(studio-ai-client.ts generateBackgroundImage와
 * 동일한 순서 — 빈 입력 검사 먼저, 설정 여부 검사 다음).
 */
export async function searchStockPhotos(
  query: string,
  accessKey: string,
  opts: { page?: number } = {}
): Promise<StudioStockImageResult<StudioStockPhotoSearchResult>> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "검색어를 입력하세요." };
  if (!isStudioStockImageConfigured(accessKey)) {
    return { ok: false, code: "not_configured", error: "설정에서 Unsplash Access Key를 등록하세요." };
  }
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const url = buildSearchUrl(trimmed, page);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
    });
  } catch (e) {
    return { ok: false, code: "network_error", error: e instanceof Error ? e.message : "네트워크 요청에 실패했습니다." };
  }

  const rateLimit = parseUnsplashRateLimit(res);
  const parsed = await parseUnsplashResponse(res);
  if (!parsed.ok) return parsed;

  const body = asRecord(parsed.data);
  const rawResults = body?.results;
  if (!Array.isArray(rawResults)) {
    return { ok: false, code: "parse_error", error: "검색 결과 목록을 찾을 수 없습니다." };
  }

  const photos = rawResults.map(normalizePhoto).filter((p): p is StudioStockPhoto => p !== null);

  return {
    ok: true,
    data: {
      photos,
      page,
      totalPages: typeof body?.total_pages === "number" ? body.total_pages : page,
      total: typeof body?.total === "number" ? body.total : photos.length,
      rateLimit,
    },
  };
}

/**
 * Unsplash API Guidelines가 요구하는 "다운로드" 트리거 — 사용자가 사진을 실제로 사용(이 앱에서는
 * 캔버스 삽입)할 때마다 호출해야 한다(§5-2). 호출부는 이 결과를 기다려 삽입을 막을 필요가 없다 —
 * fire-and-forget으로 호출해도 안전하다.
 */
export async function triggerStockImageDownload(
  downloadLocationUrl: string,
  accessKey: string
): Promise<StudioStockImageResult<void>> {
  if (!downloadLocationUrl.trim()) {
    return { ok: false, code: "invalid_input", error: "download_location URL이 없습니다." };
  }
  if (!isStudioStockImageConfigured(accessKey)) {
    return { ok: false, code: "not_configured", error: "설정에서 Unsplash Access Key를 등록하세요." };
  }
  let res: Response;
  try {
    res = await fetch(downloadLocationUrl, {
      method: "GET",
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
  } catch (e) {
    return { ok: false, code: "network_error", error: e instanceof Error ? e.message : "네트워크 요청에 실패했습니다." };
  }
  if (!res.ok) {
    return { ok: false, code: "http_error", error: `download_location 호출이 실패했습니다 (HTTP ${res.status}).` };
  }
  return { ok: true, data: undefined };
}

// ── 캔버스 삽입용 인라인 변환(DOM 의존 — 테스트 스코프 밖, 모듈 docstring §5 참고) ────────────

/** studio-image-utils.ts downscaleImageFile과 동일한 상한. */
export const STUDIO_STOCK_IMAGE_MAX_INSERT_DIM = 1280;
export const STUDIO_STOCK_IMAGE_INSERT_QUALITY = 0.85;

/**
 * 선택한 스톡 사진을 이 앱의 "이미지 요소 src는 항상 data: URL" 불변식에 맞게 변환한다. Unsplash
 * CDN(imgix)이 Access-Control-Allow-Origin 헤더를 보내는 것을 전제로 `crossOrigin="anonymous"`로
 * 로드해 캔버스를 오염(taint)시키지 않고 `toDataURL` 할 수 있다 — studio-image-utils.ts의
 * downscaleImageFile과 동일한 canvas 축소 규약(maxDim/quality/webp)을 그대로 재사용한다.
 *
 * **DOM(Image/canvas)에 의존해 vitest(jsdom)로 픽셀 디코딩을 검증할 수 없다** — 이 파일의 다른
 * 모든 함수(순수 fetch+파싱)와 달리 이 함수만 유닛 테스트 스코프 밖이다(studio-image-utils.ts의
 * downscaleImageFile/downscaleDataUrl과 동일한 처지 — 그 파일도 테스트가 없다).
 */
export function inlineStockPhotoForCanvas(
  url: string,
  opts: { maxDim?: number; quality?: number } = {}
): Promise<StudioStockImageResult<{ dataUrl: string; width: number; height: number }>> {
  const maxDim = opts.maxDim ?? STUDIO_STOCK_IMAGE_MAX_INSERT_DIM;
  const quality = opts.quality ?? STUDIO_STOCK_IMAGE_INSERT_QUALITY;
  return new Promise((resolve) => {
    const img = new globalThis.Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve({ ok: false, code: "network_error", error: "이미지를 불러오지 못했습니다." });
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ ok: false, code: "parse_error", error: "캔버스 컨텍스트를 만들지 못했습니다." });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve({ ok: true, data: { dataUrl: canvas.toDataURL("image/webp", quality), width, height } });
      } catch {
        // crossOrigin 헤더가 없는 예외적 응답 등으로 캔버스가 오염된 경우(SecurityError) — 정상
        // 흐름에서는 발생하지 않아야 하지만(§5), 방어적으로 안전한 에러로 변환한다.
        resolve({ ok: false, code: "http_error", error: "이미지를 캔버스에 담지 못했습니다(교차 출처 제한)." });
      }
    };
    img.src = url;
  });
}
