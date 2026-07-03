// Traffic mode: a dedicated view of GDOT 511 live roadway events (wrecks,
// closures, construction) plus optional traffic-camera locations. Both feeds
// come from the GEMA-hosted public GDOT ArcGIS services (CORS *), fetched
// client-side. Its own intel panel: active count, type breakdown, worst
// corridors, and a latest-incidents feed.

import { timeAgo, escapeHtml, escapeAttr } from "./live.js";

const BBOX = "-85.0,33.3,-83.9,34.4"; // metro Atlanta envelope (lon/lat)

const EVENTS_URL =
  "https://services1.arcgis.com/2iUE8l8JKrP2tygQ/arcgis/rest/services/" +
  "GDOT_511_Events_Public_View/FeatureServer/0/query" +
  `?where=1%3D1&geometry=${BBOX}&geometryType=esriGeometryEnvelope&inSR=4326` +
  "&spatialRel=esriSpatialRelIntersects&outFields=RoadwayName,EventType,Severity," +
  "Description,LastUpdated,IsFullClosure,DirectionOfTravel,LanesAffected,Latitude,Longitude" +
  "&outSR=4326&f=json";

const CAMERAS_URL =
  "https://services1.arcgis.com/2iUE8l8JKrP2tygQ/arcgis/rest/services/" +
  "GDOT_Live_Traffic_Cameras/FeatureServer/0/query" +
  "?where=subdivision%3D%27Metro%20Atlanta%27&outFields=name,route,county," +
  "location_description,cross_street,dir,url&outSR=4326&f=json&resultRecordCount=3000";

// EventType -> { label, color }. Colors stay in the crime map's palette.
const EVENT_STYLE = {
  accidentsAndIncidents: { label: "Incident", color: "#F23645" },
  closures: { label: "Closure", color: "#FF5A1F" },
  roadwork: { label: "Roadwork", color: "#F59E0B" },
  specialEvents: { label: "Special event", color: "#60A5FA" },
  weatherEvents: { label: "Weather", color: "#94A3B8" },
};
const styleFor = (t) => EVENT_STYLE[t] || { label: titleish(t || "Event"), color: "#94A3B8" };

export class TrafficView {
  constructor(map, onUpdate) {
    this.map = map;
    this.onUpdate = onUpdate;

    map.createPane("cameraPane").style.zIndex = 406;
    map.createPane("trafficPane").style.zIndex = 412;
    this.trafficRenderer = L.canvas({ pane: "trafficPane" });
    this.cameraRenderer = L.canvas({ pane: "cameraPane" });

    this.incidentLayer = L.layerGroup();
    this.cameraLayer = L.layerGroup();

    this.incidents = [];
    this.cameras = [];
    this.camerasLoaded = false;
    this.showCameras = false;
    this.lastFetch = null;
    this._active = false;
    this._timer = null;

    this.el = {
      total: document.getElementById("traffic-total"),
      hint: document.getElementById("traffic-hint"),
      types: document.getElementById("traffic-types"),
      corridors: document.getElementById("traffic-corridors"),
      feed: document.getElementById("traffic-feed"),
      camCount: null,
    };
  }

  setActive(active) {
    this._active = active;
    if (active) {
      this.incidentLayer.addTo(this.map);
      if (this.showCameras) this.cameraLayer.addTo(this.map);
      this.refresh();
      this._timer = setInterval(() => this.refresh(), 3 * 60000);
    } else {
      this.map.removeLayer(this.incidentLayer);
      this.map.removeLayer(this.cameraLayer);
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
    }
  }

  async refresh() {
    await this._fetchIncidents();
    if (this.showCameras && !this.camerasLoaded) await this._fetchCameras();
    this.lastFetch = Date.now();
    this.render();
    this.onUpdate();
  }

  toggleCameras(on) {
    this.showCameras = on;
    if (on) {
      this.cameraLayer.addTo(this.map);
      if (!this.camerasLoaded) this._fetchCameras().then(() => this.onUpdate());
    } else {
      this.map.removeLayer(this.cameraLayer);
    }
    this.onUpdate();
  }

