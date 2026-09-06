import assert from 'node:assert/strict';

/** Delay a real bundled asset request. The fetch observer never replaces response bytes:
 * it only proves the component aborts the actual request before it can alter the canvas.
 */
export async function verifyCc0InsertionCancellation(page, panel, manifest, steps) { // NOSONAR javascript:S3776
  const assetId = await panel.locator('article').first().getAttribute('data-cc0-asset-id');
  const asset = manifest.assets.find(item => item.id === assetId);
  assert.ok(asset && asset.kind === 'surface-texture');
  const assetUrl = new URL('/assets/studio/cc0-20260906/' + asset.path, page.url()).href;
  await page.evaluate(url => {
    const originalFetch = window.fetch;
    window.__cc0OriginalFetch = originalFetch;
    window.__cc0AssetAbortCount = 0;
    window.fetch = function (input, init) {
      const requested = new URL(input instanceof Request ? input.url : String(input), document.baseURI).href;
      if (requested === url && init?.signal) {
        init.signal.addEventListener('abort', () => { window.__cc0AssetAbortCount += 1; }, {once: true});
      }
      return originalFetch.call(this, input, init);
    };
  }, assetUrl);
  try {
    for (const mode of ['collapse', 'close-button', 'escape']) {
      await page.evaluate(() => {
        window.__cc0Used = null;
        window.__cc0UseCount = 0;
        window.__cc0Accept = true;
        window.__cc0AssetAbortCount = 0;
      });
      const started = Promise.withResolvers();
      const released = Promise.withResolvers();
      const handled = Promise.withResolvers();
      let intercepted = false;
      const holdAsset = async route => {
        if (route.request().resourceType() !== 'fetch') {
          await route.continue();
          return;
        }
        intercepted = true;
        started.resolve();
        await released.promise;
        try {
          await route.continue();
        } catch {
          // The component deliberately aborted this intercepted request while it was paused.
        } finally {
          handled.resolve();
        }
      };
      await page.route(assetUrl, holdAsset);
      let timer;
      try {
        if (mode !== 'collapse') {
          await panel.locator('article button[aria-label]').first().click();
          await page.getByRole('dialog').waitFor();
        }
        const scope = mode === 'collapse' ? panel : page.getByRole('dialog');
        await scope.getByRole('button', {name: '캔버스에 삽입', exact: true}).first().click();
        await Promise.race([
          started.promise,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(mode + ': insertion did not request bundled bytes')), 10_000);
          }),
        ]);
        clearTimeout(timer);
        if (mode === 'collapse') await panel.locator('summary').click();
        else if (mode === 'close-button') await page.getByRole('dialog').getByRole('button', {name: '닫기', exact: true}).click();
        else await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.__cc0AssetAbortCount > 0, null, {timeout: 10_000});
        assert.equal(await page.evaluate(() => window.__cc0UseCount), 0, mode + ': cancelled request called canvas insertion');
      } finally {
        clearTimeout(timer);
        released.resolve();
        if (intercepted) await handled.promise;
        await page.unroute(assetUrl, holdAsset);
      }
      assert.equal(await page.evaluate(() => window.__cc0Used), null, mode + ': stale completion changed the canvas');
      if (mode === 'collapse') await panel.locator('summary').click();
      await page.getByRole('dialog').waitFor({state: 'hidden'});
      const retry = panel.getByRole('button', {name: '캔버스에 삽입', exact: true}).first();
      await retry.waitFor();
      assert.equal(await retry.isEnabled(), true, mode + ': cancellation left insertion disabled');
      await retry.click();
      await page.waitForFunction(() => window.__cc0Used !== null);
      assert.equal(await page.evaluate(() => window.__cc0Used.id), 'cc0:' + assetId);
      assert.equal(await page.evaluate(() => window.__cc0UseCount), 1, mode + ': retry inserted more than once');
      steps.push(mode + ': abort pending real asset download, prevent stale insertion, retry once without reload');
    }
  } finally {
    await page.evaluate(() => {
      window.fetch = window.__cc0OriginalFetch;
      delete window.__cc0OriginalFetch;
      delete window.__cc0AssetAbortCount;
    });
  }
}
