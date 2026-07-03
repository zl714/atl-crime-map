// Leaflet map: canvas-rendered incident bubbles, firearm halos, filtering,
// heat layer, and a neighborhood choropleth.

import {
  MAP,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  FIREARM_COLOR,
  CHOROPLETH_STOPS,
} from "./config.js";
import { formatDate, titleCase, normHood } from "./data.js";

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

    // Panes so choropleth sits under bubbles, and firearm halos sit under the
    // colored bubble but above other bubbles.
    this.map.createPane("choroplethPane").style.zIndex = 350;
    this.map.createPane("haloPane").style.zIndex = 401;
    this.map.createPane("bubblePane").style.zIndex = 402;

    this.bubbleRenderer = L.canvas({ pane: "bubblePane", padding: 0.5 });
    this.haloRenderer = L.canvas({ pane: "haloPane", padding: 0.5 });

    this.haloLayer = L.layerGroup().addTo(this.map);
    this.markerLayer = L.layerGroup().addTo(this.map);
    this.choroplethLayer = null;
    this.heatLayer = null;

    this.heatOn = false;
    this.choroplethOn = false;

    this.incidents = [];
    this.markers = []; // { inc, marker, halo, shown }
    this.latestTs = Date.now();
    this._filtered = [];

    this.hoodByKey = new Map(); // normalized name -> Leaflet layer
    this.selectedHood = null;
    this.onSelectHood = null;

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
      const radius = this._radiusFor(inc);
      const marker = L.circleMarker([inc.lat, inc.lon], {
        renderer: this.bubbleRenderer,
        radius,
        color,
        weight: 1,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.42,
      });
      marker.bindPopup(() => buildPopup(inc), { closeButton: true });

      // Firearm-involved incidents get a bright red-orange ring that reads
      // against any category color, at any zoom.
      let halo = null;
      if (inc.firearm) {
        halo = L.circleMarker([inc.lat, inc.lon], {
          renderer: this.haloRenderer,
          radius: radius + 3.5,
          color: FIREARM_COLOR,
          weight: 2.5,
          opacity: 0.95,
          fill: false,
          interactive: false,
        });
      }
      this.markers.push({ inc, marker, halo, shown: false });
    }
  }

  // Apply category + date + firearm-only + neighborhood filters.
  applyFilters(activeCats, minTs, firearmOnly, selectedHoodKey) {
    this.selectedHood = selectedHoodKey || null;
    const filtered = [];
    for (const m of this.markers) {
      const inc = m.inc;
      const match =
        activeCats.has(inc.cat) &&
        inc.ts >= minTs &&
        (!firearmOnly || inc.firearm) &&
        (!selectedHoodKey || normHood(inc.hood) === selectedHoodKey);
      if (match) {
        filtered.push(inc);
        if (!m.shown) {
          this.markerLayer.addLayer(m.marker);
          if (m.halo) this.haloLayer.addLayer(m.halo);
          m.shown = true;
        }
      } else if (m.shown) {
        this.markerLayer.removeLayer(m.marker);
        if (m.halo) this.haloLayer.removeLayer(m.halo);
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
      this.map.removeLayer(this.haloLayer);
    } else {
      if (this.heatLayer) this.map.removeLayer(this.heatLayer);
      this.markerLayer.addTo(this.map);
      this.haloLayer.addTo(this.map);
    }
  }

  // ---------- Neighborhoods / choropleth ----------

  setNeighborhoods(geojson, onSelectHood) {
    this.onSelectHood = onSelectHood;
    this.choroplethLayer = L.geoJSON(geojson, {
      pane: "choroplethPane",
      style: () => baseHoodStyle(),
      onEachFeature: (feature, layer) => {
        const name = feature.properties.NhoodName;
        const key = normHood(name);
        this.hoodByKey.set(key, layer);
        layer.on("click", () => this.onSelectHood && this.onSelectHood(name));
        layer.on("mouseover", () => {
          if (this.choroplethOn && normHood(name) !== this.selectedHood) {
            layer.setStyle({ weight: 1.2, color: "rgba(245,158,11,0.6)" });
          }
        });
        layer.on("mouseout", () => {
          if (this.choroplethOn) this._restyleHood(layer, name);
        });
      },
    });
  }

  hasNeighborhoods() {
    return !!this.choroplethLayer;
  }

  setChoropleth(on) {
    if (!this.choroplethLayer) return;
    this.choroplethOn = on;
    if (on) this.choroplethLayer.addTo(this.map);
    else this.map.removeLayer(this.choroplethLayer);
  }

  // Recolor polygons by in-view incident counts (sequential ramp).
  updateChoropleth(countsByKey) {
    if (!this.choroplethLayer) return;
    this._countsByKey = countsByKey;
    let max = 1;
    for (const v of countsByKey.values()) if (v > max) max = v;
    this._choroMax = max;
    this.choroplethLayer.eachLayer((layer) => {
      const name = layer.feature.properties.NhoodName;
      this._restyleHood(layer, name);
    });
  }

  _restyleHood(layer, name) {
    const key = normHood(name);
    const count = (this._countsByKey && this._countsByKey.get(key)) || 0;
    const selected = this.selectedHood === key;
    layer.setStyle(hoodStyle(count, this._choroMax || 1, selected));
  }

  fitHood(name) {
    const layer = this.hoodByKey.get(normHood(name));
    if (layer) this.map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  }

  choroplethColor(count, max) {
    return rampColor(count, max);
  }

  // Show/hide all crime-mode layers when switching top-level modes.
  setModeVisible(on) {
    if (on) {
      if (this.heatOn && this.heatLayer) {
        this.heatLayer.addTo(this.map);
      } else {
        this.markerLayer.addTo(this.map);
        this.haloLayer.addTo(this.map);
      }
      if (this.choroplethOn && this.choroplethLayer) {
        this.choroplethLayer.addTo(this.map);
      }
    } else {
      this.map.removeLayer(this.markerLayer);
      this.map.removeLayer(this.haloLayer);
      if (this.heatLayer) this.map.removeLayer(this.heatLayer);
      if (this.choroplethLayer) this.map.removeLayer(this.choroplethLayer);
    }
  }

  // ---------- Viewport helpers ----------

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

// ---------- Choropleth styling ----------

function baseHoodStyle() {
  return {
    color: "rgba(255,255,255,0.10)",
    weight: 0.6,
    fillColor: "#132033",
    fillOpacity: 0.0,
  };
}

function rampColor(count, max) {
  if (count <= 0) return CHOROPLETH_STOPS[0];
  // Perceptual-ish: sqrt so mid counts aren't washed out by a few hotspots.
  const t = Math.sqrt(count / max);
  const idx = Math.min(
    CHOROPLETH_STOPS.length - 1,
    1 + Math.floor(t * (CHOROPLETH_STOPS.length - 1))
  );
  return CHOROPLETH_STOPS[idx];
}

function hoodStyle(count, max, selected) {
  if (selected) {
    return {
      color: "#F59E0B",
      weight: 2,
      fillColor: rampColor(count, max),
      fillOpacity: 0.72,
    };
  }
  return {
    color: "rgba(255,255,255,0.12)",
    weight: 0.6,
    fillColor: rampColor(count, max),
    fillOpacity: count > 0 ? 0.62 : 0.12,
  };
}

// ---------- Popup ----------

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
    ? '<div class="popup__flag">● Firearm involved</div>'
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
