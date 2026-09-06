import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ASSETS, createAsset } from '../apps/web/public/assets/reference-rebuild/generator.mjs';
const out = path.resolve(process.argv[2] ?? 'reference-rebuild-output');
await mkdir(out, { recursive: true });
const rows = [];
for (const asset of ASSETS) {
 const bytes = createAsset(asset.id);
 const fileName = `${asset.id}.glb`;
 await writeFile(path.join(out,fileName),bytes);
 rows.push({ ...asset, fileName, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceOriginalAvailable: false });
}
await writeFile(path.join(out,'manifest.json'), JSON.stringify({version:1,kind:'preview-reference-rebuild',assets:rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({id,byteSize,sha256})=>({id,byteSize,sha256})),null,2));
