#!/usr/bin/env node
/** Real Chromium component integration against bundled files, not mocked URLs.
 * Does not claim the entire editor's save/restore or rigged-garment coverage.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

import { verifyCc0InsertionCancellation } from './studio-cc0-lifecycle-checks.mjs';

const root = process.cwd();
const output = path.resolve(process.argv[2] ?? '/tmp/studio-cc0-ui');
await mkdir(output, {recursive:true});
const manifest = JSON.parse(await readFile(path.join(root,'apps/web/public/assets/studio/cc0-20260906/manifest.json'),'utf8'));
const htmlName = 'cc0-curation-private-test.html';
const entryName = 'cc0-curation-private-test.tsx';
for (const file of [htmlName,entryName]) if (existsSync(path.join(root,file))) throw new Error('Test fixture path already exists');
const mainPath = path.join(root,'apps/web/src/app/main.tsx');
const mainSource = await readFile(mainPath,'utf8');
const cssImports = [...mainSource.matchAll(/import\s*["']([^"']+\.css)["']/g)].map(match => {
  const resolved = path.resolve(path.dirname(mainPath),match[1]);
  if(!resolved.startsWith(root+path.sep))throw new Error('Unexpected application CSS location');
  return `import ${JSON.stringify('./'+path.relative(root,resolved).split(path.sep).join('/'))};`;
}).join('\n');
await writeFile(path.join(root,htmlName),'<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><body><div id="root"></div><script type="module" src="/'+entryName+'"></script></body></html>');
await writeFile(path.join(root,entryName),`${cssImports}
import React from 'react';
import {createRoot} from 'react-dom/client';
import {StudioCc0AssetLibraryPanel} from './apps/web/src/domains/creator/StudioCc0AssetLibraryPanel';
window.__cc0Accept=true;
window.__cc0Used=null;
window.__cc0UseCount=0;
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:720,margin:'24px auto',padding:12}}><h1>에셋 라이브러리 실제 컴포넌트 검증</h1><StudioCc0AssetLibraryPanel onUseAsset={asset=>{window.__cc0UseCount+=1;window.__cc0Used=asset;return window.__cc0Accept;}}/></main>);
`);
let server, browser;
const errors=[], steps=[];
try {
  server = await createServer({root,server:{host:'127.0.0.1',port:5189,strictPort:true,open:false}});
  await server.listen();
  browser = await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:1000,height:1100},acceptDownloads:true});
  const page = await context.newPage();
  page.on('pageerror', error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5189/'+htmlName,{waitUntil:'networkidle'});
  const panel=page.locator('[data-studio-cc0-library]');
  assert.equal(await panel.locator('article').count(),0,'closed library must not build every tile');
  await panel.locator('summary').click();
  await panel.locator('article').first().waitFor();
  const detailed = manifest.assets.filter(a=>a.license.provider==='Poly Haven');
  assert.equal(detailed.length,47);
  assert.ok((await panel.locator('article').first().getAttribute('data-cc0-asset-id')).startsWith('polyhaven-'));
  steps.push('lazy loading and detailed originals first');
  await page.getByLabel('에셋 표현 스타일').selectOption('detailed');
  assert.match(await panel.getByRole('status').first().textContent(), /검색 결과 46종/);
  await page.getByLabel('조립부품 포함', {exact:false}).check();
  assert.match(await panel.getByRole('status').first().textContent(), /검색 결과 47종/);
  await page.getByLabel('조립부품 포함', {exact:false}).uncheck();
  steps.push('component inclusion changes 46 to 47 without losing originals');
  const previewButton=panel.locator('article button[aria-label]').first();
  await previewButton.click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await previewButton.evaluate(el=>el===document.activeElement),true,'modal must restore focus');
  steps.push('actual enlarged preview Escape and focus return');
  const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('link',{name:'GLB 받기'}).first().click()]);
  const downloadPath=await download.path();
  const bytes=await readFile(downloadPath);
  const downloaded=detailed.find(a=>`${a.id}.glb`===download.suggestedFilename());
  assert.ok(downloaded);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),downloaded.sha256);
  steps.push('actual same-origin GLB download verified by SHA-256');
  await panel.getByRole('button',{name:'표면 재질',exact:true}).click();
  assert.match(await panel.getByRole('status').first().textContent(),/검색 결과 30종/);
  await panel.locator('article button[aria-label]').first().click();
  await page.evaluate(()=>{window.__cc0Accept=false;});
  await page.getByRole('dialog').getByRole('button',{name:'캔버스에 삽입',exact:true}).click();
  await page.waitForFunction(()=>window.__cc0Used!==null);
  assert.equal(await page.getByRole('dialog').count(),1,'failed canvas callback must retain preview');
  await page.getByRole('dialog').getByRole('status').filter({hasText:'캔버스에 삽입하지 못했습니다.'}).waitFor();
  steps.push('failed insertion feedback is visible inside the active modal');
  await page.evaluate(()=>{window.__cc0Accept=true;window.__cc0Used=null;});
  await page.getByRole('dialog').getByRole('button',{name:'캔버스에 삽입',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const inserted = await page.evaluate(async()=>{
    const a=window.__cc0Used;
    const blob=await (await fetch(a.dataUrl)).blob();
    const bitmap=await createImageBitmap(blob);
    const result={width:bitmap.width,height:bitmap.height,license:a.rights.licenseId};
    bitmap.close();return result;
  });
  assert.ok(inserted.width>=1024&&inserted.height>=1024);
  assert.equal(inserted.license,'CC0-1.0');
  steps.push('real WebP hash/decode/dimensions/rights insertion; success-only dismissal');
  await verifyCc0InsertionCancellation(page, panel, manifest, steps);
  await page.getByLabel('에셋 검색',{exact:true}).fill('존재하지않는검수문자열');
  assert.equal(await panel.locator('article').count(),0);
  await page.getByLabel('에셋 검색',{exact:true}).fill('목재');
  assert.ok(await panel.locator('article').count()>0);
  steps.push('Korean search and empty state');
  await page.getByLabel('에셋 검색',{exact:true}).fill('');
  await page.screenshot({path:path.join(output,'curated-materials-desktop.png'),fullPage:true});
  await page.pdf({path:path.join(output,'curated-ui-desktop.pdf'),width:'1000px',height:'1400px',printBackground:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'curated-materials-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  assert.equal(overflow,false,'mobile library must not create horizontal overflow');
  assert.deepEqual(errors,[]);
  steps.push('390px mobile layout without horizontal overflow or page errors');
  console.log('CC0 UI VERIFIED',JSON.stringify({steps,inserted,errors}));
  await writeFile(path.join(output,'ui-verification.json'),JSON.stringify({scope:'actual-component-with-bundled-files',steps,inserted,errors,fullEditorRoundTrip:false},null,2)+'\n');
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([htmlName,entryName].map(name=>unlink(path.join(root,name))));
}
