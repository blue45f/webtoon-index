/** Offline intake for owner-supplied Dontdraw originals. Never scrapes/downloads products. */
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readStableFile, stagePrivateBundle } from "./authorized-intake-io.mjs";
import { buildIntakeReviewQueue, intakeExitCode } from "./intake-review-queue.mjs";

export const SOURCE_SCHEMA = "toonstudio.dontdraw-source.v1";
export const REPORT_SCHEMA = "toonstudio.dontdraw-intake.v1";
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const CONVERSION_FORMATS = new Set([".skp", ".skb", ".cs3o", ".cs3c", ".clip", ".sut", ".blend", ".fbx", ".obj", ".gltf", ".max", ".sntp", ".tif", ".tiff", ".psd"]);
const READY_FORMATS = new Set([".png", ".jpg", ".jpeg", ".webp", ".glb"]);
const CATEGORIES = new Set(["background", "prop", "character", "effect"]);

function text(value, label, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || Array.from(value).some((character) => character.charCodeAt(0) < 32)) {
    throw new Error(`${label}: a nonempty, single-line string (max ${maximum}) is required`);
  }
  return value.trim();
}

export function validateSourceManifest(input) { // NOSONAR javascript:S3776
  if (!input || input.schema !== SOURCE_SCHEMA || !Array.isArray(input.products) || input.products.length > 20000) {
    throw new Error(`Expected ${SOURCE_SCHEMA} with at most 20000 products`);
  }
  const authorization = input.authorization;
  const reference = text(authorization?.reference, "authorization.reference");
  if (!["private-workspace", "public-library"].includes(authorization?.scope)) throw new Error("Invalid authorization.scope");
  if (typeof authorization.redistributionAllowed !== "boolean") throw new Error("redistributionAllowed must be boolean");
  if (authorization.scope === "public-library" && !authorization.redistributionAllowed) {
    throw new Error("Public-library intake requires explicit redistribution authorization");
  }
  const ids = new Set();
  let fileCount = 0;
  const products = input.products.map((product) => {
    const id = text(product?.id, "product.id", 16);
    if (!/^[1-9]\d*$/u.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate product ID: ${id}`);
    ids.add(id);
    const title = text(product.title, "product.title", 200);
    const sourceUrl = text(product.sourceUrl, "product.sourceUrl");
    // Exact canonical product URLs avoid ambiguous/mismatched provenance and embedded credentials.
    if (sourceUrl !== `https://dontdraw.com/itemDetail.html?pdIdx=${id}`) throw new Error(`Product URL does not match ID ${id}`);
    if (!CATEGORIES.has(product.category)) throw new Error(`Unsupported category for product ${id}`);
    if (!Array.isArray(product.files) || !product.files.length || product.files.length > 1000) throw new Error(`Invalid files for ${id}`);
    fileCount += product.files.length;
    if (fileCount > 50000) throw new Error("Manifest exceeds 50000 file entries");
    const fileKeys = new Set();
    const files = product.files.map((file) => {
      const relativePath = text(file?.path, "file.path", 1000);
      if (relativePath.includes("\\") || relativePath.includes(":") || relativePath.includes("%")
        || path.posix.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error(`Unsafe source path: ${relativePath}`);
      }
      if (!["asset", "preview", "source"].includes(file.role)) throw new Error(`Invalid role: ${relativePath}`);
      const fileKey = JSON.stringify([relativePath, file.role]);
      if (fileKeys.has(fileKey)) throw new Error(`Duplicate source path and role: ${relativePath}`);
      fileKeys.add(fileKey);
      if (file.sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error(`Invalid SHA-256: ${relativePath}`);
      return { path: relativePath, role: file.role, ...(file.sha256 ? { sha256: file.sha256 } : {}) };
    });
    return { id, title, sourceUrl, category: product.category, files };
  });
  return { schema: SOURCE_SCHEMA, authorization: { reference, scope: authorization.scope, redistributionAllowed: authorization.redistributionAllowed, verification: "operator-attested" }, products };
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function sourceFile(root, relativePath) {
  text(relativePath, "relative source path", 1000);
  if (relativePath.includes("\\") || relativePath.includes(":") || relativePath.includes("%")
    || path.posix.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe source path: ${relativePath}`);
  }
  let current = root;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Source symlinks are not accepted: ${relativePath}`);
  }
  const resolved = await realpath(current);
  if (!within(root, resolved)) throw new Error(`Source leaves root: ${relativePath}`);
  return resolved;
}

async function inspectFile(filename, maximumBytes = MAX_FILE_BYTES) {
  const bytes = await readStableFile(filename, maximumBytes);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

async function readSourceManifest(filename) {
  let bytes;
  try {
    // The bounded descriptor reader rejects pipes/devices/symlinks before opening and enforces the byte limit.
    bytes = await readStableFile(filename, MAX_MANIFEST_BYTES);
  } catch (error) {
    throw new Error(`Source manifest must be a regular file of at most 8 MiB: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  // Invalid UTF-8 is an error, never silently replaced with U+FFFD before validation.
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function inspectReadyFormat(extension, bytes) { // NOSONAR javascript:S3776
  if (extension === ".png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) throw new Error("Invalid PNG signature/header");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width > 32768 || height > 32768 || width * height > 100000000) throw new Error("PNG dimensions exceed limits");
    return { subtype: "image", width, height };
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error("Invalid JPEG signature");
    return { subtype: "image" };
  }
  if (extension === ".webp") {
    if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
      || bytes.readUInt32LE(4) + 8 !== bytes.length || !["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))) throw new Error("Invalid WebP signature/container");
    return { subtype: "image" };
  }
  if (extension === ".glb") {
    if (bytes.length < 24 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
      || bytes.readUInt32LE(8) !== bytes.length) throw new Error("Invalid GLB 2.0 header");
    let offset = 12;
    let document;
    let chunks = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("Truncated GLB chunk");
      const length = bytes.readUInt32LE(offset);
      const type = bytes.readUInt32LE(offset + 4);
      if (!length || length % 4 || offset + 8 + length > bytes.length) throw new Error("Invalid GLB chunk length");
      if (chunks === 0) {
        if (type !== 0x4e4f534a) throw new Error("GLB first chunk must be JSON");
        document = JSON.parse(bytes.toString("utf8", offset + 8, offset + 8 + length));
      } else if (chunks !== 1 || type !== 0x004e4942) throw new Error("Unexpected GLB chunk");
      offset += 8 + length;
      chunks += 1;
    }
    if (!document || document.asset?.version !== "2.0" || !Array.isArray(document.meshes) || !document.meshes.length) throw new Error("GLB has no mesh asset");
    // Reject URI references throughout extensions as well as standard textures/buffers.
    const stack = [document];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      for (const [key, item] of Object.entries(value)) {
        if (key.toLowerCase().endsWith("uri")) throw new Error("GLB must embed all resources; URI references are not accepted");
        if (item && typeof item === "object") stack.push(item);
      }
    }
    return { subtype: "background3d" };
  }
  throw new Error("Unsupported ready format");
}

/** Prepare only: no API calls, uploads, publication, model conversion or visual-quality claims. */
export async function prepareAuthorizedImport({ sourceDir, manifestPath, outputDir, write = false }) { // NOSONAR javascript:S3776
  const root = await realpath(sourceDir);
  if (!(await lstat(root)).isDirectory()) throw new Error("sourceDir must be a directory");
  const sourceManifest = await sourceFile(root, manifestPath);
  const input = validateSourceManifest(await readSourceManifest(sourceManifest));
  const destination = outputDir ? path.resolve(outputDir) : undefined;
  if (write && !destination) throw new Error("--output is required with --write");
  if (destination && (within(root, destination) || within(destination, root))) throw new Error("Output and source must not overlap");
  const entries = [];
  const records = [];
  const seen = new Map();
  let totalBytes = 0;
  for (const product of [...input.products].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    for (const file of [...product.files].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
      const record = { productId: product.id, sourceUrl: product.sourceUrl, sourcePath: file.path, role: file.role };
      if (file.role === "preview") { records.push({ ...record, status: "excluded-preview" }); continue; }
      const extension = path.extname(file.path).toLowerCase();
      if (!READY_FORMATS.has(extension) && !CONVERSION_FORMATS.has(extension)) { records.push({ ...record, status: "unsupported-format" }); continue; }
      try {
        const absolutePath = await sourceFile(root, file.path);
        const inspected = await inspectFile(absolutePath, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes));
        totalBytes += inspected.size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Intake exceeds the 2 GiB per-batch inspection limit");
        if (file.sha256 && file.sha256 !== inspected.sha256) throw new Error("SHA-256 mismatch");
        const fingerprint = { sha256: inspected.sha256, bytes: inspected.size };
        if (CONVERSION_FORMATS.has(extension) || file.role === "source") {
          records.push({ ...record, ...fingerprint, status: "conversion-required" });
          continue;
        }
        const details = inspectReadyFormat(extension, inspected.bytes);
        if (seen.has(inspected.sha256)) { records.push({ ...record, ...fingerprint, status: "duplicate", duplicateOf: seen.get(inspected.sha256) }); continue; }
        const canonicalExtension = extension === ".jpeg" ? ".jpg" : extension;
        const relativeOutput = `files/${inspected.sha256}${canonicalExtension}`;
        const id = `dontdraw-${product.id}-${inspected.sha256.slice(0, 16)}`;
        seen.set(inspected.sha256, id);
        const entry = { name: product.title, path: relativeOutput, category: product.category === "effect" ? "prop" : product.category,
          subtype: details.subtype, seed: Number.parseInt(inspected.sha256.slice(0, 8), 16),
          provenance: { provider: "dontdraw", productId: product.id, sourceUrl: product.sourceUrl, sourcePath: file.path, sha256: inspected.sha256, authorization: input.authorization } };
        entries.push({ entry, absolutePath, sha256: inspected.sha256 });
        records.push({ ...record, ...fingerprint, ...details, id, status: "ready-for-review", outputPath: relativeOutput });
      } catch (error) {
        records.push({ ...record, status: "invalid-file", reason: error instanceof Error ? error.message : String(error) });
      }
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Intake exceeds the 2 GiB per-batch inspection limit; split the source manifest");
    }
  }
  const counts = { productsProvided: input.products.length, filesProvided: records.length, ready: 0, duplicates: 0, conversionRequired: 0, excludedPreviews: 0, unsupported: 0, invalid: 0, published: 0 };
  const countKeys = { "ready-for-review": "ready", duplicate: "duplicates", "conversion-required": "conversionRequired", "excluded-preview": "excludedPreviews", "unsupported-format": "unsupported", "invalid-file": "invalid" };
  for (const record of records) counts[countKeys[record.status]] += 1;
  const report = { schema: REPORT_SCHEMA, catalogScope: "provided-manifest-only", websiteInventoryComplete: false,
    authorization: input.authorization, visualReview: "not-performed", counts, records };
  const manifest = entries.map((item) => item.entry);
  const reviewQueue = buildIntakeReviewQueue(report, manifest);
  if (write) {
    if (counts.invalid) throw new Error(`Intake has ${counts.invalid} invalid files; fix them before staging`);
    if (!entries.length) throw new Error("No compatible original assets to stage");
    await mkdir(path.dirname(destination), { recursive: true });
    const actualDestination = path.join(await realpath(path.dirname(destination)), path.basename(destination));
    if (within(root, actualDestination) || within(actualDestination, root)) throw new Error("Output and source must not overlap through symlinks");
    // Exclusive reservation, staging directory, atomic /ready exposure and scoped cleanup live in stagePrivateBundle.
    await stagePrivateBundle(actualDestination, async (temporary) => {
      await mkdir(path.join(temporary, "files"), { mode: 0o700 });
      for (const item of entries) {
        // Re-read bounded, stable bytes and validate BEFORE writing; never copy a moving source.
        const originalPath = await sourceFile(root, item.entry.provenance.sourcePath);
        if (originalPath !== item.absolutePath) throw new Error("Source path changed before staging");
        const inspected = await inspectFile(originalPath);
        if (inspected.sha256 !== item.sha256) throw new Error("Source changed before staging");
        const outputPath = path.join(temporary, item.entry.path);
        await writeFile(outputPath, inspected.bytes, { flag: "wx", mode: 0o600 });
        if ((await inspectFile(outputPath)).sha256 !== item.sha256) throw new Error("Staged file hash mismatch");
      }
      await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(temporary, "intake-report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(temporary, "review-queue.json"), `${JSON.stringify(reviewQueue, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    });
  }
  return { report, manifest, reviewQueue };
}

export function parseCliOptions(argv) {
  const options = { manifestPath: "source.json", write: false };
  const names = new Map([["--source-dir", "sourceDir"], ["--manifest", "manifestPath"], ["--output", "outputDir"]]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--") continue; // pnpm/npm argument separator
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--write") { options.write = true; continue; }
    const key = names.get(flag);
    if (!key || !argv[i + 1]?.trim() || argv[i + 1].startsWith("--")) throw new Error(`Unknown option or missing value: ${flag}`);
    options[key] = argv[++i]; // NOSONAR javascript:S2310
  }
  if (!options.sourceDir) throw new Error("--source-dir is required");
  if (options.write && !options.outputDir) throw new Error("--output is required with --write");
  return options;
}

export async function runCli(argv) {
  // Help is honoured only on its own so it can never mask a malformed write command.
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("node scripts/dontdraw/import-authorized-assets.mjs --source-dir /originals --manifest source.json [--output /new-batch --write]\nDefault is read-only inspection. --write stages an offline bundle under /new-batch/ready, not a public upload. Exit: 0=structurally ready, 1=invalid/error, 2=conversion/unsupported/empty batch.");
    return 0;
  }
  const result = await prepareAuthorizedImport(parseCliOptions(argv));
  console.log(JSON.stringify({ ...result.report, reviewQueue: result.reviewQueue }, null, 2));
  return intakeExitCode(result.report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(path.resolve(process.argv[1])))) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
