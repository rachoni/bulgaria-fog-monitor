"""FastAPI backend with localized hazard endpoints and mock webhooks.

Binds to PORT env var for Render compatibility (default 8000).
"""

from __future__ import annotations

import os
import time
from typing import Dict

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import LocalFogEngine
from notifier import NotificationGateway

load_dotenv()

app = FastAPI(title=os.getenv("APP_NAME", "BulgariaFogMonitor"), version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="templates"), name="static")

_engine = LocalFogEngine()
_notifier = NotificationGateway()


class DispatchRequest(BaseModel):
    lat: float
    lon: float
    radius_m: int = 5000
    reason: str = "operator_manual"


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("templates/index.html")


@app.get("/api/local-hazards")
async def local_hazards(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: int = Query(
        int(os.getenv("DEFAULT_SEARCH_RADIUS_KM", "5")) * 1000,
        ge=500, le=20000,
    ),
) -> Dict:
    report = _engine.analyze_location(lat, lon, radius_m)
    return {
        "timestamp": report.timestamp,
        "user": {"lat": report.user_lat, "lon": report.user_lon},
        "radius_m": report.radius_m,
        "visibility_m": round(report.visibility_m, 1),
        "risk_level": report.risk_level.value,
        "data_source": report.data_source,
        "pm2_5_ugm3": report.pm2_5_ugm3,
        "bridges": [
            {"id": b.bridge_id, "lat": b.lat, "lon": b.lon,
             "road_name": b.road_name, "risk_level": b.risk_level.value}
            for b in report.bridges
        ],
        "segments": [
            {"id": s.segment_id, "road_name": s.road_name,
             "highway_type": s.highway_type, "risk_level": s.risk_level.value,
             "coords": list(s.geometry.coords)}
            for s in report.segments
        ],
    }


@app.post("/api/dispatch-alert")
async def dispatch_alert(req: DispatchRequest) -> Dict:
    report = _engine.analyze_location(req.lat, req.lon, req.radius_m)
    records = _notifier.dispatch(report)
    return {
        "dispatched": len(records),
        "risk_level": report.risk_level.value,
        "visibility_m": round(report.visibility_m, 1),
        "records": [
            {"dispatch_id": r.dispatch_id, "channel": r.channel.value,
             "severity": r.severity, "success": r.success, "error": r.error}
            for r in records
        ],
    }


@app.get("/api/alerts/log")
async def alert_log(limit: int = 50) -> Dict:
    log = _notifier.log[-limit:]
    return {
        "count": len(log),
        "records": [
            {"dispatch_id": r.dispatch_id, "channel": r.channel.value,
             "severity": r.severity, "visibility_m": r.visibility_m,
             "success": r.success, "timestamp": r.timestamp}
            for r in log
        ],
    }


@app.post("/api/mock/{channel}")
async def mock_webhook(channel: str, request: Request) -> Dict:
    body = await request.json()
    return {
        "received": True, "channel": channel,
        "identifier": body.get("identifier", "unknown"),
        "timestamp": time.time(),
    }


@app.get("/api/health")
async def health() -> Dict:
    return {"status": "ok", "timestamp": time.time()}


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("DEBUG", "True").lower() == "true",
    )