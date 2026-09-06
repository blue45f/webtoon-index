/**
 * 인앱 브라우저(카카오톡·네이버·인스타그램 등) 판별과 탈출 경로.
 *
 * 한국어권 웹툰 트래픽 대부분은 메신저/SNS가 띄운 임베디드 WebView로 들어온다. 그 환경은
 * 일반 모바일 브라우저와 세 가지가 다르고, Studio 는 세 가지 모두에 의존한다.
 *
 * 1. `window.open` 이 **항상** null 을 돌려준다. 멀티 디스플레이 작업공간·"새 탭에서 같이
 *    그리기" 처럼 팝업을 여는 기능은 조용히 죽는다. "팝업을 허용해 주세요" 같은 안내는
 *    인앱 브라우저에 설정 화면이 없으므로 실행할 수 없는 지시다.
 * 2. 주소창과 뒤로 가기 크롬이 없다. 막다른 화면에 도착하면 앱을 끄는 것 말고는 길이 없다.
 * 3. 저장소·격리 정책이 앱마다 다르다(OPFS·SharedArrayBuffer 가 없을 수 있다).
 *
 * 그래서 이 모듈은 **판별만** 한다. 어떤 기능을 접을지는 각 화면이 정하고, 여기서는
 * "무엇인지"와 "밖으로 나가는 실제 방법이 있는지"만 순수 함수로 답한다. UA 문자열을 인자로
 * 받으므로 브라우저 없이도 전부 테스트된다.
 */

export type StudioInAppBrowserId =
  | "android-webview"
  | "band"
  | "daum"
  | "facebook"
  | "instagram"
  | "ios-webview"
  | "kakaotalk"
  | "line"
  | "naver"
  | "threads"
  | "tiktok"
  | "wechat";

export type StudioInAppBrowserPlatform = "android" | "ios" | "unknown";

/**
 * 인앱 브라우저에서 시스템 브라우저로 빠져나가는 방법.
 *
 * - `link`  — 누르면 바로 외부 브라우저가 열리는 URL 이 있다(`escapeHref`).
 * - `manual`— 앱이 제공하는 네이티브 메뉴로만 나갈 수 있다. 안내 문구만 줄 수 있다.
 * - `none`  — 인앱 브라우저가 아니다.
 */
export type StudioInAppEscapeKind = "link" | "manual" | "none";

export interface StudioInAppBrowserDiagnosis {
  /**
   * 시스템 브라우저로 바로 여는 URL. `escape === "link"` 일 때만 존재한다.
   *
   * 이건 **추가** 어포던스다. 링크를 렌더링할 수 있는 화면만 쓸 수 있고, 문자열만 받는
   * 자리(예: 스튜디오 announce 파이프라인)는 아래 `escapeHint` 로 충분해야 한다.
   */
  readonly escapeHref: string | null;
  /**
   * 인앱 브라우저를 벗어나는 방법을 한 줄로 말한 것. 인앱이면 **항상** 채워진다.
   *
   * 예전에는 탈출 링크를 만들 수 있으면 이 값을 null 로 뒀는데, 그러면 링크를 렌더링하지
   * 못하는 호출부가 "기본 브라우저로 여세요"까지만 말하고 방법은 못 알려주는 상태가 됐다.
   * 링크는 있으면 좋은 것이고, 실행 가능한 지시는 없으면 안 되는 것이다.
   */
  readonly escapeHint: string | null;
  readonly escape: StudioInAppEscapeKind;
  readonly id: StudioInAppBrowserId | null;
  readonly inApp: boolean;
  /** 사용자에게 보여줄 이름 — "카카오톡" 처럼 앱 이름만 담는다. */
  readonly name: string | null;
  /** 새 창/탭을 열 수 있는 환경인가. 인앱 브라우저는 언제나 false 로 본다. */
  readonly popupCapable: boolean;
  readonly platform: StudioInAppBrowserPlatform;
}

interface InAppSignature {
  readonly id: StudioInAppBrowserId;
  readonly name: string;
  /** UA 소문자에 대해 검사한다. */
  readonly match: readonly string[];
}

