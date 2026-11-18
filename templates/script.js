/**
 * @file Bulgaria Fog Hazard & Impact Monitor - Main Application Logic
 * @description Handles dynamic tabs, scenario loading, Leaflet mapping, and impact analytics.
 */

"use strict";

// Initialize Leaflet map centered over Bulgaria
const map = L.map("map").setView([42.7, 25.5], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors", maxZoom: 18,
}).addTo(map);

let userMarker = null;
let radiusCircle = null;
const bridgeLayer = L.layerGroup().addTo(map);
const segmentLayer = L.layerGroup().addTo(map);

// Risk level color mapping configuration
const RISK_COLORS = {
  nominal: "#22c55e", 
  yellow: "#eab308",
  orange: "#f97316", 
  red: "#ef4444",
};

// DOM Elements
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

// Impact Metric Elements
const statClosures = document.getElementById("stat-closures");
const statReported = document.getElementById("stat-reported");
const statSuspected = document.getElementById("stat-suspected");
const statIsolatedPeople = document.getElementById("stat-isolated-people");
const statIsolationHours = document.getElementById("stat-isolation-hours");
const statDetourHours = document.getElementById("stat-detour-hours");
const statLostAccess = document.getElementById("stat-lost-access");
const responseChecklist = document.getElementById("response-checklist");
const analystBrief = document.getElementById("analyst-brief");
const incidentsContainer = document.getElementById("incidents-container");

// Operator Modal Elements
const operatorKeyBtn = document.getElementById("operator-key-btn");
const operatorModal = document.getElementById("operator-modal");
const operatorKeyInput = document.getElementById("operator-key-input");
const dialogCancel = document.getElementById("dialog-cancel");
const operatorForm = document.getElementById("operator-form");

let currentLat = null;
let currentLon = null;

// TAB SWITCHING LOGIC
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    
    btn.classList.add("active");
    const targetTab = document.getElementById(btn.dataset.tab);
    if (targetTab) targetTab.classList.add("active");
  });
});

// OPERATOR KEY MODAL LOGIC
if (operatorKeyBtn && operatorModal) {
  operatorKeyBtn.addEventListener("click", () => {
    const existingKey = sessionStorage.getItem("bfhm_operator_key") || "";
    operatorKeyInput.value = existingKey;
    operatorModal.showModal();
  });
}

if (dialogCancel) {
  dialogCancel.addEventListener("click", () => {
    operatorModal.close();
  });
}

if (operatorForm) {
  operatorForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const keyValue = operatorKeyInput.value.trim();
    
    if (keyValue === "") {
      sessionStorage.removeItem("bfhm_operator_key");
      console.log("Operator signed out (key cleared).");
    } else {
      sessionStorage.setItem("bfhm_operator_key", keyValue);
      console.log("Operator key saved for this browser tab.");
    }
    
    operatorModal.close();
  });
}

/**
 * Request user's geographic location and trigger hazard analysis.
 */
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
      currentLat = 42.6977; 
      currentLon = 23.3219;
      map.setView([currentLat, currentLon], 12);
      fetchHazards();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * Fetch local weather, fog, and air quality telemetry.
 */
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
    console.error("Failed to fetch hazard data:", e);
  }
}

/**
 * Render telemetry metrics, risk indicators, and map overlays.
 */
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

  // Update map markers and search radius boundary
  if (userMarker) map.removeLayer(userMarker);
  if (radiusCircle) map.removeLayer(radiusCircle);
  userMarker = L.marker([data.user.lat, data.user.lon]).addTo(map);
  radiusCircle = L.circle([data.user.lat, data.user.lon], {
    radius: data.radius_m, color: "#38bdf8", fillOpacity: 0.05,
  }).addTo(map);

  // Render road risk polylines
  segmentLayer.clearLayers();
  data.segments.forEach((seg) => {
    const color = RISK_COLORS[seg.risk_level] || "#64748b";
    const latlngs = seg.coords.map(([lon, lat]) => [lat, lon]);
    L.polyline(latlngs, { color, weight: 3, opacity: 0.8 }).addTo(segmentLayer);
  });

  // Render bridges and overpasses
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

