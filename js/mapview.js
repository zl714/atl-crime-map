// Leaflet map: canvas-rendered incident bubbles, filtering, heat layer.

import { MAP, CATEGORY_COLOR, CATEGORY_LABEL } from "./config.js";
import { formatDate, titleCase } from "./data.js";

const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a> · ' +
  "Data: Atlanta Police Dept. Open Data";

export class MapView {
  constructor(elementId, onMove) {
    this.map = L.map(elementId, {
      center: MAP.center,
      zoom: MAP.zoom,
      minZoom: MAP.minZoom,
      maxZoom: MAP.maxZoom,
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(this.map);

    // Dedicated canvas renderer keeps ~30k markers smooth.
    this.renderer = L.canvas({ padding: 0.5 });
    this.markerLayer = L.layerGroup().addTo(this.map);
    this.heatLayer = null;
    this.heatOn = false;

    this.incidents = [];
    this.markers = []; // { inc, marker, shown }
    this.latestTs = Date.now();

    this._onMove = onMove;
    this.map.on("moveend zoomend", () => this._onMove && this._onMove());
  }

  _radiusFor(inc) {
    // Subtle recency sizing: newer incidents render slightly larger.
    const ageDays = (this.latestTs - inc.ts) / 86400000;
    if (ageDays <= 3) return 6;
    if (ageDays <= 10) return 5;
    if (ageDays <= 30) return 4;
    return 3.2;
  }

  setData(incidents, latestTs) {
    this.incidents = incidents;
    this.latestTs = latestTs;

    for (const inc of incidents) {
      const color = CATEGORY_COLOR[inc.cat] || CATEGORY_COLOR.other;
      const marker = L.circleMarker([inc.lat, inc.lon], {
        renderer: this.renderer,
        radius: this._radiusFor(inc),
        color: color,
        weight: 1,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.42,
      });
      marker.bindPopup(() => buildPopup(inc), { closeButton: true });
      this.markers.push({ inc, marker, shown: false });
    }
  }

  // Apply category + date filters. activeCats is a Set of category ids.
  applyFilters(activeCats, minTs) {
    const filtered = [];
    for (const m of this.markers) {
      const inc = m.inc;
      const match = activeCats.has(inc.cat) && inc.ts >= minTs;
      if (match) {
        filtered.push(inc);
        if (!m.shown) {
          this.markerLayer.addLayer(m.marker);
          m.shown = true;
        }
      } else if (m.shown) {
        this.markerLayer.removeLayer(m.marker);
        m.shown = false;
      }
    }
    this._filtered = filtered;
    if (this.heatOn) this._renderHeat(filtered);
    return filtered;
  }

  _renderHeat(filtered) {
    const points = filtered.map((inc) => [inc.lat, inc.lon, 0.5]);
    if (this.heatLayer) {
      this.heatLayer.setLatLngs(points);
    } else {
      this.heatLayer = L.heatLayer(points, {
        radius: 12,
        blur: 16,
        max: 3.0,
        maxZoom: 16,
        minOpacity: 0.2,
        gradient: {
          0.0: "#0F172A",
          0.35: "#60A5FA",
          0.65: "#F59E0B",
          1.0: "#F23645",
        },
      });
    }
  }

  setHeat(on) {
    this.heatOn = on;
    if (on) {
      this._renderHeat(this._filtered || []);
      this.heatLayer.addTo(this.map);
      this.map.removeLayer(this.markerLayer);
    } else {
      if (this.heatLayer) this.map.removeLayer(this.heatLayer);
      this.markerLayer.addTo(this.map);
    }
  }

  // Incidents currently inside the viewport (from the active filtered set).
  incidentsInView() {
    const bounds = this.map.getBounds();
    const src = this._filtered || [];
    const out = [];
    for (const inc of src) {
      if (bounds.contains([inc.lat, inc.lon])) out.push(inc);
    }
    return out;
  }

  panTo(inc) {
    this.map.setView([inc.lat, inc.lon], Math.max(this.map.getZoom(), 15), {
      animate: true,
    });
  }
}

function buildPopup(inc) {
  const color = CATEGORY_COLOR[inc.cat] || CATEGORY_COLOR.other;
  const label = CATEGORY_LABEL[inc.cat] || "Other";
  const offense = titleCase(inc.offense || inc.type);
  const hood = inc.hood && inc.hood !== "Unknown" ? inc.hood : "";
  const addr = inc.addr ? titleCase(inc.addr) : "";
  const zone = inc.zone || "";
  const loc = inc.loc ? titleCase(inc.loc) : "";

  const rows = [];
  if (addr) rows.push(row("Location", addr));
  if (hood) rows.push(row("Neighborhood", hood));
  if (zone) rows.push(row("APD zone", zone));
  if (loc) rows.push(row("Place", loc));
  rows.push(row("Date", formatDate(inc.date)));

  const flag = inc.firearm
    ? '<div class="popup__flag">Firearm involved</div>'
    : "";

  return `
    <div class="popup__cat" style="color:${color}">
      <span class="cat-dot" style="background:${color}"></span>${label}
    </div>
    <div class="popup__type">${escapeHtml(offense)}</div>
    ${rows.join("")}
    ${flag}
  `;
}

function row(k, v) {
  return `<div class="popup__row"><span class="k">${k}</span><span class="v">${escapeHtml(
    v
  )}</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c];
  });
}
