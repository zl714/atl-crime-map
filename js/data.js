// Data loading + derived helpers for incident records.

import { DATA_URL, NEIGHBORHOODS_URL, NEIGHBORHOOD_ALIAS } from "./config.js";

export async function loadIncidents() {
  const res = await fetch(DATA_URL, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to load incident data (${res.status})`);
  }
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.incidents)) {
    throw new Error("Incident data is malformed.");
  }
  return payload;
}

// Neighborhood boundaries are optional: if the file is missing or malformed we
// degrade gracefully (table without choropleth) rather than break the app.
export async function loadNeighborhoods() {
  try {
    const res = await fetch(NEIGHBORHOODS_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const gj = await res.json();
    if (!gj || !Array.isArray(gj.features) || !gj.features.length) return null;
    return gj;
  } catch {
    return null;
  }
}

// Normalize a neighborhood label for joining incidents to boundary polygons.
export function normHood(name) {
  const key = (name || "").trim().toLowerCase();
  return NEIGHBORHOOD_ALIAS[key] ? NEIGHBORHOOD_ALIAS[key].toLowerCase() : key;
}

// Newest incident timestamp (ms) — used as the anchor for date-range chips
// so ranges are relative to the freshest data, not the browser clock.
export function latestTimestamp(incidents) {
  let max = 0;
  for (const inc of incidents) {
    if (inc.ts > max) max = inc.ts;
  }
  return max || Date.now();
}

export function formatDate(iso) {
  // iso is "YYYY-MM-DD" — render as "Mon D" without timezone drift.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function titleCase(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/_/g, " ");
}
