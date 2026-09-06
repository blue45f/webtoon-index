// 카탈로그 머지 — 전량 교체 대신 "동일 작품(id)이면 갱신, 이번 크롤에서 놓친 작품은 기존 유지".
//
// 단일 크롤이 일부 플랫폼에서 차단/레이트리밋되면 전체 수가 줄어 검증 게이트(92%)에 걸려
// 통째로 거부되었다. 그러면 정상 크롤된 작품들의 최신 정보(조회수/별점/연재상태)마저 못 들어온다.
// 대신 기존 스냅샷을 base 로 두고 신선 크롤을 upsert 하면:
//   - id 일치     → 신선 크롤에 "값이 있는 필드만" 갱신(없는 필드는 기존 유지), availability 는 합집합
//   - 신선에만 존재 → 신규 작품으로 추가
//   - 기존에만 존재 → 그대로 유지(이번 크롤이 놓친 작품 — 보통 플랫폼 차단)
// 결과 수는 항상 base 이상이라 다운그레이드가 구조적으로 불가능하다.
//
// 사용:
//   node scripts/merge-catalog.mjs <freshCrawl.json|.json.gz> [--base apps/api/data/catalog.json.gz] [--out <path>]
// 인자 없는 fresh 경로는 필수. base/out 기본값은 apps/api/data/catalog.json.gz.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CATALOG = path.join(ROOT, "apps/api/data/catalog.json.gz");

function parseArgs(argv) {
  const out = { fresh: null, base: DEFAULT_CATALOG, out: DEFAULT_CATALOG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i]; // NOSONAR javascript:S2310
    else if (a === "--out") out.out = argv[++i]; // NOSONAR javascript:S2310
    else if (!out.fresh) out.fresh = a;
  }
  return out;
}

function loadPayload(file) {
  if (!existsSync(file)) throw new Error(`파일 없음: ${file}`);
  const buf = readFileSync(file);
  const raw = file.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const parsed = JSON.parse(raw);
  const titles = Array.isArray(parsed) ? parsed : parsed?.titles;
  if (!Array.isArray(titles)) throw new Error(`titles 배열 없음: ${file}`);
  // 배열만 들어온 경우 최소 래퍼를 만들어 둔다.
  const meta = Array.isArray(parsed) ? {} : parsed;
  return { meta, titles };
}

/** availability 합집합 — platformId 기준, 신선 항목이 충돌 시 우선. 기존 전용 플랫폼은 보존. */
function mergeAvailability(oldAvail, newAvail) {
  const byId = new Map();
  for (const a of oldAvail ?? []) if (a?.platformId) byId.set(a.platformId, a);
  for (const a of newAvail ?? []) if (a?.platformId) byId.set(a.platformId, a); // 신선이 덮어씀
  return [...byId.values()];
}

/** 값이 "있는" 것으로 볼지 — null/undefined/빈문자열/빈배열은 미존재로 본다(불리언·숫자는 유효). */
function isMeaningful(v) {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 필드 단위 머지 — 기존을 base 로 두고, 신선 크롤에 "값이 있는 필드만" 덮어쓴다.
 * 신선에 없는(빈) 필드는 기존값 유지. availability 는 합집합으로 누락 플랫폼 보존.
 */
function mergeTitle(oldT, newT) {
  const merged = { ...oldT };
  for (const [k, v] of Object.entries(newT)) {
    if (k === "availability") continue;
    if (isMeaningful(v)) merged[k] = v;
  }
  merged.availability = mergeAvailability(oldT.availability, newT.availability);
  return merged;
}

function main() {
  const { fresh, base, out } = parseArgs(process.argv.slice(2));
  if (!fresh) {
    console.error("사용: node scripts/merge-catalog.mjs <freshCrawl.json[.gz]> [--base <gz>] [--out <gz>]");
    process.exit(2);
  }

  const baseP = loadPayload(base);
  const freshP = loadPayload(fresh);

  const oldById = new Map();
  for (const t of baseP.titles) if (t?.id != null) oldById.set(t.id, t);
  const newById = new Map();
  for (const t of freshP.titles) if (t?.id != null) newById.set(t.id, t);

  let updated = 0;
  let added = 0;
  let retained = 0;
  const merged = [];
  const seen = new Set();

  // 신선 기준으로 먼저 순회(갱신/추가) — 신선의 순서를 우선 반영.
  for (const [id, nt] of newById) {
    const ot = oldById.get(id);
    if (ot) {
      merged.push(mergeTitle(ot, nt));
      updated++;
    } else {
      merged.push(nt);
      added++;
    }
    seen.add(id);
  }
  // 기존에만 있는 작품 유지(이번 크롤이 놓침).
  for (const [id, ot] of oldById) {
    if (seen.has(id)) continue;
    merged.push(ot);
    retained++;
  }

  const payload = {
    ...freshP.meta,
    titles: merged,
    count: merged.length,
    crawledAt: freshP.meta.crawledAt ?? new Date().toISOString(),
    merge: {
      baseCount: baseP.titles.length,
      freshCount: freshP.titles.length,
      updated,
      added,
      retained,
      mergedCount: merged.length,
    },
  };

  writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }));

  console.log("카탈로그 머지 완료:");
  console.log(`  base(기존)   : ${baseP.titles.length}`);
  console.log(`  fresh(신선)  : ${freshP.titles.length}`);
  console.log(`  갱신(updated): ${updated}`);
  console.log(`  추가(added)  : ${added}`);
  console.log(`  유지(retained): ${retained}`);
  console.log(`  → merged     : ${merged.length}  (${out})`);
}

main();
