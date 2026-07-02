// Filter controls: category toggles, date-range chips, heat toggle.

import { CATEGORIES, DATE_RANGES, DEFAULT_RANGE } from "./config.js";

export class Controls {
  constructor({ onChange, onHeatToggle }) {
    this.onChange = onChange;
    this.onHeatToggle = onHeatToggle;
    this.activeCats = new Set(CATEGORIES.map((c) => c.id));
    this.range = DEFAULT_RANGE;
    this._buildCategoryToggles();
    this._buildDateChips();
    this._buildHeatToggle();
  }

  _buildCategoryToggles() {
    const host = document.getElementById("cat-toggles");
    this.catButtons = {};
    for (const cat of CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.setAttribute("aria-pressed", "true");
      btn.innerHTML = `<span class="chip__dot" style="background:${cat.color}"></span>${cat.label}`;
      btn.addEventListener("click", () => this._toggleCat(cat.id, btn));
      host.appendChild(btn);
      this.catButtons[cat.id] = btn;
    }
  }

  _toggleCat(id, btn) {
    if (this.activeCats.has(id)) {
      // Keep at least one category active.
      if (this.activeCats.size === 1) return;
      this.activeCats.delete(id);
      btn.setAttribute("aria-pressed", "false");
    } else {
      this.activeCats.add(id);
      btn.setAttribute("aria-pressed", "true");
    }
    this.onChange();
  }

  _buildDateChips() {
    const host = document.getElementById("date-chips");
    this.dateButtons = {};
    for (const r of DATE_RANGES) {
      const btn = document.createElement("button");
      btn.className = "chip chip--date";
      btn.textContent = r.label;
      btn.setAttribute("aria-pressed", r.id === this.range ? "true" : "false");
      btn.addEventListener("click", () => this._setRange(r.id));
      host.appendChild(btn);
      this.dateButtons[r.id] = btn;
    }
  }

  _setRange(id) {
    if (this.range === id) return;
    this.range = id;
    for (const [rid, btn] of Object.entries(this.dateButtons)) {
      btn.setAttribute("aria-pressed", rid === id ? "true" : "false");
    }
    this.onChange();
  }

  _buildHeatToggle() {
    const btn = document.getElementById("heat-toggle");
    this.heatOn = false;
    btn.addEventListener("click", () => {
      this.heatOn = !this.heatOn;
      btn.setAttribute("aria-pressed", this.heatOn ? "true" : "false");
      this.onHeatToggle(this.heatOn);
    });
  }

  minTimestamp(latestTs) {
    const range = DATE_RANGES.find((r) => r.id === this.range);
    if (!range || range.days == null) return 0;
    return latestTs - range.days * 86400000;
  }
}
