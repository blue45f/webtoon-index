// 작품 상세(/title/:slug) SNS 공유용 — 크롤러(카카오/페북/트위터 등)에는 작품별 OG 메타를
// 주입한 HTML을, 사람에게는 평소 SPA 셸을 그대로 준다(추가 지연 없음).
const fs = require("fs");
const path = require("path");

let TEMPLATE = null;
function template() {
  if (TEMPLATE === null) {
    for (const p of [
      path.join(process.cwd(), "dist", "index.html"),
      path.join(__dirname, "..", "dist", "index.html"),
    ]) {
      try {
        TEMPLATE = fs.readFileSync(p, "utf8");
        break;
      } catch {
        /* try next */
      }
    }
    if (TEMPLATE === null)
      TEMPLATE =
        '<!doctype html><html><head><title></title><meta name="description" content="" /><link rel="canonical" href="" /><meta property="og:type" content="website" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:image" content="" /><meta property="og:image:alt" content="" /><meta property="og:url" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head><body><div id="root"></div></body></html>';
  }
  return TEMPLATE;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const BOT_RE =
  /bot|crawl|spider|facebookexternalhit|kakaotalk|slack|twitter|discord|whatsapp|telegram|line|pinterest|embedly|preview|naver|daum|skype|vkshare/i;

const MARKET_KIND_LABEL = Object.freeze({
  asset: "에셋",
  brush: "브러시",
  filter: "필터",
  palette: "팔레트",
  template: "템플릿",
  "3d-preset": "3D 프리셋",
});

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return "";
  }
}

function cleanText(value, max) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function marketLicenseUrl(license, origin) {
  if (license === "cc0-1.0") return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (license === "cc-by-4.0") return "https://creativecommons.org/licenses/by/4.0/";
  if (license === "cc-by-nc-4.0") return "https://creativecommons.org/licenses/by-nc/4.0/";
  return `${origin}/terms`;
}

function titleImage(coverImage, proto, host) {
  if (!coverImage) return proto + "://" + host + "/og-web.png";
  if (coverImage.startsWith("http")) return coverImage;
  const pathPart = coverImage.startsWith("/") ? coverImage : "/" + coverImage;
  return proto + "://" + host + pathPart;
}

function injectPageMetadata(page, metadata, structuredData) {
  let next = page
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(metadata.title)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      () => `<meta name="description" content="${esc(metadata.description)}" />`,
    )
    .replace(
      /<link\s+rel="canonical"[^>]*>/,
      () => `<link rel="canonical" href="${esc(metadata.url)}" />`,
    )
    .replace(
      /<meta\s+property="og:type"[^>]*>/,
      () => `<meta property="og:type" content="${esc(metadata.type)}" />`,
    )
    .replace(
      /<meta\s+property="og:title"[^>]*>/,
      () => `<meta property="og:title" content="${esc(metadata.title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"[^>]*>/,
      () => `<meta property="og:description" content="${esc(metadata.description)}" />`,
    )
    .replace(
      /<meta\s+property="og:image"[^>]*>/,
      () => `<meta property="og:image" content="${esc(metadata.image)}" />`,
    )
    .replace(
      /<meta\s+property="og:image:alt"[^>]*>/,
      () => `<meta property="og:image:alt" content="${esc(metadata.imageAlt)}" />`,
    )
    .replace(
      /<meta\s+property="og:url"[^>]*>/,
      () => `<meta property="og:url" content="${esc(metadata.url)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"[^>]*>/,
      () => `<meta name="twitter:title" content="${esc(metadata.title)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"[^>]*>/,
      () => `<meta name="twitter:description" content="${esc(metadata.description)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:image"[^>]*>/,
      () => `<meta name="twitter:image" content="${esc(metadata.image)}" />`,
    );
  if (structuredData) {
    const json = JSON.stringify(structuredData).replace(/</g, "\\u003c");
    next = next.replace(
      /<\/head>/,
      `<script type="application/ld+json">${json}</script></head>`,
    );
  }
  return next;
}

function validMarketResource(value) {
  return Boolean(
    value
      && typeof value === "object"
      && typeof value.name === "string"
      && typeof value.id === "string"
      && typeof value.kind === "string"
      && MARKET_KIND_LABEL[value.kind]
      && value.publisher
      && typeof value.publisher === "object"
      && typeof value.publisher.name === "string",
  );
}

