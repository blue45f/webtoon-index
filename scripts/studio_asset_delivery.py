#!/usr/bin/env python3
"""Acquire actual CC0 files, not thumbnail URLs or quantity-only catalog records.

Runs outside apps/web/public/ by default. A technical pass is NOT a visual/runtime approval.
No user library, production data, payment, credentials, or existing asset is changed.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import html
import io
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
from urllib.parse import unquote, urljoin, urlsplit
import urllib.request

from PIL import Image, ImageDraw, ImageStat
from acquire_studio_asset_pilot import download, extract_assets, SourceRedirects, checked_url
from normalize_studio_asset_glb import normalize, read_glb, write_glb
from studio_asset_curation import safe_file

ROOT = Path(__file__).resolve().parents[1]
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
EXTRA_PACKS = [
    ('kenney-nature', 'nature-kit', 'nature'),
    ('kenney-city-commercial', 'city-kit-commercial', 'architecture'),
    ('kenney-survival', 'survival-kit', 'outdoor-prop'),
    ('kenney-building', 'building-kit', 'architecture'),
    ('kenney-watercraft', 'watercraft-kit', 'outdoor-prop'),
    ('kenney-suburban', 'city-kit-suburban', 'architecture'),
    ('kenney-roads', 'city-kit-roads', 'architecture'),
]
LIMIT_IMAGE_PIXELS = 32 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = LIMIT_IMAGE_PIXELS


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def slug(value: str) -> str:
    result = re.sub(r'[^a-z0-9]+', '-', re.sub(r'([a-z])([A-Z])', r'\1-\2', value).lower()).strip('-')
    if not result or len(result) > 160:
        raise ValueError('invalid asset name')
    return result


def license_record(provider: str, source_url: str) -> dict:
    return {'id': 'CC0-1.0', 'url': CC0, 'provider': provider, 'sourceUrl': source_url,
            'commercialUse': True, 'redistributionAllowed': True, 'checkedOn': '2026-09-06'}


def direct_kenney_pack(identifier: str, page: str, category: str) -> dict:
    page_url = 'https://kenney.nl/assets/' + page
    request = urllib.request.Request(page_url, headers={'User-Agent': 'ToonSpectrum-AssetDelivery/1.0'})
    with urllib.request.build_opener(SourceRedirects()).open(request, timeout=30) as response:
        checked_url(response.url)
        document = response.read(2_000_001)
    if len(document) > 2_000_000:
        raise ValueError('source page exceeds budget')
    text = document.decode('utf-8')
    if 'creativecommons.org/publicdomain/zero' not in text:
        raise ValueError('source no longer declares CC0')
    urls = sorted(set(html.unescape(urljoin(page_url, value)) for value in re.findall(r'href=[\"\']([^\"\']+\.zip(?:\?[^\"\']*)?)[\"\']', text)))
    urls = [u for u in urls if urlsplit(u).hostname == 'kenney.nl' and '/media/pages/assets/' + page + '/' in u]
    if len(urls) != 1:
        raise ValueError('expected exactly one explicit official download')
    checked_url(urls[0])
    return {'id': identifier, 'provider': 'Kenney', 'pageUrl': page_url, 'downloadUrl': urls[0],
            'license': 'CC0-1.0', 'category': category, 'method': 'explicit-free-download'}


def gltf_to_glb(source: Path, destination: Path) -> None: # NOSONAR python:S3776
    if source.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('glTF JSON too large')
    doc = json.loads(source.read_text())
    if doc.get('asset', {}).get('version') != '2.0':
        raise ValueError('not glTF 2.0')
    data = bytearray()
    offsets = []
    for buffer in doc.get('buffers', []):
        uri = buffer.get('uri')
        if not isinstance(uri, str) or urlsplit(uri).scheme or urlsplit(uri).netloc:
            raise ValueError('glTF requires local file buffers')
        path = safe_file(source.parent, unquote(uri))
        if path.stat().st_size > 32 * 1024 * 1024:
            raise ValueError('glTF buffer exceeds budget')
        raw = path.read_bytes()
        if len(raw) != buffer.get('byteLength'):
            raise ValueError('glTF buffer length mismatch')
        data.extend(b'\0' * (-len(data) % 4))
        offsets.append(len(data))
        data.extend(raw)
        if len(data) > 48 * 1024 * 1024:
            raise ValueError('glTF buffer total exceeds budget')
    for view in doc.get('bufferViews', []):
        index = view.get('buffer')
        offset, length = view.get('byteOffset', 0), view.get('byteLength')
        if type(index) is not int or not 0 <= index < len(offsets):
            raise ValueError('invalid buffer index')
        if type(offset) is not int or type(length) is not int or min(offset, length) < 0 or offset + length > doc['buffers'][index]['byteLength']:
            raise ValueError('invalid buffer view bounds')
        view['byteOffset'] = offsets[index] + offset
        view['buffer'] = 0
    doc['buffers'] = [{'byteLength': len(data)}]
    # Keep intermediate beside source so the existing safe image-embedding resolver retains its root.
    intermediate = source.with_name(source.stem + '.delivery-intermediate.glb')
    if intermediate.exists():
        raise ValueError('intermediate collision')
    try:
        intermediate.write_bytes(write_glb(doc, bytes(data)))
        normalize(intermediate, destination)
    finally:
        intermediate.unlink(missing_ok=True)


def geometry_key(doc: dict, binary: bytes) -> str: # NOSONAR python:S3776
    h = hashlib.sha256()
    component_sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    counts = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    for mesh in doc.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            h.update(str(primitive.get('mode', 4)).encode())
            references = [('POSITION', primitive.get('attributes', {}).get('POSITION')),
                          ('NORMAL', primitive.get('attributes', {}).get('NORMAL')),
                          ('indices', primitive.get('indices'))]
            for name, index in references:
                if index is None:
                    if name == 'POSITION': raise ValueError('mesh missing positions')
                    continue
                accessor = doc['accessors'][index]
                if 'sparse' in accessor: raise ValueError('sparse accessor needs dedicated review')
                view = doc['bufferViews'][accessor['bufferView']]
                unit = component_sizes[accessor['componentType']] * counts[accessor['type']]
                stride = view.get('byteStride', unit)
                count = accessor['count']
                local_start = accessor.get('byteOffset', 0)
                if type(count) is not int or not 0 < count < 2_000_000 or stride < unit or local_start < 0 or local_start + (count - 1) * stride + unit > view['byteLength']:
                    raise ValueError('accessor outside buffer view')
                start = view.get('byteOffset', 0) + local_start
                h.update(json.dumps([name, count, unit]).encode())
                for i in range(count):
                    raw = binary[start + i * stride:start + i * stride + unit]
                    if name == 'POSITION' and accessor['componentType'] == 5126:
                        if not all(math.isfinite(v) for v in struct.unpack('<' + 'f' * counts[accessor['type']], raw)):
                            raise ValueError('non-finite geometry')
                    h.update(raw)
    nodes = [{k: v for k, v in n.items() if k in {'mesh', 'children', 'translation', 'rotation', 'scale', 'matrix', 'skin'}} for n in doc.get('nodes', [])]
    h.update(json.dumps(nodes, sort_keys=True, separators=(',', ':')).encode())
    return h.hexdigest()


def audit_existing(output: Path) -> None: # NOSONAR python:S3776
    files = sorted(p for folder in ('apps/web/public/assets/3d', 'apps/web/public/assets/studio') for p in (ROOT / folder).rglob('*') if p.is_file())
    records, seen = [], {}
    for path in files:
        row = {'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'findings': []}
        raw = path.read_bytes()
        row['sha256'] = digest(raw)
        if row['sha256'] in seen: row['findings'].append('byte-identical-to:' + seen[row['sha256']])
        else: seen[row['sha256']] = row['path']
        try:
            if path.suffix.lower() in {'.webp', '.png', '.jpg', '.jpeg'}:
                with Image.open(io.BytesIO(raw)) as image:
                    image.load()
                    row['dimensions'] = list(image.size)
                    if min(image.size) < 256: row['findings'].append('small-raster-review-intended-role')
                    if image.mode == 'RGBA' and image.getchannel('A').getbbox() is None: row['findings'].append('empty-alpha')
            elif path.suffix.lower() == '.glb':
                doc, binary = read_glb(raw)
                if any('uri' in image for image in doc.get('images', [])): row['findings'].append('external-texture-dependency')
                row['meshes'] = len(doc.get('meshes', []))
        except Exception as error:
            row['findings'].append('decode-error:' + str(error)[:180])
        records.append(row)
    save_json(output / 'existing-asset-audit.json', records)
    print('EXISTING ASSET FINDINGS', json.dumps([r for r in records if r['findings']], ensure_ascii=False), flush=True)
    print('ACTUAL BUNDLED MODEL CATALOG REFERENCES', flush=True)
    found = 0
    for path in sorted((ROOT / 'apps/web/src/domains/creator').rglob('*.ts*')):
        if '.test.' in path.name: continue
        text = path.read_text()
        lines = text.splitlines()
        indexes = [i for i, line in enumerate(lines) if '/assets/3d/' in line]
        if indexes:
            print(str(path.relative_to(ROOT)), [(i + 1, lines[i][:200]) for i in indexes[:8]], flush=True)
            found += 1
            if found >= 16: break


def write_gallery(output: Path, assets: list[dict]) -> None:
    images = [a for a in assets if a['kind'] != 'model']
    for page_no, start in enumerate(range(0, len(images), 48), 1):
        batch = images[start:start + 48]
        sheet = Image.new('RGB', (1200, 900), '#eeeeee')
        draw = ImageDraw.Draw(sheet)
        for i, asset in enumerate(batch):
            x, y = (i % 8) * 150, (i // 8) * 150
            with Image.open(output / asset['path']) as image:
                image = image.convert('RGBA')
                image.thumbnail((138, 115))
                sheet.paste(image, (x + (150 - image.width) // 2, y + 4), image)
            draw.text((x + 5, y + 122), asset['name'][:23], fill='#151515')
        sheet.save(output / f'contact-sheet-{page_no:02d}.jpg', quality=92)
    cards = []
    for asset in assets:
        safe_path, title = html.escape(asset['path'], quote=True), html.escape(asset['name'])
        if asset['kind'] == 'model':
            preview = '<div class="model">3D · GLB</div>'
        else:
            preview = f'<img loading="lazy" src="{safe_path}" alt="{title}">'
        cards.append(f'<article data-kind="{asset["kind"]}"><a href="{safe_path}" download>{preview}<strong>{title}</strong></a><small>{html.escape(asset["category"])} · CC0</small></article>')
    document = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ToonSpectrum CC0 asset delivery</title><style>body{font:16px system-ui;margin:24px;background:#f7f7f8;color:#17171b}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}article{border:1px solid #ddd;background:white;border-radius:12px;padding:12px}img,.model{width:100%;height:150px;object-fit:contain}.model{display:grid;place-items:center;background:#f2f2f4}a{color:inherit;text-decoration:none}strong,small{display:block;padding-top:8px}small{color:#555}input{font:inherit;padding:12px;width:min(90%,600px);margin:12px 0 24px}</style><h1>CC0 원본 에셋</h1><p>기술 검사 통과 파일. 3D 미리보기·스튜디오 실사용 검증과 예술 품질 승인은 별도입니다. 다운로드하여 스튜디오의 파일 가져오기로 사용할 수 있습니다.</p><label>에셋 검색 <input id="q" type="search" placeholder="furniture, food, nature, wood"></label><main>' + ''.join(cards) + '</main><script>document.getElementById("q").addEventListener("input",event=>{const terms=event.target.value.toLowerCase().split(/\\s+/).filter(Boolean);document.querySelectorAll("article").forEach(card=>{card.hidden=!terms.every(term=>card.textContent.toLowerCase().includes(term));});});</script></html>'
    (output / 'index.html').write_text(document, encoding='utf-8')


def acquire_delivery(output: Path) -> dict: # NOSONAR python:S3776
    output.mkdir(parents=True, exist_ok=True)
    audit_existing(output)
    plan = json.loads((ROOT / 'data/studio-assets/acquisition-plan.json').read_text())
    packs = [dict(p) for p in plan['pilot']]
    packs[0]['category'], packs[1]['category'], packs[2]['category'] = 'furniture', 'food', 'effect-mask'
    for pack in packs[3:]: pack['category'] = 'surface-material'
    errors = []
    for identifier, page, category in EXTRA_PACKS:
        try: packs.append(direct_kenney_pack(identifier, page, category))
        except Exception as error: errors.append({'pack': identifier, 'error': str(error)})
        time.sleep(1)
    budget = {'downloaded': 0, 'expanded': 0}
    assets, variants, rejected, pack_reports = [], [], [], []
    seen_geometry, seen_pixels = {}, {}
    with tempfile.TemporaryDirectory(prefix='studio-delivery-') as tmp:
        scratch = Path(tmp)
        for pack in packs:
            pack_id = pack['id']
            try:
                root = scratch / pack_id
                root.mkdir()
                archive = root / 'source.zip'
                receipt = download(pack['downloadUrl'], archive, budget)
                unpacked = root / 'source'
                records = extract_assets(archive, unpacked, budget)
                folder = output / 'assets' / pack_id
                folder.mkdir(parents=True)
                rights = license_record(pack['provider'], pack['pageUrl'])
                save_json(folder / 'SOURCE.json', {'license': rights, 'download': receipt})
                for i, license_path in enumerate(sorted(unpacked.rglob('*'))):
                    if license_path.is_file() and license_path.suffix.lower() == '.txt' and 'license' in license_path.name.lower():
                        if license_path.stat().st_size < 64 * 1024:
                            shutil.copyfile(license_path, folder / f'LICENSE-{i}.txt')
                candidates = sorted(unpacked.rglob('*.glb'))
                glb_names = {p.stem for p in candidates}
                candidates += [p for p in sorted(unpacked.rglob('*.gltf')) if p.stem not in glb_names]
                added = 0
                for source in candidates:
                    target = None
                    try:
                        source_rel = source.relative_to(unpacked).as_posix()
                        if any(t in source.stem.lower() for t in ['lowdetail', 'low-detail']):
                            rejected.append({'source': pack_id + '/' + source_rel, 'reason': 'low-detail-alternative-not-in-default-delivery'})
                            continue
                        identifier = pack_id + '-' + slug(source.stem)
                        target = folder / (slug(source.stem) + '.glb')
                        if target.exists():
                            suffix = digest(source_rel.encode('utf-8'))[:10]
                            identifier += '-' + suffix
                            target = folder / (slug(source.stem) + '-' + suffix + '.glb')
                        if source.suffix == '.glb': normalize(source, target)
                        else: gltf_to_glb(source, target)
                        raw = target.read_bytes()
                        doc, binary = read_glb(raw)
                        if not doc.get('meshes') or not doc.get('scenes'):
                            raise ValueError('empty model or scene')
                        if any('uri' in image for image in doc.get('images', [])):
                            raise ValueError('unresolved texture')
                        key = geometry_key(doc, binary)
                        if key in seen_geometry:
                            variants.append({'source': pack_id + '/' + source_rel, 'canonicalId': seen_geometry[key], 'reason': 'same-geometry-format-or-color-variant'})
                            target.unlink()
                            continue
                        seen_geometry[key] = identifier
                        assets.append({'id': identifier, 'name': re.sub(r'([a-z])([A-Z])', r'\1 \2', source.stem).replace('_', ' '),
                                       'kind': 'model', 'category': pack['category'], 'style': 'stylized-low-poly',
                                       'path': target.relative_to(output).as_posix(), 'bytes': len(raw), 'sha256': digest(raw),
                                       'geometrySha256': key, 'sourcePath': source_rel, 'license': rights,
                                       'technicalChecks': ['GLB-2.0', 'self-contained-textures', 'finite-positions', 'accessor-bounds', 'geometry-deduplicated'],
                                       'visualReviewed': False, 'studioRuntimeVerified': False})
                        added += 1
                    except Exception as error:
                        if target is not None and target.exists(): target.unlink()
                        rejected.append({'source': pack_id + '/' + str(source.relative_to(unpacked)), 'reason': str(error)})
                image_candidates = []
                if pack['category'] == 'effect-mask':
                    image_candidates = [p for p in sorted(unpacked.rglob('*.png')) if 'transparent' in str(p).lower()]
                    if not image_candidates: image_candidates = sorted(unpacked.rglob('*.png'))
                elif pack['category'] == 'surface-material':
                    image_candidates = [p for p in sorted(unpacked.rglob('*')) if p.suffix.lower() in {'.jpg', '.png'} and re.search(r'_Color\.', p.name, re.I)]
                for source in image_candidates:
                    try:
                        with Image.open(source) as image:
                            image.load()
                            image = image.convert('RGBA')
                        w, h = image.size
                        minimum = 512 if pack['category'] == 'effect-mask' else 2048
                        if ((pack['category'] == 'effect-mask' and min(w, h) < minimum)
                            or (pack['category'] == 'surface-material' and (max(w, h) < 2048 or min(w, h) < 1024))):
                            raise ValueError('below-intended-role-resolution')
                        if pack['category'] == 'effect-mask' and image.getchannel('A').getextrema()[0] == 255:
                            raise ValueError('opaque-effect-background')
                        if image.getchannel('A').getbbox() is None: raise ValueError('empty-alpha')
                        key = digest(struct.pack('<II', w, h) + image.tobytes())
                        identifier = pack_id + '-' + slug(source.stem)
                        if key in seen_pixels:
                            variants.append({'source': pack_id + '/' + str(source.relative_to(unpacked)), 'canonicalId': seen_pixels[key], 'reason': 'identical-decoded-pixels'})
                            continue
                        seen_pixels[key] = identifier
                        target = folder / (slug(source.stem) + '.webp')
                        image.save(target, 'WEBP', lossless=True, method=6)
                        raw = target.read_bytes()
                        assets.append({'id': identifier, 'name': source.stem.replace('_', ' '), 'kind': 'effect-mask' if pack['category'] == 'effect-mask' else 'surface-texture',
                                       'category': pack['category'], 'path': target.relative_to(output).as_posix(),
                                       'width': w, 'height': h, 'maxRecommendedDisplayWidth': w,
                                       'bytes': len(raw), 'sha256': digest(raw), 'sourceSha256': digest(source.read_bytes()),
                                       'license': rights, 'technicalChecks': ['decoded', 'native-resolution', 'pixel-deduplicated'],
                                       'visualReviewed': False, 'studioRuntimeVerified': False})
                        added += 1
                    except Exception as error: rejected.append({'source': pack_id + '/' + str(source.relative_to(unpacked)), 'reason': str(error)})
                # PBR maps belong to the same material, never counted as separate originals.
                if pack['category'] == 'surface-material':
                    for source in sorted(unpacked.rglob('*')):
                        if source.is_file() and source.suffix.lower() in {'.jpg', '.png'} and not re.search(r'_Color\.', source.name, re.I):
                            shutil.copyfile(source, folder / source.name)
                pack_reports.append({'id': pack_id, 'rawFiles': len(records), 'deliveredOriginals': added, 'download': receipt})
                print('DELIVERY', pack_id, 'originals', added, flush=True)
            except Exception as error:
                errors.append({'pack': pack_id, 'error': str(error)})
                print('PACK ERROR', pack_id, str(error), flush=True)
            time.sleep(1)
    report = {'schema': 'toonspectrum.asset-delivery.v1', 'sourceRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'deliveredOriginals': len(assets), 'byKind': dict(Counter(a['kind'] for a in assets)),
              'byCategory': dict(Counter(a['category'] for a in assets)), 'deduplicatedVariants': len(variants),
              'excludedCandidates': len(rejected), 'approvedVisualOriginals': 0, 'productionPublished': 0,
              'downloadedBytes': budget['downloaded'], 'packs': pack_reports, 'errors': errors,
              'notice': 'Actual delivered files passed the listed technical checks. These are not claims of visual approval, complete 3D validation, Studio runtime verification, or production publication.'}
    save_json(output / 'manifest.json', {'schema': report['schema'], 'assets': assets})
    save_json(output / 'delivery-report.json', report)
    save_json(output / 'excluded-and-variants.json', {'excluded': rejected, 'variants': variants})
    write_gallery(output, assets)
    (output / 'README.md').write_text('# ToonSpectrum CC0 asset delivery\n\nActual original files are in assets/. Open index.html for search and downloads.\n\nGLB files have embedded textures and can be imported with Studio 3D model import. Surface images can be used as material base-color textures; companion PBR maps are not separate assets. Effect masks are small 512px-or-better native masks, not full-panel art.\n\nAll source and license records travel with files. No fonts, paid assets, user uploads or user works are included. Technical checks, exclusions and duplicates are recorded. Artistic review and Studio runtime round-trip remain separate gates.\n', encoding='utf-8')
    print('DELIVERY SUMMARY', json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT / 'public') or output == ROOT:
        parser.error('use a staging directory, not public or the repository root')
    report = acquire_delivery(output)
    return 0 if report['deliveredOriginals'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
