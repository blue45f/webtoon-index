import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import test from 'node:test';
import { ASSETS, createAsset } from '../apps/web/public/assets/reference-rebuild/generator.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
function parse(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.readUInt32LE(0), 0x46546c67);
  assert.equal(b.readUInt32LE(4), 2);
  assert.equal(b.readUInt32LE(8), b.length);
  const jsonLength = b.readUInt32LE(12);
  assert.equal(jsonLength % 4, 0);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a);
  const doc = JSON.parse(b.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength;
  assert.equal(b.readUInt32LE(binOffset + 4), 0x004e4942);
  assert.equal(binOffset + 8 + b.readUInt32LE(binOffset), b.length);
  const bin = b.subarray(binOffset + 8);
  assert.ok(bin.length - doc.buffers[0].byteLength >= 0 && bin.length - doc.buffers[0].byteLength <= 3);
  const read = index => {
    const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    assert.ok(components && a.count > 0 && [5125, 5126].includes(a.componentType));
    assert.equal(view.buffer, 0);
    assert.equal((view.byteOffset ?? 0) % 4, 0);
    assert.equal(view.byteLength, a.count * components * 4);
    assert.ok(view.byteOffset + view.byteLength <= doc.buffers[0].byteLength);
    const values = [];
    for (let i = 0; i < a.count * components; i++) values.push(a.componentType === 5125
      ? bin.readUInt32LE(view.byteOffset + i * 4) : bin.readFloatLE(view.byteOffset + i * 4));
    assert.ok(values.every(Number.isFinite));
    for (let c = 0; c < components; c++) {
      let min = Infinity, max = -Infinity;
      for (let i = c; i < values.length; i += components) { min = Math.min(min, values[i]); max = Math.max(max, values[i]); }
      assert.equal(a.min[c], min); assert.equal(a.max[c], max);
    }
    return values;
  };
  return { doc, bin, read };
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}

