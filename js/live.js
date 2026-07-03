// Crime-mode live layers: media reports (news) + NWS weather alerts.
// News is precomputed by a cron into data/live.json and read from
// raw.githubusercontent so refreshes go live without a redeploy. Weather is
// fetched client-side (api.weather.gov sends CORS *). Traffic is a separate
// top-level mode (see traffic.js), not a layer here.

const NEWS_RAW =
  "https://raw.githubusercontent.com/zl714/atl-crime-map/main/data/live.json";
const NEWS_LOCAL = "data/live.json";
const COUNTIES_URL = "data/atl_counties.geojson";

const NWS_URL = "https://api.weather.gov/alerts/active?area=GA";
const NWS_HEADERS = { Accept: "application/geo+json" };

const ATL_COUNTY_CODES = new Set([
  "GAC121", "GAC089", "GAC067", "GAC057", "GAC223", "GAC015", "GAC063", "GAC135",
]);

const NEWS_COLOR = "#F59E0B";
const SEV_COLOR = { extreme: "#F23645", severe: "#F23645", moderate: "#F59E0B" };
const weatherColor = (sev) => SEV_COLOR[(sev || "").toLowerCase()] || "#94A3B8";

export class LiveLayers {
  constructor(map, onUpdate) {
    this.map = map;
    this.onUpdate = onUpdate;

    map.createPane("weatherPane").style.zIndex = 345;

    this.newsLayer = L.layerGroup();
    this.weatherLayer = L.layerGroup();

    this.data = { news: [], weather: [] };
    this.counties = null;
    this.lastFetch = null;
    this.on = { news: true, weather: true };
    this._active = false;
  }

  setLayer(kind, on) {
    this.on[kind] = on;
    const layer = this[`${kind}Layer`];
    if (on && this._active) layer.addTo(this.map);
    else this.map.removeLayer(layer);
    this.onUpdate();
  }

  // Called when entering/leaving crime mode.
  setActive(active) {
    this._active = active;
    for (const kind of ["news", "weather"]) {
      if (active && this.on[kind]) this[`${kind}Layer`].addTo(this.map);
      else this.map.removeLayer(this[`${kind}Layer`]);
    }
  }

  async init() {
    try {
      const res = await fetch(COUNTIES_URL);
      this.counties = res.ok ? await res.json() : null;
    } catch {
      this.counties = null;
    }
    // Map visibility is controlled by setMode()/setActive(); just load data.
    await this.refreshAll();
    setInterval(() => this._refreshWeather(), 3 * 60000);
    setInterval(() => this._refreshNews(), 5 * 60000);
  }

  async refreshAll() {
    await Promise.allSettled([this._refreshNews(), this._refreshWeather()]);
    this.lastFetch = Date.now();
    this.onUpdate();
  }

  // ---------- News ----------
  async _refreshNews() {
    let payload = null;
    try {
      const res = await fetch(NEWS_RAW + "?t=" + Date.now(), { cache: "no-store" });
      if (res.ok) payload = await res.json();
    } catch {
      /* fall back to same-origin copy */
    }
    if (!payload) {
      try {
        const res = await fetch(NEWS_LOCAL, { cache: "no-store" });
        if (res.ok) payload = await res.json();
      } catch {
        payload = null;
      }
    }
    if (!payload) return;
    this.newsUpdated = payload.updated || null;
    this.newsLayer.clearLayers();
    const items = [];
    for (const n of payload.news || []) {
      const item = { ...n, kind: "news", ts: n.published || 0 };
      items.push(item);
      if (n.lat != null && n.lon != null) {
        const marker = L.marker([n.lat, n.lon], {
          icon: diamondIcon(NEWS_COLOR),
          keyboard: false,
        });
        marker.bindPopup(newsPopup(n), { closeButton: true });
        item.marker = marker;
        this.newsLayer.addLayer(marker);
      }
    }
    this.data.news = items;
    this.lastFetch = Date.now();
    this.onUpdate();
  }

