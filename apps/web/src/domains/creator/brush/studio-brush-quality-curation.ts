/**
 * Quality-first brush catalogue curation.
 *
 * The curation layer never deletes a runtime id. It only produces exposure-removal suggestions
 * after committed long-stroke marks are visually near-identical. Saved documents therefore keep
 * resolving their original brush id and replay contract.
 */

export interface StudioBrushMarkFingerprint {
  /** Normalized 0..1 darkness field, row-major. */
  readonly darkness: readonly number[];
  /** Binary silhouette matching `darkness`, row-major. */
  readonly silhouette: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly toneHistogram: readonly number[];
  readonly horizontalProfile: readonly number[];
  readonly verticalProfile: readonly number[];
  readonly inkDensity: number;
  readonly edgeDensity: number;
  readonly gradientDensity: number;
  readonly textureEntropy: number;
}

export interface StudioBrushCurationCandidate {
  readonly id: string;
  /** Only candidates in the same comparison group may be collapsed. */
  readonly comparisonGroup: string;
  readonly listedOrder: number;
  readonly protectedFromCulling: boolean;
  readonly qualityPassed: boolean;
  readonly browserErrorCount: number;
  readonly refusedStrokeCount: number;
  readonly centerlineCoverage: number;
  readonly liveCommitFidelity: number;
  readonly settledStability: number;
  readonly inputDeliveryRatio: number;
  readonly frameP95Milliseconds: number;
  readonly textureQuality: number;
  readonly gpuApproved: boolean;
  readonly fingerprint: StudioBrushMarkFingerprint;
}

export interface StudioBrushSimilarityThresholds {
  readonly silhouetteIntersectionOverUnionMinimum: number;
  readonly darknessMeanAbsoluteErrorMaximum: number;
  readonly toneHistogramIntersectionMinimum: number;
  readonly horizontalProfileCorrelationMinimum: number;
  readonly verticalProfileCorrelationMinimum: number;
  readonly inkDensityRatioMinimum: number;
  readonly inkDensityRatioMaximum: number;
  readonly edgeDensityRatioMinimum: number;
  readonly edgeDensityRatioMaximum: number;
  readonly gradientDensityRatioMinimum: number;
  readonly gradientDensityRatioMaximum: number;
  readonly weightedDistanceMaximum: number;
}

export const STUDIO_BRUSH_SIMILARITY_THRESHOLDS: StudioBrushSimilarityThresholds =
  Object.freeze({
    silhouetteIntersectionOverUnionMinimum: 0.975,
    darknessMeanAbsoluteErrorMaximum: 0.035,
    toneHistogramIntersectionMinimum: 0.985,
    horizontalProfileCorrelationMinimum: 0.995,
    verticalProfileCorrelationMinimum: 0.995,
    inkDensityRatioMinimum: 0.9,
    inkDensityRatioMaximum: 1.1,
    edgeDensityRatioMinimum: 0.9,
    edgeDensityRatioMaximum: 1.1,
    gradientDensityRatioMinimum: 0.88,
    gradientDensityRatioMaximum: 1.12,
    weightedDistanceMaximum: 0.045,
  });

export interface StudioBrushPairSimilarity {
  readonly leftId: string;
  readonly rightId: string;
  readonly compatible: boolean;
  readonly duplicateCandidate: boolean;
  readonly silhouetteIntersectionOverUnion: number;
  readonly darknessMeanAbsoluteError: number;
  readonly toneHistogramIntersection: number;
  readonly horizontalProfileCorrelation: number;
  readonly verticalProfileCorrelation: number;
  readonly inkDensityRatio: number;
  readonly edgeDensityRatio: number;
  readonly gradientDensityRatio: number;
  readonly weightedDistance: number;
  readonly failedGates: readonly string[];
}

export interface StudioBrushCurationCluster {
  readonly comparisonGroup: string;
  readonly memberIds: readonly string[];
  readonly representativeId: string;
  readonly suggestedQuarantineIds: readonly string[];
  readonly pairEvidence: readonly StudioBrushPairSimilarity[];
  readonly confidence: number;
  readonly representativeReason: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function safeRatio(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  if (left <= 0 || right <= 0) return left === right ? 1 : Number.POSITIVE_INFINITY;
  return left / right;
}

function symmetricRatio(left: number, right: number): number {
  const ratio = safeRatio(left, right);
  if (!Number.isFinite(ratio) || ratio <= 0) return Number.POSITIVE_INFINITY;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = (left[index] ?? 0) - leftMean;
    const b = (right[index] ?? 0) - rightMean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  if (leftVariance <= 1e-15 || rightVariance <= 1e-15) {
    return left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= 1e-12)
      ? 1
      : 0;
  }
  return Math.max(-1, Math.min(1, numerator / Math.sqrt(leftVariance * rightVariance)));
}

