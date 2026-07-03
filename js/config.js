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

// Bright red-orange reserved exclusively for firearm-involved incidents.
// Sits apart from the four category hues so a gun ring reads on any bubble.
export const FIREARM_COLOR = "#FF5A1F";

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
export const NEIGHBORHOODS_URL = "data/neighborhoods.geojson";

// A few incident neighborhood labels don't match the boundary layer's
// NhoodName verbatim; map them to their polygon so the join covers more
// incidents. (Boundary layer + incident feed are both APD, so exact matches
// dominate — this only patches the largest stragglers.)
export const NEIGHBORHOOD_ALIAS = {
  "historic westin heights/bankhead": "Bankhead",
  "baker hills at campbellton": "Campbellton Road",
  "west cascade": "Cascade Heights",
  "peyton heights": "Peyton Forest",
};

// Sequential dark-to-amber ramp for the neighborhood choropleth. Low counts
// stay near the panel background; high counts push toward amber/red.
export const CHOROPLETH_STOPS = [
  "#132033",
  "#1E3050",
  "#3B4468",
  "#7A5A34",
  "#B67A22",
  "#F59E0B",
];
