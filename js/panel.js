// Intelligence panel: in-view total, category bars, 7-day sparkline, recent list.

import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL } from "./config.js";
import { formatDate, titleCase } from "./data.js";

const RECENT_LIMIT = 40;

export class Panel {
  constructor(onSelectIncident) {
    this.onSelectIncident = onSelectIncident;
    this.el = {
      viewTotal: document.getElementById("view-total"),
      viewHint: document.getElementById("view-hint"),
      catBars: document.getElementById("cat-bars"),
      sparkTotal: document.getElementById("spark-total"),
      sparkDelta: document.getElementById("spark-delta"),
      sparkStart: document.getElementById("spark-start"),
      sparkEnd: document.getElementById("spark-end"),
      sparkline: document.getElementById("sparkline"),
      recentList: document.getElementById("recent-list"),
      recentCount: document.getElementById("recent-count"),
    };
    this._buildCatRows();
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

  update(inView, latestTs) {
    this._updateTotals(inView);
    this._updateCategories(inView);
    this._updateSparkline(inView, latestTs);
    this._updateRecent(inView);
  }

  _updateTotals(inView) {
    this.el.viewTotal.textContent = inView.length.toLocaleString();
    this.el.viewHint.textContent = inView.length
      ? "Stats reflect the current map view and filters."
      : "No incidents match here — zoom out or adjust filters.";
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
    // Build 7 daily buckets ending on the latest data day.
    const days = 7;
    const dayMs = 86400000;
    const endDay = Math.floor(latestTs / dayMs);
    const buckets = new Array(days).fill(0);
    const labels = [];
    for (let i = 0; i < days; i++) {
      const d = new Date((endDay - (days - 1 - i)) * dayMs);
      labels.push(d);
    }
    for (const inc of inView) {
      const incDay = Math.floor(inc.ts / dayMs);
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
      item.className = "recent-item";
      const hood =
        inc.hood && inc.hood !== "Unknown" ? inc.hood : inc.zone || "Atlanta";
      const flag = inc.firearm
        ? '<span class="recent-item__flag">firearm</span>'
        : "";
      item.innerHTML = `
        <span class="recent-item__stripe" style="background:${color}"></span>
        <span class="recent-item__body">
          <span class="recent-item__type">${escapeHtml(
            titleCase(inc.type)
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

function fmtShort(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

  // Baseline area
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = scaleY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad + (n - 1) * stepX, h - pad);
  ctx.lineTo(pad, h - pad);
  ctx.closePath();
  ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
  ctx.fill();

  // Line
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = scaleY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // End dot
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
