#!/usr/bin/env python3
"""Apply the actual 57-page visual triage plus four reviewed PBR contact sheets.

No user data, original GLB/image URL or legacy ID is deleted. Only the new-selection
manifest is curated. A contact-sheet review is explicitly NOT a rigging/pose,
close-up topology, all-angle art approval or Studio save/restore assertion.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/web/public/assets/studio/cc0-20260906'
REVIEW = ROOT / 'docs/reports/asset-visual-review-20260906'
REVIEW_SHA = '0c99edac76dc728f8ba3a58b887a3ce35bcfab7b'
QUARANTINE_ID = 'kenney-food-glass-wine'
REVIEW_LEVEL = 'contact-sheet-visual-triage'
MANIFEST_FILENAME = 'manifest.json'
PBR_REVIEW_FILENAME = 'pbr-candidates-review.pdf'
CURATION_SUMMARY_FILENAME = 'curation-summary.json'
DELIVERY_REPORT_FILENAME = 'delivery-report.json'
KOREAN_TERMS = {'wood':'목재','fabric':'직물','brick':'벽돌','metal':'금속','plaster':'회벽',
 'asphalt':'아스팔트','concrete':'콘크리트','stone':'석재','leather':'가죽','tile':'타일',
 'paper':'벽지','ground':'지면','chair':'의자','table':'테이블','potted':'화분',
 'lamp':'조명','sofa':'소파','book':'책','bowl':'그릇','barrel':'통','bench':'벤치 · 작업 소품'}


def save(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def local_file(root: Path, relative: str) -> Path:
    if not re.fullmatch(r'(?:assets|previews)/[A-Za-z0-9_./-]+', relative):
        raise ValueError('Unexpected asset-relative path')
    if any(part in {'', '.', '..'} for part in relative.split('/')):
        raise ValueError('Unsafe path component')
    asset_file = (root / relative).resolve()
    if not asset_file.is_relative_to(root.resolve()) or not asset_file.is_file() or asset_file.is_symlink():
        raise ValueError('Missing or unsafe file: '+relative)
    return asset_file


def is_component(identifier: str) -> bool:
    patterns = [r'^kenney-building-', r'^kenney-furniture-(?:floor|wall|panelling)(?:-|$)',
      r'^kenney-nature-(?:cliff|ground|path|platform|bridge-center|bridge-side)(?:-|$)',
      r'^kenney-survival-(?:floor|metal-panel|structure|tent-frame)(?:-|$)',
      r'^kenney-suburban-(?:driveway|fence|path)(?:-|$)',
      r'^kenney-roads-(?:bridge-pillar|electricity-wires|road|tile|sign-object|traffic-light-object)(?:-|$)',
      r'^kenney-watercraft-(?:arrow|gate)(?:-|$)']
    return identifier == 'polyhaven-modular-street-seating' or any(re.search(p, identifier) for p in patterns)


def rotation_match(original: Image.Image, candidate: Image.Image) -> int | None:
    original = original.convert('RGBA')
    candidate = candidate.convert('RGBA')
    for degrees, operation in [(90, Image.Transpose.ROTATE_90), (180, Image.Transpose.ROTATE_180), (270, Image.Transpose.ROTATE_270)]:
        rotated = original.transpose(operation)
        if rotated.size == candidate.size and rotated.tobytes() == candidate.tobytes():
            return degrees
    return None


def validate_asset(asset: dict, root: Path) -> None:
    raw = local_file(root, asset['path']).read_bytes()
    if len(raw) != asset['bytes'] or hashlib.sha256(raw).hexdigest() != asset['sha256']:
        raise ValueError('Original integrity mismatch: '+asset['id'])
    rights = asset['license']
    if rights['id'] != 'CC0-1.0' or rights['commercialUse'] is not True or rights['redistributionAllowed'] is not True:
        raise ValueError('Unreviewed license')
    if asset['kind'] == 'model':
        if asset.get('browserRenderVerified') is not True:
            raise ValueError('Missing browser render verification')
        local_file(root, asset['previewPath'])
    else:
        with Image.open(local_file(root, asset['path'])) as image:
            image.load()
            if image.size != (asset['width'], asset['height']):
                raise ValueError('Decoded image dimensions mismatch')


def apply(candidates: Path, output: Path) -> dict: # NOSONAR python:S3776
    source_manifest = json.loads((PUBLIC/MANIFEST_FILENAME).read_text())
    source_assets = source_manifest['assets']
    # This operation is locked to the reviewed baseline; rerunning on a different
    # catalog requires a new review rather than silently inheriting old approval.
    if len(source_assets) != 1097 or not any(a['id'] == QUARANTINE_ID for a in source_assets):
        raise ValueError('The reviewed 1097-item baseline has changed')
    new_manifest = json.loads((candidates/MANIFEST_FILENAME).read_text())
    additions = new_manifest['assets']
    if len(additions) != 47 or Counter(a['kind'] for a in additions) != {'model':17,'surface-texture':30}:
        raise ValueError('Candidate artifact differs from the 47 visually reviewed originals')
    if hashlib.sha256((candidates/PBR_REVIEW_FILENAME).read_bytes()).hexdigest() != 'd1aa27db80fd73da9536f38afa8d2e1ac4c9c69a20b5eed2aa86c643ffa0158c':
        raise ValueError('The viewed PBR contact sheet has changed')
    index = json.loads((REVIEW/'review-index.json').read_text())
    if index['totalVisualItems'] != 1351 or index['pages'] != 57:
        raise ValueError('The original visual index has changed')
    source_ids = {a['id'] for a in source_assets}
    if len(source_ids) != 1097 or any(a['id'] in source_ids or not a['id'].startswith('polyhaven-') for a in additions):
        raise ValueError('Duplicate or unexpected candidate identity')
    for asset in source_assets: validate_asset(asset, PUBLIC)
    for asset in additions: validate_asset(asset, candidates)

    # Only retire rotated masks after exact decoded RGBA equality, never a name,
    # blur score, similar thumbnail, or lossy perceptual threshold alone.
    masks = [a for a in source_assets if a['kind']=='effect-mask']
    canonical_masks = [a for a in masks if not a['id'].endswith('-rotated')]
    variants = []
    for variant in masks:
        if not variant['id'].endswith('-rotated'): continue
        base_id = variant['id'].removesuffix('-rotated')
        preferred = sorted(canonical_masks, key=lambda asset, base=base_id: asset['id'] != base)
        with Image.open(local_file(PUBLIC, variant['path'])) as candidate:
            for canonical in preferred:
                with Image.open(local_file(PUBLIC, canonical['path'])) as original:
                    degrees = rotation_match(original, candidate)
                if degrees is not None:
                    variants.append({'id':variant['id'],'canonicalId':canonical['id'],
                      'rotationDegrees':degrees,'reason':'exact-decoded-RGBA-rotation-duplicate',
                      'sourcePath':variant['path'],'originalFilePreserved':True})
                    break
    retired_ids = {v['id'] for v in variants} | {QUARANTINE_ID}
    retained = [dict(a) for a in source_assets if a['id'] not in retired_ids]
    review_by_id = {item['id']:item for item in index['items']}
    for asset in retained:
        evidence = review_by_id[asset['id']]
        asset.update({'visualReviewed':True,'visualReviewLevel':REVIEW_LEVEL,
          'visualReviewSource':f'{REVIEW_SHA}:review-{(evidence["page"]-1)//12+1:02d}.pdf#page={(evidence["page"]-1)%12+1}',
          'role':'assembly-component' if is_component(asset['id']) else 'finished-asset',
          'curationStatus':'selected-after-visual-triage'})
    for position, candidate in enumerate(additions):
        asset = dict(candidate)
        asset['originalName'] = asset['name']
        term = 'leather' if asset['id']=='polyhaven-leather-white' else asset.get('selectionTerm','')
        label = '식기 세트' if asset['id']=='polyhaven-tea-set-01' else KOREAN_TERMS.get(term,'')
        if label: asset['name'] = f'{asset["name"]} · {label}'
        asset.update({'visualReviewed':True,'visualReviewLevel':REVIEW_LEVEL,
          'visualReviewSource':f'artifact:9975049171#page={position//12+1}',
          'role':'assembly-component' if is_component(asset['id']) else 'finished-asset',
          'curationStatus':'selected-after-visual-triage'})
        folder = local_file(candidates, asset['path']).parent
        for file in folder.rglob('*'):
            if file.is_file() and (file.is_symlink() or file.suffix.lower() not in {'.glb','.webp','.png','.jpg','.jpeg','.json','.txt'}):
                raise ValueError('Unexpected file in approved asset pack: '+str(file))
        destination = PUBLIC / folder.relative_to(candidates)
        if destination.exists(): raise ValueError('Candidate output collision')
        shutil.copytree(folder, destination)
        if asset.get('previewPath'):
            target = PUBLIC/asset['previewPath']; target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists(): raise ValueError('Preview identity collision')
            shutil.copyfile(local_file(candidates, asset['previewPath']), target)
        retained.append(asset)

    decisions = []
    legacy_shells = []
    for item in index['items']:
        row = dict(item)
        row.update({'visuallyReviewed':True,'reviewLevel':REVIEW_LEVEL,
                    'reviewedOn':'2026-09-06','allAnglesArtisticallyApproved':False})
        if item['id'] == QUARANTINE_ID:
            row.update({'decision':'quarantine-from-new-selection','reason':'Dense dark stippling across the glass surface, stem and base in actual sheet 10 item 228.'})
        elif item['id'] in retired_ids:
            row.update({'decision':'retire-rotation-duplicate','reason':'Verified exact RGBA rotation equality; original URL preserved.'})
        elif '/outfits/' in item['sourcePath'] and item['sourcePath'].endswith('.glb'):
            row.update({'decision':'legacy-reference-not-wearable','reason':'Rigid sphere/ellipsoid shell, not a selectable wearable. Current measured/skinned wardrobe runtime is separate and must not be removed.'})
            legacy_shells.append(item['sourcePath'])
        elif is_component(item['id']):
            row.update({'decision':'assembly-component','reason':'Useful construction element, separated from finished assets rather than deleted.'})
        else:
            row.update({'decision':'retain-at-reviewed-scale','reason':'No blocking silhouette/texture defect identified at the contact-sheet review scale; not a close-up or rigging approval.'})
        decisions.append(row)
    if len(legacy_shells) != 18: raise ValueError('Legacy outfit audit coverage changed')
    report = {'schema':'toonspectrum.visual-curation.v1','reviewedOn':'2026-09-06',
      'baselineVisualItemsReviewed':1351,'baselineContactPagesViewed':57,
      'newOriginalsVisuallyReviewed':47,'newContactPagesViewed':4,
      'newModels':17,'newSurfaceMaterials':30,'quarantinedNewSelectionIds':[QUARANTINE_ID],
      'exactRotationDuplicatesRetired':len(variants),'preservedLegacyNonWearableReferences':len(legacy_shells),
      'activeOriginals':len(retained),'byKind':dict(Counter(a['kind'] for a in retained)),
      'byCategory':dict(Counter(a['category'] for a in retained)),
      'assemblyComponents':sum(is_component(a['id']) for a in retained),
      'defaultFinishedSelection':sum(not is_component(a['id']) for a in retained),
      'sourceFilesDeleted':0,'userDataChanged':False,'studioSaveRestoreRoundTrip':'not-claimed',
      'remainingScope':['all-angle artistic inspection','enlarged topology/texture inspection for every model','dynamic brush/pose/clothing variants','Studio save/restore across every asset'],
      'evidence':{'baselineRevision':REVIEW_SHA,'pbrArtifact':9975051972,'pbrReviewPdf':9975049171},
      'notice':'All listed contact-sheet images were viewed. Technical rendering, contact-sheet triage, full artistic approval and production deployment are different claims.'}
    output.mkdir(parents=True,exist_ok=True)
    for directory in (output, REVIEW):
        save(directory/CURATION_SUMMARY_FILENAME,report)
        save(directory/'visual-decisions.json',{'items':decisions,'newOriginals':[a for a in retained if a['id'].startswith('polyhaven-')]})
        save(directory/'retired-rotation-variants.json',{'variants':variants})
    save(PUBLIC/MANIFEST_FILENAME,{'schema':'toonspectrum.asset-delivery.v1','assets':retained})
    save(PUBLIC/CURATION_SUMMARY_FILENAME,report)
    save(PUBLIC/'retired-assets.json',{'quarantined':[{'id':QUARANTINE_ID,'reason':'visual-render-artifact','originalFilePreserved':True}],'rotationVariants':variants})
    shutil.copyfile(candidates/PBR_REVIEW_FILENAME,REVIEW/PBR_REVIEW_FILENAME)
    shutil.copyfile(candidates/'browser-render-evidence.json',REVIEW/'pbr-browser-render-evidence.json')
    shutil.copyfile(candidates/DELIVERY_REPORT_FILENAME,REVIEW/'pbr-acquisition-report.json')
    old_report=json.loads((PUBLIC/DELIVERY_REPORT_FILENAME).read_text())
    old_report['initialDeliveryOriginals']=old_report['deliveredOriginals']
    old_report.update({'deliveredOriginals':len(retained),'byKind':report['byKind'],'byCategory':report['byCategory'],
      'activeCatalogCuration':CURATION_SUMMARY_FILENAME,'repositoryBundledOriginals':len(retained),'verifiedDeliveryFiles':len(retained),'productionPublished':0})
    save(PUBLIC/DELIVERY_REPORT_FILENAME,old_report)
    # Replace the stale standalone gallery so it cannot continue offering retired IDs.
    cards=[]
    for a in sorted(retained,key=lambda x:not x['id'].startswith('polyhaven-')):
        image=html.escape(a.get('previewPath',a['path']),quote=True); link=html.escape(a['path'],quote=True)
        title=html.escape(a['name']); component=is_component(a['id'])
        cards.append(f'<article data-component="{str(component).lower()}"><a href="{link}" download><img src="{image}" alt="{title}" loading="lazy"><strong>{title}</strong></a><small>{html.escape(a["category"])} · CC0'+(' · assembly component' if component else '')+'</small></article>')
    gallery='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>시각 검수 CC0 원본</title><style>body{font:16px system-ui;margin:24px;background:#f5f5f7}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}article{padding:12px;background:white;border:1px solid #ccc;border-radius:10px}article[hidden]{display:none}img{width:100%;height:170px;object-fit:contain;background:#d5d6dc}strong,small{display:block;margin-top:8px}a{color:inherit;text-decoration:none}input{margin:12px;padding:12px}</style><h1>시각 검수 CC0 원본</h1><p>디테일 모델·재질 우선. 기존 작품의 원본 파일은 보존합니다. 접촉 시트 검수는 모든 장면·포즈의 승인과 구분됩니다.</p><label>검색<input id="q" type="search"></label><label><input id="parts" type="checkbox">조립부품 포함</label><main>'+''.join(cards)+'</main><script>function filter(){let q=document.getElementById("q").value.toLowerCase();let parts=document.getElementById("parts").checked;for(let a of document.querySelectorAll("article"))a.hidden=(!parts&&a.dataset.component==="true")||!a.textContent.toLowerCase().includes(q)}document.getElementById("q").addEventListener("input",filter);document.getElementById("parts").addEventListener("change",filter);filter()</script></html>'
    (PUBLIC/'index.html').write_text(gallery,encoding='utf-8')
    print('VISUAL CURATION RESULT',json.dumps(report,ensure_ascii=False),flush=True)
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidates',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    apply(args.candidates.resolve(),args.output.resolve())
