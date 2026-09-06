/**
 * Studio 3D Character Rig Graph
 *
 * VRM/glTF 캐릭터의 본 체계, IK/FK 전환, 리타겟,
 * 포즈 라이브러리, Expression 믹서를 관리합니다.
 *
 * 설계서 참조: §6.7 Character·VRM·Animation (CHR-001~CHR-020)
 */

export type BoneSemantic =
  | "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "leftToes"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot" | "rightToes"
  | "leftEye" | "rightEye" | "jaw"
  // 손가락 (21개)
  | "leftThumbProximal" | "leftThumbIntermediate" | "leftThumbDistal"
  | "leftIndexProximal" | "leftIndexIntermediate" | "leftIndexDistal"
  | "leftMiddleProximal" | "leftMiddleIntermediate" | "leftMiddleDistal"
  | "leftRingProximal" | "leftRingIntermediate" | "leftRingDistal"
  | "leftLittleProximal" | "leftLittleIntermediate" | "leftLittleDistal"
  | "rightThumbProximal" | "rightThumbIntermediate" | "rightThumbDistal"
  | "rightIndexProximal" | "rightIndexIntermediate" | "rightIndexDistal"
  | "rightMiddleProximal" | "rightMiddleIntermediate" | "rightMiddleDistal"
  | "rightRingProximal" | "rightRingIntermediate" | "rightRingDistal"
  | "rightLittleProximal" | "rightLittleIntermediate" | "rightLittleDistal";

export interface BoneMapping {
  semantic: BoneSemantic;
  nodeName: string; // 원본 glTF/VRM 노드 이름
  rotation: [number, number, number, number]; // quaternion
  restPosition: [number, number, number];
}

export interface IKChain {
  id: string;
  name: string;
  endEffectorBone: BoneSemantic;
  chainLength: number; // 체인에 포함되는 본 수
  targetPosition: [number, number, number];
  targetRotation: [number, number, number, number];
  poleTarget?: [number, number, number];
  enabled: boolean;
  weight: number; // 0~1, FK↔IK 블렌드
}

export type VRMExpression =
  | "happy" | "angry" | "sad" | "relaxed" | "surprised"
  | "aa" | "ih" | "ou" | "ee" | "oh"
  | "blink" | "blinkLeft" | "blinkRight"
  | "lookUp" | "lookDown" | "lookLeft" | "lookRight"
  | "neutral";

export interface ExpressionState {
  expression: VRMExpression;
  weight: number; // 0~1
}

export interface PosePreset {
  id: string;
  name: string;
  category: string;
  boneRotations: Partial<Record<BoneSemantic, [number, number, number, number]>>;
  expressions: ExpressionState[];
  thumbnailUrl?: string;
}

export interface LookAtTarget {
  mode: "camera" | "object" | "direction";
  targetId?: string;
  direction?: [number, number, number];
  headWeight: number;
  eyeWeight: number;
}

