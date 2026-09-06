#!/usr/bin/env python3
"""Reproducible, bounded preparation/staging for the September CC0 delivery.

Only repository-owned built-ins are changed. Existing asset/package IDs continue to
resolve; no user database, OPFS library, uploaded file or saved work is deleted.
"""
from __future__ import annotations
import argparse
import hashlib
import html
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/web/public/assets/studio/cc0-20260906'
DELIVERY_REPORT_FILENAME = 'delivery-report.json'


def replace_once(path: Path, before: str, after: str) -> None:
    text = path.read_text(encoding='utf-8')
    if after in text:
        return
    if text.count(before) != 1:
        raise ValueError(f'Expected exactly one reviewed source anchor in {path.name}: {before[:90]}')
    path.write_text(text.replace(before, after, 1), encoding='utf-8')


def prepare() -> None:
    acquire = ROOT / 'scripts/studio_asset_delivery.py'
    replace_once(acquire,
        "    ('kenney-survival', 'survival-kit', 'outdoor-prop'),\n]",
        "    ('kenney-survival', 'survival-kit', 'outdoor-prop'),\n"
        "    ('kenney-building', 'building-kit', 'architecture'),\n"
        "    ('kenney-watercraft', 'watercraft-kit', 'outdoor-prop'),\n"
        "    ('kenney-suburban', 'city-kit-suburban', 'architecture'),\n"
        "    ('kenney-roads', 'city-kit-roads', 'architecture'),\n]")
    replace_once(acquire,
        '                for source in candidates:\n                    try:',
        '                for source in candidates:\n                    target = None\n                    try:')
    replace_once(acquire,
        "                        if 'target' in locals() and target.exists(): target.unlink()",
        "                        if target is not None and target.exists(): target.unlink()")
    replace_once(acquire,
        "                        target = folder / (slug(source.stem) + '.glb')\n                        if source.suffix == '.glb':",
        "                        target = folder / (slug(source.stem) + '.glb')\n"
        "                        if target.exists():\n"
        "                            suffix = digest(source_rel.encode('utf-8'))[:10]\n"
        "                            identifier += '-' + suffix\n"
        "                            target = folder / (slug(source.stem) + '-' + suffix + '.glb')\n"
        "                        if source.suffix == '.glb':")
    replace_once(acquire,
        "                        if min(w, h) < minimum: raise ValueError('below-intended-role-resolution')",
        "                        if ((pack['category'] == 'effect-mask' and min(w, h) < minimum)\n"
        "                            or (pack['category'] == 'surface-material' and (max(w, h) < 2048 or min(w, h) < 1024))):\n"
        "                            raise ValueError('below-intended-role-resolution')")
    renderer = ROOT / 'scripts/render_studio_asset_delivery.mjs'
    replace_once(renderer,
        "const threeRoot = path.dirname(requireTools.resolve('three/package.json'));",
        "const threeRoot = path.dirname(path.dirname(requireTools.resolve('three')));")
    replace_once(renderer,
        'await page.waitForFunction(() => window.rendererReady, {timeout:30000});',
        'await page.waitForFunction(() => window.rendererReady, undefined, {timeout:30000});')

    panel = ROOT / 'apps/web/src/domains/creator/StudioAssetMenuPanel.tsx'
    replace_once(panel,
        'const studioOriginalAssetMarketplaceLoader = createStudioIntentLazyLoader(() =>',
        'const studioCc0AssetLibraryLoader = createStudioIntentLazyLoader(() =>\n'
        '  import("./StudioCc0AssetLibraryPanel").then((module) => ({\n'
        '    default: module.StudioCc0AssetLibraryPanel,\n'
        '  }))\n);\n\n'
        'const studioOriginalAssetMarketplaceLoader = createStudioIntentLazyLoader(() =>')
    replace_once(panel,
        'const LazyStudioOriginalAssetMarketplacePanel = lazyRetry(',
        'const LazyStudioCc0AssetLibraryPanel = lazyRetry(\n'
        '  studioCc0AssetLibraryLoader.load,\n'
        '  "StudioCc0AssetLibraryPanel"\n);\n\n'
        'const LazyStudioOriginalAssetMarketplacePanel = lazyRetry(')
    replace_once(panel,
        'function preloadStudioAssetMarketplacePanels(): void {\n',
        'function preloadStudioAssetMarketplacePanels(): void {\n  studioCc0AssetLibraryLoader.preload();\n')
    replace_once(panel,
        '        <LazyStudioOriginalAssetMarketplacePanel onUseAsset={onUseLocalAsset} />',
        '        <LazyStudioCc0AssetLibraryPanel onUseAsset={onUseLocalAsset} />\n'
        '        <LazyStudioOriginalAssetMarketplacePanel onUseAsset={onUseLocalAsset} />')

    originals = ROOT / 'apps/web/src/domains/creator/studio-original-free-asset-packs.ts'
    replace_once(originals,
        'export const STUDIO_ORIGINAL_FREE_ASSET_PACKAGES: readonly StudioOriginalFreeAssetPackage[] =',
        'const ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES: readonly StudioOriginalFreeAssetPackage[] =')
    replace_once(originals,
        'export const STUDIO_ORIGINAL_FREE_ASSETS: readonly StudioOriginalFreeAsset[] =',
        '/** Blockout-only backgrounds are retained for old works, not advertised as finished art. */\n'
        'export const STUDIO_RETIRED_ORIGINAL_FREE_ASSETS = Object.freeze([...EVERYDAY_ASSETS]);\n\n'
        'export const STUDIO_ORIGINAL_FREE_ASSET_PACKAGES: readonly StudioOriginalFreeAssetPackage[] =\n'
        '  Object.freeze(ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.filter((pkg) => pkg.id !== EVERYDAY_PACKAGE_ID));\n\n'
        'const ALL_STUDIO_ORIGINAL_FREE_ASSETS = Object.freeze(\n'
        '  ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.flatMap((pkg) => pkg.includedItems)\n);\n\n'
        'export const STUDIO_ORIGINAL_FREE_ASSETS: readonly StudioOriginalFreeAsset[] =')
    replace_once(originals,
        'return STUDIO_ORIGINAL_FREE_ASSETS.find((asset) => asset.id === assetId) ?? null;',
        'return ALL_STUDIO_ORIGINAL_FREE_ASSETS.find((asset) => asset.id === assetId) ?? null;')
    replace_once(originals,
        'return STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.find((pkg) => pkg.id === packageId) ?? null;',
        'return ALL_STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.find((pkg) => pkg.id === packageId) ?? null;')
    print('Prepared native catalog integration and compatibility-preserving blockout retirement.', flush=True)


