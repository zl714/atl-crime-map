// App orchestrator: wires data -> map -> panel -> controls.

import { loadIncidents, latestTimestamp, formatDate } from "./data.js";
import { MapView } from "./mapview.js";
import { Panel } from "./panel.js";
import { Controls } from "./controls.js";

const state = {
  incidents: [],
  latestTs: Date.now(),
};

let mapView, panel, controls;
let refreshQueued = false;

async function init() {
  mapView = new MapView("map", scheduleRefresh);

  panel = new Panel((inc) => {
    mapView.panTo(inc);
    mapView.markers.find((m) => m.inc === inc)?.marker.openPopup();
  });

  controls = new Controls({
    onChange: applyFilters,
    onHeatToggle: (on) => {
      mapView.setHeat(on);
      refreshPanel();
    },
  });

  try {
    const payload = await loadIncidents();
    state.incidents = payload.incidents;
    state.latestTs = latestTimestamp(payload.incidents);
    onDataReady(payload);
  } catch (err) {
    showError(err);
  }
}

function onDataReady(payload) {
  document.getElementById("header-total").textContent =
    state.incidents.length.toLocaleString();

  const meta = payload.meta || {};
  if (meta.date_min && meta.date_max) {
    document.getElementById("footer-range").textContent =
      `Incidents ${formatDate(meta.date_min)} – ${formatDate(meta.date_max)}, ${state.incidents.length.toLocaleString()} records.`;
  }
  document.getElementById("footer-retrieved").textContent =
    meta.retrieved || "—";

  mapView.setData(state.incidents, state.latestTs);
  applyFilters();
  applyDeepLink();

  const loading = document.getElementById("loading");
  loading.classList.add("hidden");
  setTimeout(() => (loading.style.display = "none"), 400);
}

// Optional shareable view: ?lat=&lon=&z=&heat=1
function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  const z = parseInt(p.get("z"), 10);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapView.map.setView([lat, lon], Number.isFinite(z) ? z : 14);
  }
  if (p.get("heat") === "1") {
    document.getElementById("heat-toggle").click();
  }
}

function applyFilters() {
  const minTs = controls.minTimestamp(state.latestTs);
  mapView.applyFilters(controls.activeCats, minTs);
  refreshPanel();
}

// Coalesce rapid moveend/zoomend events into one panel update per frame.
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    refreshPanel();
  });
}

function refreshPanel() {
  const inView = mapView.incidentsInView();
  panel.update(inView, state.latestTs);
}

function showError(err) {
  const loading = document.getElementById("loading");
  loading.innerHTML = `
    <div class="eyebrow" style="color:var(--cat-violent)">Could not load data</div>
    <div style="max-width:280px;text-align:center;color:var(--text-dim);font-size:13px">
      ${err.message}. If you opened this file directly, serve it over HTTP
      (e.g. <code>python3 -m http.server</code>) so the browser can fetch
      data/incidents.json.
    </div>`;
  console.error(err);
}

init();
