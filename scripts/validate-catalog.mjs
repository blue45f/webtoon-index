#!/usr/bin/env node
// 카탈로그 검증 게이트 — 크롤 결과를 배포(커밋)하기 전에 건전성을 확인한다.
// 목적: 지오차단·파서 깨짐·소스 장애로 망가진 스냅샷이 라이브로 새는 걸 막는다.
//
//   node scripts/validate-catalog.mjs <new.json|new.json.gz> [prev.json.gz]
//
// 종료코드 0 = 통과(배포 OK), 1 = 실패(커밋/배포 스킵). 사유를 사람이 읽게 출력하고,
// GITHUB_OUTPUT 이 있으면 ok / total / reasons 를 기계가 읽게 기록한다.
//
// 설계: 절대 바닥값은 환경(러너 egress)에 따라 정당하게 낮을 수 있어 느슨하게 두고,
// "직전 스냅샷 대비 회귀"를 주 신호로 본다 — 특히 플랫폼 단위 급락(예: bookcube 1545→50)은
// 전체 합계로는 -5%라 합계 게이트를 통과하므로, 플랫폼별로 따로 잡는다.

import { readFileSync, appendFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// ── 튜닝 노브 ──────────────────────────────────────────────
const ABS_FLOOR = 8000; // 전체 절대 바닥(이 밑이면 명백한 전면 장애/차단)
// 직전의 92% 미만이면 회귀로 간주 — "현재보다 유의미하게 적은 데이터로 덮어쓰지 않는다"가 원칙.
// 같은 환경의 연속 크롤은 거의 동일(>99%)하므로 8% 여유는 자연 변동엔 충분하고, 러너 egress가
// 로컬(KR)보다 구조적으로 낮으면 통과 못 해(다운그레이드 방지) 알림만 가고 기존 카탈로그를 지킨다.
const TOTAL_MIN_RATIO = 0.92;
const PLATFORM_MIN_PREV = 400; // 직전에 이 이상이던 플랫폼만 급락 검사(소형 노이즈 제외)
const PLATFORM_COLLAPSE_RATIO = 0.12; // 직전의 12% 미만이고
const PLATFORM_COLLAPSE_ABS = 80; // 절대값도 80 미만이면 "붕괴"로 판정
const MALFORMED_MAX_RATIO = 0.05; // id/제목/availability 누락이 5% 넘으면 실패

function loadCatalog(p) {
  const buf = readFileSync(p); // NOSONAR S8707 로컬 CLI 검증 스크립트, 운영자 지정 카탈로그 경로(신뢰)
  const raw = p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const d = JSON.parse(raw);
  const titles = Array.isArray(d) ? d : d?.titles;
  if (!Array.isArray(titles)) throw new Error(`titles 배열을 찾을 수 없음: ${p}`);
  return titles;
}

function platformCounts(titles) {
  const m = {};
  for (const t of titles) {
    const ids = new Set((t.availability || []).map((a) => a.platformId).filter(Boolean));
    for (const id of ids) m[id] = (m[id] || 0) + 1;
  }
  return m;
}

function main() { // NOSONAR javascript:S3776
  const [, , newPath, prevPath] = process.argv;
  if (!newPath) {
    console.error("usage: validate-catalog.mjs <new.json|.gz> [prev.json.gz]");
    process.exit(2);
  }

  const next = loadCatalog(newPath);
  const total = next.length;
  const reasons = [];

  // 1) 절대 바닥
  if (total < ABS_FLOOR) {
    reasons.push(`전체 ${total} < 절대 바닥 ${ABS_FLOOR} (전면 장애/차단 의심)`);
  }

  // 2) 데이터 형태 sanity
  let malformed = 0;
  for (const t of next) {
    if (!t || !t.id || !t.title || !Array.isArray(t.availability) || t.availability.length === 0) malformed++;
  }
  const malformedRatio = total > 0 ? malformed / total : 1;
  if (malformedRatio > MALFORMED_MAX_RATIO) {
    reasons.push(`불완전 레코드 ${malformed}/${total} (${(malformedRatio * 100).toFixed(1)}%) > ${(MALFORMED_MAX_RATIO * 100).toFixed(0)}%`);
  }

  const nextPc = platformCounts(next);
  let prev = null;
  let prevPc = null;
  if (prevPath) {
    try {
      prev = loadCatalog(prevPath);
      prevPc = platformCounts(prev);
    } catch (e) {
      console.log(`(직전 스냅샷 로드 실패 — 회귀 검사 생략: ${e.message})`);
    }
  }

  if (prev) {
    const prevTotal = prev.length;
    // 3) 전체 회귀
    if (prevTotal > 0 && total < prevTotal * TOTAL_MIN_RATIO) {
      reasons.push(`전체 ${total} < 직전 ${prevTotal}의 ${(TOTAL_MIN_RATIO * 100).toFixed(0)}% (${Math.round(prevTotal * TOTAL_MIN_RATIO)})`);
    }
    // 4) 플랫폼 단위 붕괴
    for (const [id, pc] of Object.entries(prevPc)) {
      if (pc < PLATFORM_MIN_PREV) continue;
      const nc = nextPc[id] || 0;
      if (nc < pc * PLATFORM_COLLAPSE_RATIO && nc < PLATFORM_COLLAPSE_ABS) {
        reasons.push(`플랫폼 '${id}' 붕괴: ${pc} → ${nc} (직전의 ${((nc / pc) * 100).toFixed(0)}%)`);
      }
    }
  }

  // ── 리포트 ──
  console.log(`\n검증 대상: ${newPath}`);
  const previousDeltaSign = prev && total - prev.length >= 0 ? "+" : "";
  const previousSummary = prev ? ` (직전 ${prev.length}, Δ${previousDeltaSign}${total - prev.length})` : "";
  console.log(`전체 작품 수: ${total}${previousSummary}`); // NOSONAR S8689 집계 수치만 출력(기밀 아님)
  console.log(`불완전 레코드: ${malformed} (${(malformedRatio * 100).toFixed(2)}%)`);
  console.log("플랫폼별:");
  const allIds = [...new Set([...Object.keys(nextPc), ...(prevPc ? Object.keys(prevPc) : [])])].sort(
    (a, b) => (nextPc[b] || 0) - (nextPc[a] || 0)
  );
  for (const id of allIds) {
    const nc = nextPc[id] || 0;
    const pc = prevPc ? prevPc[id] || 0 : null;
    const deltaValue = nc - pc;
    const deltaSign = deltaValue >= 0 ? "+" : "";
    const delta = pc !== null ? ` (직전 ${pc}, ${deltaSign}${deltaValue})` : "";
    console.log(`  ${id.padEnd(16)} ${String(nc).padStart(6)}${delta}`);
  }

  const ok = reasons.length === 0;
  if (ok) {
    console.log(`\n✅ 검증 통과 — 배포 진행 가능`);
  } else {
    console.log(`\n❌ 검증 실패 — 커밋/배포 스킵:`);
    for (const r of reasons) console.log(`   • ${r}`);
  }

  // GitHub Actions 출력
  if (process.env.GITHUB_OUTPUT) {
    // reasons 는 heredoc 형식 — 값에 개행/특수문자가 섞여도 key=value 출력을 깨지 않는다.
    const out = `ok=${ok}\ntotal=${total}\nreasons<<EOF_REASONS\n${reasons.join(" / ").replace(/\r/g, " ")}\nEOF_REASONS\n`;
    try {
      appendFileSync(process.env.GITHUB_OUTPUT, out);
    } catch {
      /* noop */
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