def stage(output: Path) -> None: # NOSONAR python:S3776
    from PIL import Image, ImageDraw
    manifest = json.loads((output / 'manifest.json').read_text())
    report = json.loads((output / DELIVERY_REPORT_FILENAME).read_text())
    assets = manifest['assets']
    if not assets or len(assets) > 2400:
        raise ValueError('Invalid delivery count')
    ids = set()
    paths = set()
    for asset in assets:
        relative = Path(asset['path'])
        asset_file = (output / relative).resolve()
        if not asset_file.is_relative_to(output.resolve()) or not str(relative).startswith('assets/'):
            raise ValueError('Unsafe staged path')
        if asset['id'] in ids or str(relative) in paths:
            raise ValueError('Duplicate delivery identity')
        ids.add(asset['id'])
        paths.add(str(relative))
        raw = asset_file.read_bytes()
        if len(raw) != asset['bytes'] or hashlib.sha256(raw).hexdigest() != asset['sha256']:
            raise ValueError('Delivered file does not match its manifest: ' + asset['id'])
        if asset['kind'] == 'model':
            if asset.get('browserRenderVerified') is not True or len(asset.get('sourceBounds', [])) != 3:
                raise ValueError('A model lacks actual render evidence')
            preview = (output / asset['previewPath']).resolve()
            if not preview.is_relative_to(output.resolve()) or not preview.is_file():
                raise ValueError('Missing actual model preview')
    # Purely presentational sheets are not counted as extra asset originals.
    for number, start in enumerate(range(0, len(assets), 48), 1):
        sheet = Image.new('RGB', (1600, 1200), '#f4f4f6')
        draw = ImageDraw.Draw(sheet)
        for index, asset in enumerate(assets[start:start + 48]):
            x, y = (index % 8) * 200, (index // 8) * 200
            with Image.open(output / asset.get('previewPath', asset['path'])) as image:
                image = image.convert('RGBA')
                image.thumbnail((186, 162))
                sheet.paste(image, (x + (200 - image.width) // 2, y + 4), image)
            draw.text((x + 6, y + 170), asset['name'][:28], fill='#19191e')
            draw.text((x + 6, y + 185), asset['category'][:26], fill='#5c5c66')
        sheet.save(output / f'review-sheet-{number:02d}.jpg', quality=93)
    cards = []
    for asset in assets:
        title = html.escape(asset['name'])
        source = html.escape(asset.get('previewPath', asset['path']), quote=True)
        link = html.escape(asset['path'], quote=True)
        category = html.escape(asset['category'])
        cards.append(f'<article><a href="{link}" download><img src="{source}" loading="lazy" alt="{title}"><strong>{title}</strong></a><small>{category} · CC0</small></article>')
    page = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ToonSpectrum CC0 originals</title><style>body{font:16px system-ui;margin:24px;background:#f7f7f8;color:#17171b}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}article{border:1px solid #ddd;background:white;border-radius:12px;padding:12px}img{width:100%;height:150px;object-fit:contain}a{color:inherit;text-decoration:none}strong,small{display:block;padding-top:8px}small{color:#555}input{font:inherit;padding:12px;width:min(90%,600px);margin:12px 0 24px}article[hidden]{display:none}</style><h1>CC0 원본 에셋 라이브러리</h1><p>' + str(len(assets)) + '종의 실제 파일입니다. 3D 모델은 Three.js에서 3방향 렌더링을 검사했습니다. 로우폴리 스타일이며, 미술 품질 승인·스튜디오 저장/복원 검증과는 구분됩니다.</p><label>검색 <input id="q" type="search" placeholder="furniture, food, tree, road"></label><main>' + ''.join(cards) + '</main><script>document.getElementById("q").addEventListener("input",event=>{const terms=event.target.value.toLowerCase().split(/\s+/).filter(Boolean);document.querySelectorAll("article").forEach(card=>{card.hidden=!terms.every(term=>card.textContent.toLowerCase().includes(term));});});</script></html>'
    (output / 'index.html').write_text(page, encoding='utf-8')
    report['repositoryBundledOriginals'] = len(assets)
    report['productionPublished'] = 0
    report['retiredStarterBackgrounds'] = 8
    report['retirementMethod'] = 'hidden-from-new-selection; legacy-id-and-package-resolution-preserved'
    report['verifiedDeliveryFiles'] = len(assets)
    (output / DELIVERY_REPORT_FILENAME).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    PUBLIC.mkdir(parents=True, exist_ok=True)
    # This generated subtree contains no user data. Copy without deleting other repository assets.
    for name in ('assets', 'previews'):
        shutil.copytree(output / name, PUBLIC / name, dirs_exist_ok=True)
    for name in ('manifest.json', DELIVERY_REPORT_FILENAME, 'index.html', 'README.md', 'excluded-and-variants.json', 'browser-render-evidence.json'):
        shutil.copyfile(output / name, PUBLIC / name)
    for review_sheet in output.glob('review-sheet-*.jpg'):
        shutil.copyfile(review_sheet, PUBLIC / review_sheet.name)
    audit = ROOT / 'data/studio-assets/delivery-20260906'
    audit.mkdir(parents=True, exist_ok=True)
    for name in (DELIVERY_REPORT_FILENAME, 'excluded-and-variants.json', 'existing-asset-audit.json'):
        shutil.copyfile(output / name, audit / name)
    print('FINAL STAGED DELIVERY', json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--stage', type=Path)
    args = parser.parse_args()
    if args.prepare:
        prepare()
    if args.stage:
        stage(args.stage.resolve())
    if not args.prepare and not args.stage:
        parser.error('Pass --prepare or --stage OUTPUT')
