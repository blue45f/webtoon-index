/**
 * Studio 3D Particle & Atmospheric VFX Engine (Spline / Unreal Webtoon FX Benchmark).
 * Real-time particle simulation with gravity, wind, turbulence noise, and lifetime decay.
 */

export type ParticleVfxPresetKind =
  | "sakura-petals"
  | "magic-stardust"
  | "rain-splashes"
  | "snow-blizzard"
  | "fire-embers"
  | "action-speed-lines"
  | "atmospheric-dust";

export interface ParticleVfxPresetConfig {
  readonly id: ParticleVfxPresetKind;
  readonly name: string;
  readonly description: string;
  readonly maxParticles: number;
  readonly spawnRate: number; // particles per second
  readonly lifetime: readonly [number, number]; // [min, max] seconds
  readonly initialSpeed: readonly [number, number];
  readonly spreadAngle: number; // degrees
  readonly gravity: readonly [number, number, number];
  readonly wind: readonly [number, number, number];
  readonly turbulenceStrength: number;
  readonly baseSize: number;
  readonly sizeVariation: number;
  readonly baseColor: string; // hex
  readonly endColor: string;
  readonly opacityStart: number;
  readonly opacityEnd: number;
  readonly spinSpeed: number;
}

export const PARTICLE_VFX_PRESETS: Record<ParticleVfxPresetKind, ParticleVfxPresetConfig> = {
  "sakura-petals": {
    id: "sakura-petals",
    name: "벚꽃 잎날림 (Sakura)",
    description: "로맨스/청춘 웹툰 분위기를 연출하는 부드러운 벚꽃 잎 낙하 효과",
    maxParticles: 120,
    spawnRate: 20,
    lifetime: [3.5, 6.0],
    initialSpeed: [0.5, 1.2],
    spreadAngle: 45,
    gravity: [0.2, -0.8, 0.1],
    wind: [0.6, -0.2, 0.3],
    turbulenceStrength: 0.35,
    baseSize: 0.18,
    sizeVariation: 0.06,
    baseColor: "#ffb7c5",
    endColor: "#ffe4e1",
    opacityStart: 0.95,
    opacityEnd: 0.1,
    spinSpeed: 2.5,
  },
  "magic-stardust": {
    id: "magic-stardust",
    name: "마법 스타더스트 (Stardust)",
    description: "판타지 각성 및 마법 시전 장면에 반짝이는 별가루 입자",
    maxParticles: 200,
    spawnRate: 40,
    lifetime: [1.5, 3.0],
    initialSpeed: [1.0, 2.5],
    spreadAngle: 180,
    gravity: [0, 0.1, 0],
    wind: [0, 0, 0],
    turbulenceStrength: 0.5,
    baseSize: 0.08,
    sizeVariation: 0.04,
    baseColor: "#70d6ff",
    endColor: "#ffd166",
    opacityStart: 1.0,
    opacityEnd: 0.0,
    spinSpeed: 4.0,
  },
  "rain-splashes": {
    id: "rain-splashes",
    name: "빗줄기와 물방울 (Rain)",
    description: "우천 및 감정적 클라이맥스 씬의 고속 빗줄기와 지면 물보라",
    maxParticles: 300,
    spawnRate: 80,
    lifetime: [0.8, 1.4],
    initialSpeed: [8.0, 12.0],
    spreadAngle: 15,
    gravity: [0.1, -15.0, 0.1],
    wind: [1.2, -1.0, 0.5],
    turbulenceStrength: 0.1,
    baseSize: 0.04,
    sizeVariation: 0.02,
    baseColor: "#a0c4ff",
    endColor: "#e0e7ff",
    opacityStart: 0.8,
    opacityEnd: 0.2,
    spinSpeed: 0.2,
  },
  "snow-blizzard": {
    id: "snow-blizzard",
    name: "눈보라와 함박눈 (Snow)",
    description: "겨울 풍경 및 차가운 서스펜스 장면에 흩날리는 눈송이",
    maxParticles: 250,
    spawnRate: 35,
    lifetime: [4.0, 8.0],
    initialSpeed: [0.4, 1.0],
    spreadAngle: 60,
    gravity: [0, -0.6, 0],
    wind: [-0.8, -0.1, 0.4],
    turbulenceStrength: 0.4,
    baseSize: 0.12,
    sizeVariation: 0.05,
    baseColor: "#ffffff",
    endColor: "#e2e8f0",
    opacityStart: 0.9,
    opacityEnd: 0.15,
    spinSpeed: 1.2,
  },
  "fire-embers": {
    id: "fire-embers",
    name: "불꽃 불씨 (Embers)",
    description: "전투 및 화재 씬에서 타오르며 위로 솟구치는 불꽃 파편",
    maxParticles: 150,
    spawnRate: 30,
    lifetime: [1.2, 2.8],
    initialSpeed: [1.5, 3.5],
    spreadAngle: 40,
    gravity: [0, 1.8, 0],
    wind: [0.3, 0.5, -0.2],
    turbulenceStrength: 0.6,
    baseSize: 0.1,
    sizeVariation: 0.05,
    baseColor: "#ff4d00",
    endColor: "#ffdd00",
    opacityStart: 1.0,
    opacityEnd: 0.0,
    spinSpeed: 3.0,
  },
  "action-speed-lines": {
    id: "action-speed-lines",
    name: "액션 3D 스피드 라인 (Action Streaks)",
    description: "타격 및 돌진 순간 카메라 시점으로 쇄도하는 3D 속도선",
    maxParticles: 80,
    spawnRate: 25,
    lifetime: [0.4, 0.8],
    initialSpeed: [15.0, 25.0],
    spreadAngle: 10,
    gravity: [0, 0, 0],
    wind: [0, 0, -20.0],
    turbulenceStrength: 0.05,
    baseSize: 0.25,
    sizeVariation: 0.1,
    baseColor: "#ffffff",
    endColor: "#64748b",
    opacityStart: 0.95,
    opacityEnd: 0.0,
    spinSpeed: 0.0,
  },
  "atmospheric-dust": {
    id: "atmospheric-dust",
    name: "공간 먼지 & 틴들 현상 (Dust Motes)",
    description: "햇살 비치는 방이나 어두운 유적지의 미세 부유 먼지 입자",
    maxParticles: 100,
    spawnRate: 15,
    lifetime: [5.0, 10.0],
    initialSpeed: [0.1, 0.3],
    spreadAngle: 360,
    gravity: [0, 0.02, 0],
    wind: [0.1, 0.05, 0.1],
    turbulenceStrength: 0.2,
    baseSize: 0.05,
    sizeVariation: 0.02,
    baseColor: "#fef08a",
    endColor: "#fef9c3",
    opacityStart: 0.6,
    opacityEnd: 0.05,
    spinSpeed: 0.8,
  },
};

