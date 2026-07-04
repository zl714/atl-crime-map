// Intelligence panel: in-view total, firearm KPI, category bars, 7-day
// sparkline, top neighborhoods, day/hour time grid, and recent list.

import { CATEGORIES, CATEGORY_COLOR } from "./config.js";
import { formatDate, titleCase, normHood } from "./data.js";

const RECENT_LIMIT = 40;
const TOP_HOODS = 10;
const DAY_MS = 86400000;
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export class Panel {
  constructor({ onSelectIncident, onSelectHood }) {
    this.onSelectIncident = onSelectIncident;
    this.onSelectHood = onSelectHood;
    this.el = {
      viewTotal: document.getElementById("view-total"),
      viewHint: document.getElementById("view-hint"),
      fireCount: document.getElementById("fire-count"),
      firePct: document.getElementById("fire-pct"),
      catBars: document.getElementById("cat-bars"),
      sparkTotal: document.getElementById("spark-total"),
      sparkDelta: document.getElementById("spark-delta"),
      sparkStart: document.getElementById("spark-start"),
      sparkEnd: document.getElementById("spark-end"),
      sparkline: document.getElementById("sparkline"),
      topHoods: document.getElementById("top-hoods"),
      timeGrid: document.getElementById("time-grid"),
      timeGridPeak: document.getElementById("time-grid-peak"),
      recentList: document.getElementById("recent-list"),
      recentCount: document.getElementById("recent-count"),
    };
    this.selectedHood = null;
    this._buildCatRows();
    this._buildTimeGrid();
  }

  _buildCatRows() {
    this.el.catBars.innerHTML = "";
    this.catRows = {};
    for (const cat of CATEGORIES) {
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <span class="cat-dot" style="background:${cat.color}"></span>
        <span class="cat-name">${cat.label}</span>
        <span class="cat-bar"><span class="cat-bar__fill" style="background:${cat.color};width:0%"></span></span>
        <span class="cat-count tnum">0</span>`;
      this.el.catBars.appendChild(row);
      this.catRows[cat.id] = {
        fill: row.querySelector(".cat-bar__fill"),
        count: row.querySelector(".cat-count"),
      };
    }
  }

  // 7 rows (Mon-Sun) x 24 hour columns, built once and recolored on update.
  _buildTimeGrid() {
    const grid = this.el.timeGrid;
    grid.innerHTML = "";
    this.cells = []; // [dow][hour] -> element

    // Header row: blank corner + hour ticks at 0/6/12/18.
    grid.appendChild(cell("tg-corner", ""));
    for (let h = 0; h < 24; h++) {
      const label = h % 6 === 0 ? String(h) : "";
      grid.appendChild(cell("tg-hlabel", label));
    }

    for (let d = 0; d < 7; d++) {
      grid.appendChild(cell("tg-dlabel", DOW_LABELS[d]));
      this.cells[d] = [];
      for (let h = 0; h < 24; h++) {
        const c = cell("tg-cell", "");
        grid.appendChild(c);
        this.cells[d][h] = c;
      }
    }
  }

  update(inView, latestTs) {
    this._updateTotals(inView);
    this._updateFirearm(inView);
    this._updateCategories(inView);
    this._updateSparkline(inView, latestTs);
    this._updateTopHoods(inView, latestTs);
    this._updateTimeGrid(inView);
    this._updateRecent(inView);
  }

  setSelectedHood(key) {
    this.selectedHood = key;
  }

  _updateTotals(inView) {
    this.el.viewTotal.textContent = inView.length.toLocaleString();
    this.el.viewHint.textContent = inView.length
      ? "Stats reflect the current map view and filters."
      : "No incidents match here — zoom out or adjust filters.";
  }

  _updateFirearm(inView) {
    const fire = inView.reduce((n, inc) => n + (inc.firearm ? 1 : 0), 0);
    const pct = inView.length ? (100 * fire) / inView.length : 0;
    this.el.fireCount.textContent = fire.toLocaleString();
    this.el.firePct.textContent = inView.length ? `${pct.toFixed(1)}% of view` : "—";
  }

  _updateCategories(inView) {
    const counts = { violent: 0, property: 0, vehicle: 0, other: 0 };
    for (const inc of inView) counts[inc.cat] = (counts[inc.cat] || 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    for (const cat of CATEGORIES) {
      const c = counts[cat.id] || 0;
      const row = this.catRows[cat.id];
      row.fill.style.width = `${(c / max) * 100}%`;
      row.count.textContent = c.toLocaleString();
    }
  }

  _updateSparkline(inView, latestTs) {
    const days = 7;
    const endDay = Math.floor(latestTs / DAY_MS);
    const buckets = new Array(days).fill(0);
    const labels = [];
    for (let i = 0; i < days; i++) {
      labels.push(new Date((endDay - (days - 1 - i)) * DAY_MS));
    }
    for (const inc of inView) {
      const incDay = Math.floor(inc.ts / DAY_MS);
      const idx = days - 1 - (endDay - incDay);
      if (idx >= 0 && idx < days) buckets[idx] += 1;
    }
    const total = buckets.reduce((a, b) => a + b, 0);
    this.el.sparkTotal.textContent = total.toLocaleString();

    const first = buckets[0];
    const last = buckets[days - 1];
    if (first === 0 && last === 0) {
      this.el.sparkDelta.textContent = "";
    } else {
      const diff = last - first;
      const sign = diff > 0 ? "+" : "";
      this.el.sparkDelta.textContent = `${sign}${diff} day-over-week`;
      this.el.sparkDelta.style.color =
        diff > 0 ? "var(--cat-violent)" : "var(--text-dim)";
    }
    this.el.sparkStart.textContent = fmtShort(labels[0]);
    this.el.sparkEnd.textContent = fmtShort(labels[days - 1]);
    drawSparkline(this.el.sparkline, buckets);
  }

  // Top neighborhoods by in-view count, with firearm count and a
  // last-30d vs prior-30d trend arrow.
  _updateTopHoods(inView, latestTs) {
    const cut30 = latestTs - 30 * DAY_MS;
    const cut60 = latestTs - 60 * DAY_MS;
    const agg = new Map(); // key -> { name, count, fire, last30, prev30 }
    for (const inc of inView) {
      if (!inc.hood || inc.hood === "Unknown") continue;
      const key = normHood(inc.hood);
      let a = agg.get(key);
      if (!a) {
        a = { name: inc.hood, key, count: 0, fire: 0, last30: 0, prev30: 0 };
        agg.set(key, a);
      }
      a.count += 1;
      if (inc.firearm) a.fire += 1;
      if (inc.ts >= cut30) a.last30 += 1;
      else if (inc.ts >= cut60) a.prev30 += 1;
    }
    const rows = [...agg.values()]
      .sort((x, y) => y.count - x.count)
      .slice(0, TOP_HOODS);

    if (!rows.length) {
      this.el.topHoods.innerHTML =
        '<div class="empty">No mapped neighborhoods in view.</div>';
      return;
    }
    const max = rows[0].count;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const diff = r.last30 - r.prev30;
      const trend =
        diff > 0
          ? `<span class="trend up" title="+${diff} vs prior 30 days">▲ ${diff}</span>`
          : diff < 0
          ? `<span class="trend down" title="${diff} vs prior 30 days">▼ ${-diff}</span>`
          : `<span class="trend flat" title="no change vs prior 30 days">—</span>`;
      const fire = r.fire
        ? `<span class="hood-fire tnum" title="${r.fire} firearm-involved">◉ ${r.fire}</span>`
        : "";
      const active = this.selectedHood === r.key ? " is-active" : "";
      const item = document.createElement("button");
      item.className = "hood-row" + active;
      item.innerHTML = `
        <span class="hood-rank tnum">${r.count.toLocaleString()}</span>
        <span class="hood-body">
          <span class="hood-name">${escapeHtml(r.name)}</span>
          <span class="hood-bar"><span class="hood-bar__fill" style="width:${
            (r.count / max) * 100
          }%"></span></span>
        </span>
        <span class="hood-meta">${fire}${trend}</span>`;
      item.addEventListener("click", () => this.onSelectHood(r.name));
      frag.appendChild(item);
    }
    this.el.topHoods.innerHTML = "";
    this.el.topHoods.appendChild(frag);
  }

  _updateTimeGrid(inView) {
    const grid = new Array(7).fill(0).map(() => new Array(24).fill(0));
    let max = 0;
    let peakD = 0;
    let peakH = 0;
    for (const inc of inView) {
      const d = inc.dow;
      const h = inc.hour;
      if (d == null || h == null) continue;
      const v = ++grid[d][h];
      if (v > max) {
        max = v;
        peakD = d;
        peakH = h;
      }
    }
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const v = grid[d][h];
        const c = this.cells[d][h];
        c.style.background = heatCellColor(v, max);
        c.title = v ? `${DOW_LABELS[d]} ${hourLabel(h)} · ${v}` : "";
      }
    }
    this.el.timeGridPeak.textContent = max
      ? `Peak ${DOW_LABELS[peakD]} ${hourLabel(peakH)} (${max})`
      : "";
  }

  _updateRecent(inView) {
    const sorted = [...inView].sort((a, b) => b.ts - a.ts).slice(0, RECENT_LIMIT);
    this.el.recentCount.textContent = inView.length
      ? `${Math.min(inView.length, RECENT_LIMIT)} of ${inView.length.toLocaleString()}`
      : "";

    if (!sorted.length) {
      this.el.recentList.innerHTML = '<div class="empty">No incidents in view.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const inc of sorted) {
      const color = CATEGORY_COLOR[inc.cat] || CATEGORY_COLOR.other;
      const item = document.createElement("div");
      item.className = "recent-item" + (inc.firearm ? " has-firearm" : "");
      const hood =
        inc.hood && inc.hood !== "Unknown" ? inc.hood : inc.zone || "Atlanta";
      const flag = inc.firearm
        ? '<span class="recent-item__flag">◉ firearm</span>'
        : "";
      const type = titleCase(inc.type);
      item.innerHTML = `
        <span class="recent-item__stripe" style="background:${color}"></span>
        <span class="recent-item__body">
          <span class="recent-item__type">${escapeHtml(
            !type || type === "Unknown" ? "Unclassified offense" : type
          )}${flag}</span>
          <span class="recent-item__meta">${escapeHtml(hood)}</span>
        </span>
        <span class="recent-item__date tnum">${formatDate(inc.date)}</span>`;
      item.addEventListener("click", () => this.onSelectIncident(inc));
      frag.appendChild(item);
    }
    this.el.recentList.innerHTML = "";
    this.el.recentList.appendChild(frag);
  }
}

// ---------- helpers ----------

function cell(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function hourLabel(h) {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function fmtShort(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Dark -> amber -> red ramp for time-grid cells.
function heatCellColor(v, max) {
  if (!v || !max) return "rgba(255,255,255,0.03)";
  const t = Math.sqrt(v / max); // ease so low counts remain visible
  const stops = [
    [30, 41, 59], // slate
    [245, 158, 11], // amber
    [242, 54, 69], // red
  ];
  let a, b, f;
  if (t < 0.6) {
    a = stops[0];
    b = stops[1];
    f = t / 0.6;
  } else {
    a = stops[1];
    b = stops[2];
    f = (t - 0.6) / 0.4;
  }
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

function drawSparkline(canvas, values) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 44;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const max = Math.max(1, ...values);
  const pad = 3;
  const n = values.length;
  const stepX = (w - pad * 2) / (n - 1);
  const scaleY = (v) => h - pad - (v / max) * (h - pad * 2);

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = scaleY(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad + (n - 1) * stepX, h - pad);
  ctx.lineTo(pad, h - pad);
  ctx.closePath();
  ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = scaleY(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  const lastX = pad + (n - 1) * stepX;
  const lastY = scaleY(values[n - 1]);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#F3F4F6";
  ctx.fill();
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
