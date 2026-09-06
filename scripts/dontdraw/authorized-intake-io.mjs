/** Bounded, offline I/O for operator-supplied originals; never reads devices or streams. */
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

const READ_CHUNK_BYTES = 64 * 1024;

function sameSnapshot(left, right) {
  return right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function validateSize(stat, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("A positive integer byte limit is required");
  if (!stat.isFile()) throw new Error("Only regular files are accepted; devices, pipes and directories are rejected");
  if (stat.size < 1n || stat.size > BigInt(maxBytes)) throw new Error(`File must contain 1 to ${maxBytes} bytes`);
}

/** Internal handle-level primitive, exported so mutation/short-read contracts are deterministic. */
export async function readBoundedHandle(handle, maxBytes) {
  const before = await handle.stat({ bigint: true });
  validateSize(before, maxBytes);
  // Allocate exactly the inspected size, never readFile() to a potentially moving EOF.
  const bytes = Buffer.alloc(Number(before.size));
  let position = 0;
  while (position < bytes.length) {
    const length = Math.min(READ_CHUNK_BYTES, bytes.length - position);
    const { bytesRead } = await handle.read(bytes, position, length, position);
    if (!Number.isInteger(bytesRead) || bytesRead < 1 || bytesRead > length) {
      throw new Error("Source changed or ended while reading");
    }
    position += bytesRead;
  }
  const { bytesRead: trailingBytes } = await handle.read(Buffer.alloc(1), 0, 1, position);
  const after = await handle.stat({ bigint: true });
  if (trailingBytes !== 0 || !sameSnapshot(before, after)) throw new Error("Source changed while reading");
  return bytes;
}

export async function readStableFile(filename, maxBytes) {
  // Reject FIFOs before open: O_RDONLY on a FIFO can wait forever for a writer.
  const before = await lstat(filename, { bigint: true });
  validateSize(before, maxBytes);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await open(filename, flags);
  try {
    if (!sameSnapshot(before, await handle.stat({ bigint: true }))) throw new Error("Source changed before opening");
    const bytes = await readBoundedHandle(handle, maxBytes);
    if (!sameSnapshot(before, await lstat(filename, { bigint: true }))) throw new Error("Source path changed while reading");
    return bytes;
  } finally {
    await handle.close();
  }
}

function sameDirectory(left, right) {
  return right.isDirectory() && !right.isSymbolicLink() && left.dev === right.dev && left.ino === right.ino;
}

/** Reserve a private output, expose ready/ only on success, and clean up only our staging data. */
export async function stagePrivateBundle(destination, populate) { // NOSONAR javascript:S3776
  await mkdir(destination, { mode: 0o700 }); // Exclusive; never reuse an existing output.
  let identity;
  let temporary;
  try {
    identity = await lstat(destination, { bigint: true });
    temporary = await mkdtemp(path.join(destination, ".staging-"));
    await populate(temporary);
    if (!sameDirectory(identity, await lstat(destination, { bigint: true }))) {
      throw new Error("Output directory changed while staging");
    }
    const ready = path.join(destination, "ready");
    try {
      await lstat(ready);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await rename(temporary, ready);
      return;
    }
    throw new Error("Output ready directory already exists; refusing to replace it");
  } catch (error) {
    const cleanupErrors = [];
    try {
      // Do not traverse a substituted output path or recursively remove its unrelated contents.
      if (!identity || !sameDirectory(identity, await lstat(destination, { bigint: true }))) {
        throw new Error("Output ownership changed; cleanup was not attempted", { cause: error });
      }
      if (temporary) await rm(temporary, { recursive: true, force: true });
      try {
        await rmdir(destination); // Remove only if empty; preserve any independently added files.
      } catch (cleanupError) {
        if (!["ENOTEMPTY", "EEXIST"].includes(cleanupError?.code)) throw cleanupError;
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Staging failed and cleanup needs review", { cause: error });
    throw error;
  }
}
