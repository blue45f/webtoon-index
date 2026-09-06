"""Pure configuration and report contracts for the ToonStudio Blender pipeline.

This module intentionally has no ``bpy`` dependency.  It is imported by Blender,
GitHub Actions, the MCP dispatcher, and ordinary Python unit tests.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any, Iterable, Literal, Mapping, Sequence

PIPELINE_VERSION = 1
BLENDER_MIN_VERSION = (5, 2, 0)
VRM_ADDON_MIN_VERSION = (4, 5, 0)
DEFAULT_BLENDER_VERSION = "5.2.1"
DEFAULT_VRM_ADDON_VERSION = "4.5.0"

Severity = Literal["info", "warning", "error"]
PipelineMode = Literal["audit", "upgrade", "reference"]
HairStyle = Literal[
    "short-layered",
    "soft-bob",
    "romance-long",
    "action-pony",
    "hime-cut",
    "wolf-layered",
]

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,62}$")
HEX_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


class ContractError(ValueError):
    """Raised when a pipeline request is unsafe or structurally invalid."""


@dataclass(frozen=True)
class QualityBudget:
    max_triangles_lod0: int = 120_000
    max_triangles_lod1: int = 65_000
    max_triangles_lod2: int = 30_000
    max_hair_triangles_lod0: int = 36_000
    max_hair_materials: int = 3
    max_vertex_influences: int = 4
    max_texture_size: int = 4096
    max_unapplied_scale_delta: float = 0.001
    max_degenerate_faces: int = 0
    max_non_manifold_edges: int = 0
    minimum_score: int = 86

    def validate(self) -> None:
        numeric = asdict(self)
        for key, value in numeric.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ContractError(f"quality.{key} must be numeric")
            if key == "minimum_score":
                if not 0 <= value <= 100:
                    raise ContractError("quality.minimum_score must be between 0 and 100")
            elif value < 0:
                raise ContractError(f"quality.{key} must be non-negative")
        if not (
            self.max_triangles_lod2 <= self.max_triangles_lod1 <= self.max_triangles_lod0
        ):
            raise ContractError("triangle budgets must descend from LOD0 to LOD2")
        if self.max_vertex_influences < 1:
            raise ContractError("quality.max_vertex_influences must be at least 1")
        if self.max_hair_materials < 1:
            raise ContractError("quality.max_hair_materials must be at least 1")


@dataclass(frozen=True)
class Palette:
    base: str = "#2a2026"
    shadow: str = "#120e13"
    highlight: str = "#785a70"
    outline: str = "#09070a"

    def validate(self) -> None:
        for key, value in asdict(self).items():
            if not HEX_PATTERN.fullmatch(value):
                raise ContractError(f"palette.{key} must be a six-digit hex colour")


@dataclass(frozen=True)
class HairOptions:
    enabled: bool = True
    style: HairStyle = "soft-bob"
    replace_detected_hair: bool = False
    volume: float = 1.0
    length: float = 1.0
    fringe: float = 0.72
    wave: float = 0.18
    clump_density: float = 1.0
    generate_lods: bool = True
    palette: Palette = field(default_factory=Palette)

    def validate(self) -> None:
        if self.style not in HAIR_STYLE_PRESETS:
            raise ContractError(f"unsupported hair style: {self.style}")
        for key in ("volume", "length", "clump_density"):
            value = getattr(self, key)
            if not 0.5 <= value <= 1.8:
                raise ContractError(f"hair.{key} must be between 0.5 and 1.8")
        for key in ("fringe", "wave"):
            value = getattr(self, key)
            if not 0 <= value <= 1:
                raise ContractError(f"hair.{key} must be between 0 and 1")
        self.palette.validate()


@dataclass(frozen=True)
class FaceOptions:
    create_semantic_shape_keys: bool = True
    preserve_expression_shape_keys: bool = True
    require_explicit_face_mesh: bool = False
    maximum_displacement_ratio: float = 0.035
    minimum_detection_confidence: float = 0.72

    def validate(self) -> None:
        if not 0.005 <= self.maximum_displacement_ratio <= 0.08:
            raise ContractError(
                "face.maximum_displacement_ratio must be between 0.005 and 0.08"
            )
        if not 0 <= self.minimum_detection_confidence <= 1:
            raise ContractError(
                "face.minimum_detection_confidence must be between 0 and 1"
            )


@dataclass(frozen=True)
class RenderOptions:
    enabled: bool = True
    resolution: int = 768
    transparent: bool = True
    samples: int = 32
    views: tuple[str, ...] = ("front", "three-quarter", "side", "back")
    expressions: tuple[str, ...] = ("neutral", "happy", "angry", "surprised", "blink")

    def validate(self) -> None:
        if not 256 <= self.resolution <= 2048:
            raise ContractError("render.resolution must be between 256 and 2048")
        if not 1 <= self.samples <= 256:
            raise ContractError("render.samples must be between 1 and 256")
        allowed_views = {"front", "three-quarter", "side", "back"}
        if not self.views or any(view not in allowed_views for view in self.views):
            raise ContractError("render.views contains an unsupported view")
        if len(set(self.views)) != len(self.views):
            raise ContractError("render.views must not contain duplicates")
        if not self.expressions or any(not value.strip() for value in self.expressions):
            raise ContractError("render.expressions must contain non-empty names")
        if len(set(self.expressions)) != len(self.expressions):
            raise ContractError("render.expressions must not contain duplicates")
        if len(self.expressions) > 12:
            raise ContractError("render.expressions is limited to 12 review states")


@dataclass(frozen=True)
class ExportOptions:
    glb: bool = True
    vrm: bool = True
    blend: bool = True
    embed_textures: bool = True
    apply_modifiers: bool = False
    export_animations: bool = True
    export_morph_normals: bool = True

    def validate(self) -> None:
        if not (self.glb or self.vrm or self.blend):
            raise ContractError("at least one export format must be enabled")


@dataclass(frozen=True)
class PipelineConfig:
    version: int
    character_id: str
    display_name: str
    mode: PipelineMode = "upgrade"
    input_path: str | None = None
    output_dir: str = "batch_generated/blender-character"
    strict: bool = True
    hair: HairOptions = field(default_factory=HairOptions)
    face: FaceOptions = field(default_factory=FaceOptions)
    render: RenderOptions = field(default_factory=RenderOptions)
    export: ExportOptions = field(default_factory=ExportOptions)
    quality: QualityBudget = field(default_factory=QualityBudget)
    provenance: Mapping[str, str] = field(default_factory=dict)

    def validate(self) -> None: # NOSONAR python:S3776
        if self.version != PIPELINE_VERSION:
            raise ContractError(
                f"config version {self.version!r} is unsupported; expected {PIPELINE_VERSION}"
            )
        if not SLUG_PATTERN.fullmatch(self.character_id):
            raise ContractError(
                "character_id must be a 2-63 character lower-case slug"
            )
        if not self.display_name.strip() or len(self.display_name.strip()) > 100:
            raise ContractError("display_name must contain 1-100 visible characters")
        if self.mode not in {"audit", "upgrade", "reference"}:
            raise ContractError(f"unsupported pipeline mode: {self.mode}")
        if self.mode != "reference" and not self.input_path:
            raise ContractError("input_path is required unless mode is reference")
        output = Path(self.output_dir)
        if ".." in output.parts or "\x00" in self.output_dir:
            raise ContractError("output_dir must not contain parent traversal or null bytes")
        if self.input_path and "\x00" in self.input_path:
            raise ContractError("input_path contains a null byte")
        self.hair.validate()
        self.face.validate()
        self.render.validate()
        self.export.validate()
        self.quality.validate()
        for key, value in self.provenance.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise ContractError("provenance keys and values must be strings")
            if len(key) > 80 or len(value) > 500:
                raise ContractError("provenance entry exceeds the allowed length")
        expected_source_sha = self.provenance.get("sourceSha256")
        if expected_source_sha and not SHA256_PATTERN.fullmatch(expected_source_sha):
            raise ContractError("provenance.sourceSha256 must be a 64-character hex digest")

    def canonical_mapping(self) -> dict[str, Any]:
        return _canonical(asdict(self))

    def digest(self) -> str:
        payload = json.dumps(
            self.canonical_mapping(), ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return sha256(payload).hexdigest()


@dataclass(frozen=True)
class QualityIssue:
    code: str
    severity: Severity
    message: str
    object_name: str | None = None
    metric: float | int | str | None = None
    limit: float | int | str | None = None
    repair_hint: str | None = None

    def to_mapping(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass(frozen=True)
class PipelineReport:
    character_id: str
    config_digest: str
    blender_version: str
    vrm_addon_version: str | None
    score: int
    passed: bool
    metrics: Mapping[str, Any]
    issues: tuple[QualityIssue, ...]
    outputs: Mapping[str, str]

    def to_mapping(self) -> dict[str, Any]:
        return {
            "pipelineVersion": PIPELINE_VERSION,
            "characterId": self.character_id,
            "configDigest": self.config_digest,
            "blenderVersion": self.blender_version,
            "vrmAddonVersion": self.vrm_addon_version,
            "score": self.score,
            "passed": self.passed,
            "metrics": _canonical(dict(self.metrics)),
            "issues": [issue.to_mapping() for issue in self.issues],
            "outputs": dict(sorted(self.outputs.items())),
        }


def _canonical(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _canonical(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonical(entry) for entry in value]
    return value


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{name} must be an object")
    return value


def _bool(source: Mapping[str, Any], key: str, fallback: bool) -> bool:
    value = source.get(key, fallback)
    if not isinstance(value, bool):
        raise ContractError(f"{key} must be boolean")
    return value


def _float(source: Mapping[str, Any], key: str, fallback: float) -> float:
    value = source.get(key, fallback)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{key} must be numeric")
    return float(value)


def _int(source: Mapping[str, Any], key: str, fallback: int) -> int:
    value = source.get(key, fallback)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(f"{key} must be an integer")
    return value


def _str(source: Mapping[str, Any], key: str, fallback: str) -> str:
    value = source.get(key, fallback)
    if not isinstance(value, str):
        raise ContractError(f"{key} must be a string")
    return value


def parse_config(raw: Mapping[str, Any]) -> PipelineConfig:
    source = _mapping(raw, "config")
    hair_source = _mapping(source.get("hair", {}), "hair")
    face_source = _mapping(source.get("face", {}), "face")
    render_source = _mapping(source.get("render", {}), "render")
    export_source = _mapping(source.get("export", {}), "export")
    quality_source = _mapping(source.get("quality", {}), "quality")
    palette_source = _mapping(hair_source.get("palette", {}), "hair.palette")
    provenance_source = _mapping(source.get("provenance", {}), "provenance")

    default_quality = QualityBudget()
    default_hair = HairOptions()
    default_face = FaceOptions()
    default_render = RenderOptions()
    default_export = ExportOptions()

    palette = Palette(
        base=_str(palette_source, "base", default_hair.palette.base),
        shadow=_str(palette_source, "shadow", default_hair.palette.shadow),
        highlight=_str(palette_source, "highlight", default_hair.palette.highlight),
        outline=_str(palette_source, "outline", default_hair.palette.outline),
    )
    hair = HairOptions(
        enabled=_bool(hair_source, "enabled", default_hair.enabled),
        style=_str(hair_source, "style", default_hair.style),  # type: ignore[arg-type]
        replace_detected_hair=_bool(
            hair_source, "replaceDetectedHair", default_hair.replace_detected_hair
        ),
        volume=_float(hair_source, "volume", default_hair.volume),
        length=_float(hair_source, "length", default_hair.length),
        fringe=_float(hair_source, "fringe", default_hair.fringe),
        wave=_float(hair_source, "wave", default_hair.wave),
        clump_density=_float(
            hair_source, "clumpDensity", default_hair.clump_density
        ),
        generate_lods=_bool(
            hair_source, "generateLods", default_hair.generate_lods
        ),
        palette=palette,
    )
    face = FaceOptions(
        create_semantic_shape_keys=_bool(
            face_source,
            "createSemanticShapeKeys",
            default_face.create_semantic_shape_keys,
        ),
        preserve_expression_shape_keys=_bool(
            face_source,
            "preserveExpressionShapeKeys",
            default_face.preserve_expression_shape_keys,
        ),
        require_explicit_face_mesh=_bool(
            face_source,
            "requireExplicitFaceMesh",
            default_face.require_explicit_face_mesh,
        ),
        maximum_displacement_ratio=_float(
            face_source,
            "maximumDisplacementRatio",
            default_face.maximum_displacement_ratio,
        ),
        minimum_detection_confidence=_float(
            face_source,
            "minimumDetectionConfidence",
            default_face.minimum_detection_confidence,
        ),
    )
    views = render_source.get("views", list(default_render.views))
    expressions = render_source.get("expressions", list(default_render.expressions))
    if not isinstance(views, Sequence) or isinstance(views, (str, bytes)):
        raise ContractError("render.views must be an array")
    if not isinstance(expressions, Sequence) or isinstance(expressions, (str, bytes)):
        raise ContractError("render.expressions must be an array")
    render = RenderOptions(
        enabled=_bool(render_source, "enabled", default_render.enabled),
        resolution=_int(render_source, "resolution", default_render.resolution),
        transparent=_bool(render_source, "transparent", default_render.transparent),
        samples=_int(render_source, "samples", default_render.samples),
        views=tuple(str(value) for value in views),
        expressions=tuple(str(value) for value in expressions),
    )
    export = ExportOptions(
        glb=_bool(export_source, "glb", default_export.glb),
        vrm=_bool(export_source, "vrm", default_export.vrm),
        blend=_bool(export_source, "blend", default_export.blend),
        embed_textures=_bool(
            export_source, "embedTextures", default_export.embed_textures
        ),
        apply_modifiers=_bool(
            export_source, "applyModifiers", default_export.apply_modifiers
        ),
        export_animations=_bool(
            export_source, "exportAnimations", default_export.export_animations
        ),
        export_morph_normals=_bool(
            export_source, "exportMorphNormals", default_export.export_morph_normals
        ),
    )
    quality = QualityBudget(
        max_triangles_lod0=_int(
            quality_source, "maxTrianglesLod0", default_quality.max_triangles_lod0
        ),
        max_triangles_lod1=_int(
            quality_source, "maxTrianglesLod1", default_quality.max_triangles_lod1
        ),
        max_triangles_lod2=_int(
            quality_source, "maxTrianglesLod2", default_quality.max_triangles_lod2
        ),
        max_hair_triangles_lod0=_int(
            quality_source,
            "maxHairTrianglesLod0",
            default_quality.max_hair_triangles_lod0,
        ),
        max_hair_materials=_int(
            quality_source, "maxHairMaterials", default_quality.max_hair_materials
        ),
        max_vertex_influences=_int(
            quality_source,
            "maxVertexInfluences",
            default_quality.max_vertex_influences,
        ),
        max_texture_size=_int(
            quality_source, "maxTextureSize", default_quality.max_texture_size
        ),
        max_unapplied_scale_delta=_float(
            quality_source,
            "maxUnappliedScaleDelta",
            default_quality.max_unapplied_scale_delta,
        ),
        max_degenerate_faces=_int(
            quality_source,
            "maxDegenerateFaces",
            default_quality.max_degenerate_faces,
        ),
        max_non_manifold_edges=_int(
            quality_source,
            "maxNonManifoldEdges",
            default_quality.max_non_manifold_edges,
        ),
        minimum_score=_int(
            quality_source, "minimumScore", default_quality.minimum_score
        ),
    )
    provenance = {str(key): str(value) for key, value in provenance_source.items()}
    config = PipelineConfig(
        version=_int(source, "version", PIPELINE_VERSION),
        character_id=_str(source, "characterId", "reference-character"),
        display_name=_str(source, "displayName", "Reference Character"),
        mode=_str(source, "mode", "upgrade"),  # type: ignore[arg-type]
        input_path=(
            _str(source, "inputPath", "").strip()
            if source.get("inputPath") is not None
            else None
        )
        or None,
        output_dir=_str(
            source, "outputDir", "batch_generated/blender-character"
        ),
        strict=_bool(source, "strict", True),
        hair=hair,
        face=face,
        render=render,
        export=export,
        quality=quality,
        provenance=provenance,
    )
    config.validate()
    return config


def load_config(path: str | Path) -> PipelineConfig:
    target = Path(path)
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ContractError(f"config file does not exist: {target}") from error
    except json.JSONDecodeError as error:
        raise ContractError(f"config JSON is invalid: {error}") from error
    return parse_config(_mapping(raw, "config"))


def write_json(path: str | Path, value: Mapping[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(_canonical(dict(value)), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def calculate_score(issues: Iterable[QualityIssue]) -> int:
    score = 100
    for issue in issues:
        if issue.severity == "error":
            score -= 18
        elif issue.severity == "warning":
            score -= 6
        else:
            score -= 0
    return max(0, min(100, score))


HAIR_STYLE_PRESETS: Mapping[str, Mapping[str, Any]] = {
    "short-layered": {
        "label": "Short Layered",
        "backLength": 0.48,
        "sideLength": 0.58,
        "crownLift": 0.14,
        "tail": False,
        "symmetryBreak": 0.08,
    },
    "soft-bob": {
        "label": "Soft Bob",
        "backLength": 0.82,
        "sideLength": 0.88,
        "crownLift": 0.08,
        "tail": False,
        "symmetryBreak": 0.04,
    },
    "romance-long": {
        "label": "Romance Long",
        "backLength": 1.72,
        "sideLength": 1.44,
        "crownLift": 0.1,
        "tail": False,
        "symmetryBreak": 0.06,
    },
    "action-pony": {
        "label": "Action Ponytail",
        "backLength": 0.74,
        "sideLength": 0.76,
        "crownLift": 0.12,
        "tail": True,
        "symmetryBreak": 0.08,
    },
    "hime-cut": {
        "label": "Hime Cut",
        "backLength": 1.56,
        "sideLength": 1.2,
        "crownLift": 0.06,
        "tail": False,
        "symmetryBreak": 0.0,
    },
    "wolf-layered": {
        "label": "Wolf Layered",
        "backLength": 1.12,
        "sideLength": 0.88,
        "crownLift": 0.18,
        "tail": False,
        "symmetryBreak": 0.14,
    },
}

MCP_ALLOWED_COMMANDS = frozenset(
    {
        "inspect_character",
        "build_authored_hair",
        "create_semantic_face_shapes",
        "render_quality_views",
        "validate_character",
        "export_character_package",
        "run_pipeline",
    }
)
