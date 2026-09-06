import {
  installStudioPhysicsParticleWorkerHost,
  type StudioPhysicsParticleWorkerHostScope,
} from "./studio-physics-particle-brush-worker-host";

installStudioPhysicsParticleWorkerHost(
  globalThis as unknown as StudioPhysicsParticleWorkerHostScope,
);
