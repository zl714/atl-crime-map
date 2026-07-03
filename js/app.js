// App orchestrator: wires data -> map -> panel -> controls.

import {
  loadIncidents,
  loadNeighborhoods,
  latestTimestamp,
  formatDate,
  normHood,
} from "./data.js";
import { MapView } from "./mapview.js";
import { Panel } from "./panel.js";
import { Controls } from "./controls.js";
import { LiveLayers, timeAgo } from "./live.js";

const state = {
  incidents: [],
  latestTs: Date.now(),
  selectedHoodKey: null,
  selectedHoodName: null,
};

let mapView, panel, controls, live;
let refreshQueued = false;

async function init() {
  mapView = new MapView("map", scheduleRefresh);

  panel = new Panel({
    onSelectIncident: (inc) => {
      mapView.panTo(inc);
      mapView.markers.find((m) => m.inc === inc)?.marker.openPopup();
    },
    onSelectHood: selectHood,
  });

  controls = new Controls({
    onChange: applyFilters,
    onHeatToggle: (on) => {
      mapView.setHeat(on);
      refreshPanel();
    },
    onChoroplethToggle: (on) => {
      mapView.setChoropleth(on);
      document.getElementById("choropleth-legend").hidden = !on;
      if (on) updateChoropleth();
    },
  });

  try {
    const [payload, hoods] = await Promise.all([
      loadIncidents(),
      loadNeighborhoods(),
    ]);
    state.incidents = payload.incidents;
    state.latestTs = latestTimestamp(payload.incidents);
    onDataReady(payload, hoods);
  } catch (err) {
    showError(err);
  }
}

function onDataReady(payload, hoods) {
  document.getElementById("header-total").textContent =
    state.incidents.length.toLocaleString();

  const meta = payload.meta || {};
  if (meta.date_min && meta.date_max) {
    document.getElementById("footer-range").textContent = `Incidents ${formatDate(
      meta.date_min
    )} – ${formatDate(meta.date_max)}, ${state.incidents.length.toLocaleString()} records.`;
  }
  document.getElementById("footer-retrieved").textContent = meta.retrieved || "—";
  const stamp = document.getElementById("data-updated");
  if (stamp) stamp.textContent = meta.retrieved ? `Data updated ${meta.retrieved}` : "";

  mapView.setData(state.incidents, state.latestTs);

  if (hoods) {
    mapView.setNeighborhoods(hoods, selectHood);
  } else {
    // No boundary layer: disable choropleth control, keep the rest working.
    const btn = document.getElementById("choropleth-toggle");
    if (btn) {
      btn.disabled = true;
      btn.title = "Neighborhood boundaries unavailable";
    }
  }

  applyFilters();
  applyDeepLink();

  const loading = document.getElementById("loading");
  loading.classList.add("hidden");
  setTimeout(() => (loading.style.display = "none"), 400);

  // Live layers load independently so a slow/failed live source never blocks
  // the core incident map.
  live = new LiveLayers(mapView.map, renderLive);
  buildLiveToggles();
  live.init();
  setInterval(renderLive, 60000); // keep "updated Xm ago" fresh
}

// ---------- Live layers UI ----------
const LIVE_KINDS = [
  { id: "news", label: "News", glyph: "diamond" },
  { id: "traffic", label: "Traffic", glyph: "triangle" },
  { id: "weather", label: "Weather", glyph: "wx" },
];

