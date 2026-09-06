import { PROMO_MOTIONS, PROMO_MOTION_LABELS } from "./promo-model";

import type { PromoPanel, PromoScene } from "./promo-model";

export function PromoPanelEditor({ scene, index, count, disabled, onChange, onMove, onRemove }: {
  scene: PromoScene; index: number; count: number; disabled: boolean;
  onChange: (patch: Partial<PromoPanel>) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
  const { panel } = scene;
  return (
    <fieldset className="promo-shot" disabled={disabled}>
      <legend>컷 {index + 1} · {(scene.duration / 30).toFixed(1)}초</legend>
      <img src={panel.src} alt={`컷 ${index + 1} 원본`} className="promo-shot-image" />
      <div className="promo-shot-fields">
        <label htmlFor={`description-${panel.id}`}>컷 설명 <span className="promo-muted">AI가 참고할 내용</span></label>
        <textarea id={`description-${panel.id}`} maxLength={500} rows={2} placeholder="누가, 어디서, 어떤 감정으로 무엇을 하나요?" value={panel.description} onChange={(event) => onChange({ description: event.target.value })} />
        <label htmlFor={`caption-${panel.id}`}>영상 자막</label>
        <input id={`caption-${panel.id}`} maxLength={120} value={panel.caption} onChange={(event) => onChange({ caption: event.target.value })} />
        <div className="promo-inline-grid">
          <label htmlFor={`motion-${panel.id}`}>카메라 모션<select id={`motion-${panel.id}`} value={panel.motion} onChange={(event) => onChange({ motion: event.target.value as PromoPanel["motion"] })}>{PROMO_MOTIONS.map((motion) => <option key={motion} value={motion}>{PROMO_MOTION_LABELS[motion]}</option>)}</select></label>
          <label htmlFor={`fit-${panel.id}`}>화면 맞춤<select id={`fit-${panel.id}`} value={panel.fit} onChange={(event) => onChange({ fit: event.target.value as PromoPanel["fit"] })}><option value="contain">원본 전체 보기</option><option value="cover">화면 채우기 (크롭)</option></select></label>
          <label htmlFor={`weight-${panel.id}`}>상대 길이<select id={`weight-${panel.id}`} value={panel.weight} onChange={(event) => onChange({ weight: Number(event.target.value) })}>{[0.5, 1, 1.5, 2, 3].map((weight) => <option key={weight} value={weight}>{weight}배</option>)}{![0.5, 1, 1.5, 2, 3].includes(panel.weight) ? <option value={panel.weight}>{panel.weight}배 (AI)</option> : null}</select></label>
        </div>
        <div className="promo-shot-actions">
          <button type="button" aria-label={`컷 ${index + 1} 앞으로 이동`} disabled={index === 0} onClick={() => onMove(-1)}>앞으로</button>
          <button type="button" aria-label={`컷 ${index + 1} 뒤로 이동`} disabled={index === count - 1} onClick={() => onMove(1)}>뒤로</button>
          <button type="button" aria-label={`컷 ${index + 1} 삭제`} onClick={onRemove}>삭제</button>
        </div>
      </div>
    </fieldset>
  );
}