  // ---------- Weather (NWS) ----------
  async _refreshWeather() {
    let d;
    try {
      const res = await fetch(NWS_URL, { headers: NWS_HEADERS, cache: "no-store" });
      if (!res.ok) return;
      d = await res.json();
    } catch {
      return;
    }
    this.weatherLayer.clearLayers();
    const items = [];
    for (const f of d.features || []) {
      const p = f.properties || {};
      const codes = (p.geocode && p.geocode.UGC) || [];
      const inAtlanta =
        codes.some((c) => ATL_COUNTY_CODES.has(c)) ||
        (this.counties && featureIntersectsMetro(f));
      if (!inAtlanta) continue;

      const color = weatherColor(p.severity);
      const item = {
        kind: "weather",
        type: p.event,
        title: p.event,
        summary: p.headline || p.areaDesc || "",
        severity: p.severity,
        ts: p.sent ? Date.parse(p.sent) : 0,
        lat: null,
        lon: null,
      };

      let gj = null;
      if (f.geometry) {
        gj = L.geoJSON(f, {
          pane: "weatherPane",
          style: () => ({ color, weight: 1, fillColor: color, fillOpacity: 0.14 }),
        });
      } else if (this.counties) {
        const hit = this.counties.features.filter((cf) =>
          codes.includes(cf.properties.code)
        );
        if (hit.length) {
          gj = L.geoJSON(
            { type: "FeatureCollection", features: hit },
            {
              pane: "weatherPane",
              style: () => ({ color, weight: 1, fillColor: color, fillOpacity: 0.1 }),
            }
          );
        }
      }
      if (gj) {
        gj.bindPopup(weatherPopup(p));
        this.weatherLayer.addLayer(gj);
        const c = gj.getBounds().getCenter();
        item.lat = c.lat;
        item.lon = c.lng;
      }
      items.push(item);
    }
    this.data.weather = items;
    this.lastFetch = Date.now();
    this.onUpdate();
  }

  feed() {
    const all = [];
    if (this.on.news) all.push(...this.data.news);
    if (this.on.weather) all.push(...this.data.weather);
    return all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  counts() {
    return { news: this.data.news.length, weather: this.data.weather.length };
  }

  focus(item) {
    if (item.lat == null || item.lon == null) return;
    this.map.setView([item.lat, item.lon], Math.max(this.map.getZoom(), 14), {
      animate: true,
    });
    if (item.marker) item.marker.openPopup();
  }
}

// ---------- Icons ----------

export function diamondIcon(color) {
  return L.divIcon({
    className: "live-glyph",
    html: `<span class="glyph-diamond" style="background:${color}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

// ---------- Popups ----------

function newsPopup(n) {
  const when = n.published ? timeAgo(n.published) : "";
  return `
    <div class="popup__cat" style="color:${NEWS_COLOR}">
      <span class="glyph-diamond" style="background:${NEWS_COLOR}"></span>Media report · ${escapeHtml(n.type || "")}
    </div>
    <div class="popup__type">${escapeHtml(n.title)}</div>
    ${n.location_text ? popRow("Location", n.location_text) : ""}
    ${popRow("Source", n.source)}
    ${when ? popRow("Reported", when) : ""}
    <a class="popup__link" href="${escapeAttr(n.link)}" target="_blank" rel="noopener">Read report ↗</a>
  `;
}

function weatherPopup(p) {
  return `
    <div class="popup__cat" style="color:${weatherColor(p.severity)}">
      NWS alert · ${escapeHtml(p.severity || "")}
    </div>
    <div class="popup__type">${escapeHtml(p.event || "Weather alert")}</div>
    ${p.areaDesc ? popRow("Area", p.areaDesc) : ""}
    ${p.headline ? `<div class="popup__wx">${escapeHtml(p.headline)}</div>` : ""}
    ${p.ends ? popRow("Ends", new Date(p.ends).toLocaleString()) : ""}
  `;
}

function popRow(k, v) {
  return `<div class="popup__row"><span class="k">${k}</span><span class="v">${escapeHtml(
    v
  )}</span></div>`;
}

// ---------- helpers ----------

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function featureIntersectsMetro(f) {
  const b = [-85.0, 33.3, -83.9, 34.4];
  let hit = false;
  const scan = (coords) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) hit = true;
    } else {
      for (const c of coords) scan(c);
    }
  };
  if (f.geometry && f.geometry.coordinates) scan(f.geometry.coordinates);
  return hit;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