function isFiniteTuple(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function normalizeQuaternion(
  rotation: readonly [number, number, number, number],
): [number, number, number, number] | undefined {
  if (!isFiniteTuple(rotation)) return undefined;
  const length = Math.hypot(...rotation);
  if (length <= Number.EPSILON) return undefined;
  return rotation.map((component) => component / length) as [number, number, number, number];
}

function cloneBoneMapping(mapping: BoneMapping): BoneMapping {
  return {
    ...mapping,
    rotation: [...mapping.rotation],
    restPosition: [...mapping.restPosition],
  };
}

function cloneIKChain(chain: IKChain): IKChain {
  return {
    ...chain,
    targetPosition: [...chain.targetPosition],
    targetRotation: [...chain.targetRotation],
    poleTarget: chain.poleTarget ? [...chain.poleTarget] : undefined,
  };
}

function clonePosePreset(preset: PosePreset): PosePreset {
  const boneRotations: PosePreset["boneRotations"] = {};
  for (const [semantic, rotation] of Object.entries(preset.boneRotations)) {
    if (rotation) {
      boneRotations[semantic as BoneSemantic] = [...rotation] as [number, number, number, number];
    }
  }
  return {
    ...preset,
    boneRotations,
    expressions: preset.expressions.map((expression) => ({ ...expression })),
  };
}

export class Studio3DCharacterRigGraph {
  private boneMap = new Map<BoneSemantic, BoneMapping>();
  private ikChains = new Map<string, IKChain>();
  private expressionStates = new Map<VRMExpression, number>();
  private poseLibrary: PosePreset[] = [];
  private lookAt: LookAtTarget = { mode: "camera", headWeight: 0.5, eyeWeight: 1.0 };
  private nextId = 1;

  // ── Bone Mapping ──

  public mapBone(semantic: BoneSemantic, nodeName: string, restPosition: [number, number, number] = [0, 0, 0]): void {
    if (!nodeName.trim()) throw new Error("본 노드 이름은 비어 있을 수 없습니다.");
    if (!isFiniteTuple(restPosition)) throw new Error("본 rest position은 유한한 값이어야 합니다.");
    this.boneMap.set(semantic, {
      semantic,
      nodeName,
      rotation: [0, 0, 0, 1],
      restPosition: [...restPosition],
    });
  }

  public getBoneMapping(semantic: BoneSemantic): BoneMapping | undefined {
    const mapping = this.boneMap.get(semantic);
    return mapping ? cloneBoneMapping(mapping) : undefined;
  }

  public getAllBones(): BoneMapping[] {
    return [...this.boneMap.values()].map(cloneBoneMapping);
  }

  public setBoneRotation(
    semantic: BoneSemantic,
    rotation: [number, number, number, number],
  ): boolean {
    const bone = this.boneMap.get(semantic);
    const normalized = normalizeQuaternion(rotation);
    if (!bone || !normalized) return false;
    bone.rotation = normalized;
    return true;
  }

  public getMissingRequiredBones(): BoneSemantic[] {
    const required: BoneSemantic[] = [
      "hips", "spine", "chest", "neck", "head",
      "leftUpperArm", "leftLowerArm", "leftHand",
      "rightUpperArm", "rightLowerArm", "rightHand",
      "leftUpperLeg", "leftLowerLeg", "leftFoot",
      "rightUpperLeg", "rightLowerLeg", "rightFoot",
    ];
    return required.filter((b) => !this.boneMap.has(b));
  }

  // ── IK/FK ──

  public addIKChain(name: string, endEffector: BoneSemantic, chainLength: number): IKChain {
    const id = `ik-${this.nextId++}`;
    const chain: IKChain = {
      id,
      name,
      endEffectorBone: endEffector,
      chainLength: Number.isFinite(chainLength) ? Math.max(1, Math.trunc(chainLength)) : 1,
      targetPosition: [0, 0, 0],
      targetRotation: [0, 0, 0, 1],
      enabled: true,
      weight: 1.0,
    };
    this.ikChains.set(id, chain);
    return cloneIKChain(chain);
  }

  public setIKTarget(chainId: string, position: [number, number, number], rotation?: [number, number, number, number]): boolean {
    const chain = this.ikChains.get(chainId);
    const normalizedRotation = rotation ? normalizeQuaternion(rotation) : undefined;
    if (!chain || !isFiniteTuple(position) || (rotation && !normalizedRotation)) return false;
    chain.targetPosition = [...position];
    if (normalizedRotation) chain.targetRotation = normalizedRotation;
    return true;
  }

  public setIKWeight(chainId: string, weight: number): boolean {
    const chain = this.ikChains.get(chainId);
    if (!chain) return false;
    chain.weight = clamp01(weight);
    return true;
  }

  public setIKPoleTarget(chainId: string, poleTarget?: [number, number, number]): boolean {
    const chain = this.ikChains.get(chainId);
    if (!chain || (poleTarget && !isFiniteTuple(poleTarget))) return false;
    chain.poleTarget = poleTarget ? [...poleTarget] : undefined;
    return true;
  }

  public setIKEnabled(chainId: string, enabled: boolean): boolean {
    const chain = this.ikChains.get(chainId);
    if (!chain) return false;
    chain.enabled = enabled;
    return true;
  }

  public getAllIKChains(): IKChain[] {
    return [...this.ikChains.values()].map(cloneIKChain);
  }

  // ── Expression ──

  public setExpression(expression: VRMExpression, weight: number): void {
    this.expressionStates.set(expression, clamp01(weight));
  }

  public getExpressionWeight(expression: VRMExpression): number {
    return this.expressionStates.get(expression) ?? 0;
  }

  public getAllExpressions(): ExpressionState[] {
    return [...this.expressionStates.entries()].map(([expression, weight]) => ({ expression, weight }));
  }

  public resetExpressions(): void {
    this.expressionStates.clear();
  }

  // ── LookAt ──

  public setLookAt(target: LookAtTarget): void {
    const direction = target.direction && isFiniteTuple(target.direction)
      ? [...target.direction] as [number, number, number]
      : undefined;
    this.lookAt = {
      mode: target.mode,
      targetId: target.targetId,
      direction,
      headWeight: clamp01(target.headWeight),
      eyeWeight: clamp01(target.eyeWeight),
    };
  }

  public getLookAt(): LookAtTarget {
    return {
      ...this.lookAt,
      direction: this.lookAt.direction ? [...this.lookAt.direction] : undefined,
    };
  }

  // ── Pose Library ──

  public savePose(name: string, category: string): PosePreset {
    const id = `pose-${this.nextId++}`;
    const boneRotations: Partial<Record<BoneSemantic, [number, number, number, number]>> = {};
    for (const [semantic, mapping] of this.boneMap) {
      boneRotations[semantic] = [...mapping.rotation] as [number, number, number, number];
    }

    const preset: PosePreset = {
      id,
      name,
      category,
      boneRotations,
      expressions: this.getAllExpressions(),
    };
    this.poseLibrary.push(preset);
    return clonePosePreset(preset);
  }

  public loadPose(poseId: string): boolean {
    const preset = this.poseLibrary.find((p) => p.id === poseId);
    if (!preset) return false;

    for (const [semantic, rotation] of Object.entries(preset.boneRotations)) {
      const bone = this.boneMap.get(semantic as BoneSemantic);
      const normalized = rotation
        ? normalizeQuaternion(rotation as [number, number, number, number])
        : undefined;
      if (bone && normalized) {
        bone.rotation = normalized;
      }
    }

    this.resetExpressions();
    for (const expr of preset.expressions) {
      this.setExpression(expr.expression, expr.weight);
    }

    return true;
  }

  public getPoseLibrary(): PosePreset[] {
    return this.poseLibrary.map(clonePosePreset);
  }

  public getPosesByCategory(category: string): PosePreset[] {
    return this.poseLibrary.filter((p) => p.category === category).map(clonePosePreset);
  }

  public removePose(poseId: string): boolean {
    const index = this.poseLibrary.findIndex((pose) => pose.id === poseId);
    if (index < 0) return false;
    this.poseLibrary.splice(index, 1);
    return true;
  }

  // ── 기본 포즈 프리셋 ──

  public static getDefaultHandPresets(): Array<{ name: string; category: string }> {
    return [
      { name: "주먹 (Fist)", category: "hand" },
      { name: "가위 (Scissors)", category: "hand" },
      { name: "보자기 (Paper)", category: "hand" },
      { name: "하트 (Heart)", category: "hand" },
      { name: "브이 (V-Sign)", category: "hand" },
      { name: "엄지 척 (Thumb Up)", category: "hand" },
      { name: "검지 가리키기 (Point)", category: "hand" },
      { name: "잡기 (Grip)", category: "hand" },
      { name: "자연스럽게 펴기 (Relaxed)", category: "hand" },
    ];
  }
}
