/**
 * Studio 3D Character-Scene Mixer
 *
 * 3D VRM 캐릭터와 3D 배경(방, 건물, CAD 소품)을 하나의 3D DCC 세트장에
 * 믹스(Blending/Fusion)하고, 지면 접촉(Foot Contact), 가구 착석(Seating),
 * 소품 바인딩(Attachment), 다중 캐릭터 시선(LookAt), 조명/투음영 하모니 및
 * 카메라 투명 벽(Wall Cutaway)을 일괄 조율하는 고성능 엔진입니다.
 */

export interface ContactState {
  feetOnGround: boolean;
  groundY: number;
  seated: boolean;
  seatSurfaceY?: number;
  leaningOnSurface: boolean;
  surfaceContactY?: number;
  ankleTiltDeg: number;
  penetrationDistance: number;
}

export type InteractionStance =
  | "standing-ground"
  | "seated-chair"
  | "seated-floor-crosslegged"
  | "leaning-table"
  | "action-dynamic"
  | "floating-air";

export interface AttachmentContract {
  characterId: string;
  targetBone: "rightHand" | "leftHand" | "head" | "spine" | "hips" | "rightFoot" | "leftFoot";
  propId: string;
  propName: string;
  offsetPosition: [number, number, number];
  offsetRotationDeg?: [number, number, number];
  isDualGrip?: boolean;
  secondaryBone?: "leftHand" | "rightHand";
}

export interface LookAtTarget {
  mode: "camera" | "character" | "position" | "none";
  targetCharacterId?: string;
  targetWorldPosition?: [number, number, number];
}

export interface MixedCharacterNode {
  characterId: string;
  characterName: string;
  stance: InteractionStance;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  attachedProps: AttachmentContract[];
  contact: ContactState;
  lookAt: LookAtTarget;
}

export interface MixedSceneConfig {
  sceneId: string;
  sceneName: string;
  backgroundModelUrl?: string;
  sunDirection: [number, number, number];
  toonShadowBands: number;
  wallCutawayEnabled: boolean;
  characters: MixedCharacterNode[];
}

export class Studio3DCharacterSceneMixer {
  private config: MixedSceneConfig;

  constructor(sceneId: string, sceneName = "하이브리드 3D 믹스 세트장") {
    this.config = {
      sceneId,
      sceneName,
      sunDirection: [0.5, 1.0, 0.3],
      toonShadowBands: 2,
      wallCutawayEnabled: true,
      characters: [],
    };
  }

  public getConfig(): Readonly<MixedSceneConfig> {
    return this.config;
  }

  /**
   * 3D 세트장에 VRM 캐릭터를 소환하고 지면/바닥 접촉을 자동 조율합니다.
   */
  public addCharacter(
    characterId: string,
    characterName: string,
    initialPosition: [number, number, number] = [0, 0, 0],
    stance: InteractionStance = "standing-ground",
  ): MixedCharacterNode {
    const node: MixedCharacterNode = {
      characterId,
      characterName,
      stance,
      position: [...initialPosition],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      attachedProps: [],
      contact: {
        feetOnGround: stance === "standing-ground",
        groundY: 0,
        seated: stance === "seated-chair" || stance === "seated-floor-crosslegged",
        leaningOnSurface: stance === "leaning-table",
        ankleTiltDeg: 0,
        penetrationDistance: 0,
      },
      lookAt: {
        mode: "camera",
      },
    };

    // 지면 스냅 보정
    node.position[1] = Math.max(node.position[1], node.contact.groundY);
    this.config.characters.push(node);
    return node;
  }

  public removeCharacter(characterId: string): boolean {
    const idx = this.config.characters.findIndex((c) => c.characterId === characterId);
    if (idx === -1) return false;
    this.config.characters.splice(idx, 1);
    return true;
  }

  public getCharacter(characterId: string): MixedCharacterNode | undefined {
    return this.config.characters.find((c) => c.characterId === characterId);
  }

