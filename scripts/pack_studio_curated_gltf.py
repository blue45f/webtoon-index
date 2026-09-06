#!/usr/bin/env python3
"""Lossless dependency packaging for selected external-buffer glTF 2.0 models.

No image upscaling, mesh simplification, topology edits or artistic approval.
Python 3.11+. One external geometry buffer; PNG/JPEG images only. Outputs GLB,
source/texture hashes and geometry preservation proof. Final glTF validation and
ToonStudio import/save/export still have to be performed separately.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct
from urllib.parse import unquote, urlsplit

MAX_FILE = 64 * 1024 * 1024
MAX_IMAGES = 512


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dependency(base: Path, uri: object) -> Path:
    if not isinstance(uri, str) or not uri or '\\' in uri or any(ord(c) < 32 for c in uri):
        raise ValueError('invalid dependency URI')
    parsed = urlsplit(uri)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('only relative local files are supported')
    name = unquote(parsed.path, errors='strict')
    if (not name or '\\' in name or ':' in name or any(ord(c) < 32 for c in name)
            or Path(name).is_absolute() or any(x in {'', '.', '..'} for x in name.split('/'))):
        raise ValueError('path traversal or unsafe decoded URI')
    root = base.resolve(strict=True)
    result = root / name
    for part in [result, *result.parents]:
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('symlink dependency')
    result = result.resolve(strict=True)
    if not result.is_relative_to(root) or not result.is_file() or result.stat().st_size > MAX_FILE:
        raise ValueError('dependency outside budget or root')
    return result


def pack(source: Path, destination: Path) -> dict: # NOSONAR python:S3776
    if source.is_symlink() or source.suffix.lower() != '.gltf' or source.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('invalid source')
    if destination.suffix.lower() != '.glb':
        raise ValueError('destination must be a GLB file')
    if destination.exists() or destination.is_symlink():
        raise ValueError('destination already exists')
    raw = source.read_bytes()
    doc = json.loads(raw)
    if (not isinstance(doc, dict) or not isinstance(doc.get('asset'), dict)
            or doc['asset'].get('version') != '2.0'):
        raise ValueError('requires glTF 2.0')
    buffers = doc.get('buffers', [])
    if not isinstance(buffers, list) or len(buffers) != 1 or not isinstance(buffers[0], dict):
        raise ValueError('requires one external buffer')
    geometry_file = dependency(source.parent, buffers[0].get('uri'))
    if geometry_file.suffix.lower() != '.bin':
        raise ValueError('requires geometry .bin')
    geometry = geometry_file.read_bytes()
    if type(buffers[0].get('byteLength')) is not int or buffers[0]['byteLength'] != len(geometry) or not geometry:
        raise ValueError('geometry length mismatch')
    views = doc.setdefault('bufferViews', [])
    if not isinstance(views, list):
        raise ValueError('invalid buffer views')
    for v in views:
        if not isinstance(v, dict):
            raise ValueError('invalid geometry view')
        offset, length = v.get('byteOffset', 0), v.get('byteLength')
        if (type(v.get('buffer')) is not int or v['buffer'] != 0
                or type(offset) is not int or type(length) is not int
                or offset < 0 or length <= 0 or offset + length > len(geometry)):
            raise ValueError('invalid geometry view')
    images = doc.get('images', [])
    if not isinstance(images, list) or len(images) > MAX_IMAGES:
        raise ValueError('invalid images or image count exceeds budget')
    original_views = copy.deepcopy(views)
    original_semantics = {k: copy.deepcopy(v) for k, v in doc.items() if k not in {'buffers', 'bufferViews', 'images'}}
    data = bytearray(geometry)
    texture_report = []
    shared_images: dict[str, int] = {}
    for image in images:
        if not isinstance(image, dict) or 'bufferView' in image:
            raise ValueError('requires unambiguous external images')
        uri = image.get('uri')
        image_file = dependency(source.parent, uri)
        if image_file.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
            raise ValueError('unsupported image format')
        texture = image_file.read_bytes()
        if texture.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif texture.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        else:
            mime = None
        if mime is None:
            raise ValueError("invalid image signature")
        key = digest(texture)
        if key not in shared_images:
            data.extend(b'\0' * (-len(data) % 4))
            if len(data) + len(texture) > MAX_FILE:
                raise ValueError('GLB exceeds budget')
            shared_images[key] = len(views)
            views.append({'buffer': 0, 'byteOffset': len(data), 'byteLength': len(texture)})
            data.extend(texture)
        del image['uri']
        image['bufferView'] = shared_images[key]
        image['mimeType'] = mime
        texture_report.append({'uri': uri, 'sha256': key, 'bytes': len(texture)})
    del buffers[0]['uri']
    buffers[0]['byteLength'] = len(data)
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    js += b' ' * (-len(js) % 4)
    data.extend(b'\0' * (-len(data) % 4))
    length = 28 + len(js) + len(data)
    if length > MAX_FILE:
        raise ValueError('GLB exceeds budget')
    result = struct.pack('<4sII', b'glTF', 2, length) + struct.pack('<II', len(js), 0x4e4f534a) + js + struct.pack('<II', len(data), 0x004e4942) + data
    check = json.loads(js)
    if bytes(data[:len(geometry)]) != geometry or check['bufferViews'][:len(original_views)] != original_views:
        raise ValueError('geometry was changed')
    if {k: v for k, v in check.items() if k not in {'buffers', 'bufferViews', 'images'}} != original_semantics:
        raise ValueError('model semantics were changed')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as f:
        f.write(result)
    return {'source': source.name, 'output': destination.name, 'sourceSha256': digest(raw), 'geometrySha256': digest(geometry), 'glbSha256': digest(result), 'bytes': len(result), 'textures': texture_report, 'geometryBytesPreserved': True, 'sceneAndMaterialMetadataPreserved': True, 'externalDependencies': 0, 'status': 'packaged-not-art-approved'}


def pack_with_provenance(source: Path, destination: Path) -> dict:
    provenance = destination.with_suffix('.provenance.json')
    if provenance.exists() or provenance.is_symlink():
        raise ValueError('provenance destination already exists')
    report = pack(source, destination)
    # Exclusive creation also rejects a file or symlink introduced after the preflight.
    # A concurrent collision reports failure; it never overwrites someone else's file.
    with provenance.open('x', encoding='utf-8') as f:
        f.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    report = pack_with_provenance(args.source, args.destination)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
