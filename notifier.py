"""Institutional dispatch gateway for fog hazard alerts.

Generates CAP v1.2-compliant JSON payloads and posts them to webhook
URLs configured via environment variables. BG-ALERT payloads respect
the 600-character content limit per Bulgarian regulation.
"""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv

from engine import LocalHazardReport, RiskLevel

load_dotenv()


class Channel(str, Enum):
    API = "api"
    MUNICIPALITY = "municipality"
    BG_ALERT = "bg_alert"
    PBZN = "pbzn"


WEBHOOK_MAP: Dict[Channel, str] = {
    Channel.API: os.getenv("API_ROAD_AGENCY_WEBHOOK", ""),
    Channel.MUNICIPALITY: os.getenv("MUNICIPALITY_DISPATCH_WEBHOOK", ""),
    Channel.BG_ALERT: os.getenv("BG_ALERT_GATEWAY_WEBHOOK", ""),
    Channel.PBZN: os.getenv("FIRE_SAFETY_WEBHOOK", ""),
}


@dataclass
class DispatchRecord:
    dispatch_id: str
    channel: Channel
    severity: str
    visibility_m: float
    payload: Dict
    timestamp: float
    success: bool = False
    error: Optional[str] = None


class NotificationGateway:
    def __init__(self) -> None:
        self._log: List[DispatchRecord] = []

    def dispatch(self, report: LocalHazardReport) -> List[DispatchRecord]:
        if report.risk_level not in (RiskLevel.RED, RiskLevel.ORANGE):
            return []

        channels = (
            list(Channel) if report.risk_level == RiskLevel.RED
            else [Channel.API, Channel.MUNICIPALITY]
        )

        records: List[DispatchRecord] = []
        for ch in channels:
            payload = self._build_payload(report, ch)
            rec = self._send_webhook(ch, payload, report)
            records.append(rec)

        self._log.extend(records)
        return records

    def _send_webhook(
        self, channel: Channel, payload: Dict, report: LocalHazardReport
    ) -> DispatchRecord:
        dispatch_id = hashlib.sha256(
            f"{report.timestamp}:{channel.value}:{uuid.uuid4().hex}".encode()
        ).hexdigest()[:16]
        url = WEBHOOK_MAP.get(channel, "")
        success = False
        error: Optional[str] = None

        if url:
            try:
                resp = requests.post(url, json=payload, timeout=5)
                success = resp.status_code < 400
                if not success:
                    error = f"HTTP {resp.status_code}"
            except Exception as exc:
                error = str(exc)

        return DispatchRecord(
            dispatch_id=dispatch_id, channel=channel,
            severity=report.risk_level.value,
            visibility_m=round(report.visibility_m, 1),
            payload=payload, timestamp=time.time(),
            success=success, error=error,
        )

    def _build_payload(self, report: LocalHazardReport, channel: Channel) -> Dict:
        bridge_names = ", ".join({b.road_name for b in report.bridges[:2]})
        return {
            "identifier": f"BG-FOG-{uuid.uuid4().hex[:8]}",
            "sender": "fog-monitor@system.bg",
            "sent": datetime.now(timezone.utc).isoformat(),
            "status": "Actual", "msgType": "Alert", "scope": "Public",
            "info": {
                "category": "Met", "event": "Dense Fog",
                "urgency": "Immediate",
                "severity": "Extreme" if report.risk_level == RiskLevel.RED else "Severe",
                "certainty": "Observed",
                "headline": (
                    f"Гъста мъгла: видимост {report.visibility_m:.0f}м. "
                    f"Dense fog: visibility {report.visibility_m:.0f}m."
                )[:600],
                "area": {
                    "areaDesc": "Local road corridor",
                    "circle": f"{report.user_lat:.5f},{report.user_lon:.5f} 5",
                },
            },
            "_channel": channel.value,
            "_visibility_m": round(report.visibility_m, 1),
            "_risk_level": report.risk_level.value,
            "_bridges": bridge_names or "none",
        }

    @property
    def log(self) -> List[DispatchRecord]:
        return list(self._log)