  /**
   * 3D 소품/배경 에셋을 캐릭터의 특정 본에 바인딩합니다 (단일/양손 그립 지원).
   */
  public attachPropToCharacter(
    characterId: string,
    propId: string,
    propName: string,
    targetBone: "rightHand" | "leftHand" | "head" | "spine" | "hips" | "rightFoot" | "leftFoot" = "rightHand",
    offsetPosition: [number, number, number] = [0, 0, 0],
    isDualGrip = false,
    secondaryBone?: "leftHand" | "rightHand",
  ): boolean {
    const charNode = this.config.characters.find((c) => c.characterId === characterId);
    if (!charNode) return false;

    const attachment: AttachmentContract = {
      characterId,
      targetBone,
      propId,
      propName,
      offsetPosition,
      isDualGrip,
      secondaryBone,
    };

    charNode.attachedProps.push(attachment);
    return true;
  }

  /**
   * 캐릭터 착석(Seating) 및 가구 인터랙션 적용
   */
  public applySeatingInteraction(
    characterId: string,
    seatSurfaceY = 0.45,
    seatForwardPos?: [number, number],
  ): boolean {
    const charNode = this.config.characters.find((c) => c.characterId === characterId);
    if (!charNode) return false;

    charNode.stance = "seated-chair";
    charNode.contact.seated = true;
    charNode.contact.seatSurfaceY = seatSurfaceY;
    charNode.contact.feetOnGround = true;
    charNode.position[1] = seatSurfaceY;

    if (seatForwardPos) {
      charNode.position[0] = seatForwardPos[0];
      charNode.position[2] = seatForwardPos[1];
    }
    return true;
  }

  /**
   * 다중 캐릭터 상호 시선(LookAt) 설정
   */
  public setCharacterLookAt(
    sourceCharId: string,
    lookAt: LookAtTarget,
  ): boolean {
    const charNode = this.config.characters.find((c) => c.characterId === sourceCharId);
    if (!charNode) return false;
    charNode.lookAt = lookAt;
    return true;
  }

  /**
   * 두 캐릭터 간 상호 대화 시선(Mutual Eye Contact) 자동 조율
   */
  public setupConversationStaging(charIdA: string, charIdB: string): boolean {
    const charA = this.config.characters.find((c) => c.characterId === charIdA);
    const charB = this.config.characters.find((c) => c.characterId === charIdB);
    if (!charA || !charB) return false;

    charA.lookAt = { mode: "character", targetCharacterId: charIdB };
    charB.lookAt = { mode: "character", targetCharacterId: charIdA };

    // 서로를 마주보도록 Y축 회전 계산
    const dx = charB.position[0] - charA.position[0];
    const dz = charB.position[2] - charA.position[2];
    const angleA = Math.atan2(dx, dz);
    const angleB = angleA + Math.PI;

    // Y축 쿼터니언 (간이)
    charA.rotation = [0, Math.sin(angleA / 2), 0, Math.cos(angleA / 2)];
    charB.rotation = [0, Math.sin(angleB / 2), 0, Math.cos(angleB / 2)];

    return true;
  }

  public setWallCutaway(enabled: boolean): void {
    this.config.wallCutawayEnabled = enabled;
  }

  public setToonShadowBands(bands: number): void {
    this.config.toonShadowBands = Math.max(1, Math.min(8, bands));
  }

  /**
   * 믹스 상태의 요약 보고서를 생성합니다.
   */
  public generateMixSummary(): {
    sceneName: string;
    characterCount: number;
    totalAttachedProps: number;
    wallCutawayActive: boolean;
    toonShadowBands: number;
    characters: Array<{ id: string; name: string; stance: InteractionStance; propCount: number }>;
  } {
    const totalAttachedProps = this.config.characters.reduce(
      (sum, c) => sum + c.attachedProps.length,
      0,
    );

    return {
      sceneName: this.config.sceneName,
      characterCount: this.config.characters.length,
      totalAttachedProps,
      wallCutawayActive: this.config.wallCutawayEnabled,
      toonShadowBands: this.config.toonShadowBands,
      characters: this.config.characters.map((c) => ({
        id: c.characterId,
        name: c.characterName,
        stance: c.stance,
        propCount: c.attachedProps.length,
      })),
    };
  }
}