const generated = new Map(ASSETS.map(a => [a.id, createAsset(a.id)]));
test('six unique files represent two scenes and four reusable modules', () => {
  assert.equal(ASSETS.length, 6);
  assert.equal(new Set(ASSETS.map(a => a.id)).size, 6);
  assert.equal(ASSETS.filter(a => a.kind === '환경').length, 2);
  assert.equal(new Set([...generated.values()].map(hash)).size, 6);
});
for (const asset of ASSETS) {
  test(`${asset.id}: deterministic GLB, provenance and bounded payload`, () => {
    const bytes = generated.get(asset.id);
    assert.equal(hash(bytes), hash(createAsset(asset.id)));
    assert.ok(bytes.length < 8 * 1024 * 1024);
    const { doc } = parse(bytes);
    assert.equal(doc.asset.version, '2.0');
    assert.equal(doc.extras.provenance.sourceOriginalAvailable, false);
    assert.equal(doc.extras.provenance.referenceUrl, asset.reference);
    assert.match(doc.asset.copyright, /not declared CC0/u);
    assert.equal(doc.extras.units, 'metres');
    assert.equal(doc.scenes[0].nodes.length, doc.nodes.length);
    for (const node of doc.nodes) {
      assert.ok(node.name.length > 0 && doc.meshes[node.mesh]);
      assert.ok(node.translation.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...node.rotation) - 1) < 1e-7);
    }
  });
  test(`${asset.id}: complete indexed meshes, finite bounds, outward normals and UVs`, () => { // NOSONAR javascript:S3776
    const { doc, read } = parse(generated.get(asset.id));
    for (let i = 0; i < doc.accessors.length; i++) read(i);
    for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
      const p = read(primitive.attributes.POSITION), n = read(primitive.attributes.NORMAL);
      const uv = read(primitive.attributes.TEXCOORD_0), indices = read(primitive.indices);
      assert.equal(n.length, p.length); assert.equal(uv.length, p.length / 3 * 2);
      assert.equal(indices.length % 3, 0);
      assert.ok(indices.every(i => i >= 0 && i < p.length / 3));
      for (let i = 0; i < n.length; i += 3) assert.ok(Math.abs(Math.hypot(n[i], n[i+1], n[i+2]) - 1) < 1e-5);
      for (let i = 0; i < indices.length; i += 3) {
        const [a,b,c] = indices.slice(i,i+3).map(j => j*3);
        const u = [p[b]-p[a], p[b+1]-p[a+1], p[b+2]-p[a+2]];
        const v = [p[c]-p[a], p[c+1]-p[a+1], p[c+2]-p[a+2]];
        const face = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        assert.ok(Math.hypot(...face) > 1e-14, `${mesh.name}: degenerate triangle`);
        const dot = face.reduce((sum,x,k)=>sum+x*(n[a+k]+n[b+k]+n[c+k]),0);
        assert.ok(dot > -1e-10, `${mesh.name}: reversed normal/winding`);
      }
    }
  });
  test(`${asset.id}: embedded, CRC-valid decodable PNGs and normalized PBR`, () => { // NOSONAR javascript:S3776
    const { doc, bin } = parse(generated.get(asset.id));
    assert.equal(doc.images.length, 2);
    assert.ok(doc.buffers.every(b => !Object.hasOwn(b,'uri')));
    for (const image of doc.images) {
      assert.equal(image.mimeType,'image/png'); assert.ok(!Object.hasOwn(image,'uri'));
      const view=doc.bufferViews[image.bufferView], png=bin.subarray(view.byteOffset,view.byteOffset+view.byteLength);
      assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      const chunks=[]; let offset=8, ended=false;
      while(offset<png.length){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
        assert.ok(offset+12+length<=png.length);
        assert.equal(crc32(png.subarray(offset+4,offset+8+length)),png.readUInt32BE(offset+8+length));
        if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));
        if (type === "IEND") { ended = true; }
        offset += length + 12;
      }
      assert.equal(ended,true); assert.equal(png.readUInt32BE(16),128); assert.equal(png.readUInt32BE(20),128);
      assert.equal(inflateSync(Buffer.concat(chunks)).length,(128*3+1)*128);
    }
    for (const m of doc.materials) {
      const p=m.pbrMetallicRoughness;
      assert.ok([...p.baseColorFactor,p.roughnessFactor,p.metallicFactor].every(v=>Number.isFinite(v)&&v>=0&&v<=1));
      if(p.baseColorTexture)assert.ok(doc.textures[p.baseColorTexture.index]);
    }
  });
}
test('classroom repeats shared meshes without duplicating every desk in the binary',()=>{
  const {doc}=parse(generated.get('school-room'));
  assert.equal(doc.nodes.filter(n=>n.name==='School desk').length,24);
  assert.equal(new Set(doc.nodes.filter(n=>n.name==='School desk').map(n=>n.mesh)).size,1);
  assert.equal(doc.nodes.filter(n=>n.extras.role==='removable-ceiling').length,1);
});
test('library includes upper/lower shelves and a separately hideable ceiling',()=>{
  const {doc}=parse(generated.get('library-room'));
  assert.ok(doc.nodes.some(n=>n.name==='Moulded bookcase'&&n.translation[1]===2.98));
  assert.ok(doc.nodes.some(n=>n.name==='Moulded bookcase'&&n.translation[1]===0));
  assert.equal(doc.nodes.filter(n=>n.extras.role==='removable-ceiling').length,1);
});
test('unknown IDs cannot generate files',()=>{
  for(const id of ['__proto__','constructor','../school-room','',null,123])assert.throws(()=>createAsset(id));
});
test('worker rejects invalid requests and transfers actual GLB bytes',()=>{
  const messages=[]; const self={postMessage:(message,transfer)=>messages.push({message,transfer})};
  const source=readFileSync(new URL('../apps/web/public/assets/reference-rebuild/worker.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/u,'');
  vm.runInNewContext(source,{self,ASSETS,createAsset});
  for(const data of [null,{}, {version:2,type:'build',id:'bookcase'},{version:1,type:'build',id:'constructor'}])self.onmessage({data});
  assert.ok(messages.every(({message})=>message.type==='error'));
  self.onmessage({data:{version:1,type:'build',id:'school-desk'}});
  const result=messages.at(-1); assert.equal(result.message.type,'built');
  assert.equal(result.transfer[0],result.message.bytes);
  assert.equal(hash(Buffer.from(result.message.bytes)),hash(generated.get('school-desk')));
});

test('school chair uprights no longer pierce the top of the backrest', () => {
  const {doc,read}=parse(generated.get('school-desk'));
  const chair=doc.meshes.find(m=>m.name==='School chair');
  const steel=chair.primitives.find(p=>doc.materials[p.material].name==='Charcoal steel');
  const positions=read(steel.attributes.POSITION);
  let highest=-Infinity;
  for(let i=1;i<positions.length;i+=3)highest=Math.max(highest,positions[i]);
  assert.ok(highest<0.71 && highest>0.68);
});
test('chandelier suspension reaches the retained ceiling instead of floating below it', () => {
  const {doc}=parse(generated.get('library-room'));
  const chandelier=doc.nodes.find(n=>n.name==='Brass chandelier');
  const top=Math.max(...doc.meshes[chandelier.mesh].primitives.map(p=>doc.accessors[p.attributes.POSITION].max[1]))+chandelier.translation[1];
  assert.ok(top>=5.89 && top<=6.03);
});