function histogramIntersection(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let intersection = 0;
  for (let index = 0; index < left.length; index += 1) {
    intersection += Math.min(left[index] ?? 0, right[index] ?? 0);
  }
  return clamp01(intersection);
}

function silhouetteIntersectionOverUnion(
  left: StudioBrushMarkFingerprint,
  right: StudioBrushMarkFingerprint,
): number {
  if (
    left.width !== right.width
    || left.height !== right.height
    || left.silhouette.length !== right.silhouette.length
  ) return 0;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.silhouette.length; index += 1) {
    const a = (left.silhouette[index] ?? 0) >= 0.5;
    const b = (right.silhouette[index] ?? 0) >= 0.5;
    if (a && b) intersection += 1;
    if (a || b) union += 1;
  }
  return union > 0 ? intersection / union : 1;
}

function darknessMeanAbsoluteError(
  left: StudioBrushMarkFingerprint,
  right: StudioBrushMarkFingerprint,
): number {
  if (
    left.width !== right.width
    || left.height !== right.height
    || left.darkness.length !== right.darkness.length
    || left.darkness.length === 0
  ) return 1;
  let total = 0;
  for (let index = 0; index < left.darkness.length; index += 1) {
    total += Math.abs((left.darkness[index] ?? 0) - (right.darkness[index] ?? 0));
  }
  return total / left.darkness.length;
}

function ratioPenalty(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(1, Math.abs(Math.log(ratio)) / Math.log(2));
}

export function compareStudioBrushCurationCandidates(
  left: StudioBrushCurationCandidate,
  right: StudioBrushCurationCandidate,
  thresholds = STUDIO_BRUSH_SIMILARITY_THRESHOLDS,
): StudioBrushPairSimilarity {
  const compatible = left.id !== right.id
    && left.comparisonGroup.length > 0
    && left.comparisonGroup === right.comparisonGroup;
  const silhouetteIoU = compatible
    ? silhouetteIntersectionOverUnion(left.fingerprint, right.fingerprint)
    : 0;
  const darknessMae = compatible
    ? darknessMeanAbsoluteError(left.fingerprint, right.fingerprint)
    : 1;
  const toneIntersection = compatible
    ? histogramIntersection(left.fingerprint.toneHistogram, right.fingerprint.toneHistogram)
    : 0;
  const horizontalCorrelation = compatible
    ? correlation(left.fingerprint.horizontalProfile, right.fingerprint.horizontalProfile)
    : 0;
  const verticalCorrelation = compatible
    ? correlation(left.fingerprint.verticalProfile, right.fingerprint.verticalProfile)
    : 0;
  const inkDensityRatio = compatible
    ? safeRatio(left.fingerprint.inkDensity, right.fingerprint.inkDensity)
    : Number.POSITIVE_INFINITY;
  const edgeDensityRatio = compatible
    ? safeRatio(left.fingerprint.edgeDensity, right.fingerprint.edgeDensity)
    : Number.POSITIVE_INFINITY;
  const gradientDensityRatio = compatible
    ? safeRatio(left.fingerprint.gradientDensity, right.fingerprint.gradientDensity)
    : Number.POSITIVE_INFINITY;
  const weightedDistance = compatible
    ? 0.3 * (1 - silhouetteIoU)
      + 0.25 * darknessMae
      + 0.15 * (1 - toneIntersection)
      + 0.1 * (1 - Math.max(0, horizontalCorrelation))
      + 0.1 * (1 - Math.max(0, verticalCorrelation))
      + 0.04 * ratioPenalty(symmetricRatio(left.fingerprint.inkDensity, right.fingerprint.inkDensity))
      + 0.03 * ratioPenalty(symmetricRatio(left.fingerprint.edgeDensity, right.fingerprint.edgeDensity))
      + 0.03 * ratioPenalty(symmetricRatio(left.fingerprint.gradientDensity, right.fingerprint.gradientDensity))
    : 1;

  const failedGates: string[] = [];
  if (!compatible) failedGates.push("comparison-group");
  if (silhouetteIoU < thresholds.silhouetteIntersectionOverUnionMinimum) {
    failedGates.push("silhouette");
  }
  if (darknessMae > thresholds.darknessMeanAbsoluteErrorMaximum) {
    failedGates.push("darkness");
  }
  if (toneIntersection < thresholds.toneHistogramIntersectionMinimum) {
    failedGates.push("tone-histogram");
  }
  if (horizontalCorrelation < thresholds.horizontalProfileCorrelationMinimum) {
    failedGates.push("horizontal-profile");
  }
  if (verticalCorrelation < thresholds.verticalProfileCorrelationMinimum) {
    failedGates.push("vertical-profile");
  }
  if (
    inkDensityRatio < thresholds.inkDensityRatioMinimum
    || inkDensityRatio > thresholds.inkDensityRatioMaximum
  ) failedGates.push("ink-density");
  if (
    edgeDensityRatio < thresholds.edgeDensityRatioMinimum
    || edgeDensityRatio > thresholds.edgeDensityRatioMaximum
  ) failedGates.push("edge-density");
  if (
    gradientDensityRatio < thresholds.gradientDensityRatioMinimum
    || gradientDensityRatio > thresholds.gradientDensityRatioMaximum
  ) failedGates.push("gradient-density");
  if (weightedDistance > thresholds.weightedDistanceMaximum) {
    failedGates.push("weighted-distance");
  }

  return Object.freeze({
    leftId: left.id,
    rightId: right.id,
    compatible,
    duplicateCandidate: compatible && failedGates.length === 0,
    silhouetteIntersectionOverUnion: silhouetteIoU,
    darknessMeanAbsoluteError: darknessMae,
    toneHistogramIntersection: toneIntersection,
    horizontalProfileCorrelation: horizontalCorrelation,
    verticalProfileCorrelation: verticalCorrelation,
    inkDensityRatio,
    edgeDensityRatio,
    gradientDensityRatio,
    weightedDistance,
    failedGates: Object.freeze(failedGates),
  });
}