function buildLiveToggles() {
  const host = document.getElementById("live-toggles");
  liveButtons = {};
  for (const k of LIVE_KINDS) {
    const btn = document.createElement("button");
    btn.className = `chip chip--live chip--live-${k.id}`;
    btn.setAttribute("aria-pressed", live.on[k.id] ? "true" : "false");
    btn.innerHTML = `<span class="glyph-${k.glyph}"></span>${k.label}<span class="chip__count tnum"></span>`;
    btn.addEventListener("click", () => {
      const on = !live.on[k.id];
      live.setLayer(k.id, on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      renderLive();
    });
    host.appendChild(btn);
    liveButtons[k.id] = btn;
  }
}

let liveButtons = {};

function renderLive() {
  if (!live) return;
  const counts = live.counts();
  for (const k of LIVE_KINDS) {
    const c = liveButtons[k.id]?.querySelector(".chip__count");
    if (c) c.textContent = counts[k.id] ? String(counts[k.id]) : "";
  }

  // Header LIVE indicator.
  const stamp = document.getElementById("live-stamp");
  const ind = document.getElementById("live-indicator");
  if (live.lastFetch) {
    ind.classList.add("is-live");
    stamp.textContent = `updated ${timeAgo(live.lastFetch)}`;
  } else {
    stamp.textContent = "connecting…";
  }

  // Merged feed.
  const feed = live.feed();
  const host = document.getElementById("live-feed");
  const total = counts.news + counts.traffic + counts.weather;
  document.getElementById("live-count").textContent = total
    ? `${total} active`
    : "";
  if (!feed.length) {
    host.innerHTML =
      '<div class="empty">No active live items right now, or layers are off.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of feed.slice(0, 30)) {
    const row = document.createElement("button");
    row.className = "live-item";
    const when = item.ts ? timeAgo(item.ts) : "";
    row.innerHTML = `
      <span class="live-item__tag live-tag--${item.kind}">${tagLabel(item.kind)}</span>
      <span class="live-item__body">
        <span class="live-item__title">${esc(item.title || item.type || "")}</span>
        <span class="live-item__meta">${esc(liveMeta(item))}</span>
      </span>
      <span class="live-item__when tnum">${when}</span>`;
    if (item.lat != null) row.addEventListener("click", () => live.focus(item));
    else row.classList.add("is-static");
    frag.appendChild(row);
  }
  host.innerHTML = "";
  host.appendChild(frag);
}

function tagLabel(kind) {
  return kind === "news" ? "NEWS" : kind === "traffic" ? "TRAFFIC" : "WX";
}

function liveMeta(item) {
  if (item.kind === "news") return item.source + (item.location_text ? ` · ${item.location_text}` : "");
  if (item.kind === "traffic") return item.road ? titleWord(item.road) : "GDOT 511";
  return item.summary || item.severity || "NWS";
}

function titleWord(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// Toggle a neighborhood selection (click same one again to clear).
function selectHood(name) {
  const key = normHood(name);
  if (state.selectedHoodKey === key) {
    state.selectedHoodKey = null;
    state.selectedHoodName = null;
  } else {
    state.selectedHoodKey = key;
    state.selectedHoodName = name;
    mapView.fitHood(name);
  }
  panel.setSelectedHood(state.selectedHoodKey);
  updateSelectionChip();
  applyFilters();
}

function updateSelectionChip() {
  const chip = document.getElementById("hood-selection");
  if (!chip) return;
  if (state.selectedHoodName) {
    chip.hidden = false;
    chip.querySelector(".hood-selection__name").textContent =
      state.selectedHoodName;
  } else {
    chip.hidden = true;
  }
}

// Optional shareable view: ?lat=&lon=&z=&heat=1&choro=1
function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  const z = parseInt(p.get("z"), 10);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    mapView.map.setView([lat, lon], Number.isFinite(z) ? z : 14);
  }
  if (p.get("heat") === "1") document.getElementById("heat-toggle").click();
  if (p.get("choro") === "1") {
    const btn = document.getElementById("choropleth-toggle");
    if (btn && !btn.disabled) btn.click();
  }
  if (p.get("firearm") === "1") document.getElementById("firearm-toggle").click();
  const hood = p.get("hood");
  if (hood && mapView.hoodByKey.has(normHood(hood))) selectHood(hood);
}

function applyFilters() {
  const minTs = controls.minTimestamp(state.latestTs);
  mapView.applyFilters(
    controls.activeCats,
    minTs,
    controls.firearmOnly,
    state.selectedHoodKey
  );
  if (controls.choroplethOn) updateChoropleth();
  refreshPanel();
}

// Choropleth reflects the full filtered set (category/date/firearm), so it
// reads as a citywide hotspot map; the top-10 list stays viewport-scoped.
function updateChoropleth() {
  const counts = new Map();
  for (const inc of mapView._filtered) {
    if (!inc.hood || inc.hood === "Unknown") continue;
    const key = normHood(inc.hood);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  mapView.updateChoropleth(counts);
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    refreshPanel();
  });
}

function refreshPanel() {
  panel.update(mapView.incidentsInView(), state.latestTs);
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

// Clicking the selection chip clears the neighborhood filter.
document.addEventListener("click", (e) => {
  if (e.target.closest("#hood-selection")) {
    if (state.selectedHoodName) selectHood(state.selectedHoodName);
  }
});

init();