/**
 * 순서가 곧 우선순위다. 카카오톡·네이버·라인은 Android 에서 자신을 `wv` 웹뷰로도 표기하므로
 * 구체적인 앱 서명이 먼저 걸려야 일반 WebView 로 뭉뚱그려지지 않는다.
 */
const IN_APP_SIGNATURES: readonly InAppSignature[] = Object.freeze([
  { id: "kakaotalk", name: "카카오톡", match: ["kakaotalk"] },
  // 다음앱은 카카오와 별개 서명(`daumapps`)을 쓴다.
  { id: "daum", name: "다음", match: ["daumapps", "daumdevice"] },
  // 네이버앱은 `NAVER(inapp; ...)`, 웨일 인앱은 `naver` 만 남기기도 한다.
  { id: "naver", name: "네이버", match: ["naver(inapp", "naver("] },
  { id: "band", name: "밴드", match: ["band/", "bandapp"] },
  { id: "line", name: "라인", match: ["line/"] },
  // Threads 는 Barcelona 라는 내부 코드명을 UA 에 남긴다. Instagram 보다 먼저 본다.
  { id: "threads", name: "스레드", match: ["barcelona"] },
  { id: "instagram", name: "인스타그램", match: ["instagram"] },
  // FBAV=Facebook 앱, FBAN/FB_IAB=인앱 브라우저 컨테이너.
  { id: "facebook", name: "페이스북", match: ["fbav", "fban", "fb_iab"] },
  { id: "tiktok", name: "틱톡", match: ["bytelocale", "trill_", "musical_ly", "tiktok"] },
  { id: "wechat", name: "위챗", match: ["micromessenger"] },
]);

function detectPlatform(ua: string): StudioInAppBrowserPlatform {
  if (ua.includes("android")) return "android";
  if (/(iphone|ipad|ipod)/u.test(ua)) return "ios";
  return "unknown";
}

/**
 * 앱 서명이 없는 임베디드 WebView 판별.
 *
 * Android 는 `; wv)` 토큰이 표준 신호다. iOS 는 WKWebView 가 Safari 와 같은 UA 를 쓰되
 * `Version/` 토큰을 빼므로, Safari 계열인데 `Version/` 도 `CriOS`·`FxiOS` 같은 명시적 브라우저
 * 표기도 없을 때만 임베디드로 본다. 확신이 없으면 일반 브라우저로 둔다 — 잘못 인앱으로 몰면
 * 멀쩡한 Safari 사용자에게서 팝업 기능을 빼앗는다.
 */
function detectGenericWebView(
  ua: string,
  platform: StudioInAppBrowserPlatform,
): StudioInAppBrowserId | null {
  if (platform === "android") {
    return /;\s*wv[;)]/u.test(ua) ? "android-webview" : null;
  }
  if (platform !== "ios") return null;
  if (!ua.includes("applewebkit")) return null;
  const namedBrowser = /(crios|fxios|edgios|opios|duckduckgo)/u.test(ua);
  if (namedBrowser) return null;
  return ua.includes("version/") ? null : "ios-webview";
}

/**
 * Android 에서 현재 주소를 기본 브라우저로 넘기는 URL.
 *
 * 카카오톡은 전용 스킴이 확실하게 동작한다. 그 밖의 Android WebView 는 `intent://` 폴백을
 * 쓴다 — 시스템이 기본 브라우저를 고르므로 앱마다 다른 스킴을 추측하지 않아도 된다.
 */
function androidEscapeHref(id: StudioInAppBrowserId | null, href: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (id === "kakaotalk") {
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(parsed.href)}`;
  }
  const withoutScheme = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  return (
    `intent://${withoutScheme}#Intent;scheme=${parsed.protocol.slice(0, -1)};` +
    "action=android.intent.action.VIEW;end;"
  );
}

const IOS_ESCAPE_HINT =
  "화면 오른쪽 아래 메뉴에서 ‘Safari로 열기’를 눌러 주세요.";
const ANDROID_MANUAL_HINT =
  "화면 오른쪽 위 메뉴에서 ‘다른 브라우저로 열기’를 눌러 주세요.";

const NOT_IN_APP: StudioInAppBrowserDiagnosis = Object.freeze({
  escape: "none",
  escapeHref: null,
  escapeHint: null,
  id: null,
  inApp: false,
  name: null,
  popupCapable: true,
  platform: "unknown",
});

