"""M10 固定场景的确定性太阳位置计算。

计算采用 Meeus/NOAA 的太阳几何公式，并按 NREL SPA 的方位角约定输出：
正北为 0 度、顺时针增加。它不使用天气、系统当前时间或远程服务，也不
宣称达到 NREL 官方 C 实现的 0.0003 度不确定度。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import math
from zoneinfo import ZoneInfo

from .config import ShadeConfig


@dataclass(frozen=True)
class SolarPosition:
    """方位角从正北顺时针，高度角从地平线向上。"""

    azimuth_degrees: float
    elevation_degrees: float


def _julian_day(instant: datetime) -> float:
    utc = instant.astimezone(UTC)
    year = utc.year
    month = utc.month
    day_fraction = (
        utc.day
        + (utc.hour + (utc.minute + (utc.second + utc.microsecond / 1_000_000) / 60) / 60)
        / 24
    )
    if month <= 2:
        year -= 1
        month += 12
    century = math.floor(year / 100)
    correction = 2 - century + math.floor(century / 4)
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day_fraction
        + correction
        - 1524.5
    )


def _mean_obliquity_degrees(centuries: float) -> float:
    seconds = 21.448 - centuries * (
        46.815 + centuries * (0.00059 - centuries * 0.001813)
    )
    return 23 + (26 + seconds / 60) / 60


def solar_position(
    instant: datetime,
    latitude: float,
    longitude: float,
) -> SolarPosition:
    """返回给定时刻的几何太阳方位角与高度角。

    ``instant`` 必须带时区；经纬度使用 WGS84 十进制度，东经为正。
    返回值不应用大气折射，符合 M10 离线几何阴影所需的确定性输入。
    """

    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("instant must be timezone-aware")
    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise ValueError("latitude must be within [-90, 90]")
    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise ValueError("longitude must be within [-180, 180]")

    julian_centuries = (_julian_day(instant) - 2451545.0) / 36525.0
    mean_longitude = (
        280.46646
        + julian_centuries * (36000.76983 + julian_centuries * 0.0003032)
    ) % 360
    mean_anomaly = math.radians(
        357.52911
        + julian_centuries * (35999.05029 - 0.0001537 * julian_centuries)
    )
    eccentricity = 0.016708634 - julian_centuries * (
        0.000042037 + 0.0000001267 * julian_centuries
    )
    equation_of_center = (
        math.sin(mean_anomaly)
        * (1.914602 - julian_centuries * (0.004817 + 0.000014 * julian_centuries))
        + math.sin(2 * mean_anomaly) * (0.019993 - 0.000101 * julian_centuries)
        + math.sin(3 * mean_anomaly) * 0.000289
    )
    true_longitude = mean_longitude + equation_of_center
    omega = math.radians(125.04 - 1934.136 * julian_centuries)
    apparent_longitude = math.radians(
        true_longitude - 0.00569 - 0.00478 * math.sin(omega)
    )
    corrected_obliquity = math.radians(
        _mean_obliquity_degrees(julian_centuries) + 0.00256 * math.cos(omega)
    )
    declination = math.asin(
        math.sin(corrected_obliquity) * math.sin(apparent_longitude)
    )

    y = math.tan(corrected_obliquity / 2) ** 2
    longitude_radians = math.radians(mean_longitude)
    equation_of_time = 4 * math.degrees(
        y * math.sin(2 * longitude_radians)
        - 2 * eccentricity * math.sin(mean_anomaly)
        + 4
        * eccentricity
        * y
        * math.sin(mean_anomaly)
        * math.cos(2 * longitude_radians)
        - 0.5 * y * y * math.sin(4 * longitude_radians)
        - 1.25 * eccentricity * eccentricity * math.sin(2 * mean_anomaly)
    )

    utc = instant.astimezone(UTC)
    utc_minutes = (
        utc.hour * 60
        + utc.minute
        + utc.second / 60
        + utc.microsecond / 60_000_000
    )
    true_solar_minutes = (utc_minutes + equation_of_time + 4 * longitude) % 1440
    hour_angle_degrees = true_solar_minutes / 4 - 180
    hour_angle = math.radians(hour_angle_degrees)
    latitude_radians = math.radians(latitude)

    cosine_zenith = (
        math.sin(latitude_radians) * math.sin(declination)
        + math.cos(latitude_radians) * math.cos(declination) * math.cos(hour_angle)
    )
    zenith = math.acos(max(-1.0, min(1.0, cosine_zenith)))
    elevation = 90 - math.degrees(zenith)
    azimuth = (
        math.degrees(
            math.atan2(
                math.sin(hour_angle),
                math.cos(hour_angle) * math.sin(latitude_radians)
                - math.tan(declination) * math.cos(latitude_radians),
            )
        )
        + 180
    ) % 360
    return SolarPosition(
        azimuth_degrees=round(azimuth, 6),
        elevation_degrees=round(elevation, 6),
    )


def build_solar_scenarios(
    config: ShadeConfig,
    center: tuple[float, float],
) -> dict[str, SolarPosition]:
    """为配置中的固定本地时间构建有序太阳场景。"""

    longitude, latitude = center
    timezone = ZoneInfo(config.timezone)
    positions: dict[str, SolarPosition] = {}
    for scenario in config.scenarios:
        hour_text, minute_text = scenario.split(":", maxsplit=1)
        instant = datetime.combine(
            config.reference_date,
            datetime.min.time(),
            tzinfo=timezone,
        ).replace(hour=int(hour_text), minute=int(minute_text))
        positions[scenario] = solar_position(instant, latitude, longitude)
    return positions