  async _fetchIncidents() {
    let d;
    try {
      const res = await fetch(EVENTS_URL, { cache: "no-store" });
      if (!res.ok) return;
      d = await res.json();
    } catch {
      return;
    }
    this.incidentLayer.clearLayers();
    const items = [];
    for (const f of d.features || []) {
      const a = f.attributes || {};
      if (a.Latitude == null || a.Longitude == null) continue;
      const st = styleFor(a.EventType);
      const major =
        (a.Severity || "").toLowerCase() === "major" ||
        String(a.IsFullClosure).toLowerCase() === "true";
      const color = major && a.EventType === "accidentsAndIncidents" ? "#F23645" : st.color;
      const marker = L.marker([a.Latitude, a.Longitude], {
        icon: triangleIcon(color),
        keyboard: false,
      });
      marker.bindPopup(incidentPopup(a, st), { closeButton: true });
      const item = {
        type: st.label,
        eventType: a.EventType,
        road: a.RoadwayName || "",
        severity: a.Severity || "",
        fullClosure: String(a.IsFullClosure).toLowerCase() === "true",
        desc: a.Description || "",
        ts: a.LastUpdated || 0,
        lat: a.Latitude,
        lon: a.Longitude,
        marker,
      };
      items.push(item);
      this.incidentLayer.addLayer(marker);
    }
    this.incidents = items;
  }

  async _fetchCameras() {
    let d;
    try {
      const res = await fetch(CAMERAS_URL, { cache: "no-store" });
      if (!res.ok) return;
      d = await res.json();
    } catch {
      return;
    }
    this.cameraLayer.clearLayers();
    const items = [];
    for (const f of d.features || []) {
      const a = f.attributes || {};
      const g = f.geometry || {};
      const lat = g.y;
      const lon = g.x;
      if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;
      const marker = L.circleMarker([lat, lon], {
        renderer: this.cameraRenderer,
        radius: 3,
        color: "#7C93B4",
        weight: 1,
        fillColor: "#3B4A63",
        fillOpacity: 0.9,
      });
      marker.bindPopup(cameraPopup(a), { closeButton: true });
      items.push({ a, marker });
      this.cameraLayer.addLayer(marker);
    }
    this.cameras = items;
    this.camerasLoaded = true;
  }

  render() {
    const inc = this.incidents;
    this.el.total.textContent = inc.length.toLocaleString();
    this.el.hint.textContent = inc.length
      ? "Live GDOT 511 roadway events across metro Atlanta."
      : "No active GDOT 511 events in metro Atlanta right now.";

    // Type breakdown.
    const byType = new Map();
    for (const i of inc) byType.set(i.type, (byType.get(i.type) || 0) + 1);
    const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const maxType = Math.max(1, ...typeRows.map((r) => r[1]));
    this.el.types.innerHTML =
      typeRows
        .map(([label, n]) => {
          const color = colorForLabel(label);
          return `<div class="tr-row">
            <span class="tr-swatch" style="background:${color}"></span>
            <span class="tr-name">${escapeHtml(label)}</span>
            <span class="tr-bar"><span class="tr-bar__fill" style="width:${
              (n / maxType) * 100
            }%;background:${color}"></span></span>
            <span class="tr-count tnum">${n}</span></div>`;
        })
        .join("") || '<div class="empty">—</div>';

    // Worst corridors (by incident count).
    const byRoad = new Map();
    for (const i of inc) {
      if (!i.road) continue;
      const r = byRoad.get(i.road) || { count: 0, major: 0 };
      r.count += 1;
      if (i.severity.toLowerCase() === "major" || i.fullClosure) r.major += 1;
      byRoad.set(i.road, r);
    }
    const roads = [...byRoad.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
    this.el.corridors.innerHTML =
      roads
        .map(
          ([road, r]) => `<div class="tr-corridor">
            <span class="tr-corridor__count tnum">${r.count}</span>
            <span class="tr-corridor__name">${escapeHtml(titleish(road))}</span>
            ${
              r.major
                ? `<span class="tr-corridor__major tnum" title="major/closure">${r.major}●</span>`
                : ""
            }</div>`
        )
        .join("") || '<div class="empty">No corridors with active events.</div>';

    // Latest incidents feed.
    const latest = [...inc].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30);
    this.el.feed.innerHTML =
      latest
        .map((i) => {
          const color = colorForLabel(i.type);
          const when = i.ts ? timeAgo(i.ts) : "";
          return `<button class="tr-item" data-lat="${i.lat}" data-lon="${i.lon}">
            <span class="tr-item__stripe" style="background:${color}"></span>
            <span class="tr-item__body">
              <span class="tr-item__title">${escapeHtml(i.type)} — ${escapeHtml(
            titleish(i.road) || "Roadway"
          )}${i.fullClosure ? ' <span class="tr-closed">CLOSED</span>' : ""}</span>
              <span class="tr-item__meta">${escapeHtml(shorten(i.desc, 64))}</span>
            </span>
            <span class="tr-item__when tnum">${when}</span></button>`;
        })
        .join("") || '<div class="empty">No active events.</div>';

    for (const btn of this.el.feed.querySelectorAll(".tr-item")) {
      btn.addEventListener("click", () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        this.map.setView([lat, lon], Math.max(this.map.getZoom(), 14), {
          animate: true,
        });
        const hit = this.incidents.find((i) => i.lat === lat && i.lon === lon);
        if (hit && hit.marker) hit.marker.openPopup();
      });
    }
  }

  counts() {
    return { incidents: this.incidents.length, cameras: this.cameras.length };
  }
}

