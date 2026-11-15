"""Localized fog monitoring engine for device-geolocated road networks.

Responsibilities:
1. Fetch local road graph via OSMnx around user coordinates.
2. Detect road-river intersections to flag bridge nodes as fog-prone.
3. Ingest live visibility from Open-Meteo; CAMS PM2.5 optional.
4. Compute per-segment and per-bridge risk levels against visibility thresholds.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple

import geopandas as gpd
import osmnx as ox
import requests
from dotenv import load_dotenv
from shapely.geometry import LineString
from shapely.ops import unary_union

load_dotenv()

VIS_CRITICAL_M: float = float(os.getenv("CRITICAL_VISIBILITY_THRESHOLD_METERS", "50"))
VIS_HIGH_M: float = 150.0
VIS_MEDIUM_M: float = 500.0

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


class RiskLevel(str, Enum):
    NOMINAL = "nominal"
    YELLOW = "yellow"
    ORANGE = "orange"
    RED = "red"


@dataclass
class BridgeNode:
    bridge_id: str
    lat: float
    lon: float
    road_name: str
    river_name: str
    risk_level: RiskLevel = RiskLevel.NOMINAL


@dataclass
class RoadSegment:
    segment_id: str
    road_name: str
    highway_type: str
    geometry: LineString
    risk_level: RiskLevel = RiskLevel.NOMINAL


@dataclass
class VisibilityReading:
    lat: float
    lon: float
    visibility_m: float
    timestamp: float
    source: str = "open-meteo"
    pm2_5_ugm3: Optional[float] = None


@dataclass
class LocalHazardReport:
    user_lat: float
    user_lon: float
    radius_m: int
    visibility_m: float
    risk_level: RiskLevel
    bridges: List[BridgeNode]
    segments: List[RoadSegment]
    timestamp: float
    pm2_5_ugm3: Optional[float] = None
    data_source: str = "open-meteo"


class LocalRoadEngine:
    """Fetches and analyzes road network around user coordinates."""

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[List[BridgeNode], List[RoadSegment]]] = {}

    def analyze(
        self, lat: float, lon: float, radius_m: int = 5000
    ) -> Tuple[List[BridgeNode], List[RoadSegment]]:
        cache_key = f"{lat:.4f}:{lon:.4f}:{radius_m}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            G = ox.graph_from_point(
                (lat, lon), dist=radius_m, network_type="drive", simplify=True
            )
            _, edges = ox.graph_to_gdfs(G)
            edges = edges.reset_index()
        except Exception:
            edges = gpd.GeoDataFrame()

        river_union = None
        try:
            waterways = ox.features_from_point(
                (lat, lon), dist=radius_m,
                tags={"waterway": ["river", "stream", "canal"]},
            )
            river_lines = waterways[
                waterways.geometry.type.isin(["LineString", "MultiLineString"])
            ]
            if not river_lines.empty:
                river_union = unary_union(river_lines.geometry.tolist())
        except Exception:
            river_union = None

        bridges: List[BridgeNode] = []
        if river_union is not None and not edges.empty:
            for _, row in edges.iterrows():
                geom = row.geometry
                if geom is None or not geom.intersects(river_union):
                    continue
                inter = geom.intersection(river_union)
                if inter.is_empty:
                    continue
                pt = inter.centroid
                bridges.append(
                    BridgeNode(
                        bridge_id=f"BR-{len(bridges):04d}",
                        lat=pt.y, lon=pt.x,
                        road_name=str(row.get("name", "unnamed road")),
                        river_name="waterway",
                    )
                )

        segments: List[RoadSegment] = []
        for idx, row in edges.iterrows():
            geom = row.geometry
            if geom is None:
                continue
            segments.append(
                RoadSegment(
                    segment_id=f"SEG-{idx}",
                    road_name=str(row.get("name", "unnamed")),
                    highway_type=str(row.get("highway", "unknown")),
                    geometry=geom,
                )
            )

        self._cache[cache_key] = (bridges, segments)
        return bridges, segments


class VisibilityIngestionEngine:
    """Fetches live visibility and CAMS-backed air quality data."""

    def fetch_visibility(self, lat: float, lon: float) -> VisibilityReading:
        params = {
            "latitude": lat, "longitude": lon,
            "hourly": "visibility", "forecast_days": 1, "timezone": "auto",
        }
        visibility_m = 10_000.0
        try:
            resp = requests.get(OPEN_METEO_FORECAST_URL, params=params, timeout=15)
            resp.raise_for_status()
            vis_list = resp.json().get("hourly", {}).get("visibility", [])
            valid = [v for v in vis_list if v is not None]
            if valid:
                visibility_m = float(valid[-1])
        except Exception:
            pass

        pm2_5 = self._fetch_pm2_5(lat, lon)
        return VisibilityReading(
            lat=lat, lon=lon, visibility_m=visibility_m,
            timestamp=time.time(), source="open-meteo", pm2_5_ugm3=pm2_5,
        )

    @staticmethod
    def _fetch_pm2_5(lat: float, lon: float) -> Optional[float]:
        try:
            resp = requests.get(
                OPEN_METEO_AIR_QUALITY_URL,
                params={
                    "latitude": lat, "longitude": lon,
                    "hourly": "pm2_5", "forecast_days": 1,
                },
                timeout=10,
            )
            resp.raise_for_status()
            values = resp.json().get("hourly", {}).get("pm2_5", [])
            valid = [v for v in values if v is not None]
            return float(valid[-1]) if valid else None
        except Exception:
            return None


class FogRiskAssessor:
    def assess(
        self, visibility_m: float,
        bridges: List[BridgeNode], segments: List[RoadSegment],
    ) -> RiskLevel:
        base_level = _vis_to_risk(visibility_m)
        for b in bridges:
            b.risk_level = _escalate(base_level)
        for s in segments:
            s.risk_level = base_level
        return base_level


class LocalFogEngine:
    def __init__(self) -> None:
        self.roads = LocalRoadEngine()
        self.visibility = VisibilityIngestionEngine()
        self.assessor = FogRiskAssessor()

    def analyze_location(
        self, lat: float, lon: float, radius_m: int = 5000
    ) -> LocalHazardReport:
        bridges, segments = self.roads.analyze(lat, lon, radius_m)
        reading = self.visibility.fetch_visibility(lat, lon)
        level = self.assessor.assess(reading.visibility_m, bridges, segments)
        return LocalHazardReport(
            user_lat=lat, user_lon=lon, radius_m=radius_m,
            visibility_m=reading.visibility_m, risk_level=level,
            bridges=bridges, segments=segments, timestamp=time.time(),
            pm2_5_ugm3=reading.pm2_5_ugm3, data_source=reading.source,
        )


def _vis_to_risk(vis_m: float) -> RiskLevel:
    if vis_m < VIS_CRITICAL_M:
        return RiskLevel.RED
    if vis_m < VIS_HIGH_M:
        return RiskLevel.ORANGE
    if vis_m < VIS_MEDIUM_M:
        return RiskLevel.YELLOW
    return RiskLevel.NOMINAL


def _escalate(level: RiskLevel) -> RiskLevel:
    order = [RiskLevel.NOMINAL, RiskLevel.YELLOW, RiskLevel.ORANGE, RiskLevel.RED]
    return order[min(order.index(level) + 1, len(order) - 1)]