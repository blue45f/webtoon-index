/** Minimal ZIP STORE writer: deterministic UTF-8 names, CRC32, no compression dependencies. */
export function promoCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function promoZip(files: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([path, value]) => {
    if (!/^[A-Za-z0-9_./-]+$/u.test(path) || path.startsWith("/") || path.split("/").includes("..")) throw new Error("안전하지 않은 ZIP 경로예요.");
    return { name: encoder.encode(path), data: typeof value === "string" ? encoder.encode(value) : value };
  });
  if (entries.length > 100) throw new Error("ZIP 파일 수가 너무 많아요.");
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  if (localSize + centralSize > 100_000_000) throw new Error("프로젝트가 100MB를 초과했어요.");
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let directory = localSize;
  for (const entry of entries) {
    const crc = promoCrc32(entry.data);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x800, true);
    view.setUint16(offset + 12, 33, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    bytes.set(entry.name, offset + 30);
    bytes.set(entry.data, offset + 30 + entry.name.length);
    view.setUint32(directory, 0x02014b50, true);
    view.setUint16(directory + 4, 20, true);
    view.setUint16(directory + 6, 20, true);
    view.setUint16(directory + 8, 0x800, true);
    view.setUint16(directory + 14, 33, true);
    view.setUint32(directory + 16, crc, true);
    view.setUint32(directory + 20, entry.data.length, true);
    view.setUint32(directory + 24, entry.data.length, true);
    view.setUint16(directory + 28, entry.name.length, true);
    view.setUint32(directory + 42, offset, true);
    bytes.set(entry.name, directory + 46);
    offset += 30 + entry.name.length + entry.data.length;
    directory += 46 + entry.name.length;
  }
  view.setUint32(directory, 0x06054b50, true);
  view.setUint16(directory + 8, entries.length, true);
  view.setUint16(directory + 10, entries.length, true);
  view.setUint32(directory + 12, centralSize, true);
  view.setUint32(directory + 16, localSize, true);
  return bytes;
}