// ---------- Icons ----------

function triangleIcon(color) {
  return L.divIcon({
    className: "live-glyph",
    html: `<span class="glyph-triangle" style="border-bottom-color:${color}"></span>`,
    iconSize: [18, 16],
    iconAnchor: [9, 11],
    popupAnchor: [0, -9],
  });
}

// ---------- Popups ----------

function incidentPopup(a, st) {
  const when = a.LastUpdated ? timeAgo(a.LastUpdated) : "";
  const closed = String(a.IsFullClosure).toLowerCase() === "true";
  return `
    <div class="popup__cat" style="color:${st.color}">
      <span class="glyph-triangle" style="border-bottom-color:${st.color}"></span>GDOT 511 · ${escapeHtml(
    st.label
  )}
    </div>
    <div class="popup__type">${escapeHtml(titleish(a.RoadwayName) || "Roadway")}${
    closed ? ' <span class="popup__flag">Full closure</span>' : ""
  }</div>
    ${a.Description ? popRow("Details", a.Description) : ""}
    ${a.DirectionOfTravel ? popRow("Direction", dirText(a.DirectionOfTravel)) : ""}
    ${a.LanesAffected ? popRow("Lanes", a.LanesAffected) : ""}
    ${a.Severity ? popRow("Severity", titleish(a.Severity)) : ""}
    ${when ? popRow("Updated", when) : ""}
  `;
}

function cameraPopup(a) {
  const loc = a.location_description || `${titleish(a.route)} ${a.cross_street || ""}`;
  // GDOT snapshot host is http-only, so an embedded <img> is blocked as mixed
  // content on the HTTPS site; it falls back to the live 511 camera link.
  const snap = a.url
    ? `<img class="cam-snap" src="${escapeAttr(a.url)}" alt="camera snapshot"
        onerror="this.style.display='none'">`
    : "";
  const view = a.url
    ? `<a class="popup__link" href="${escapeAttr(cam511Link(a))}" target="_blank" rel="noopener">View live camera ↗</a>`
    : "";
  return `
    <div class="popup__cat" style="color:#7C93B4">GDOT traffic camera</div>
    <div class="popup__type">${escapeHtml(loc)}</div>
    ${a.county ? popRow("County", a.county) : ""}
    ${a.dir ? popRow("Direction", dirText(a.dir)) : ""}
    ${snap}
    ${view}
  `;
}

function cam511Link(a) {
  // Prefer the https 511 camera page over the http snapshot host.
  return "https://511ga.org/";
}

function popRow(k, v) {
  return `<div class="popup__row"><span class="k">${k}</span><span class="v">${escapeHtml(
    v
  )}</span></div>`;
}

// ---------- helpers ----------

function colorForLabel(label) {
  for (const s of Object.values(EVENT_STYLE)) if (s.label === label) return s.color;
  return "#94A3B8";
}

function dirText(d) {
  const map = { n: "Northbound", s: "Southbound", e: "Eastbound", w: "Westbound", ns: "Both directions" };
  return map[(d || "").toLowerCase()] || titleish(d);
}

function titleish(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function shorten(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