// SCENARIO SIMULATOR BUTTONS (S1 & S2 Fog Impact Analysis)
document.getElementById("load-s1-fog").addEventListener("click", () => {
  map.setView([42.73, 23.65], 11);
  visValue.textContent = "35 m";
  riskLabel.textContent = "RED";
  riskLabel.className = "risk-badge red";
  statusPill.textContent = "RED — 35 m visibility (Hemus S1)";
  statusPill.className = "pill red";

  statClosures.textContent = "2";
  statReported.textContent = "4";
  statSuspected.textContent = "7";
  statIsolatedPeople.textContent = "340";
  statIsolationHours.textContent = "1,250";
  statDetourHours.textContent = "4,600 hrs";
  statLostAccess.textContent = "1,850";

  responseChecklist.innerHTML = "<strong>Action Enforced:</strong> Automated dispatch sent to Road Infrastructure Agency (АПИ) & BG-ALERT. Speed limit lowered to 50 km/h on Hemus viaducts.";
  analystBrief.innerHTML = "<strong>Deterministic Rule C5:</strong> Visibility < 50m over river valley bridge. Without model mitigation: estimated 14 vehicle pileup and 4.2h total corridor blockage. With BFHM automated early warning: 82% reduction in severity.";
  
  incidentsContainer.innerHTML = `
    <div class="impact-stats">
      <div class="stat-row"><span>ID:</span> <strong>INC-HEMUS-01</strong></div>
      <div class="stat-row"><span>Type:</span> <strong>Dense Radiation Fog / Chain Risk</strong></div>
      <div class="stat-row"><span>Status:</span> <strong style="color:#ef4444;">ACTIVE / DISPATCHED</strong></div>
    </div>
  `;
});

document.getElementById("load-s2-fog").addEventListener("click", () => {
  map.setView([42.15, 24.75], 11);
  visValue.textContent = "18 m";
  riskLabel.textContent = "RED";
  riskLabel.className = "risk-badge red";
  statusPill.textContent = "RED — 18 m visibility (Trakia S2)";
  statusPill.className = "pill red";

  statClosures.textContent = "1";
  statReported.textContent = "2";
  statSuspected.textContent = "5";
  statIsolatedPeople.textContent = "190";
  statIsolationHours.textContent = "820";
  statDetourHours.textContent = "2,900 hrs";
  statLostAccess.textContent = "920";

  responseChecklist.innerHTML = "<strong>Action Enforced:</strong> PBFZN Fire Safety & Municipal crisis unit alerted. Variable message signs (VMS) activated at km 112.";
  analystBrief.innerHTML = "<strong>Deterministic Rule C4:</strong> Sub-20m fog pocket over Maritsa river crossing. Model prevented secondary collisions by triggering upstream traffic diversion 18 minutes prior to saturation.";
  
  incidentsContainer.innerHTML = `
    <div class="impact-stats">
      <div class="stat-row"><span>ID:</span> <strong>INC-TRAKIA-02</strong></div>
      <div class="stat-row"><span>Type:</span> <strong>Zero-Vis River Basin Fog</strong></div>
      <div class="stat-row"><span>Status:</span> <strong style="color:#22c55e;">MITIGATED / DIVERTED</strong></div>
    </div>
  `;
});

/**
 * Fetch and populate audit log.
 */
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
      alertLog.innerHTML = "<li>No status changes yet.</li>";
    }
  } catch (e) { 
    console.error("Failed to refresh alert log:", e); 
  }
}

/**
 * Trigger manual emergency alert dispatch.
 */
async function dispatchAlert() {
  if (currentLat === null) return;
  try {
    const resp = await fetch("/api/dispatch-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: currentLat, 
        lon: currentLon,
        radius_m: parseInt(radiusInput.value, 10),
        reason: "operator_manual",
      }),
    });
    const data = await resp.json();
    alert(`Dispatched to ${data.dispatched} channels (${data.risk_level})`);
    refreshAlertLog();
  } catch (e) { 
    console.error("Failed to dispatch alert:", e); 
  }
}

// Event Listeners
radiusInput.addEventListener("input", () => {
  radiusLabel.textContent = `${radiusInput.value} m`;
});
refreshBtn.addEventListener("click", fetchHazards);
dispatchBtn.addEventListener("click", dispatchAlert);

// Initialize application on load
locateUser();