#!/usr/bin/env python3
"""Bounded acquisition of official CC0 PBR originals into a review-only directory.

Uses Poly Haven's public API with its required identifiable User-Agent. No live
API requests are made by Studio clients. Attribution is retained per asset.
Technical and browser checks never imply artistic approval.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import time
from urllib.parse import urlsplit, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler

from PIL import Image
from studio_asset_delivery import gltf_to_glb, geometry_key
from normalize_studio_asset_glb import read_glb

ROOT = Path(__file__).resolve().parents[1]
UA = 'ToonStudio-AssetCuration/1.0 (github.com/blue45f/toonspectrum; CC0 provenance retained)'
HOSTS = {'api.polyhaven.com', 'dl.polyhaven.org'}
MAX_FILE = 40 * 1024 * 1024
MAX_TOTAL = 640 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 32 * 1024 * 1024


def checked_url(url: str) -> str:
    value = urlsplit(url)
    if value.scheme != 'https' or value.hostname not in HOSTS or value.username or value.password or value.port:
        raise ValueError('Download outside the explicit HTTPS source allowlist')
    return url


class SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        checked_url(new_url)
        return super().redirect_request(request, fp, code, message, headers, new_url)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def safe_path(root: Path, relative: str) -> Path:
    value = PurePosixPath(unquote(relative))
    if value.is_absolute() or '\\' in relative or any(p in {'', '.', '..'} for p in value.parts) or urlsplit(relative).scheme:
        raise ValueError('Unsafe source dependency path')
    target = (root / value).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Dependency escapes its asset directory')
    return target


class Fetcher:
    def __init__(self) -> None:
        self.total = 0
        self.last_api = 0.0
        self.opener = build_opener(SafeRedirects())

    def bytes(self, url: str, limit: int) -> bytes:
        checked_url(url)
        request = Request(url, headers={'User-Agent': UA})
        with self.opener.open(request, timeout=45) as response:
            checked_url(response.url)
            if int(response.headers.get('Content-Length', '0')) > limit:
                raise ValueError('Response exceeds per-file budget')
            data = response.read(limit + 1)
        if len(data) > limit or self.total + len(data) > MAX_TOTAL:
            raise ValueError('Acquisition byte budget exhausted')
        self.total += len(data)
        return data

    def api(self, route: str) -> dict:
        time.sleep(max(0.0, 0.8 - (time.monotonic() - self.last_api)))
        self.last_api = time.monotonic()
        value = json.loads(self.bytes('https://api.polyhaven.com/' + route, 8 * 1024 * 1024))
        if not isinstance(value, dict):
            raise ValueError('Unexpected official API schema')
        return value

    def file(self, spec: dict, path: Path) -> dict:
        size = spec.get('size')
        if type(size) is not int or not 0 < size <= MAX_FILE:
            raise ValueError('Source file size is not within the reviewed budget')
        data = self.bytes(spec['url'], size)
        if len(data) != size:
            raise ValueError('Source byte length does not match the official API')
        expected_md5 = spec.get('md5')
        if expected_md5 and hashlib.md5(data, usedforsecurity=False).hexdigest() != expected_md5:
            raise ValueError('Source integrity checksum mismatch')
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            raise ValueError('Will not overwrite an existing staged file')
        path.write_bytes(data)
        return {'url': spec['url'], 'bytes': len(data), 'sha256': sha256(data), 'sourceMd5': expected_md5}


def file_entries(value: object, parents: tuple[str, ...] = ()):
    if not isinstance(value, dict):
        return
    if isinstance(value.get('url'), str):
        yield parents, value
        return
    for key, item in value.items():
        yield from file_entries(item, parents + (key,))


def choose_file(files: dict, role: str) -> tuple[tuple[str, ...], dict]:
    candidates = []
    for keys, spec in file_entries(files):
        tags = '/'.join(keys).lower()
        extension = Path(unquote(urlsplit(spec['url']).path)).suffix.lower()
        if '2k' not in [p.lower() for p in keys]:
            continue
        if role == 'model' and extension != '.gltf':
            continue
        if role == 'color' and (extension not in {'.jpg', '.png'} or not any(t in tags for t in ['diff', 'albedo', 'basecolor', 'base_color'])):
            continue
        if type(spec.get('size')) is not int or not 0 < spec['size'] <= MAX_FILE:
            continue
        candidates.append((keys, spec))
    if not candidates:
        raise ValueError('No native 2K source in an explicitly supported format')
    return min(candidates, key=lambda pair: pair[1]['size'])


def select_assets(metadata: dict) -> list[tuple[str, str, str, dict]]: # NOSONAR python:S3776
    # Select by intended use, not a fabricated quality score. Pixel review follows.
    result, seen = [], set()
    groups = [
        ('model', 2, ('chair', 'table', 'potted', 'lamp', 'sofa', 'book', 'bowl', 'barrel', 'bench'), 2),
        ('surface-texture', 1, ('wood', 'fabric', 'brick', 'metal', 'plaster', 'asphalt', 'concrete', 'stone', 'leather', 'tile', 'paper', 'ground'), 3),
    ]
    for kind, asset_type, terms, limit in groups:
        ordered = sorted(((key, value) for key, value in metadata.items() if isinstance(value, dict) and value.get('type') == asset_type),
                         key=lambda pair: pair[1].get('download_count', 0), reverse=True)
        for term in terms:
            count = 0
            for key, value in ordered:
                if key in seen or not re.fullmatch(r'[a-z0-9_-]{1,100}', key):
                    continue
                if term not in (key + ' ' + value.get('name', '') + ' ' + str(value.get('category', ''))).lower():
                    continue
                if kind == 'model' and value.get('polycount', 0) > 250_000:
                    continue
                seen.add(key)
                result.append((key, kind, term, value))
                count += 1
                if count == limit:
                    break
    return result


def acquire(output: Path) -> dict: # NOSONAR python:S3776
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use an empty review directory; existing assets are never overwritten')
    output.mkdir(parents=True, exist_ok=True)
    fetch = Fetcher()
    metadata = fetch.api('assets')
    selected = select_assets(metadata)
    write_json(output / 'acquisition-plan.json', [{'id': k, 'kind': kind, 'selectionTerm': term, 'metadata': meta} for k, kind, term, meta in selected])
    assets, errors, receipts, seen = [], [], {}, set()
    for source_id, kind, term, source_meta in selected:
        identifier = 'polyhaven-' + source_id.replace('_', '-')
        folder = output / 'assets' / identifier
        try:
            files = fetch.api('files/' + source_id)
            license_info = {'id': 'CC0-1.0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/',
                            'provider': 'Poly Haven', 'sourceUrl': 'https://polyhaven.com/a/' + source_id,
                            'commercialUse': True, 'redistributionAllowed': True, 'checkedOn': '2026-09-06'}
            common = {'id': identifier, 'name': source_meta.get('name', source_id), 'kind': kind,
                      'category': 'pbr-detailed-prop' if kind == 'model' else 'surface-material',
                      'style': 'pbr-detailed', 'selectionTerm': term, 'license': license_info,
                      'visualReviewed': False, 'studioRuntimeVerified': False, 'curationStatus': 'candidate'}
            local_receipts = []
            if kind == 'model':
                keys, main = choose_file(files, 'model')
                dependencies = main.get('include', {})
                if not isinstance(dependencies, dict) or len(dependencies) > 40:
                    raise ValueError('Unsupported model dependency schema')
                estimate = main['size'] + sum(v.get('size', MAX_FILE) for v in dependencies.values() if isinstance(v, dict))
                if estimate > 64 * 1024 * 1024:
                    raise ValueError('Complete model exceeds the import budget')
                source_root = output / '_source' / identifier
                file_name = Path(unquote(urlsplit(main['url']).path)).name
                source = safe_path(source_root, file_name)
                local_receipts.append(fetch.file(main, source))
                for relative, spec in dependencies.items():
                    if not isinstance(spec, dict) or 'url' not in spec:
                        raise ValueError('Unsupported source dependency record')
                    local_receipts.append(fetch.file(spec, safe_path(source_root, relative)))
                target = folder / (source_id + '.glb')
                target.parent.mkdir(parents=True, exist_ok=True)
                gltf_to_glb(source, target)
                raw = target.read_bytes()
                doc, binary = read_glb(raw)
                if not doc.get('meshes') or not doc.get('images') or any('uri' in image for image in doc.get('images', [])):
                    raise ValueError('Model needs actual embedded PBR textures')
                if len(raw) > 64 * 1024 * 1024:
                    raise ValueError('Normalized GLB exceeds the Studio import budget')
                key = geometry_key(doc, binary)
                if key in seen:
                    target.unlink()
                    raise ValueError('Same geometry as a previously admitted original')
                seen.add(key)
                row = {**common, 'path': target.relative_to(output).as_posix(), 'bytes': len(raw), 'sha256': sha256(raw),
                       'geometrySha256': key, 'textureCount': len(doc['images']),
                       'technicalChecks': ['official-API-checksum', 'self-contained-GLB', 'finite-positions', 'accessor-bounds', 'native-2K-source']}
            else:
                keys, color = choose_file(files, 'color')
                source = output / '_source' / identifier / Path(unquote(urlsplit(color['url']).path)).name
                local_receipts.append(fetch.file(color, source))
                with Image.open(source) as original:
                    original.load()
                    image = original.convert('RGB')
                if max(image.size) < 2048 or min(image.size) < 1024:
                    raise ValueError('Surface source is below its native 2K requirement')
                key = sha256(image.tobytes())
                if key in seen:
                    raise ValueError('Identical decoded color texture')
                seen.add(key)
                target = folder / (source_id + '.webp')
                target.parent.mkdir(parents=True, exist_ok=True)
                image.save(target, 'WEBP', quality=95, method=6)
                raw = target.read_bytes()
                maps = []
                for role in ['rough', 'nor_gl', 'ao', 'disp']:
                    choices = [(p, spec) for p, spec in file_entries(files)
                               if '2k' in [s.lower() for s in p] and role in '/'.join(p).lower()
                               and Path(unquote(urlsplit(spec['url']).path)).suffix.lower() in {'.jpg', '.png'}
                               and type(spec.get('size')) is int and 0 < spec['size'] < 12 * 1024 * 1024]
                    if choices:
                        _, spec = min(choices, key=lambda pair: pair[1]['size'])
                        map_path = folder / Path(unquote(urlsplit(spec['url']).path)).name
                        if map_path.exists():
                            continue
                        receipt = fetch.file(spec, map_path)
                        with Image.open(map_path) as companion:
                            companion.load()
                            if companion.size != image.size:
                                raise ValueError('PBR companion map dimension mismatch')
                        local_receipts.append(receipt)
                        maps.append({'role': role, 'path': map_path.relative_to(output).as_posix(), 'sha256': receipt['sha256'], 'bytes': receipt['bytes']})
                row = {**common, 'path': target.relative_to(output).as_posix(), 'bytes': len(raw), 'sha256': sha256(raw),
                       'width': image.width, 'height': image.height, 'sourceSha256': sha256(source.read_bytes()), 'pbrMaps': maps,
                       'technicalChecks': ['official-API-checksum', 'native-2K-source', 'decoded-pixel-deduplication', 'PBR-map-dimensions']}
            write_json(folder / 'SOURCE.json', {'license': license_info, 'metadata': source_meta, 'files': local_receipts})
            receipts[identifier] = local_receipts
            assets.append(row)
            print('PBR ACQUIRED', identifier, kind, row['bytes'], flush=True)
        except Exception as error:
            errors.append({'id': identifier, 'kind': kind, 'reason': str(error)[:600]})
            print('PBR EXCLUDED', identifier, str(error)[:300], flush=True)
        if fetch.total >= MAX_TOTAL - MAX_FILE:
            break
    report = {'schema': 'toonspectrum.asset-delivery.v1', 'selectedCandidates': len(selected),
              'deliveredOriginals': len(assets), 'byKind': dict(Counter(a['kind'] for a in assets)),
              'byCategory': dict(Counter(a['category'] for a in assets)), 'downloadedBytes': fetch.total,
              'errors': errors, 'approvedVisualOriginals': 0, 'productionPublished': 0,
              'notice': 'Review candidates only; not artistically approved or automatically added to the active Studio catalog.'}
    write_json(output / 'manifest.json', {'schema': report['schema'], 'assets': assets})
    write_json(output / 'delivery-report.json', report)
    write_json(output / 'source-receipts.json', receipts)
    print('PBR ACQUISITION SUMMARY', json.dumps(report, ensure_ascii=False), flush=True)
    if not assets:
        raise ValueError('No original passed the acquisition gates')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination == ROOT or destination.is_relative_to(ROOT / 'public'):
        parser.error('Use an empty staging directory outside apps/web/public/')
    acquire(destination)
