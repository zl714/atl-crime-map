// Shared configuration: categories, colors, map defaults.

export const CATEGORIES = [
  { id: "violent", label: "Violent", color: "#F23645" },
  { id: "property", label: "Property", color: "#F59E0B" },
  { id: "vehicle", label: "Vehicle", color: "#60A5FA" },
  { id: "other", label: "Other", color: "#94A3B8" },
];

export const CATEGORY_COLOR = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color])
);

export const CATEGORY_LABEL = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
);

// Quick date-range chips. days = null means "all loaded".
export const DATE_RANGES = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "6mo", label: "6mo", days: 200 },
  { id: "all", label: "All", days: null },
];

export const DEFAULT_RANGE = "all";

export const MAP = {
  center: [33.762, -84.39], // downtown Atlanta
  zoom: 12,
  minZoom: 10,
  maxZoom: 18,
};

export const DATA_URL = "data/incidents.json";
