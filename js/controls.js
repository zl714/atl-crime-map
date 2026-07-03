// Filter controls: category toggles, firearms-only, date chips, heat +
// choropleth toggles.

import { CATEGORIES, DATE_RANGES, DEFAULT_RANGE, FIREARM_COLOR } from "./config.js";

export class Controls {
  constructor({ onChange, onHeatToggle, onChoroplethToggle }) {
    this.onChange = onChange;
    this.onHeatToggle = onHeatToggle;
    this.onChoroplethToggle = onChoroplethToggle;
    this.activeCats = new Set(CATEGORIES.map((c) => c.id));
    this.range = DEFAULT_RANGE;
    this.firearmOnly = false;
    this.heatOn = false;
    this.choroplethOn = false;
    this._buildCategoryToggles();
    this._buildFirearmChip();
    this._buildDateChips();
    this._buildHeatToggle();
    this._buildChoroplethToggle();
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
      if (this.activeCats.size === 1) return; // keep at least one active
      this.activeCats.delete(id);
      btn.setAttribute("aria-pressed", "false");
    } else {
      this.activeCats.add(id);
      btn.setAttribute("aria-pressed", "true");
    }
    this.onChange();
  }

  _buildFirearmChip() {
    const host = document.getElementById("firearm-toggle-wrap");
    const btn = document.createElement("button");
    btn.className = "chip chip--firearm";
    btn.id = "firearm-toggle";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<span class="chip__ring" style="border-color:${FIREARM_COLOR}"></span>Firearms only`;
    btn.addEventListener("click", () => {
      this.firearmOnly = !this.firearmOnly;
      btn.setAttribute("aria-pressed", this.firearmOnly ? "true" : "false");
      this.onChange();
    });
    host.appendChild(btn);
    this.firearmButton = btn;
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
    btn.addEventListener("click", () => {
      this.heatOn = !this.heatOn;
      btn.setAttribute("aria-pressed", this.heatOn ? "true" : "false");
      this.onHeatToggle(this.heatOn);
    });
  }

  _buildChoroplethToggle() {
    const btn = document.getElementById("choropleth-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      this.choroplethOn = !this.choroplethOn;
      btn.setAttribute("aria-pressed", this.choroplethOn ? "true" : "false");
      this.onChoroplethToggle(this.choroplethOn);
    });
  }

  minTimestamp(latestTs) {
    const range = DATE_RANGES.find((r) => r.id === this.range);
    if (!range || range.days == null) return 0;
    return latestTs - range.days * 86400000;
  }
}
