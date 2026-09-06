/** Real browser storage/locks tests, not a React or production-API test. No external requests. */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "creator-browser-"));
let browser;
let server;
let passed = 0;
try {
  const compilation = spawnSync(process.execPath, [require.resolve("typescript/lib/tsc.js"), "--strict", "--skipLibCheck", "--target", "es2022", "--module", "commonjs", "--lib", "es2023,dom,dom.iterable", "--outDir", temporary,
    "tests/creator-resources-cases.ts", "tests/creator-resource-workflow-cases.ts", "tests/creator-workspace-persistence-cases.ts"], { cwd: root, stdio: "inherit" });
  if (compilation.status !== 0) throw new Error("Browser test sources failed strict compilation");
  const sources = {};
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.name.endsWith(".js")) sources[path.relative(temporary, filename).split(path.sep).join("/")] = readFileSync(filename, "utf8");
    }
  }
  collect(temporary);
  const boot = `const sources=${JSON.stringify(sources).replaceAll("<", "\\u003c")};
    const cache={};
    function load(name){
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw new Error('Unknown module '+name);
      const mod={exports:{}};cache[name]=mod;
      const require=(request)=>{const parts=name.split('/');parts.pop();for(const part of request.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}return load(parts.join('/')+'.js');};
      new Function('require','module','exports',sources[name])(require,mod,mod.exports);return mod.exports;
    }
    globalThis.testLibrary=load('apps/web/src/shared/lib/creator-workspace-persistence.js');
    globalThis.contracts=load('apps/web/src/shared/lib/creator-resources.js');
    globalThis.cases=[...load('tests/creator-resources-cases.js').creatorResourceCases,...load('tests/creator-resource-workflow-cases.js').creatorResourceWorkflowCases,...load('tests/creator-workspace-persistence-cases.js').creatorWorkspacePersistenceCases];
    globalThis.store=globalThis.testLibrary.createCreatorWorkspaceStorage({storage:()=>localStorage,withLock:globalThis.testLibrary.browserWorkspaceLock(navigator.locks)});`;
  const html = `<!doctype html><meta charset="utf-8"><title>Creator workspace test harness</title><h1>Storage and Web Locks verification</h1><p>This is an isolated test harness, not the ToonStudio UI.</p><script>${boot}</script>`;
  server = createServer((request, response) => {
    if (request.url !== "/") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }).end(html);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require(process.env.CREATOR_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  const a = await context.newPage(); const b = await context.newPage();
  const pureOnly = process.argv.includes("--pure");
  if (pureOnly) await a.setContent(html);
  else await Promise.all([a.goto(origin), b.goto(origin)]);
  console.log(`Chromium ${browser.version()}`);
  if (!pureOnly) assert.equal(await a.evaluate(() => Boolean(navigator.locks)), true);
  const shared = await a.evaluate(async () => {
    const results = [];
    for (const testCase of globalThis.cases) {
      try { await testCase.run(); results.push({ name: testCase.name, passed: true }); }
      catch (error) { results.push({ name: testCase.name, passed: false, error: String(error) }); }
    }
    return results;
  });
  for (const item of shared) { console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}`); assert.equal(item.passed, true, item.error); passed++; }

  if (pureOnly) {
    console.log(`${passed}/${shared.length} browser shared cases passed. Six real storage/lock scenarios were NOT RUN (--pure).`);
  } else {
  await a.evaluate(() => localStorage.removeItem(globalThis.testLibrary.CREATOR_WORKSPACE_KEY));
  await Promise.all([a.evaluate(async () => {
    await Promise.all(Array.from({ length: 40 }, (_, id) => globalThis.store.update((value) => ({ ...value, checks: [...value.checks, `left-${id}`] }))));
  }), b.evaluate(async () => {
    await Promise.all(Array.from({ length: 40 }, (_, id) => globalThis.store.update((value) => ({ ...value, checks: [...value.checks, `right-${id}`] }))));
  })]);
  assert.equal(await a.evaluate(() => globalThis.store.read().checks.length), 80);
  assert.equal(await b.evaluate(() => new Set(globalThis.store.read().checks).size), 80);
  console.log("PASS real two-tab Web Locks preserve all 80 concurrent writes"); passed++;

  await a.evaluate(() => globalThis.store.update(() => ({ ...globalThis.contracts.emptyWorkspace(), story: { title: "원본" } })));
  await Promise.all([a.evaluate(() => { globalThis.draft = globalThis.testLibrary.editStoryDraft(null, globalThis.store.read().story, "title", "왼쪽 초안"); }), b.evaluate(() => { globalThis.draft = globalThis.testLibrary.editStoryDraft(null, globalThis.store.read().story, "title", "오른쪽 초안"); })]);
  await a.evaluate(() => globalThis.store.saveStory(globalThis.draft));
  const collision = await b.evaluate(async () => {
    try { await globalThis.store.saveStory(globalThis.draft); return null; }
    catch (error) { return error instanceof globalThis.testLibrary.WorkspaceConflictError ? error.fields : null; }
  });
  assert.deepEqual(collision, ["title"]);
  assert.equal(await b.evaluate(() => globalThis.store.read().story.title), "왼쪽 초안");
  console.log("PASS real tabs reject a conflicting story patch without losing the winner"); passed++;

  await a.evaluate(() => { globalThis.snapshot = globalThis.store.readRaw(); });
  await b.evaluate(() => globalThis.store.update((value) => ({ ...value, checks: [...value.checks, "after-confirmation"] })));
  assert.equal(await a.evaluate(async () => {
    try { await globalThis.store.restore(JSON.stringify(globalThis.contracts.emptyWorkspace()), "replace", globalThis.snapshot); return false; }
    catch (error) { return error instanceof globalThis.testLibrary.WorkspaceConflictError; }
  }), true);
  assert.equal(await a.evaluate(() => globalThis.store.read().checks.includes("after-confirmation")), true);
  console.log("PASS replacement refuses a stale snapshot after another tab changes the board"); passed++;

  await b.evaluate(() => {
    globalThis.lockHeld = false;
    globalThis.holder = navigator.locks.request(`${globalThis.testLibrary.CREATOR_WORKSPACE_KEY}:write`, async () => {
      globalThis.lockHeld = true;
      await new Promise((resolve) => { globalThis.releaseLock = resolve; });
    });
  });
  await b.waitForFunction(() => globalThis.lockHeld);
  const timedOut = await a.evaluate(async () => {
    const before = globalThis.store.readRaw();
    const bounded = globalThis.testLibrary.createCreatorWorkspaceStorage({ storage: () => localStorage, withLock: globalThis.testLibrary.browserWorkspaceLock(navigator.locks, 35) });
    try { await bounded.update(() => globalThis.contracts.emptyWorkspace()); return false; }
    catch (error) { return error.name === "AbortError" && globalThis.store.readRaw() === before; }
  });
  assert.equal(timedOut, true);
  await b.evaluate(async () => { globalThis.releaseLock(); await globalThis.holder; });
  await a.evaluate(() => globalThis.store.update((value) => ({ ...value, checks: [...value.checks, "recovered"] })));
  console.log("PASS a held cross-tab lock times out safely and subsequent saves recover"); passed++;

  await a.evaluate(() => sessionStorage.setItem(globalThis.testLibrary.CREATOR_STORY_DRAFT_KEY, JSON.stringify(globalThis.testLibrary.createStoryDraft({}, { title: "복구할 제목 ", world: "세계\n😀" }))));
  assert.equal(await b.evaluate(() => sessionStorage.getItem(globalThis.testLibrary.CREATOR_STORY_DRAFT_KEY)), null);
  await a.reload();
  assert.equal(await a.evaluate(() => globalThis.testLibrary.parseStoryDraft(sessionStorage.getItem(globalThis.testLibrary.CREATOR_STORY_DRAFT_KEY)).story.title), "복구할 제목 ");
  console.log("PASS session draft survives reload and stays isolated from the other open tab"); passed++;

  await b.evaluate(() => {
    globalThis.lockHeld = false;
    void navigator.locks.request(`${globalThis.testLibrary.CREATOR_WORKSPACE_KEY}:write`, () => {
      globalThis.lockHeld = true; return new Promise(() => {});
    });
  });
  await b.waitForFunction(() => globalThis.lockHeld);
  await a.evaluate(() => { globalThis.pendingSave = globalThis.store.update((value) => ({ ...value, checks: [...value.checks, "closed-tab-recovery"] })); });
  await b.close(); await a.evaluate(() => globalThis.pendingSave);
  assert.equal(await a.evaluate(() => globalThis.store.read().checks.includes("closed-tab-recovery")), true);
  console.log("PASS closing a lock-holding tab releases pending saves"); passed++;
  console.log(`${passed}/${shared.length + 6} browser checks passed (shared logic plus six real storage/lock scenarios; no React UI or live APIs).`);
  }
} catch (error) {
  process.exitCode = 1; console.error(error);
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