function handleMarketLanding(res, { host, proto, marketPage }) {
  const origin = `${proto}://${host}`;
  const isBrowse = marketPage === "browse";
  const title = isBrowse ? "마켓 탐색 · 툰스펙트럼" : "창작 마켓 · 툰스펙트럼";
  const description = isBrowse
    ? "웹툰 제작에 필요한 브러시, 팔레트, 필터, 장면 템플릿, 3D 프리셋과 에셋을 종류와 사용권으로 찾아보세요."
    : "브러시, 팔레트, 필터, 장면 템플릿, 3D 프리셋과 에셋을 살펴보고 ToonSpectrum Studio에서 바로 활용하세요.";
  const url = `${origin}${isBrowse ? "/market/browse" : "/market"}`;
  const image = `${origin}/og-web.png`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": isBrowse ? "SearchResultsPage" : "CollectionPage",
    name: title.replace(" · 툰스펙트럼", ""),
    description,
    url,
    isPartOf: {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "툰스펙트럼",
      url: `${origin}/`,
    },
  };
  const page = injectPageMetadata(template(), {
    title,
    description,
    url,
    image,
    imageAlt: "툰스펙트럼 창작 마켓",
    type: "website",
  }, structuredData);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400");
  return res.status(200).send(page);
}

const MARKET_RESOURCE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/iu;

async function fetchMarketResource(host, proto, marketResourceId) {
  if (!MARKET_RESOURCE_ID_RE.test(marketResourceId)) return null;
  try {
    const response = await fetch(
      proto + "://" + host + "/api/creator/marketplace/resources/" + encodeURIComponent(marketResourceId),
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(22000) },
    );
    if (response.ok) {
      const value = await response.json();
      if (validMarketResource(value)) return value;
    }
  } catch {
    /* fall back to the default shell; failures are deliberately not cached */
  }
  return null;
}

async function handleMarketResource(res, { host, proto, marketResourceId }) {
  const resource = await fetchMarketResource(host, proto, marketResourceId);
  let page = template();
  if (resource) {
    const origin = `${proto}://${host}`;
    const name = cleanText(resource.name, 80);
    const publisher = cleanText(resource.publisher.name, 120);
    const kind = MARKET_KIND_LABEL[resource.kind];
    const description = cleanText(resource.description, 160)
      || `${name}의 구성, 사용권, 호환성과 Studio 적용 방법을 확인하세요.`;
    const fullDescription = `${publisher} · ${kind} · 무료 공유 — ${description}`.slice(0, 200);
    const url = `${origin}/market/resource/${encodeURIComponent(marketResourceId)}`;
    const image = `${origin}/og-web.png`;
    const title = `${name} · 툰스펙트럼`;
    const tags = Array.isArray(resource.tags)
      ? resource.tags.filter((tag) => typeof tag === "string").slice(0, 8)
      : [];
    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CreativeWork",
          "@id": `${url}#resource`,
          name,
          description,
          url,
          version: cleanText(resource.resourceVersion, 40) || undefined,
          author: { "@type": "Person", name: publisher },
          publisher: { "@type": "Person", name: publisher },
          datePublished: cleanText(resource.createdAt, 40) || undefined,
          dateModified: cleanText(resource.updatedAt, 40) || undefined,
          license: marketLicenseUrl(resource.license, origin),
          isAccessibleForFree: true,
          keywords: tags.length > 0 ? tags.join(", ") : undefined,
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "창작 마켓",
              item: `${origin}/market`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name,
              item: url,
            },
          ],
        },
      ],
    };
    page = injectPageMetadata(page, {
      title,
      description: fullDescription,
      url,
      image,
      imageAlt: `${name} 창작 리소스`,
      type: "article",
    }, structuredData);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Release visibility is mutable even though its manifest is immutable. Until the
  // moderation path owns an edge-purge authority, caching a successful detail shell could
  // keep a newly hidden resource's title, publisher, and description visible to crawlers.
  // Keep discovery-page metadata cacheable, but always revalidate release-scoped metadata.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(page);
}

