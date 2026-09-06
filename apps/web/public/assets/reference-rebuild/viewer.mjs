import { mountSoftwareViewer } from './software-viewer.mjs';
import { ASSETS, createAsset } from './generator.mjs';

// This inspection surface uses the tested CPU renderer. PBR production rendering belongs to Studio.
const canvas = document.querySelector('canvas');
const status = document.getElementById('status');
const selector = document.getElementById('assets');
const save = document.getElementById('save');
let active = null, currentBytes = null, loading = false, generation = 0;
const objectUrls = new Set();

for (const asset of ASSETS) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.asset = asset.id;
  const title = document.createElement('strong'); title.textContent = asset.name;
  const info = document.createElement('span'); info.textContent = `${asset.kind} · ${asset.description}`;
  button.append(title, info); button.addEventListener('click', () => select(asset.id)); selector.append(button);
}
async function select(id) {
  const asset = ASSETS.find(item => item.id === id);
  if (loading || !asset) return;
  loading = true; const token = ++generation;
  active?.dispose(); active = null; currentBytes = null; save.disabled = true;
  canvas.getContext('2d', { alpha: false })?.clearRect(0, 0, canvas.width, canvas.height); canvas.dataset.ready = 'false'; canvas.dataset.asset = id;
  document.getElementById('name').textContent = asset.name;
  document.getElementById('description').textContent = asset.description;
  document.getElementById('reference').href = asset.reference;
  document.getElementById('metrics').textContent = '';
  status.textContent = '실제 GLB 메시를 생성하고 있습니다…';
  for (const button of selector.children) button.setAttribute('aria-pressed', String(button.dataset.asset === id));
  try {
    currentBytes = createAsset(id);
    // Saving the model must remain available even if image decoding/inspection fails.
    save.dataset.id = id; save.disabled = false;
    const view = new DataView(currentBytes.buffer);
    const jsonLength = view.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(currentBytes.subarray(20, 20 + jsonLength)));
    const mounted = await mountSoftwareViewer(canvas, asset, currentBytes, doc, 28 + jsonLength, stats => {
      document.getElementById('metrics').textContent = `${stats.nodes}개 조립체 · ${stats.triangles.toLocaleString()}개 삼각형 · ${(stats.bytes / 1024 / 1024).toFixed(2)} MiB · 외부 리소스 0`;
    });
    if (token !== generation) { mounted.dispose(); return; }
    active = mounted;
    document.getElementById('ceiling').checked = false;
    document.getElementById('ceiling').disabled = !id.endsWith('-room');
    status.textContent = 'CPU 형상 검토 · 그림자·금속 반사 표현 제한 · 드래그: 회전 · 휠: 확대 · 방향키: 시점 · Home: 초기화';
    if (location.protocol === 'http:' || location.protocol === 'https:') history.replaceState(null, '', `?asset=${encodeURIComponent(id)}`);
  } catch (error) {
    status.textContent = `미리보기 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}.${currentBytes ? ' 생성된 GLB는 저장할 수 있습니다.' : ' 모델을 다시 선택해 주세요.'}`;
  } finally { loading = false; }
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => active?.setView(button.dataset.view));
document.getElementById('ceiling').addEventListener('change', event => active?.setCeiling(event.target.checked));
save.addEventListener('click', () => {
  if (!currentBytes) return;
  const url = URL.createObjectURL(new Blob([currentBytes], { type: 'model/gltf-binary' })); objectUrls.add(url);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${save.dataset.id}.glb`; anchor.click();
  setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); }, 10_000);
});
window.addEventListener('pagehide', () => {
  generation += 1; active?.dispose(); currentBytes = null;
  for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear();
});
const requested = new URLSearchParams(location.search).get('asset');
select(ASSETS.some(asset => asset.id === requested) ? requested : 'library-room');
