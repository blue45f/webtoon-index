#!/usr/bin/env tsx
// 카탈로그 변경 알림 — 검증을 통과한 새 스냅샷을 직전 스냅샷과 비교해
//   1) 신작(이전에 없던 id)
//   2) 새 영상화(드라마·영화·애니·OTT — title-universe 기준, 작품 단위로 새로 생긴/바뀐 것)
// 을 찾아 Discord 웹훅으로 다이제스트를 보낸다. 웹훅 미설정 시 콘솔에만 출력(실패 아님).
// 영상화는 작품(정규화 제목) 단위로 manifest(apps/api/data/adaptation-seen.json)에 시그니처를
// 저장해, 실행 간 차이로 신규를 잡는다(신작이 이미 영상화돼 있거나, 큐레이션 코드가 갱신된 경우 모두).
//
//   tsx scripts/notify-catalog-changes.ts --new <new.json|.gz> --prev <prev.json|.gz> --manifest <path>
//   tsx scripts/notify-catalog-changes.ts --new <cur.json|.gz> --manifest <path> --seed   # 최초 시드(전송 X)
//   tsx scripts/notify-catalog-changes.ts --alert "<message>"                              # 실패 알림 등
//
// 네트워크/디스코드 오류는 삼켜서 배포 파이프라인을 막지 않는다(알림은 best-effort).

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { universeFor } from "../apps/web/src/shared/lib/title-universe";

import type { Title } from "../apps/web/src/shared/lib/types";

const SITE = process.env.WEBDEX_SITE_URL ?? "https://www.toonstudio.cloud";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL ?? "";
const MAX_LIST = 15; // 임베드당 최대 표기 항목
const PERSIMMON = 0xe8743b;
const COOL = 0x5ba3d0;
const BAD = 0xc8533a;

