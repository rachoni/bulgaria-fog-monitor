"use strict";

const map = L.map("map").setView([42.7, 25.5], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors", maxZoom: 18,
}).addTo(map);

let userMarker = null;
let radiusCircle = null;
const bridgeLayer = L.layerGroup().addTo(map);
const segmentLayer = L.layerGroup().addTo(map);

const RISK_COLORS = {
  nominal: "#22c55e", yellow: "#eab308",
  orange: "#f97316", red: "#ef4444",
};

const radiusInput = document.getElementById("radius");
const radiusLabel = document.getElementById("radius-label");
const refreshBtn = document.getElementById("refresh-btn");
const dispatchBtn = document.getElementById("dispatch-btn");
const visValue = document.getElementById("vis-value");
const riskLabel = document.getElementById("risk-label");
const pm25Value = document.getElementById("pm25-value");
const statusPill = document.getElementById("status-pill");
const bridgeList = document.getElementById("bridge-list");
const bridgeCount = document.getElementById("bridge-count");
const alertLog = document.getElementById("alert-log");

let currentLat = null;
let currentLon = null;

function locateUser() {
  if (!navigator.geolocation) {
    statusPill.textContent = "Geolocation not supported";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLon = pos.coords.longitude;
      map.setView([currentLat, currentLon], 13);
      fetchHazards();
    },
    () => {
      statusPill.textContent = "Location denied — using Sofia";
      currentLat = 42.6977; currentLon = 23.3219;
      map.setView([currentLat, currentLon], 12);
      fetchHazards();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function fetchHazards() {
  if (currentLat === null) return;
  const radius = parseInt(radiusInput.value, 10);
  statusPill.textContent = "Analyzing…";
  statusPill.className = "pill nominal";

  try {
    const url = `/api/local-hazards?lat=${currentLat}&lon=${currentLon}&radius_m=${radius}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    render(await resp.json());
  } catch (e) {
    statusPill.textContent = "Analysis failed";
    statusPill.className = "pill red";
    console.error(e);
  }
}

function render(data) {
  const level = data.risk_level;
  statusPill.textContent = `${level.toUpperCase()} — ${data.visibility_m.toFixed(0)} m visibility`;
  statusPill.className = `pill ${level}`;

  visValue.textContent = `${data.visibility_m.toFixed(0)} m`;
  riskLabel.textContent = level.toUpperCase();
  riskLabel.className = `risk-badge ${level}`;
  pm25Value.textContent = data.pm2_5_ugm3 !== null
    ? `PM2.5 (CAMS): ${data.pm2_5_ugm3.toFixed(1)} µg/m³`
    : "PM2.5: unavailable";

  if (userMarker) map.removeLayer(userMarker);
  if (radiusCircle) map.removeLayer(radiusCircle);
  userMarker = L.marker([data.user.lat, data.user.lon]).addTo(map);
  radiusCircle = L.circle([data.user.lat, data.user.lon], {
    radius: data.radius_m, color: "#38bdf8", fillOpacity: 0.05,
  }).addTo(map);

  segmentLayer.clearLayers();
  data.segments.forEach((seg) => {
    const color = RISK_COLORS[seg.risk_level] || "#64748b";
    const latlngs = seg.coords.map(([lon, lat]) => [lat, lon]);
    L.polyline(latlngs, { color, weight: 3, opacity: 0.8 }).addTo(segmentLayer);
  });

  bridgeLayer.clearLayers();
  bridgeList.innerHTML = "";
  bridgeCount.textContent = data.bridges.length;
  data.bridges.forEach((b) => {
    const color = RISK_COLORS[b.risk_level] || "#64748b";
    L.circleMarker([b.lat, b.lon], {
      radius: 6, color, fillColor: color, fillOpacity: 0.9,
    })
      .bindPopup(`${b.road_name}<br>Risk: ${b.risk_level}`)
      .addTo(bridgeLayer);

    const li = document.createElement("li");
    li.innerHTML = `<span>${b.road_name}</span><span class="risk-dot ${b.risk_level}"></span>`;
    bridgeList.appendChild(li);
  });

  refreshAlertLog();
}

async function refreshAlertLog() {
  try {
    const resp = await fetch("/api/alerts/log?limit=10");
    const data = await resp.json();
    alertLog.innerHTML = "";
    data.records.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${r.channel}</span><span>${r.severity}</span>`;
      alertLog.appendChild(li);
    });
    if (data.records.length === 0) {
      alertLog.innerHTML = "<li>No alerts dispatched</li>";
    }
  } catch (e) { console.error(e); }
}

async function dispatchAlert() {
  if (currentLat === null) return;
  try {
    const resp = await fetch("/api/dispatch-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: currentLat, lon: currentLon,
        radius_m: parseInt(radiusInput.value, 10),
        reason: "operator_manual",
      }),
    });
    const data = await resp.json();
    alert(`Dispatched to ${data.dispatched} channels (${data.risk_level})`);
    refreshAlertLog();
  } catch (e) { console.error(e); }
}

radiusInput.addEventListener("input", () => {
  radiusLabel.textContent = `${radiusInput.value} m`;
});
refreshBtn.addEventListener("click", fetchHazards);
dispatchBtn.addEventListener("click", dispatchAlert);

locateUser();