# Atlanta Crime Intelligence Map

A full-screen, dark-themed situational-awareness map for City of Atlanta crime
incidents — built in the spirit of [liveuamap.com](https://liveuamap.com), but
for metro-Atlanta public-safety data. Incidents are plotted as color-coded
bubbles over a dark basemap, with a live intelligence panel that recomputes
totals, category breakdowns, a 7-day trend, and a recent-incident feed for
whatever is currently in view.

Built by **Zachary LeCroy** to demonstrate crime-analysis and GIS skills.
Not affiliated with the City of Atlanta, the Atlanta Police Department, or any
agency.

![Atlanta Crime Intelligence Map](docs/screenshot.png)

_Heatmap / hotspot view:_

![Hotspot heatmap](docs/screenshot-heatmap.png)

## Data

- **Source:** [Atlanta Police Department Open Data](https://opendata.atlantapd.org/) —
  live NIBRS Crime Incidents FeatureServer
  (`services3.arcgis.com/Et5Qfajgiyosiw4d/.../OpenDataWebsite_Crime_view`).
- **Records:** 29,288 incidents (points with valid coordinates).
- **Date range:** 2026-01-03 → 2026-07-02 (trailing ~180 days).
- **Retrieved:** 2026-07-02.
- Real, incident-level data only — nothing is fabricated. Locations are snapped
  to the nearest street/block by APD for anonymity, and house numbers are
  redacted at the source.

To re-pull fresh data, see [`data/REFRESH.md`](data/REFRESH.md). The whole
pipeline is one stdlib-only script:

```bash
python3 data/fetch_incidents.py
```

## Features

- **Dark full-screen map** (Leaflet + CartoDB `dark_all` tiles) centered on
  Atlanta, canvas-rendered so ~30k points stay smooth.
- **Color-coded incident bubbles** by offense category — violent, property,
  vehicle, other — subtly sized by recency (newer = larger). Categories are
  always paired with a labeled legend, never color alone.
- **Intelligence panel** that updates as you pan/zoom/filter:
  - total incidents in the current view,
  - category breakdown with proportional bars,
  - 7-day trend sparkline with day-over-week delta,
  - a recent-incident feed (offense, neighborhood, date; firearm-involved
    incidents flagged). Click a row to fly to it and open its popup.
- **Filters:** category toggles, date-range chips (30d / 90d / 6mo / All), and a
  **heatmap** hotspot toggle.
- **Incident popups** with offense, date, neighborhood, APD zone, place type,
  and a firearm-involved flag.
- **Shareable views:** `?lat=&lon=&z=&heat=1` deep-links to a specific
  location/zoom and can open straight into the heatmap.

## Categories

APD `NIBRS_Bucket` values are mapped into four analyst categories:

| Category | Color     | Includes (examples)                                          |
| -------- | --------- | ------------------------------------------------------------ |
| Violent  | `#F23645` | Homicide, Aggravated Assault, Robbery, Rape, Sex Offenses    |
| Property | `#F59E0B` | Burglary, Larceny, Shoplifting, Fraud, Damage to Property    |
| Vehicle  | `#60A5FA` | Auto Theft, Theft From Auto                                  |
| Other    | `#94A3B8` | Drug/Narcotic, Weapon-Law, Animal Cruelty, All Other Offenses|

## Run locally

Static site — no build step. Serve the directory over HTTP so the browser can
fetch `data/incidents.json`:

```bash
python3 -m http.server 8899 --directory .
# then open http://localhost:8899
```

Deploys to Vercel as-is (static, no configuration required).

## Tech notes

- **Vanilla JS (ES modules), no frameworks.** `Leaflet` for the map,
  `Leaflet.heat` for the hotspot layer — both from CDN.
- Rendering: a single Leaflet canvas renderer with `L.circleMarker`s; filtering
  toggles marker membership in place rather than rebuilding, and the in-view
  panel recompute is coalesced to one pass per animation frame.
- Design system (LeCroy brand): navy near-black surfaces, a slate text ramp,
  amber (`#F59E0B`) as the single interactive accent, 1px hairline borders,
  Geist type, tabular-nums on all figures, a 4px spacing grid, and 6–12px radii.

## Project layout

```
atl-crime-map/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js          # orchestrator: data -> map -> panel -> controls
│   ├── config.js       # categories, colors, map + date-range config
│   ├── data.js         # fetch + date/format helpers
│   ├── mapview.js      # Leaflet map, bubbles, filtering, heat layer
│   ├── panel.js        # in-view stats, bars, sparkline, recent feed
│   └── controls.js     # category/date/heat filter controls
├── data/
│   ├── incidents.json  # preprocessed incidents (generated)
│   ├── fetch_incidents.py
│   └── REFRESH.md
└── docs/               # screenshots
```
