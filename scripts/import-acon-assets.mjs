/**
 * Offline intake for explicitly supplied, separately authorized ACON originals.
 * Does not crawl, purchase, publish, infer a license, or assert visual quality.
 * Run: node scripts/import-acon-assets.mjs --help
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const LIMITS = Object.freeze({ entries: 50000, inventory: 32 * MiB, file: 128 * MiB, total: 8 * 1024 * MiB });
const CATEGORIES = Object.freeze({
  "background-2d": "background", "background-3d": "background",
  "character-2d": "character", "character-3d": "character",
  "prop-2d": "prop", "prop-3d": "prop", "effect-2d": "effect",
  "material-2d": "material", brush: "brush", audio: "audio", font: "font",
});
const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".webp", ".glb", ".vrm"]);
const CONVERSION = new Set([".skp", ".blend", ".fbx", ".obj", ".gltf", ".dae", ".stl", ".ply", ".3ds", ".psd", ".clip", ".sut", ".abr", ".afbrushes", ".tif", ".tiff", ".exr", ".svg", ".zip", ".7z", ".rar", ".mp3", ".wav", ".ogg", ".flac", ".ttf", ".otf"]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
function hasAsciiControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function text(value, label, max = 300) {
  requireThat(typeof value === "string" && value.trim().length > 0 && value.length <= max && !hasAsciiControl(value), `${label}: expected nonempty text (max ${max})`);
  return value.trim();
}
function relativeFile(value) {
  const name = text(value, "file", 2048);
  requireThat(!/[\\:]/u.test(name) && !path.posix.isAbsolute(name) && name.split("/").every((part) => part && part !== "." && part !== ".."), "file: use a relative path without traversal or drive prefixes");
  return name;
}
export function canonicalProductUrl(value) {
  const url = new URL(text(value, "productUrl", 2048));
  requireThat(url.protocol === "https:" && ["www.acon3d.com", "acon3d.com"].includes(url.hostname) && !url.username && !url.password && !url.port, "productUrl: expected an HTTPS ACON product URL");
  const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:toon\/)?product\/(\d+)\/?$/iu.exec(url.pathname);
  requireThat(match, "productUrl: expected a product page, not a category or download URL");
  return { productId: match[1], productUrl: `https://www.acon3d.com/ko/product/${match[1]}` };
}
function metadata(row) {
  requireThat(plain(row), "entry: expected an object");
  const id = text(row.id, "id", 80);
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(id), "id: use an ASCII identifier for one independent original");
  requireThat(Object.hasOwn(CATEGORIES, row.category), "category: unsupported category");
  requireThat(row.role === "original", "role: explicitly identify an original; previews are not importable originals");
  requireThat(plain(row.license), "license: an explicit per-original license is required");
  return { id, name: text(row.name, "name"), creator: text(row.creator, "creator"),
    ...canonicalProductUrl(row.productUrl), category: row.category, file: relativeFile(row.file),
    license: { name: text(row.license.name, "license.name"), reference: text(row.license.reference, "license.reference", 1000) },
  };
}
async function readBounded(filename, maxBytes) {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    requireThat(before.isFile() && before.size > 0 && before.size <= maxBytes, "file: empty, non-regular, or over the size limit");
    // Bounded allocation even when the source grows while being read.
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      requireThat(bytesRead > 0, "file changed while reading");
      offset += bytesRead;
    }
    const after = await handle.stat();
    requireThat(after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, "file changed while reading");
    return bytes;
  } finally { await handle.close(); }
}
async function sourceFile(root, relative) {
  let current = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = await lstat(current);
    requireThat(!stat.isSymbolicLink(), "file: symbolic links are not accepted");
    requireThat(index === parts.length - 1 ? stat.isFile() : stat.isDirectory(), "file: expected a regular file within the source folder");
  }
  const resolved = await realpath(current);
  requireThat(resolved.startsWith(root + path.sep), "file escapes source folder");
  return current;
}
function dimensions(width, height) {
  requireThat(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= 64 * MiB, "image dimensions exceed decoding budget or are invalid");
  return { width, height };
}
function imageInfo(bytes, extension) { // NOSONAR javascript:S3776
  if (extension === ".png") {
    requireThat(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR", "invalid PNG header");
    let offset = 8; let hasData = false; let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset); const type = bytes.toString("ascii", offset + 4, offset + 8);
      requireThat(offset + length + 12 <= bytes.length, "truncated PNG chunk");
      if (type === "IDAT") hasData = true;
      offset += length + 12;
      if (type === "IEND") { requireThat(length === 0 && offset === bytes.length, "invalid PNG end"); ended = true; break; }
    }
    requireThat(hasData && ended, "PNG is missing image data or end chunk");
    return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (extension === ".webp") {
    requireThat(bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length, "invalid WebP container");
    let offset = 12; let size; let hasData = false;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString("ascii", offset, offset + 4); const length = bytes.readUInt32LE(offset + 4); const start = offset + 8;
      requireThat(start + length + (length % 2) <= bytes.length, "truncated WebP chunk");
      if (type === "VP8X") { requireThat(length >= 10, "invalid VP8X"); size = dimensions(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)); }
      if (type === "VP8 ") { requireThat(length >= 10 && bytes.subarray(start + 3, start + 6).equals(Buffer.from([157,1,42])), "invalid VP8"); const frame = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff); size ??= frame; hasData = true; }
      if (type === "VP8L") { requireThat(length >= 5 && bytes[start] === 0x2f, "invalid VP8L"); const bits = bytes.readUInt32LE(start + 1); const frame = dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)); size ??= frame; hasData = true; }
      requireThat(type !== "ANIM" && type !== "ANMF", "animated WebP requires a separate animation workflow");
      offset = start + length + (length % 2);
    }
    requireThat(size && hasData && offset === bytes.length, "WebP is missing a complete image payload");
    return size;
  }
  requireThat(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9, "invalid JPEG envelope");
  let offset = 2; let size; let hasScan = false;
  const frames = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while (offset < bytes.length - 2) {
    requireThat(bytes[offset] === 0xff, "invalid JPEG marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    requireThat(offset + 2 <= bytes.length, "truncated JPEG segment");
    const length = bytes.readUInt16BE(offset);
    requireThat(length >= 2 && offset + length <= bytes.length - 2, "truncated JPEG segment");
    if (frames.has(marker)) { requireThat(length >= 8, "invalid JPEG frame"); size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)); }
    if (marker === 0xda) { hasScan = true; break; }
    offset += length;
  }
  requireThat(size && hasScan, "JPEG is missing frame or scan data");
  return size;
}
export function inspectGlb(bytes) { // NOSONAR javascript:S3776
  requireThat(bytes.length >= 20 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, "invalid GLB 2 header or total length");
  let offset = 12; let document; let binaryLength = 0; let hasBinary = false;
  while (offset < bytes.length) {
    requireThat(offset + 8 <= bytes.length, "truncated GLB chunk header");
    const length = bytes.readUInt32LE(offset); const type = bytes.readUInt32LE(offset + 4);
    requireThat(length % 4 === 0 && offset + 8 + length <= bytes.length, "invalid GLB chunk length");
    if (offset === 12) {
      requireThat(type === 0x4e4f534a && length <= 16 * MiB, "GLB first chunk must be bounded JSON");
      document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + length)));
    } else {
      requireThat(type === 0x004e4942 && !hasBinary, "unsupported or duplicate GLB chunk");
      binaryLength = length; hasBinary = true;
    }
    offset += 8 + length;
  }
  requireThat(plain(document) && document.asset?.version === "2.0" && Array.isArray(document.meshes) && document.meshes.length > 0, "GLB must contain a glTF 2.0 mesh, not an empty scene");
  // This is a self-contained upload path: external textures/buffers need conversion.
  const stack = [{ value: document, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop();
    requireThat(depth <= 64, "GLB JSON nesting exceeds the intake limit");
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === "uri") requireThat(typeof child === "string" && /^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,[a-zA-Z0-9+/]*={0,2}$/u.test(child), "GLB has an external or unsupported resource URI; embed resources before intake");
      if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
    }
  }
  const buffers = document.buffers ?? [];
  requireThat(Array.isArray(buffers), "invalid glTF buffers");
  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i];
    requireThat(plain(buffer) && Number.isSafeInteger(buffer.byteLength) && buffer.byteLength > 0, "invalid glTF buffer length");
    if (!buffer.uri) requireThat(i === 0 && hasBinary && binaryLength >= buffer.byteLength && binaryLength - buffer.byteLength <= 3, "GLB binary payload does not match its buffer");
    else requireThat(Buffer.from(buffer.uri.split(",")[1], "base64").length === buffer.byteLength, "embedded buffer length mismatch");
  }
  requireThat(Array.isArray(document.bufferViews ?? []), "invalid glTF bufferViews");
  for (const view of document.bufferViews ?? []) {
    requireThat(plain(view) && Number.isInteger(view.buffer) && view.buffer >= 0 && view.buffer < buffers.length && Number.isSafeInteger(view.byteLength) && view.byteLength > 0 && Number.isSafeInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0 && (view.byteOffset ?? 0) + view.byteLength <= buffers[view.buffer].byteLength, "glTF bufferView exceeds buffer bounds");
  }
  const vrm = Object.hasOwn(document.extensions ?? {}, "VRM") || Object.hasOwn(document.extensions ?? {}, "VRMC_vrm");
  return { subtype: vrm ? "vrm" : "background3d", meshes: document.meshes.length };
}
function inspect(bytes, ext, category) {
  const model = ext === ".glb" || ext === ".vrm";
  requireThat(model ? category.endsWith("-3d") : category.endsWith("-2d"), "file format does not match its declared 2D/3D category");
  if (!model) return { subtype: "image", ...imageInfo(bytes, ext) };
  const result = inspectGlb(bytes);
  requireThat(ext !== ".vrm" || result.subtype === "vrm", "VRM file has no VRM extension");
  requireThat(result.subtype !== "vrm" || category === "character-3d", "VRM must use character-3d category");
  return result;
}
/** Structural candidates are NOT quality-approved or publicly published assets. */
export async function prepareAconIntake({ sourceDir, inventory, outputDir }) { // NOSONAR javascript:S3776
  requireThat(plain(inventory) && inventory.version === 1 && inventory.provider === "acon", "inventory: expected version 1 and provider acon");
  const authorizationReference = text(inventory.authorizationReference, "authorizationReference", 1000);
  requireThat(Array.isArray(inventory.assets) && inventory.assets.length > 0 && inventory.assets.length <= LIMITS.entries, "inventory: supply 1–50000 explicitly selected originals");
  const sourcePath = path.resolve(sourceDir);
  const rootStat = await lstat(sourcePath);
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "source-dir must be a real directory, not a symbolic link");
  const root = await realpath(sourcePath);
  const records = []; const ids = new Set(); const hashes = new Map(); let total = 0;
  for (let index = 0; index < inventory.assets.length; index += 1) {
    const record = { index, status: "rejected" };
    records.push(record);
    try {
      const item = metadata(inventory.assets[index]);
      requireThat(!ids.has(item.id), "duplicate original id; group format variants instead of counting them as new originals");
      ids.add(item.id); Object.assign(record, item);
      const filename = await sourceFile(root, item.file); const ext = path.extname(item.file).toLowerCase();
      requireThat(SUPPORTED.has(ext) || CONVERSION.has(ext), "file extension is not supported for intake");
      const stat = await lstat(filename);
      requireThat(stat.size > 0 && stat.size <= LIMITS.file, "file is empty or exceeds the 128 MiB intake limit");
      total += stat.size; requireThat(total <= LIMITS.total, "batch exceeds 8 GiB; split the inventory into smaller batches");
      if (!SUPPORTED.has(ext)) { record.status = "conversion-required"; record.reason = "Retain the original. Convert with its authoring tool or use the dedicated asset-type importer; never rename the extension."; continue; }
      const bytes = await readBounded(filename, LIMITS.file);
      const info = inspect(bytes, ext, item.category); const sha256 = digest(bytes);
      Object.assign(record, info, { sha256, bytes: bytes.length });
      if (hashes.has(sha256)) { record.status = "duplicate"; record.duplicateOf = hashes.get(sha256); continue; }
      hashes.set(sha256, item.id); record.status = "candidate"; record.reviewStatus = "pending";
      record.snapshotPath = `originals/${sha256}${ext}`;
    } catch (error) { record.reason = error instanceof Error ? error.message : "Unknown intake error"; }
  }
  const candidates = records.filter((record) => record.status === "candidate");
  const report = { version: 1, provider: "acon", authorizationReference,
    scope: "User-supplied inventory only; not the entire ACON catalogue. Structural preflight is not visual review, full decoder validation, or publication.",
    counts: { listed: records.length, candidateOriginals: candidates.length, candidateProducts: new Set(candidates.map((item) => item.productId)).size,
      duplicates: records.filter((item) => item.status === "duplicate").length,
      conversionRequired: records.filter((item) => item.status === "conversion-required").length,
      rejected: records.filter((item) => item.status === "rejected").length, published: 0 }, records };
  if (outputDir) {
    const destination = path.resolve(outputDir);
    // Existing directories are never reused: stale successful manifests must not survive a failed run.
    const parent = await realpath(path.dirname(destination));
    const canonicalDestination = path.join(parent, path.basename(destination));
    requireThat(canonicalDestination !== root && !canonicalDestination.startsWith(root + path.sep), "output-dir must be outside source-dir");
    await mkdir(canonicalDestination, { mode: 0o700 });
    await writeFile(path.join(canonicalDestination, ".incomplete"), "Do not upload until candidate-manifest.json exists and this marker is removed.\n", { flag: "wx", mode: 0o600 });
    await mkdir(path.join(canonicalDestination, "originals"), { mode: 0o700 });
    for (const item of candidates) {
      const bytes = await readBounded(await sourceFile(root, item.file), LIMITS.file);
      requireThat(digest(bytes) === item.sha256, `source changed after preflight: ${item.id}`);
      await writeFile(path.join(canonicalDestination, item.snapshotPath), bytes, { flag: "wx", mode: 0o600 });
    }
    await writeFile(path.join(canonicalDestination, "provenance.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const manifest = candidates.map((item) => ({ name: `${item.id} ${item.name}`, path: item.snapshotPath, category: CATEGORIES[item.category], subtype: item.subtype, seed: Number.parseInt(item.sha256.slice(0, 8), 16) }));
    await writeFile(path.join(canonicalDestination, "candidate-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await unlink(path.join(canonicalDestination, ".incomplete"));
  }
  return report;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("ACON authorized-original intake (offline; does not download or publish)\nnode scripts/import-acon-assets.mjs --source-dir /path/originals --inventory /path/inventory.json [--output-dir /path/NEW-intake]\nWithout --output-dir: inspect only. Output parent must exist. Exit 0: all candidates; 2: rejects/conversion; 3: no candidates; 1: invalid run. See docs/acon-authorized-asset-intake.md.");
    return 0;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    requireThat(["--source-dir", "--inventory", "--output-dir"].includes(key) && typeof value === "string" && !value.startsWith("--") && !Object.hasOwn(options, key), "unknown, repeated, or incomplete option; use --help");
    options[key] = value;
  }
  requireThat(options["--source-dir"] && options["--inventory"], "--source-dir and --inventory are required");
  const inventory = JSON.parse((await readBounded(path.resolve(options["--inventory"]), LIMITS.inventory)).toString("utf8"));
  const report = await prepareAconIntake({ sourceDir: options["--source-dir"], inventory, outputDir: options["--output-dir"] });
  console.log(JSON.stringify(report, null, 2));
  if (!report.counts.candidateOriginals) return 3;
  return report.counts.rejected || report.counts.conversionRequired ? 2 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : "Intake failed"); process.exitCode = 1; });
}
