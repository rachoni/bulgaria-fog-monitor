# Bulgaria Fog Hazard Monitor (BFHM)

A production-ready, modular, containerized end-to-end geospatial intelligence system designed for real-time atmospheric low-visibility (dense fog) hazard monitoring across the entire territory of Bulgaria. Driven by real-time device geolocation, live Open-Meteo/Copernicus satellite data, and dynamic OpenStreetMap (OSMnx) spatial processing.

---

## 🏗️ Architecture & Modular Structure

The project is built with a clean separation of concerns:
- **`engine.py`**: Ingests atmospheric visibility, fetches local road networks via OSMnx around user coordinates, computes bridge-river spatial intersections, and evaluates risk thresholds.
- **`notifier.py`**: Institutional dispatch gateway formulating CAP v1.2-compliant JSON payloads for automated webhook alerts (Road Infrastructure Agency - АПИ, BG-ALERT, Fire Safety - ПБЗН, Municipalities).
- **`server.py`**: FastAPI backend exposing REST endpoints (`/api/local-hazards`, `/api/dispatch-alert`) and mock institutional webhook listeners.
- **`templates/`**: Responsive Leaflet.js frontend featuring interactive map rendering, telemetry panels, radius controls, and operator dispatch triggers.
- **`prototype.ipynb`**: Interactive Jupyter Notebook demonstrating the spatial pipeline steps.

---

## 🛠️ Tech Stack
- **Backend:** Python 3.10+, FastAPI, Uvicorn, Pydantic
- **Geospatial & Data:** GeoPandas, Shapely, OSMnx, Pandas, Requests, python-dotenv
- **Frontend:** HTML5, CSS3, JavaScript, Leaflet.js
- **Containerization & Deployment:** Docker, Docker Compose, Docker Hub (`raychevbg`), Render, Supabase (PostgreSQL readiness)

---

## ⚙️ Configuration (.env)

1. Copy the example environment file:
   ```bash
   cp .env.example .env