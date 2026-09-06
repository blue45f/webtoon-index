/** Actual composed frames. Captures are evidence to inspect, not an aesthetic approval. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.TOONSPECTRUM_VERIFY_ORIGIN ?? 'http://127.0.0.1:5173';
const out = process.env.STUDIO_CLOSEUP_OUTPUT ?? '/tmp/3d-visual-evidence';
const group = process.env.STUDIO_REVIEW_GROUP ?? 'wardrobe';
const root = '[data-character-shaper="true"]';
const viewport = `${root} [data-character-shaper-viewport] canvas`;
const evidence = { group, variant: process.env.STUDIO_REVIEW_VARIANT, capturedAt: new Date().toISOString(), artisticApproval: 'pending-image-review', catalogs: {}, cases: [], errors: [], requests: [] };
mkdirSync(out, { recursive: true });
const persist = () => writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
// No server fixture is involved in visual inspection. Local authored changes are never published.
await context.route('**/api/auth/session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false, user: null }) }));
await context.addInitScript(() => {
  localStorage.setItem('toonspectrum-studio-quick-start-dismissed', '1');
  localStorage.setItem('toonspectrum-studio-mobile-hint-dismissed', '1');
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', (error) => { evidence.errors.push(error.message); persist(); });
page.on('requestfailed', (req) => { if (/\.(vrm|glb|gltf)(\?|$)/.test(req.url())) evidence.requests.push({ url: req.url(), failure: req.failure() }); });

async function capture(name, selector) {
  const session = await context.newCDPSession(page);
  try {
    const box = selector ? await page.locator(selector).first().boundingBox() : null;
    if (selector && (!box || box.width < 64 || box.height < 64)) throw new Error(`Missing render surface: ${selector}`);
    const shot = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, ...(box ? { clip: { ...box, scale: 1 } } : {}) });
    const file = name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.png';
    writeFileSync(join(out, file), Buffer.from(shot.data, 'base64'));
    const stats = await page.evaluate(async (data) => {
      const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
      const c = new OffscreenCanvas(128, 128); const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0, 128, 128);
      const pixels = ctx.getImageData(0, 0, 128, 128).data;
      const histogram = new Map();
      for (let i = 0; i < pixels.length; i += 4) {
        const k = (pixels[i] >> 3) * 1024 + (pixels[i + 1] >> 3) * 32 + (pixels[i + 2] >> 3);
        histogram.set(k, (histogram.get(k) ?? 0) + 1);
      }
      const result = { width: image.width, height: image.height, colors: histogram.size, dominant: Math.max(...histogram.values()) / (128 * 128) };
      image.close(); return result;
    }, shot.data);
    evidence.cases.push({ name, file, status: 'captured-not-aesthetic-approved', stats });
    persist(); console.log('[capture]', name, JSON.stringify(stats));
    return stats;
  } finally { await session.detach(); }
}
async function ready() {
  // Scope to the actual HUD: legacy Poser and Shaper both had a button named zoom before this fix.
  await page.locator(`${root} [data-character-shaper-hud] button[aria-label="확대"]:not(:disabled)`).first().waitFor({ timeout: 240000 });
  await page.locator(viewport).first().waitFor({ timeout: 120000 });
}
async function view(label) {
  await page.locator(root).getByRole('group', { name: '카메라 프리셋', exact: true }).getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(1200);
}
async function inspect(id) {
  const choice = page.getByRole('combobox', { name: '부위·방향 확대 검사', exact: true });
  if (!(await choice.count())) return false;
  await choice.selectOption(id); await page.waitForTimeout(1200); return true;
}
async function selectSlot(slot) {
  await page.locator(`${root} [data-character-slot="${slot}"]`).click();
  await page.waitForTimeout(400);
  const entries = await page.locator(`${root} [data-character-slot-card]`).evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-character-slot-card'), disabled: node.getAttribute('aria-disabled') === 'true', title: node.getAttribute('title') })));
  evidence.catalogs[slot] = entries; persist(); return entries;
}
async function selectCard(id) {
  const card = page.locator(`${root} [data-character-slot-card="${id}"]`).first();
  if (!await card.count() || await card.getAttribute('aria-disabled') === 'true') return false;
  if (await card.getAttribute('aria-pressed') !== 'true') await card.click();
  await page.waitForTimeout(1400); await ready();
  if (await card.getAttribute('aria-pressed') !== 'true') throw new Error(`Selection not reflected: ${id}`);
  return true;
}
async function character() { // NOSONAR javascript:S3776
  await page.goto(origin + '/studio/character', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(); await page.waitForTimeout(2500);
  const initial = await capture('00-original-ui');
  await view('전신');
  const render = await capture('01-original-full', viewport);
  if (render.colors < 24 || render.dominant > 0.98) throw new Error('Model-ready controls but empty composed frame');
  evidence.initial = { initial, render };
  let slots;
  if (group === "wardrobe") slots = ["top", "bottom", "shoes"];
  else if (group === "accessories") slots = ["accessory", "hand-pose"];
  else slots = ["face-shape", "eyes", "irises", "nose", "mouth", "ears", "hair", "body", "expression", "pose"];
  for (const slot of slots) {
    const entries = await selectSlot(slot);
    const original = entries.find((entry) => entry.id === slot + ':original');
    for (const entry of entries) {
      if (entry.id === original?.id) continue;
      if (entry.disabled) { evidence.cases.push({ id: entry.id, status: 'unavailable', reason: entry.title }); persist(); continue; }
      try {
        if (original) await selectCard(original.id);
        if (!await selectCard(entry.id)) throw new Error("Entry became unavailable");
        const full = ["bottom", "shoes", "body", "pose"].includes(slot);
        let viewMode = "얼굴 줌";
        if (full) viewMode = "전신";
        else if (["top", "accessory", "hand-pose"].includes(slot)) viewMode = "상반신";
        await view(viewMode);
        await capture(entry.id + "-front", viewport);
        if (group !== "appearance") {
          await view("사선");
          await capture(entry.id + "-oblique", viewport);
          let detail = "inspectTorso";
          if (slot === "top") detail = "inspectTorsoBack";
          else if (slot === "bottom") detail = "inspectLowerBody";
          else if (slot === "shoes") detail = "inspectFeet";
          else if (slot === "hand-pose") detail = "inspectRightHand";
          if (await inspect(detail)) await capture(entry.id + "-detail", viewport);
        }
        if (slot === 'accessory') {
          await page.locator(`${root} [data-character-slot-card="${entry.id}"]`).first().click();
          await page.waitForTimeout(500);
        }
      } catch (error) { evidence.cases.push({ id: entry.id, status: 'failed', error: String(error) }); persist(); }
    }
    if (original) await selectCard(original.id);
  }
  if (group === 'wardrobe') {
    for (const id of ['profile', 'profileReverse', 'back', 'inspectTorso', 'inspectTorsoBack', 'inspectLowerBody', 'inspectFeet', 'inspectLeftHand', 'inspectRightHand']) {
      if (await inspect(id)) await capture('camera-' + id, viewport);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(2000); await capture('mobile-ui');
    evidence.mobile = await page.locator(root).evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  }
}
async function background() {
  await page.goto(origin + '/studio/bg3d', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const dialog = page.locator('[data-testid="studio-bg3d-dialog"]');
  await dialog.waitFor({ timeout: 180000 });
  await dialog.getByRole('tab', { name: '보기', exact: true }).click();
  const pref = page.locator('[data-testid="studio-bg3d-engine-preference-webgl2"]').first();
  if (await pref.getAttribute('aria-pressed') !== 'true') await pref.click();
  await page.locator('[data-testid="studio-bg3d-engine-active-backend"]').first().getByText(/WebGL2 사용 중/).waitFor({ timeout: 120000 }).catch(async () => {
    if (!(await page.locator('[data-testid="studio-bg3d-engine-active-backend"]').first().innerText()).includes('WebGL2 사용 중')) throw new Error('WebGL2 not active');
  });
  await dialog.getByRole('tab', { name: '도형', exact: true }).click();
  const canvas = '[data-testid="studio-bg3d-viewport"] canvas';
  await page.locator(canvas).first().waitFor(); await page.waitForTimeout(1500);
  await capture('background-empty');
  const additions = await dialog.locator('button[aria-label$=" 추가"], button[aria-label$="장면에 추가"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  evidence.catalogs.background = additions; persist();
  for (const [index, label] of [...new Set(additions)].entries()) {
    try {
      await dialog.getByRole('button', { name: label, exact: true }).first().click();
      await page.waitForTimeout(1800);
      await capture('background-' + String(index).padStart(2, '0'), canvas);
      evidence.cases.push({ label, status: 'added-and-captured' });
      // Restore the same scene after each asset through the actual undo command.
      await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
    } catch (error) { evidence.cases.push({ label, status: 'failed', error: String(error) }); persist(); }
  }
  await dialog.getByRole('tab', { name: '템플릿', exact: true }).click();
  await capture('background-templates-ui');
  evidence.templateControls = await dialog.locator('button').evaluateAll((nodes) => nodes.map((n) => ({ label: n.getAttribute('aria-label'), text: n.textContent?.trim() })));
  await dialog.getByRole('tab', { name: '보기', exact: true }).click();
  await capture('background-view-controls');
}
try {
  if (group === 'background') await background(); else await character();
} catch (error) {
  evidence.cases.push({ status: 'fatal', error: String(error) });
  await capture('fatal-page').catch((e) => evidence.cases.push({ status: 'capture-failed', error: String(e) }));
} finally {
  writeFileSync(join(out, 'page-text.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
  persist(); await browser.close();
}
if (evidence.errors.length || evidence.cases.some((x) => x.status === 'fatal' || x.status === 'failed')) process.exitCode = 1;