async function fetchTitle(host, proto, slug) {
  try {
    const response = await fetch(
      proto + "://" + host + "/api/titles/" + encodeURIComponent(slug),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(22000),
      },
    );
    if (response.ok) return (await response.json())?.title ?? null;
  } catch {
    /* fall back to default OG */
  }
  return null;
}

function buildTitleStructuredData(t, { proto, host, url, fullDesc, img }) {
  // 구조화 데이터(schema.org) — 작품을 Book으로, 평점이 있으면 aggregateRating 포함(별점 리치 결과).
  const st = t.stats || {};
  const ratingCount = Number(st.ratingCount) || 0;
  const ratingValue = Number(st.ratingAvg) || 0;
  const work = {
    "@type": "Book",
    "@id": `${url}#work`,
    name: t.title,
    url,
    inLanguage: "ko",
  };
  if (t.author) work.author = { "@type": "Person", name: t.author };
  if (fullDesc) work.description = fullDesc;
  if (img) work.image = img;
  if (Array.isArray(t.genres) && t.genres.length) work.genre = t.genres;
  if (t.releaseYear) work.datePublished = String(t.releaseYear);
  if (ratingCount > 0 && ratingValue > 0) {
    work.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(ratingValue * 10) / 10,
      ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      work,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "홈",
            item: `${proto}://${host}/`,
          },
          { "@type": "ListItem", position: 2, name: t.title, item: url },
        ],
      },
    ],
  };
  return ld;
}

async function handleTitleRequest(res, { host, proto, slug }) {
  const t = await fetchTitle(host, proto, slug);
  let page = template();
  if (t) {
    const titleText = `${t.title} · 툰스펙트럼`;
    const desc =
      (t.synopsis || "").replace(/\s+/g, " ").trim().slice(0, 160) ||
      `${t.title} — 툰스펙트럼에서 평점·플랫폼·가격을 한눈에.`;
    const img = titleImage(t.coverImage, proto, host);
    const url = `${proto}://${host}/title/${encodeURIComponent(slug)}`;
    const sub = [t.author, ...(t.genres || []).slice(0, 2)]
      .filter(Boolean)
      .join(" · ");
    const fullDesc = sub ? `${sub} — ${desc}` : desc;
    const ld = buildTitleStructuredData(t, { proto, host, url, fullDesc, img });
    page = injectPageMetadata(page, {
      title: titleText,
      description: fullDesc,
      url,
      image: img,
      imageAlt: `${t.title} 작품 표지`,
      type: "book",
    }, ld);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // 성공(작품 메타 주입)한 경우만 캐시 — 콜드스타트로 메타 주입 실패한 응답이 캐시에 박히지 않게.
  res.setHeader(
    "Cache-Control",
    t ? "public, max-age=300, s-maxage=86400" : "no-store",
  );
  return res.status(200).send(page);
}

async function handleRequest(req, res) {
  // SSRF 방지 — 서버 사이드 fetch와 정규(canonical) URL은 신뢰 가능한 고정 호스트만 사용한다.
  // 요청 Host/X-Forwarded-Host 헤더는 공격자가 조작할 수 있어(내부 IP·메타데이터 엔드포인트 등) 신뢰하지 않는다.
  const host = (
    process.env.CANONICAL_HOST || "www.toonstudio.cloud"
  ).toString();
  const proto = "https";
  const slug = safeDecode(req.query?.slug);
  const hasMarketResource = Object.prototype.hasOwnProperty.call(
    req.query ?? {},
    "marketResourceId",
  );
  const marketResourceId = safeDecode(req.query?.marketResourceId);
  const marketPage = cleanText(req.query?.marketPage, 16);
  const ua = (req.headers["user-agent"] || "").toString();

  // 사람: 평소 SPA 셸(빠름). 크롤러만 작품 메타 주입.
  if (!BOT_RE.test(ua)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(template());
  }

  if (marketPage === "home" || marketPage === "browse") {
    return handleMarketLanding(res, { host, proto, marketPage });
  }
  if (hasMarketResource) {
    return handleMarketResource(res, { host, proto, marketResourceId });
  }
  return handleTitleRequest(res, { host, proto, slug });
}

module.exports = handleRequest;
