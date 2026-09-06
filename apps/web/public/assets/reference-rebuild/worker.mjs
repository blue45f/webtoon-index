import { ASSETS, createAsset } from './generator.mjs';
self.onmessage = ({ data }) => {
  if (!data || data.version !== 1 || data.type !== 'build' || !ASSETS.some(asset => asset.id === data.id)) {
    self.postMessage({ version: 1, type: 'error', detail: '지원하지 않는 재제작 모델입니다.' });
    return;
  }
  try {
    const bytes = createAsset(data.id);
    self.postMessage({ version: 1, type: 'built', id: data.id, bytes: bytes.buffer }, [bytes.buffer]);
  } catch {
    self.postMessage({ version: 1, type: 'error', detail: '모델을 생성하지 못했습니다. 다시 시도해 주세요.' });
  }
};
