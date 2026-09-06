/** Real Chromium component smoke: original files, existing design tokens, no AI/API calls. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, expect } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const root = process.cwd();
const evidence = path.join(root, "artifacts/studio-2d");
await mkdir(evidence, { recursive: true });
const fixture = await mkdtemp(path.join(root, ".studio-2d-smoke-"));
const relative = path.basename(fixture);
const manifest = JSON.parse(await readFile(path.join(root, "apps/web/src/domains/creator/studio-2d-asset-manifest.json"), "utf8"));
const rooftop = manifest.assets.find((asset) => asset.id === "webtoon-rooftop-sunset");
assert.ok(rooftop);
await writeFile(path.join(fixture, "index.html"), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>2D scene regression</title></head><body><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`);
await writeFile(path.join(fixture, "entry.tsx"), `import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Studio2dSceneBrowser} from '../apps/web/src/domains/creator/Studio2dSceneBrowser';
import {BG_SCENES,groupBgScenes} from '../apps/web/src/domains/creator/studio-bg-scenes';
import {BG_SCENES_EXTRA} from '../apps/web/src/domains/creator/studio-bg-scenes-extra';
import {createStudio2dCanvasImage} from '../apps/web/src/domains/creator/studio-2d-source-size';
import '../apps/web/src/styles/globals.css';
const groups=groupBgScenes([...BG_SCENES,...BG_SCENES_EXTRA]);
function Harness(){const[q,setQ]=useState('');const[g,setG]=useState('all');const[picks,setPicks]=useState<string[]>([]);const[placed,setPlaced]=useState('');
return <main style={{width:'min(100%,440px)',margin:'0 auto',padding:12,boxSizing:'border-box'}}>
<output data-testid="picked">{picks.join(',')}</output><output data-testid="placed" hidden>{placed}</output><Studio2dSceneBrowser groups={groups} query={q} onQueryChange={setQ} genre={g} onGenreChange={setG} loading={false} error={null} disabled={false} onPick={s=>{setPicks(p=>[...p,s.id]);setPlaced(JSON.stringify(createStudio2dCanvasImage(s,{id:s.id,src:s.imgSrc??'',canvasWidth:720,canvasHeight:1080})));}}/></main>}
createRoot(document.getElementById('root')!).render(<Harness/>);`);
const errors = [];
const results = [];
let server;
let browser;
try {
  server = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { "@/src": path.join(root, "apps", "web", "src"), "@/shared": path.join(root, "apps", "web", "src", "shared"), "@/domains": path.join(root, "apps", "web", "src", "domains"), "@": path.join(root, "apps", "web", "src") } },
    server: { host: "127.0.0.1", port: 0 }, publicDir: path.join(root, "apps", "web", "public"),
    optimizeDeps: { entries: [path.join(fixture, "index.html")] } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/${relative}/index.html`;
  browser = await chromium.launch();
  for (const viewport of [{ name: "desktop", width: 1280, height: 960 }, { name: "mobile", width: 390, height: 844 }, { name: "narrow", width: 320, height: 740 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(48);
    await expect(page.getByRole("status").filter({ hasText: /^64개 장면$/u })).toHaveText("64개 장면");
    await page.getByRole("button", { name: "장면 더 보기 (16개 남음)", exact: true }).click();
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(64);
    await page.getByLabel("소재 구분", { exact: true }).selectOption("recommended");
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(5);
    await expect.poll(() => page.locator("[data-studio-2d-grid]").evaluate((element) => element.scrollTop)).toBe(0);
    await page.screenshot({ path: path.join(evidence, `${viewport.name}-recommended.png`), fullPage: true });
    await page.getByLabel("장르", { exact: true }).selectOption("로맨스");
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(1);
    const opener = page.getByRole("button", { name: `${rooftop.title} 확대 미리보기`, exact: true });
    await expect(page.getByRole("button", { name: `${rooftop.title} 삽입`, exact: true })).toBeEnabled();
    await page.screenshot({ path: path.join(evidence, `${viewport.name}-library.png`), fullPage: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: rooftop.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "이 배경 삽입", exact: true })).toBeEnabled();
    await expect(dialog.getByText(/이용 권리 기록 미확인/u)).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `${viewport.name}-preview.png`), fullPage: true });
    await dialog.getByRole("button", { name: "원본 픽셀 보기", exact: true }).click();
    await expect(dialog.getByAltText(rooftop.title, { exact: true })).toHaveCSS("width", `${rooftop.width}px`);
    await expect(dialog.getByRole("region", { name: "배경 원본 이미지 영역" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => dialog.getByRole("region", { name: "배경 원본 이미지 영역" }).evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), "focus escaped modal");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole("dialog").getByRole("button", { name: "이 배경 삽입", exact: true }).click();
    await expect(page.getByTestId("picked")).toHaveText(rooftop.id);
    const placed = JSON.parse(await page.getByTestId("placed").textContent());
    assert.deepEqual([placed.width, placed.height], [720, 405], "canvas aspect ratio");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    await page.getByLabel("배경 이름·장소·분위기 검색", { exact: true }).fill("실내 태블릿");
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(1);
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    await page.getByLabel("소재 구분", { exact: true }).selectOption("large");
    await page.getByLabel("원본 비율", { exact: true }).selectOption("portrait");
    await expect(page.getByText(/조건에 맞는 배경이 없습니다/u)).toBeVisible();
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    await page.locator("[data-studio-2d-content-filters] summary").click();
    await page.getByLabel("장소", { exact: true }).selectOption("실내");
    await page.getByLabel("시간대", { exact: true }).selectOption("밤");
    await page.getByLabel("문자 형태 없는 이미지 배경만", { exact: true }).check();
    await page.getByLabel("소재 구분", { exact: true }).selectOption("large");
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(2);
    for (const asset of manifest.assets.filter((item) => ["webtoon-creator-room", "webtoon-palace"].includes(item.id))) {
      await expect(page.getByRole("button", { name: `${asset.title} 삽입`, exact: true })).toBeEnabled();
    }
    await expect(page.locator("[data-studio-2d-content-filters] summary")).toContainText("3개 적용");
    await page.screenshot({ path: path.join(evidence, `${viewport.name}-content-discovery.png`), fullPage: true });
    await page.getByRole("button", { name: "장소·시간·문자 조건만 지우기", exact: true }).click();
    await expect(page.getByLabel("소재 구분", { exact: true })).toHaveValue("large");
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(9);
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    await expect(page.locator("[data-studio-2d-asset]")).toHaveCount(48);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, "horizontal document overflow");
    results.push({ viewport: viewport.name, ok: true, originalSize: [rooftop.width, rooftop.height], assertions: "complete 64-scene catalog, pagination, filter scroll reset, filters, native decode, aspect ratio, modal, pixel view, focus trap, escape/restore, insertion, empty state, reviewed environment/time/text filters, partial reset, 320px overflow" });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, "browser-smoke.json"), JSON.stringify({ ok: true, scope: "actual component + original images; not a full editor/production deployment test", results, pageErrors: errors }, null, 2));
} catch (error) {
  if (browser) for (const page of browser.contexts().flatMap((context) => context.pages())) {
    await page.screenshot({ path: path.join(evidence, "browser-failure.png"), fullPage: true }).catch(() => {});
  }
  await writeFile(path.join(evidence, "browser-smoke.json"), JSON.stringify({ ok: false, results, pageErrors: errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
