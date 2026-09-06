import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO_2D_MANIFEST_PATH = "apps/web/src/domains/creator/studio-2d-asset-manifest.json";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_PREFIX = "/assets/studio/backgrounds/";
const WEB_PUBLIC = path.join(ROOT, "apps", "web", "public");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPngDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG header");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 36_000_000) {
    throw new Error("PNG dimensions exceed the asset safety budget");
  }
  return { width, height };
}

export function readImageDimensions(bytes) { // NOSONAR javascript:S3776
  if (Buffer.isBuffer(bytes) && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ...readPngDimensions(bytes), mediaType: "image/png" };
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) {
    throw new Error("Unsupported image signature");
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker");
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218 || marker === undefined) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG segment");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment length");
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (length < 8) throw new Error("Truncated JPEG frame");
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 36_000_000) {
        throw new Error("JPEG dimensions exceed the asset safety budget");
      }
      return { width, height, mediaType: "image/jpeg" };
    }
    offset += length;
  }
  throw new Error("JPEG has no supported frame header");
}

export function auditStudio2dAssets(root, input) { // NOSONAR javascript:S3776
  root ??= ROOT;
  const manifest = input ?? JSON.parse(readFileSync(path.join(root, STUDIO_2D_MANIFEST_PATH), "utf8"));
  const errors = [];
  const ids = new Set();
  const sources = new Set();
  const hashes = new Set();
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  if (manifest?.version !== 1 || !Array.isArray(manifest?.assets) || assets.length === 0) {
    errors.push("Expected a nonempty version-1 manifest");
  }
  let recommended = 0;
  let largeOriginals = 0;
  let totalBytes = 0;
  for (const asset of assets) {
    const id = asset?.id ?? "unknown";
    try {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || ids.has(id)) throw new Error("Invalid or duplicate ID");
      ids.add(id);
      if (typeof asset.src !== "string" || !asset.src.startsWith(SOURCE_PREFIX)
        || !/^[a-z0-9_]+\.(?:png|jpg)$/u.test(asset.src.slice(SOURCE_PREFIX.length))) throw new Error("Unsafe asset path");
      if (sources.has(asset.src)) throw new Error("Duplicate source file");
      sources.add(asset.src);
      const filePath = path.join(WEB_PUBLIC, asset.src);
      const allowedRoot = realpathSync(path.join(WEB_PUBLIC, "assets/studio/backgrounds")) + path.sep;
      if (lstatSync(filePath).isSymbolicLink() || !realpathSync(filePath).startsWith(allowedRoot)) throw new Error("Symlink source is not allowed");
      const bytes = readFileSync(filePath);
      if (bytes.length > 20 * 1024 * 1024) throw new Error("Source exceeds 20 MiB");
      const dimensions = readImageDimensions(bytes);
      const extension = dimensions.mediaType === "image/jpeg" ? ".jpg" : ".png";
      if (asset.mediaType !== dimensions.mediaType || !asset.src.endsWith(extension)) throw new Error("Image signature and extension disagree");
      if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw new Error("Declared dimensions do not match the original");
      if (bytes.length !== asset.bytes) throw new Error("Declared file size is stale");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (asset.sha256 !== hash) throw new Error("Source SHA-256 does not match the reviewed original");
      if (hashes.has(hash)) throw new Error("Duplicate original counted as a distinct asset");
      hashes.add(hash);
      if (asset.legacySrc !== null) {
        if (asset.legacySrc !== asset.src.replace(/\.jpg$/u, ".png")) throw new Error("Unsafe legacy alias");
        const alias = path.join(WEB_PUBLIC, asset.legacySrc);
        if (lstatSync(alias).isSymbolicLink() || !realpathSync(alias).startsWith(allowedRoot)) throw new Error("Unsafe legacy alias");
        if (createHash("sha256").update(readFileSync(alias)).digest("hex") !== hash) throw new Error("Legacy compatibility bytes changed");
        sources.add(asset.legacySrc);
      }
      if (!asset.title?.trim() || !Array.isArray(asset.tags) || !asset.tags.length
        || asset.tags.some((tag) => typeof tag !== "string" || !tag.trim())) throw new Error("Missing discoverability metadata");
      if (typeof asset.containsPeople !== "boolean" || typeof asset.containsText !== "boolean"
        || typeof asset.recommended !== "boolean") throw new Error("Missing content review flags");
      if (!['usable', 'small-panel-only'].includes(asset.review?.status)
        || !['full-image', 'contact-sheet'].includes(asset.review?.method)
        || !Array.isArray(asset.review?.notes)) throw new Error("Missing visual review evidence");
      // Existing provenance is deliberately unresolved; do not manufacture a commercial license.
      if (asset.provenance?.kind !== "legacy-catalog" || asset.provenance?.licenseStatus !== "unverified") {
        throw new Error("Legacy rights cannot be promoted without a separate provenance review");
      }
      const large = Math.min(asset.width, asset.height) >= 900 && Math.max(asset.width, asset.height) >= 1024;
      if (asset.recommended && (!large || asset.review.status !== "usable" || asset.review.method !== "full-image")) {
        throw new Error("Recommendation requires full-image review and original resolution");
      }
      recommended += Number(asset.recommended);
      largeOriginals += Number(large);
      totalBytes += bytes.length;
    } catch (error) {
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const directory = path.join(WEB_PUBLIC, "assets/studio/backgrounds");
  for (const name of readdirSync(directory)) {
    if (/\.(?:png|jpg)$/u.test(name) && !sources.has(SOURCE_PREFIX + name)) errors.push(`Unreviewed original: ${name}`);
  }
  return { ok: errors.length === 0, originalCount: assets.length, recommended, largeOriginals,
    smallOriginals: assets.length - largeOriginals, totalBytes, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditStudio2dAssets();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