export interface DiagnoseStudioInAppBrowserInput {
  /** 현재 문서 주소. Android 탈출 링크를 만들 때만 쓴다. */
  readonly href?: string | null;
  readonly userAgent?: string | null;
}

/** UA 만 보고 판정하는 순수 함수. 브라우저 전역에 접근하지 않는다. */
export function diagnoseStudioInAppBrowser({
  href,
  userAgent,
}: DiagnoseStudioInAppBrowserInput): StudioInAppBrowserDiagnosis {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.length === 0) return NOT_IN_APP;

  const platform = detectPlatform(ua);
  const signature = IN_APP_SIGNATURES.find((entry) =>
    entry.match.some((token) => ua.includes(token)),
  );
  const genericId = signature ? null : detectGenericWebView(ua, platform);
  if (!signature && genericId === null) {
    return Object.freeze({ ...NOT_IN_APP, platform });
  }

  const id = signature?.id ?? genericId;
  const name = signature?.name ?? null;
  const escapeHref =
    platform === "android" ? androidEscapeHref(id, href ?? "") : null;

  return Object.freeze({
    escape: escapeHref === null ? "manual" : "link",
    escapeHref,
    // 링크를 만들 수 있어도 안내는 같이 준다 — 링크를 못 그리는 호출부가 있기 때문이다.
    escapeHint: platform === "ios" ? IOS_ESCAPE_HINT : ANDROID_MANUAL_HINT,
    id,
    inApp: true,
    name,
    // 인앱 브라우저는 팝업 차단을 설정으로 풀 수 없다. 기능 축소는 시도 실패가 아니라
    // 판별 시점에 결정해야 사용자가 죽은 버튼을 누르지 않는다.
    popupCapable: false,
    platform,
  });
}

/**
 * UA 는 문서 수명 동안 바뀌지 않는데, 프레즌스 도크처럼 동기화 스냅샷마다 다시 그리는 화면이
 * 이 판정을 렌더마다 호출한다. UA 로만 결정되는 부분을 캐시한다 — 안드로이드 탈출 링크는
 * 현재 주소에 의존하므로 캐시 대상이 아니고, 명시적으로 다른 scope 를 넘기는 테스트 경로도
 * 캐시를 타지 않는다.
 */
let cachedGlobalUserAgent: string | null = null;
let cachedGlobalHref: string | null = null;
let cachedGlobalDiagnosis: StudioInAppBrowserDiagnosis | null = null;

/** 브라우저 전역에서 UA/주소를 읽어 판정한다. SSR·워커에서는 "인앱 아님". */
export function diagnoseStudioInAppBrowserFromGlobals(
  scope: typeof globalThis = globalThis,
): StudioInAppBrowserDiagnosis {
  const nav = (scope as { navigator?: Navigator }).navigator;
  const loc = (scope as { location?: Location }).location;
  if (!nav || typeof nav.userAgent !== "string") return NOT_IN_APP;
  const href = typeof loc?.href === "string" ? loc.href : null;
  if (scope !== globalThis) {
    return diagnoseStudioInAppBrowser({ href, userAgent: nav.userAgent });
  }
  if (
    cachedGlobalDiagnosis !== null
    && cachedGlobalUserAgent === nav.userAgent
    && cachedGlobalHref === href
  ) {
    return cachedGlobalDiagnosis;
  }
  cachedGlobalUserAgent = nav.userAgent;
  cachedGlobalHref = href;
  cachedGlobalDiagnosis = diagnoseStudioInAppBrowser({ href, userAgent: nav.userAgent });
  return cachedGlobalDiagnosis;
}

/**
 * "이 환경에서 새 창을 열 수 있는가."
 *
 * 인앱 브라우저는 시도해 볼 것도 없이 false. 일반 브라우저는 사용자 제스처가 있어야 하므로
 * 여기서는 능력만 답하고, 실제 차단 여부는 호출부가 `window.open` 결과로 확인한다.
 */
export function studioCanOpenAuxiliaryWindow(
  scope: typeof globalThis = globalThis,
): boolean {
  if (typeof (scope as { open?: unknown }).open !== "function") return false;
  return !diagnoseStudioInAppBrowserFromGlobals(scope).inApp;
}