function candidateQualityScore(candidate: StudioBrushCurationCandidate): number {
  if (!candidate.qualityPassed) return -1;
  const errorPenalty = Math.min(1, candidate.browserErrorCount * 0.25)
    + Math.min(1, candidate.refusedStrokeCount * 0.25);
  // This score deliberately excludes frame time. The representative is chosen by mark
  // quality and interaction fidelity; GPU/backend performance is considered only after
  // the measured quality score is tied.
  return 0.25 * clamp01(candidate.textureQuality)
    + 0.25 * clamp01(candidate.liveCommitFidelity)
    + 0.2 * clamp01(candidate.centerlineCoverage)
    + 0.15 * clamp01(candidate.settledStability)
    + 0.15 * clamp01(candidate.inputDeliveryRatio)
    - 0.2 * errorPenalty;
}

function representativeComparator(
  left: StudioBrushCurationCandidate,
  right: StudioBrushCurationCandidate,
): number {
  // An exposed canonical is never more important than a mark that actually passed the
  // measured quality contract. Protection only resolves a genuine quality tie.
  if (left.qualityPassed !== right.qualityPassed) return left.qualityPassed ? -1 : 1;
  const leftScore = candidateQualityScore(left);
  const rightScore = candidateQualityScore(right);
  const qualityDelta = leftScore - rightScore;
  if (Math.abs(qualityDelta) > 0.005) return qualityDelta > 0 ? -1 : 1;
  if (left.protectedFromCulling !== right.protectedFromCulling) {
    return left.protectedFromCulling ? -1 : 1;
  }
  // GPU is only a tie-breaker after quality is effectively equal.
  if (left.gpuApproved !== right.gpuApproved) return left.gpuApproved ? -1 : 1;
  if (left.frameP95Milliseconds !== right.frameP95Milliseconds) {
    return left.frameP95Milliseconds - right.frameP95Milliseconds;
  }
  if (left.listedOrder !== right.listedOrder) return left.listedOrder - right.listedOrder;
  return left.id.localeCompare(right.id);
}

function pairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`;
}

function clusterPairEvidence(
  members: readonly StudioBrushCurationCandidate[],
  pairByKey: ReadonlyMap<string, StudioBrushPairSimilarity>,
): StudioBrushPairSimilarity[] {
  const evidence: StudioBrushPairSimilarity[] = [];
  for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
      const left = members[leftIndex];
      const right = members[rightIndex];
      if (!left || !right) continue;
      const pair = pairByKey.get(pairKey(left.id, right.id));
      if (pair) evidence.push(pair);
    }
  }
  return evidence.sort((left, right) =>
    left.weightedDistance - right.weightedDistance
      || left.leftId.localeCompare(right.leftId)
      || left.rightId.localeCompare(right.rightId));
}

function clustersCanMerge(
  left: readonly StudioBrushCurationCandidate[],
  right: readonly StudioBrushCurationCandidate[],
  pairByKey: ReadonlyMap<string, StudioBrushPairSimilarity>,
): boolean {
  return left.every((a) => right.every((b) =>
    pairByKey.get(pairKey(a.id, b.id))?.duplicateCandidate === true));
}

/**
 * Complete-link clustering prevents the A≈B≈C chaining problem: every pair in a cluster must pass
 * every hard visual gate. The result is an auditable suggestion only; runtime ids are never removed.
 */
export function curateStudioBrushCandidates(
  candidates: readonly StudioBrushCurationCandidate[],
  thresholds = STUDIO_BRUSH_SIMILARITY_THRESHOLDS,
): readonly StudioBrushCurationCluster[] {
  const unique = new Map<string, StudioBrushCurationCandidate>();
  for (const candidate of candidates) {
    if (candidate.id.length === 0 || unique.has(candidate.id)) continue;
    unique.set(candidate.id, candidate);
  }
  const sorted = [...unique.values()].sort((left, right) =>
    left.comparisonGroup.localeCompare(right.comparisonGroup)
      || left.listedOrder - right.listedOrder
      || left.id.localeCompare(right.id));
  const pairByKey = new Map<string, StudioBrushPairSimilarity>();
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      if (!left || !right || left.comparisonGroup !== right.comparisonGroup) continue;
      const pair = compareStudioBrushCurationCandidates(left, right, thresholds);
      pairByKey.set(pairKey(left.id, right.id), pair);
    }
  }

  const output: StudioBrushCurationCluster[] = [];
  const groups = new Map<string, StudioBrushCurationCandidate[]>();
  for (const candidate of sorted) {
    const group = groups.get(candidate.comparisonGroup) ?? [];
    group.push(candidate);
    groups.set(candidate.comparisonGroup, group);
  }

  for (const [comparisonGroup, groupCandidates] of groups) {
    let clusters = groupCandidates.map((candidate) => [candidate]);
    for (;;) {
      let best: { leftIndex: number; rightIndex: number; distance: number } | null = null;
      for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
          const left = clusters[leftIndex];
          const right = clusters[rightIndex];
          if (!left || !right || !clustersCanMerge(left, right, pairByKey)) continue;
          const crossDistances = left.flatMap((a) => right.map((b) =>
            pairByKey.get(pairKey(a.id, b.id))?.weightedDistance ?? 1));
          const distance = Math.max(...crossDistances);
          if (
            !best
            || distance < best.distance
            || (distance === best.distance && leftIndex < best.leftIndex)
          ) best = { leftIndex, rightIndex, distance };
        }
      }
      if (!best) break;
      const left = clusters[best.leftIndex] ?? [];
      const right = clusters[best.rightIndex] ?? [];
      const merged = [...left, ...right].sort((a, b) =>
        a.listedOrder - b.listedOrder || a.id.localeCompare(b.id));
      clusters = clusters.filter((_, index) =>
        index !== best?.leftIndex && index !== best?.rightIndex);
      clusters.push(merged);
    }

    for (const members of clusters.filter((cluster) => cluster.length > 1)) {
      const ranked = [...members].sort(representativeComparator);
      const representative = ranked[0];
      if (!representative) continue;
      const pairEvidence = clusterPairEvidence(members, pairByKey);
      const worstDistance = Math.max(...pairEvidence.map((pair) => pair.weightedDistance), 0);
      const protectedMembers = members.filter((candidate) => candidate.protectedFromCulling);
      const suggestedQuarantineIds = protectedMembers.length > 1
        ? []
        : ranked.slice(1).map((candidate) => candidate.id).sort();
      const reasonParts = [
        `quality=${candidateQualityScore(representative).toFixed(4)}`,
        representative.protectedFromCulling ? "protected-canonical" : "quality-winner",
        representative.gpuApproved ? "GPU tie-break eligible" : "incumbent backend",
      ];
      if (protectedMembers.length > 1) reasonParts.push("manual-review: multiple protected brushes");
      output.push(Object.freeze({
        comparisonGroup,
        memberIds: Object.freeze(members.map((candidate) => candidate.id).sort()),
        representativeId: representative.id,
        suggestedQuarantineIds: Object.freeze(suggestedQuarantineIds),
        pairEvidence: Object.freeze(pairEvidence),
        confidence: clamp01(1 - worstDistance / thresholds.weightedDistanceMaximum),
        representativeReason: reasonParts.join("; "),
      }));
    }
  }

  return Object.freeze(output.sort((left, right) =>
    right.confidence - left.confidence
      || left.comparisonGroup.localeCompare(right.comparisonGroup)
      || left.representativeId.localeCompare(right.representativeId)));
}
