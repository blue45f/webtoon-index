/** Quality-first brush metadata. Quality owns 85% of selection; GPU is a tie-breaker only. */
export const STUDIO_BRUSH_QUALITY_PORTFOLIO_VERSION = "studio-brush-quality-portfolio-v1" as const;
export type StudioBrushQualityPortfolioSource = "core" | "pro";
export type StudioBrushQualityPortfolioTier = "essential" | "specialist";
export type StudioBrushQualityMedium = "ink" | "marker" | "pencil" | "watercolor" | "oil" | "airbrush" | "pastel" | "tone" | "fx" | "texture" | "eraser";
export type StudioBrushTextureProfileId = "clean-ink" | "pressure-outline" | "chisel-ribbon" | "seeded-ink-stamp" | "flat-marker" | "one-wash-marker" | "soft-spray" | "hard-spray" | "seeded-particle" | "graphite-line" | "graphite-side" | "graphite-grain" | "wet-diffuse" | "wet-fluid" | "wet-edge-bloom" | "wet-granular" | "sumi-core" | "fiber-feather" | "chroma-halo" | "matte-gouache" | "loaded-bristle" | "impasto" | "dry-charcoal" | "wax-crayon" | "powder-chalk" | "soft-pastel" | "waxy-pastel" | "tone-grid" | "cross-hatch" | "normal-map" | "material-stamp" | "rake-pattern" | "organic-scatter" | "hair-ribbon" | "brick-pattern" | "knife-edge" | "fan-bristle" | "neon-halo" | "glitter-particle" | "radial-burst";
export type StudioBrushHandFeelProfileId = "direct" | "tapered" | "tilt-chisel" | "flow-stamp" | "single-wash" | "soft-accumulation" | "hard-accumulation" | "particle" | "graphite" | "side-shading" | "wet-flow" | "loaded-paint" | "dry-drag" | "pattern" | "effect" | "eraser";
export type StudioBrushLiveCommitQualityGateId = "exact-rgba" | "outline-geometry" | "same-geometry-settled-material" | "seeded-distribution" | "phase-locked-pattern";
export type StudioBrushQualityEnginePinId = "gpu-causal-exact" | "outline-authority" | "canvas-material-authority" | "seeded-stamp-authority" | "gpu-wet-quality-tie" | "gpu-bristle-quality-tie" | "gpu-texture-quality-tie" | "particle-quality-authority";
export type StudioBrushQualityBackendId = "canonical-webgpu-textured" | "canonical-webgpu-wet-specialist" | "canvas2d-causal-ink" | "canvas2d-material-specialist" | "canvas2d-stamp-pattern" | "perfect-freehand-outline" | "physics-particle-worker" | "professional-bristle-webgpu" | "webgpu-live-causal-ink";
export interface StudioBrushMeasuredQualityAxes { readonly textureFidelity:number; readonly handFeel:number; readonly liveCommitConsistency:number; readonly geometryFidelity:number; readonly performance:number; readonly memoryStability:number; }
export interface StudioBrushMeasuredEngineCandidate { readonly backend:StudioBrushQualityBackendId; readonly gpu:boolean; readonly authority:boolean; readonly gatePassed:boolean; readonly measurements:StudioBrushMeasuredQualityAxes; }
export interface StudioBrushQualityEngineDecision { readonly selected:StudioBrushMeasuredEngineCandidate; readonly authority:StudioBrushMeasuredEngineCandidate; readonly qualityScore:number; readonly totalScore:number; readonly reason:"higher-quality"|"quality-equivalent-gpu"|"quality-equivalent-performance"|"authority-retained"; }
export interface StudioBrushTextureAxes { readonly edgeSoftness:number; readonly grain:number; readonly wetness:number; readonly bristle:number; readonly particleScatter:number; readonly opacityBuildUp:number; readonly anisotropy:number; }
export interface StudioBrushHandFeelAxes { readonly pressureResponse:number; readonly tiltResponse:number; readonly velocityResponse:number; readonly accumulation:number; readonly stabilization:number; }
export interface StudioBrushTextureProfile { readonly id:StudioBrushTextureProfileId; readonly axes:StudioBrushTextureAxes; readonly description:string; }
export interface StudioBrushHandFeelProfile { readonly id:StudioBrushHandFeelProfileId; readonly axes:StudioBrushHandFeelAxes; readonly description:string; }
export interface StudioBrushQualityEnginePin { readonly id:StudioBrushQualityEnginePinId; readonly liveBackend:StudioBrushQualityBackendId; readonly commitBackend:StudioBrushQualityBackendId; readonly gpuPreferredWhenQualityEquivalent:boolean; readonly promotionRule:"quality-parity-required"|"specialist-quality-authority"|"deterministic-authority"; readonly rationale:string; }
export interface StudioBrushQualityPortfolioEntry { readonly id:string; readonly label:string; readonly source:StudioBrushQualityPortfolioSource; readonly tier:StudioBrushQualityPortfolioTier; readonly medium:StudioBrushQualityMedium; readonly textureProfile:StudioBrushTextureProfileId; readonly handFeelProfile:StudioBrushHandFeelProfileId; readonly liveCommitGate:StudioBrushLiveCommitQualityGateId; readonly enginePin:StudioBrushQualityEnginePinId; readonly signature:string; readonly distinctness:string; readonly absorbedIds:readonly string[]; }
const texture=(id:StudioBrushTextureProfileId,a:readonly number[],description:string):StudioBrushTextureProfile=>Object.freeze({id,axes:Object.freeze({edgeSoftness:a[0]!,grain:a[1]!,wetness:a[2]!,bristle:a[3]!,particleScatter:a[4]!,opacityBuildUp:a[5]!,anisotropy:a[6]!}),description});
export const STUDIO_BRUSH_TEXTURE_PROFILES:Readonly<Record<StudioBrushTextureProfileId,StudioBrushTextureProfile>>=Object.freeze({
"clean-ink":texture("clean-ink",[0.08,0.02,0,0,0,0.72,0.05],"선명한 원형 잉크 코어와 최소 안티앨리어싱 경계"),
"pressure-outline":texture("pressure-outline",[0.07,0.01,0,0,0,0.84,0.18],"필압 테이퍼가 지배하는 매끈한 아웃라인"),
"chisel-ribbon":texture("chisel-ribbon",[0.09,0.02,0,0.1,0,0.76,0.92],"기울기에 따라 폭과 방향이 바뀌는 치즐 리본"),
"seeded-ink-stamp":texture("seeded-ink-stamp",[0.14,0.18,0.05,0.12,0.08,0.88,0.16],"결정적 잉크 팁 스탬프와 겹침 농도"),
"flat-marker":texture("flat-marker",[0.1,0.01,0,0,0,0.62,0.08],"균일하고 평평한 마커 도포"),
"one-wash-marker":texture("one-wash-marker",[0.16,0.02,0.04,0,0,0.35,0.42],"겹침이 과도하게 어두워지지 않는 단일 워시 마커"),
"soft-spray":texture("soft-spray",[0.92,0.1,0,0,0.18,0.42,0.02],"넓은 소프트 그라디언트와 낮은 입자감"),
"hard-spray":texture("hard-spray",[0.36,0.08,0,0,0.2,0.62,0.03],"단단한 중심과 짧은 감쇠를 가진 에어 도포"),
"seeded-particle":texture("seeded-particle",[0.22,0.55,0,0,0.95,0.58,0.22],"시드로 재현되는 이산 입자 분포"),
"graphite-line":texture("graphite-line",[0.18,0.62,0,0.06,0.05,0.54,0.14],"종이결에 걸리는 선형 흑연 입자"),
"graphite-side":texture("graphite-side",[0.34,0.75,0,0.12,0.08,0.45,0.86],"측면 접촉으로 넓어지는 방향성 흑연"),
"graphite-grain":texture("graphite-grain",[0.2,0.86,0,0.08,0.16,0.5,0.2],"거친 종이결을 강조한 결정적 연필 스탬프"),
"wet-diffuse":texture("wet-diffuse",[0.72,0.22,0.84,0.05,0.04,0.62,0.08],"부드러운 수분 확산과 웻엣지"),
"wet-fluid":texture("wet-fluid",[0.66,0.18,0.94,0.04,0.04,0.72,0.12],"속도와 수분량에 반응하는 유체 잉크"),
"wet-edge-bloom":texture("wet-edge-bloom",[0.82,0.34,0.96,0.04,0.08,0.7,0.16],"가장자리 농축과 백런 블룸"),
"wet-granular":texture("wet-granular",[0.64,0.82,0.82,0.06,0.12,0.66,0.12],"수분 흐름 안에서 분리되는 안료 과립"),
"sumi-core":texture("sumi-core",[0.48,0.3,0.68,0.08,0.04,0.9,0.12],"짙은 먹 코어와 제한된 외곽 번짐"),
"fiber-feather":texture("fiber-feather",[0.74,0.68,0.72,0.34,0.1,0.68,0.45],"종이 섬유 방향을 따라 갈라지는 젖은 페더링"),
"chroma-halo":texture("chroma-halo",[0.86,0.28,0.78,0.04,0.08,0.64,0.1],"채널별 이동이 다른 미세 크로마 번짐"),
"matte-gouache":texture("matte-gouache",[0.2,0.14,0.32,0.22,0,0.94,0.16],"불투명하고 매트한 바디 컬러"),
"loaded-bristle":texture("loaded-bristle",[0.2,0.36,0.16,0.82,0.02,0.88,0.72],"평행 강모 레인과 압력별 물감 고갈"),
"impasto":texture("impasto",[0.16,0.38,0.12,0.9,0.02,0.98,0.78],"두꺼운 물감 리본과 강한 강모 릴리프"),
"dry-charcoal":texture("dry-charcoal",[0.24,0.92,0,0.2,0.16,0.64,0.52],"날카로운 모서리와 부서지는 목탄 그릿"),
"wax-crayon":texture("wax-crayon",[0.24,0.76,0,0.1,0.1,0.82,0.36],"왁스 막과 종이 홈을 남기는 크레용"),
"powder-chalk":texture("powder-chalk",[0.48,0.9,0,0.08,0.24,0.58,0.24],"부드러운 가루와 끊기는 초크 입자"),
"soft-pastel":texture("soft-pastel",[0.58,0.82,0,0.08,0.18,0.62,0.16],"벨벳 같은 파스텔 케이크와 종이결"),
"waxy-pastel":texture("waxy-pastel",[0.34,0.7,0,0.16,0.08,0.86,0.3],"점착성 왁스 필름과 누적 도포"),
"tone-grid":texture("tone-grid",[0.02,0.06,0,0,0.72,0.54,0],"문서 좌표에 고정되는 규칙적 망점"),
"cross-hatch":texture("cross-hatch",[0.08,0.34,0,0.04,0.56,0.62,0.88],"획 방향을 따르는 교차 해칭"),
"normal-map":texture("normal-map",[0.12,0.08,0,0,0,0.76,0.62],"표면 탄젠트 방향을 색 채널로 기록"),
"material-stamp":texture("material-stamp",[0.24,0.88,0,0.18,0.36,0.68,0.42],"재질 알파 팁을 반복하는 결정적 스탬프"),
"rake-pattern":texture("rake-pattern",[0.14,0.66,0,0.66,0.16,0.72,0.96],"평행 갈퀴 결이 획 방향을 따라가는 패턴"),
"organic-scatter":texture("organic-scatter",[0.26,0.62,0,0.12,0.88,0.6,0.46],"잎·유기물 모티프의 결정적 산란"),
"hair-ribbon":texture("hair-ribbon",[0.12,0.26,0,0.7,0.2,0.74,0.94],"가느다란 컬 리본과 모발 방향성"),
"brick-pattern":texture("brick-pattern",[0.06,0.12,0,0,0.18,0.82,0.04],"이음매 위상이 고정된 벽돌 패턴"),
"knife-edge":texture("knife-edge",[0.08,0.28,0.08,0.06,0,0.96,0.98],"팔레트 나이프의 얇고 긴 날 접촉"),
"fan-bristle":texture("fan-bristle",[0.22,0.58,0.02,0.96,0.18,0.68,0.9],"펼쳐진 부채 강모의 마른 갈라짐"),
"neon-halo":texture("neon-halo",[0.94,0.02,0,0,0.02,0.84,0],"밝은 중심과 다중 소프트 발광층"),
"glitter-particle":texture("glitter-particle",[0.24,0.3,0,0,0.98,0.78,0.22],"반짝임 코어를 가진 결정적 입자"),
"radial-burst":texture("radial-burst",[0.06,0.08,0,0,0.78,0.8,1],"방사 중심에 위상이 고정된 속도선"),
});
const hand=(id:StudioBrushHandFeelProfileId,a:readonly number[],description:string):StudioBrushHandFeelProfile=>Object.freeze({id,axes:Object.freeze({pressureResponse:a[0]!,tiltResponse:a[1]!,velocityResponse:a[2]!,accumulation:a[3]!,stabilization:a[4]!}),description});
export const STUDIO_BRUSH_HAND_FEEL_PROFILES:Readonly<Record<StudioBrushHandFeelProfileId,StudioBrushHandFeelProfile>>=Object.freeze({
"direct":hand("direct",[0.72,0.02,0.34,0.5,0.38],"입력을 즉시 따라가는 직접적인 필기감"),
"tapered":hand("tapered",[0.96,0.08,0.62,0.58,0.54],"필압·속도 테이퍼가 선폭에 강하게 반영"),
"tilt-chisel":hand("tilt-chisel",[0.82,0.94,0.38,0.62,0.42],"펜 기울기와 진행 방향으로 치즐 각도 변화"),
"flow-stamp":hand("flow-stamp",[0.82,0.34,0.46,0.82,0.3],"압력별 스탬프 유량과 겹침 축적"),
"single-wash":hand("single-wash",[0.48,0.18,0.18,0.26,0.62],"부드럽고 안정적인 단일 워시"),
"soft-accumulation":hand("soft-accumulation",[0.56,0.12,0.28,0.78,0.5],"여러 번 지나갈수록 부드럽게 농도 누적"),
"hard-accumulation":hand("hard-accumulation",[0.66,0.08,0.34,0.82,0.36],"단단한 중심이 빠르게 누적"),
"particle":hand("particle",[0.58,0.16,0.5,0.62,0.22],"속도와 압력에 따라 입자 밀도 변화"),
"graphite":hand("graphite",[0.9,0.56,0.32,0.74,0.46],"필압으로 흑연 농도와 결이 변함"),
"side-shading":hand("side-shading",[0.76,0.98,0.3,0.7,0.38],"기울기로 접촉 폭을 넓히는 음영 필기감"),
"wet-flow":hand("wet-flow",[0.78,0.34,0.72,0.9,0.44],"수분·속도·필압이 번짐과 농도에 결합"),
"loaded-paint":hand("loaded-paint",[0.86,0.78,0.48,0.94,0.28],"강모 접촉과 물감 고갈이 느껴지는 무거운 손맛"),
"dry-drag":hand("dry-drag",[0.82,0.62,0.44,0.66,0.32],"종이 마찰과 끊김이 살아 있는 마른 드래그"),
"pattern":hand("pattern",[0.42,0.12,0.26,0.56,0.58],"문서 위상에 고정되는 반복 무늬"),
"effect":hand("effect",[0.52,0.12,0.42,0.68,0.44],"결정적 효과 입자와 발광 누적"),
"eraser":hand("eraser",[0.8,0.1,0.34,0.7,0.42],"원본 입력과 같은 기하를 쓰는 파괴적 스트로크"),
});
export const STUDIO_BRUSH_QUALITY_ENGINE_PINS:Readonly<Record<StudioBrushQualityEnginePinId,StudioBrushQualityEnginePin>>=Object.freeze({
"gpu-causal-exact":Object.freeze({"id":"gpu-causal-exact","liveBackend":"webgpu-live-causal-ink","commitBackend":"canvas2d-causal-ink","gpuPreferredWhenQualityEquivalent":true,"promotionRule":"quality-parity-required","rationale":"동일 causal 샘플·레시피가 증명된 경우 라이브 입력은 GPU를 우선"}),
"outline-authority":Object.freeze({"id":"outline-authority","liveBackend":"perfect-freehand-outline","commitBackend":"perfect-freehand-outline","gpuPreferredWhenQualityEquivalent":false,"promotionRule":"specialist-quality-authority","rationale":"아웃라인 테이퍼와 코너 품질이 성능보다 우선"}),
"canvas-material-authority":Object.freeze({"id":"canvas-material-authority","liveBackend":"canvas2d-material-specialist","commitBackend":"canvas2d-material-specialist","gpuPreferredWhenQualityEquivalent":false,"promotionRule":"specialist-quality-authority","rationale":"현재 재질 전용 렌더러가 품질 기준선이며 동등 GPU 증거 전에는 유지"}),
"seeded-stamp-authority":Object.freeze({"id":"seeded-stamp-authority","liveBackend":"canvas2d-stamp-pattern","commitBackend":"canvas2d-stamp-pattern","gpuPreferredWhenQualityEquivalent":false,"promotionRule":"deterministic-authority","rationale":"시드·위상·팁 footprint가 완전히 재현되는 스탬프 권위 경로"}),
"gpu-wet-quality-tie":Object.freeze({"id":"gpu-wet-quality-tie","liveBackend":"canonical-webgpu-wet-specialist","commitBackend":"canonical-webgpu-wet-specialist","gpuPreferredWhenQualityEquivalent":true,"promotionRule":"quality-parity-required","rationale":"젖은 안료 기하와 정착 질감이 기준선보다 나쁘지 않을 때만 GPU 승격"}),
"gpu-bristle-quality-tie":Object.freeze({"id":"gpu-bristle-quality-tie","liveBackend":"professional-bristle-webgpu","commitBackend":"professional-bristle-webgpu","gpuPreferredWhenQualityEquivalent":true,"promotionRule":"quality-parity-required","rationale":"강모 분리·물감 고갈·리본 릴리프가 기준선과 동등할 때 GPU 우선"}),
"gpu-texture-quality-tie":Object.freeze({"id":"gpu-texture-quality-tie","liveBackend":"canonical-webgpu-textured","commitBackend":"canonical-webgpu-textured","gpuPreferredWhenQualityEquivalent":true,"promotionRule":"quality-parity-required","rationale":"결정적 텍스처·입자 분포가 동등할 때 GPU의 처리량을 우선"}),
"particle-quality-authority":Object.freeze({"id":"particle-quality-authority","liveBackend":"physics-particle-worker","commitBackend":"physics-particle-worker","gpuPreferredWhenQualityEquivalent":false,"promotionRule":"specialist-quality-authority","rationale":"분포·발광·시드 안정성이 우선이며 GPU는 동등 증거가 생긴 뒤 교체"}),
});
export const STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS=Object.freeze({"textureFidelity":0.3,"handFeel":0.25,"liveCommitConsistency":0.2,"geometryFidelity":0.1,"performance":0.1,"memoryStability":0.05});
export const STUDIO_BRUSH_LIVE_COMMIT_GATES=Object.freeze({"exact-rgba":{"changedPixelRatioMax":0.01,"ssimMin":0.995,"centerlineP95PxMax":0.5,"settledChangedRatioMax":0.001},"outline-geometry":{"maskIouMin":0.98,"centerlineP95PxMax":0.75,"widthP95RelativeErrorMax":0.05,"settledChangedRatioMax":0.001},"same-geometry-settled-material":{"liveCoverageMin":0.985,"maskIouMin":0.88,"centerlineP95PxMax":1,"settledChangedRatioMax":0.001},"seeded-distribution":{"occupiedCellJensenShannonMax":0.03,"boundingCoverageMin":0.92,"seedReplayDigestRequired":true,"settledChangedRatioMax":0.001},"phase-locked-pattern":{"maskIouMin":0.97,"phaseOffsetPxMax":0.5,"seedReplayDigestRequired":true,"settledChangedRatioMax":0.001}});
const Q=STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS; const QW=Q.textureFidelity+Q.handFeel+Q.liveCommitConsistency+Q.geometryFidelity; const clamp=(v:number)=>Number.isFinite(v)?Math.min(1,Math.max(0,v)):0;
export function studioBrushQualityOnlyScore(m:StudioBrushMeasuredQualityAxes):number{return(clamp(m.textureFidelity)*Q.textureFidelity+clamp(m.handFeel)*Q.handFeel+clamp(m.liveCommitConsistency)*Q.liveCommitConsistency+clamp(m.geometryFidelity)*Q.geometryFidelity)/QW;}
export function studioBrushQualityTotalScore(m:StudioBrushMeasuredQualityAxes):number{return clamp(m.textureFidelity)*Q.textureFidelity+clamp(m.handFeel)*Q.handFeel+clamp(m.liveCommitConsistency)*Q.liveCommitConsistency+clamp(m.geometryFidelity)*Q.geometryFidelity+clamp(m.performance)*Q.performance+clamp(m.memoryStability)*Q.memoryStability;}
const noWorse=(c:StudioBrushMeasuredQualityAxes,a:StudioBrushMeasuredQualityAxes,t:number)=>c.textureFidelity+t>=a.textureFidelity&&c.handFeel+t>=a.handFeel&&c.liveCommitConsistency+t>=a.liveCommitConsistency&&c.geometryFidelity+t>=a.geometryFidelity;
export function selectStudioBrushQualityEngine(candidates:readonly StudioBrushMeasuredEngineCandidate[],options:Readonly<{qualityEquivalentTolerance?:number;gpuPreferredWhenQualityEquivalent?:boolean}>={}):StudioBrushQualityEngineDecision|null{const authority=candidates.find(c=>c.authority&&c.gatePassed);if(!authority)return null;const t=Math.min(.02,Math.max(0,options.qualityEquivalentTolerance??.005));const viable=candidates.filter(c=>c.gatePassed&&noWorse(c.measurements,authority.measurements,t));let selected=authority;let reason:StudioBrushQualityEngineDecision["reason"]="authority-retained";for(const c of viable){const sq=studioBrushQualityOnlyScore(selected.measurements),cq=studioBrushQualityOnlyScore(c.measurements);if(cq>sq+t){selected=c;reason="higher-quality";continue;}if(Math.abs(cq-sq)>t)continue;if(options.gpuPreferredWhenQualityEquivalent!==false&&c.gpu&&!selected.gpu){selected=c;reason="quality-equivalent-gpu";continue;}if(c.gpu===selected.gpu&&studioBrushQualityTotalScore(c.measurements)>studioBrushQualityTotalScore(selected.measurements)){selected=c;reason="quality-equivalent-performance";}}return{selected,authority,qualityScore:studioBrushQualityOnlyScore(selected.measurements),totalScore:studioBrushQualityTotalScore(selected.measurements),reason:selected===authority&&reason!=="higher-quality"?"authority-retained":reason};}