const PLATFORM_LABEL: Record<string, string> = {
  "naver-webtoon": "네이버웹툰",
  "naver-series": "네이버시리즈",
  "kakao-webtoon": "카카오웹툰",
  "kakao-page": "카카오페이지",
  lezhin: "레진",
  ridi: "리디",
  bomtoon: "봄툰",
  toptoon: "탑툰",
  toomics: "투믹스",
  kyobo: "교보",
  yes24: "예스24",
  joara: "조아라",
  munpia: "문피아",
  novelpia: "노벨피아",
  postype: "포스타입",
  bookcube: "북큐브",
  mrblue: "미스터블루",
  onestory: "원스토리",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function loadCatalog(p: string): Title[] {
  const buf = readFileSync(p);
  const raw = p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const d = JSON.parse(raw) as unknown;
  const titles = Array.isArray(d) ? d : (d as { titles?: unknown })?.titles;
  if (!Array.isArray(titles)) throw new Error(`titles 배열 없음: ${p}`);
  return titles as Title[];
}

// title-universe 의 norm 과 동일 규칙(작품 단위 안정 키).
const normTitle = (s: string) => s.replace(/[\s:~!?,.\-()[\]·]/g, "").toLowerCase();

const platformLabel = (id?: string) => (id ? PLATFORM_LABEL[id] ?? id : "");
const titleUrl = (t: Title) => `${SITE}/title/${t.slug}`;
const primaryPlatform = (t: Title) => platformLabel(t.availability?.[0]?.platformId);

// 작품 단위 영상화 시그니처 맵: normTitle → "kind:name(year)|..." (정렬). 대표 Title 도 함께 보관.
function adaptationMap(titles: Title[]): { sig: Map<string, string>; rep: Map<string, Title> } {
  const sig = new Map<string, string>();
  const rep = new Map<string, Title>();
  for (const t of titles) {
    if (!t?.title) continue;
    const u = universeFor({ title: t.title });
    if (!u.adaptations.length) continue;
    const key = normTitle(t.title);
    const s = u.adaptations
      .map((a) => `${a.kind}:${a.name}(${a.year ?? ""})`)
      .sort((a, b) => a.localeCompare(b))
      .join("|");
    sig.set(key, s);
    // 대표 행: 표지 있는 웹툰 우선(링크 품질)
    const cur = rep.get(key);
    const better = !cur || (!cur.coverImage && t.coverImage) || (cur.type !== "webtoon" && t.type === "webtoon");
    if (better) rep.set(key, t);
  }
  return { sig, rep };
}

function clampList(lines: string[]): string {
  if (lines.length <= MAX_LIST) return lines.join("\n");
  return [...lines.slice(0, MAX_LIST), `…외 ${lines.length - MAX_LIST}건`].join("\n");
}

async function postDiscord(payload: unknown): Promise<void> {
  if (!WEBHOOK) {
    console.log("DISCORD_WEBHOOK_URL 미설정 — 콘솔 출력으로 대체:\n" + JSON.stringify(payload, null, 2));
    return;
  }
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // 응답 본문은 외부 입력이라 GitHub Actions 명령 주입(개행/::)을 막고 길이를 제한해 기록한다.
      const bodyText = await res.text().catch(() => "");
      const safeBody = bodyText.replace(/[\r\n]+/g, " ").replace(/::/g, ":​:").slice(0, 200);
      console.log(`::warning::Discord 웹훅 응답 ${res.status} ${safeBody}`);
    } else console.log("Discord 알림 전송 완료");
  } catch (e) {
    console.log(`::warning::Discord 전송 실패(무시): ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  // 실패 알림 모드
  const alert = arg("alert");
  if (alert) {
    await postDiscord({
      username: "ToonSpectrum",
      embeds: [{ title: "⚠️ 카탈로그 파이프라인 알림", description: alert.slice(0, 4000), color: BAD }],
    });
    return;
  }

  const newPath = arg("new");
  const manifestPath = arg("manifest");
  if (!newPath || !manifestPath) {
    console.error("usage: --new <path> --manifest <path> [--prev <path>] [--seed] | --alert <msg>");
    process.exit(2);
  }

  const next = loadCatalog(newPath);
  const { sig: curSig, rep } = adaptationMap(next);

  // 시드: 현재 영상화 맵만 기록하고 종료(최초 1회).
  if (hasFlag("seed")) {
    writeFileSync(manifestPath, JSON.stringify(Object.fromEntries(curSig), null, 0) + "\n");
    console.log(`시드 완료 — 영상화 작품 ${curSig.size}건 → ${manifestPath}`);
    return;
  }

  // 1) 신작
  const prevPath = arg("prev");
  let newTitles: Title[] = [];
  if (prevPath) {
    try {
      const prev = loadCatalog(prevPath);
      const prevIds = new Set(prev.map((t) => t.id));
      newTitles = next.filter((t) => !prevIds.has(t.id));
    } catch (e) {
      console.log(`(직전 스냅샷 로드 실패 — 신작 비교 생략: ${e instanceof Error ? e.message : e})`);
    }
  }

  // 2) 새 영상화 (manifest 대비)
  let prevManifest: Record<string, string>;
  try {
    prevManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
  } catch {
    console.log("(manifest 없음 — 첫 실행이면 --seed 권장. 이번엔 전부 신규로 보지 않고 시드만 갱신)");
    writeFileSync(manifestPath, JSON.stringify(Object.fromEntries(curSig), null, 0) + "\n");
    prevManifest = Object.fromEntries(curSig);
  }
  const newAdaptations: { t: Title; sig: string }[] = [];
  for (const [key, s] of curSig) {
    if (prevManifest[key] !== s) {
      const t = rep.get(key);
      if (t) newAdaptations.push({ t, sig: s });
    }
  }

  // manifest 갱신(현재 상태로). 워크플로가 catalog 와 함께 커밋.
  writeFileSync(manifestPath, JSON.stringify(Object.fromEntries(curSig), null, 0) + "\n");

  if (newTitles.length === 0 && newAdaptations.length === 0) {
    console.log("변경 없음 — 알림 생략.");
    return;
  }

  // 신작 정렬: 조회수 높은 순(노이즈 줄이고 의미있는 신작 우선)
  newTitles.sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0));

  const embeds: unknown[] = [];
  if (newTitles.length) {
    const lines = newTitles.map((t) => {
      const meta = [t.type === "webnovel" ? "웹소설" : "웹툰", primaryPlatform(t), t.genres?.[0]].filter(Boolean).join(" · ");
      return `• [${t.title}](${titleUrl(t)})${meta ? ` — ${meta}` : ""}`;
    });
    embeds.push({ title: `🆕 신작 ${newTitles.length}편`, description: clampList(lines).slice(0, 4000), color: PERSIMMON });
  }
  if (newAdaptations.length) {
    const lines = newAdaptations.map(({ t, sig }) => {
      const kinds = sig.split("|").map((s) => s.split(":")[0]);
      const labels = [...new Set(kinds)].join("/");
      return `• [${t.title}](${titleUrl(t)}) — ${labels}`;
    });
    embeds.push({ title: `📺 새 영상화 ${newAdaptations.length}건`, description: clampList(lines).slice(0, 4000), color: COOL });
  }

  const content = `📚 ToonSpectrum 카탈로그 업데이트 · 신작 ${newTitles.length}편${newAdaptations.length ? ` · 새 영상화 ${newAdaptations.length}건` : ""}`;
  await postDiscord({ username: "ToonSpectrum", content, embeds });
}

main().catch((e) => {
  console.log(`::warning::notify 실패(무시): ${e instanceof Error ? e.message : e}`);
  process.exit(0);
});