export interface ParticleState {
  readonly id: number;
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  rot: number;
  rotSpeed: number;
  size: number;
  age: number;
  maxLife: number;
  active: boolean;
}

export class Studio3dParticleSystem {
  private particles: ParticleState[] = [];
  private nextId = 1;
  private spawnAcc = 0;
  private config: ParticleVfxPresetConfig;
  private emitterOrigin: readonly [number, number, number] = [0, 2, 0];

  constructor(presetKind: ParticleVfxPresetKind = "sakura-petals") {
    this.config = PARTICLE_VFX_PRESETS[presetKind];
  }

  public setPreset(presetKind: ParticleVfxPresetKind) {
    this.config = PARTICLE_VFX_PRESETS[presetKind];
    this.particles = [];
  }

  public getConfig(): ParticleVfxPresetConfig {
    return this.config;
  }

  public setEmitterOrigin(origin: readonly [number, number, number]) {
    this.emitterOrigin = origin;
  }

  public update(deltaSeconds: number): void {
    const dt = Math.min(0.1, Math.max(0.001, deltaSeconds));

    // Spawn new particles
    this.spawnAcc += dt * this.config.spawnRate;
    const spawnCount = Math.floor(this.spawnAcc);
    this.spawnAcc -= spawnCount;

    for (let s = 0; s < spawnCount; s++) {
      if (this.particles.length < this.config.maxParticles) {
        this.spawnParticle();
      }
    }

    // Update active particles
    const cfg = this.config;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.maxLife) {
        p.active = false;
        continue;
      }

      // Physics integration
      p.velX += (cfg.gravity[0] + cfg.wind[0]) * dt;
      p.velY += (cfg.gravity[1] + cfg.wind[1]) * dt;
      p.velZ += (cfg.gravity[2] + cfg.wind[2]) * dt;

      // Small turbulence
      p.posX += p.velX * dt + (Math.sin(p.age * 3) * cfg.turbulenceStrength * dt);
      p.posY += p.velY * dt;
      p.posZ += p.velZ * dt + (Math.cos(p.age * 2.5) * cfg.turbulenceStrength * dt);

      p.rot += p.rotSpeed * dt;
    }

    // Filter dead particles
    this.particles = this.particles.filter((p) => p.active);
  }

  private spawnParticle() {
    const cfg = this.config;
    const life = cfg.lifetime[0] + Math.random() * (cfg.lifetime[1] - cfg.lifetime[0]);
    const speed = cfg.initialSpeed[0] + Math.random() * (cfg.initialSpeed[1] - cfg.initialSpeed[0]);
    const angleRad = (Math.random() * 360 * Math.PI) / 180;
    const spreadRad = (Math.random() * cfg.spreadAngle * Math.PI) / 180;

    const velX = Math.sin(spreadRad) * Math.cos(angleRad) * speed;
    const velY = Math.cos(spreadRad) * speed;
    const velZ = Math.sin(spreadRad) * Math.sin(angleRad) * speed;

    this.particles.push({
      id: this.nextId++,
      posX: this.emitterOrigin[0] + (Math.random() - 0.5) * 4,
      posY: this.emitterOrigin[1] + (Math.random() - 0.5) * 2,
      posZ: this.emitterOrigin[2] + (Math.random() - 0.5) * 4,
      velX,
      velY,
      velZ,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * cfg.spinSpeed,
      size: cfg.baseSize + (Math.random() - 0.5) * cfg.sizeVariation,
      age: 0,
      maxLife: life,
      active: true,
    });
  }

  public getActiveParticles(): readonly ParticleState[] {
    return Object.freeze([...this.particles]);
  }
}
