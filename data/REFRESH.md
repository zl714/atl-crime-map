# Refreshing the incident data

The map reads a single preprocessed file: `data/incidents.json`. Regenerate it
by re-running the fetch script against the live Atlanta Police Department
FeatureServer.

## Source

- **Portal:** Atlanta Police Department Open Data — https://opendata.atlantapd.org/
- **Layer (live NIBRS crime incidents):**
  `https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/OpenDataWebsite_Crime_view/FeatureServer/0`
- The layer is updated by APD on a rolling basis and holds incident-level
  records from 2021 to the present (~300k rows). Coordinates are snapped to the
  nearest street/block by APD for anonymity.

## Refresh

```bash
python3 data/fetch_incidents.py
```

No dependencies beyond the Python 3 standard library.

What the script does:

1. Queries the FeatureServer for the trailing `WINDOW_DAYS` (default **180**) of
   incidents where `OccurredFromDate` is within the window and lat/lon are set.
2. Pages through results 2,000 at a time (the server's `maxRecordCount`).
3. Drops rows outside a metro-Atlanta bounding box (sanity filter).
4. Maps each APD `NIBRS_Bucket` into one of four analyst categories
   (`violent` / `property` / `vehicle` / `other`) via `CATEGORY_MAP`.
5. Writes a compact `data/incidents.json` (`{ meta, incidents[] }`).

## Tuning

- **Longer/shorter history:** change `WINDOW_DAYS` at the top of the script.
  At ~163 incidents/day the file is roughly `WINDOW_DAYS * 0.043 MB`
  (180 days ≈ 7.8 MB uncompressed, ~1.5 MB gzipped over the wire).
- **Category mapping:** edit `CATEGORY_MAP`. Any bucket not listed falls through
  to `other` (this currently includes drug/narcotic, weapon-law, animal-cruelty,
  and "All Other Offenses").

## Time zone

`OccurredFromDate` is returned as a true-UTC epoch (ms). The script converts it
to **America/New_York** (`zoneinfo`) before deriving `date`, `dow`, and `hour`,
so the app's temporal analytics use Atlanta local wall-clock time. This was
validated against APD's own `Day_of_the_week` field: Eastern-derived day matches
100% of sampled records vs 79.5% for a naive UTC read.

## Field reference (source layer)

| Source field       | Used as             | Notes                                  |
| ------------------ | ------------------- | -------------------------------------- |
| `OccurredFromDate` | `date`/`ts`/`dow`/`hour` | Epoch ms (UTC) → Eastern date, weekday (0=Mon), hour (0-23) |
| `NIBRS_Bucket`     | `type` / `cat`      | Coarse offense class → category        |
| `NIBRS_Offense`    | `offense`           | Specific offense (popup detail)        |
| `Crime_Against`    | —                   | Person / Property / Society            |
| `FireArmInvolved`  | `firearm`           | Ring on bubble, KPI, filter, popup, table |
| `NhoodName`        | `hood`              | Neighborhood (joins to boundary layer) |
| `NPU`              | `npu`               | Neighborhood Planning Unit             |
| `Zone`             | `zone`              | APD patrol zone                        |
| `StreetAddress`    | `addr`              | House number redacted by APD           |
| `LocationType`     | `loc`               | e.g. RESIDENCE_HOME                    |
| `Latitude`/`Longitude` | `lat`/`lon`     | WGS84                                  |

## Neighborhood boundaries

`data/neighborhoods.geojson` (242 polygons) is a one-time export from the APD
`neighborhood` FeatureServer and rarely changes. To refresh it:

```bash
curl -s "https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/neighborhood/FeatureServer/0/query?where=1%3D1&outFields=NPU,NhoodName&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0002&f=geojson" -o data/neighborhoods.geojson
```
