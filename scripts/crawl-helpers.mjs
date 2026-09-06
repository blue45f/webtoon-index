const IMAGE_EXT_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const ALLOWED_IMAGE_HOST_RE = /(^|\.)(pstatic\.net|kakaopagecdn\.com|kakaocdn\.net|ccdn\.lezhin\.com)$/i;
const IMAGE_KEY_RE = /(cover|thumbnail|thumb|poster|image|banner|wide|tall)/i;
const PREFERRED_KEY_RE = /(cover|thumbnail|thumb|poster)/i;
const META_IMAGE_RE =
  /<meta\s+[^>]*(?:property|name)=["'](?:og:image|twitter:image|image)["'][^>]*content=["']([^"']+)["'][^>]*>/i;
const META_IMAGE_REVERSED =
  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image|image)["'][^>]*>/i;
const URL_RE = /https:\/\/[^\s"'<>\\]+/g;
// naver 연령 가림막 등 placeholder 표지(실제 표지 아님) — 저장하지 않고 타이포그래픽 폴백으로.
// 예: https://ssl.pstatic.net/static/nstore/thumb/19over_book2_79x119.gif
const COVER_PLACEHOLDER_RE = /\/nstore\/thumb\/\d+over|19over_book/i;

export function proxiedCoverUrl(url) {
  const normalized = normalizeRemoteImageUrl(url);
  return normalized ? `/api/cover?u=${encodeURIComponent(normalized)}` : undefined;
}

export function normalizeRemoteImageUrl(value) {
  if (typeof value !== "string") return undefined;
  const candidate = decodeHtmlEntities(value.trim());
  if (!candidate) return undefined;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!ALLOWED_IMAGE_HOST_RE.test(url.hostname)) return undefined;
  if (COVER_PLACEHOLDER_RE.test(url.pathname)) return undefined; // 19금 가림막 등 placeholder 제외
  if (!IMAGE_EXT_RE.test(`${url.pathname}${url.search}`)) return undefined;
  return url.toString();
}

export function extractRemoteImageUrl(input) { // NOSONAR javascript:S3776
  if (!input) return undefined;
  if (typeof input === "string") {
    return extractRemoteImageUrlFromString(input);
  }
  if (typeof input !== "object") return undefined;

  const candidates = [];
  const queue = [{ value: input, key: "", depth: 0 }];
  const seen = new Set();
  let scanned = 0;

  while (queue.length > 0 && scanned < 250) {
    const current = queue.shift();
    if (!current || current.depth > 6) continue;
    const value = current.value;
    scanned += 1;

    if (typeof value === "string") {
      const url = extractRemoteImageUrlFromString(value);
      if (url) candidates.push({ url, score: scoreImageKey(current.key) });
      continue;
    }

    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => queue.push({ value: entry, key: `${current.key}.${index}`, depth: current.depth + 1 }));
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string") {
        const url = extractRemoteImageUrlFromString(child);
        if (url) candidates.push({ url, score: scoreImageKey(key) });
      }
      if (child && typeof child === "object") {
        queue.push({ value: child, key, depth: current.depth + 1 });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url;
}

export function buildLezhinCoverImage(item, variant = "thumbnail") {
  const id = String(item?.id ?? "").trim();
  if (!/^\d+$/.test(id)) return undefined;
  const safeVariant = ["thumbnail", "tall", "wide"].includes(variant) ? variant : "thumbnail";
  const updated = Number(item?.updatedAt ?? item?.dataUpdatedAt ?? item?.publishedAt);
  const suffix = Number.isFinite(updated) && updated > 0 ? `?updated=${Math.floor(updated)}` : "";
  return `https://ccdn.lezhin.com/v2/comics/${id}/images/${safeVariant}.jpg${suffix}`;
}

function extractRemoteImageUrlFromString(value) {
  const trimmed = value.trim();
  const direct = normalizeRemoteImageUrl(trimmed);
  if (direct) return direct;

  const meta = trimmed.match(META_IMAGE_RE)?.[1] ?? trimmed.match(META_IMAGE_REVERSED)?.[1];
  const fromMeta = normalizeRemoteImageUrl(meta);
  if (fromMeta) return fromMeta;

  const urls = trimmed.match(URL_RE) ?? [];
  for (const url of urls) {
    const normalized = normalizeRemoteImageUrl(url);
    if (normalized) return normalized;
  }
  return undefined;
}

function scoreImageKey(key) {
  if (!key) return 10;
  if (/(thumbnail|thumb)/i.test(key)) return 100;
  if (/cover/i.test(key)) return 95;
  if (/poster|tall/i.test(key)) return 90;
  if (/wide|og:image|twitter:image/i.test(key)) return 75;
  if (PREFERRED_KEY_RE.test(key)) return 70;
  if (IMAGE_KEY_RE.test(key)) return 50;
  return 1;
}

export function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
