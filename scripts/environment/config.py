from dataclasses import dataclass


@dataclass(frozen=True)
class GreenLayerDefinition:
    official_name: str
    official_definition: str
    include: bool | None
    reason: str


@dataclass(frozen=True)
class EnvironmentConfig:
    projected_crs: str = "EPSG:6677"
    green_buffer_meters: float = 15.0
    water_penalty_thresholds: tuple[tuple[float, float], ...] = (
        (100.0, 0.0),
        (300.0, 0.3),
        (500.0, 0.6),
        (float("inf"), 1.0),
    )


ENVIRONMENT_CONFIG = EnvironmentConfig()
