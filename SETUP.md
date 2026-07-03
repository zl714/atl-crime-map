# Setup & automation

## Daily data refresh

`.github/workflows/refresh.yml` runs every day at 10:00 UTC (and on demand from
the Actions tab). It re-pulls the latest ~180 days from the APD FeatureServer,
regenerates `data/incidents.json`, and commits it **only if the data changed**.

No secrets are required for the refresh itself — it uses the repo's built-in
`GITHUB_TOKEN` (the workflow declares `permissions: contents: write`).

## Deploys

**Auto-deploy is already wired.** The Vercel project `atl-crime-map` is
connected to the GitHub repo `zl714/atl-crime-map`, so every push to `main`
— including the daily data-refresh commit — triggers a production deploy
automatically. Nothing else to do.

You can confirm the connection anytime with:

```bash
vercel git connect        # prints "already connected" if wired
```

### Fallback: deploy from the workflow with a token

Only needed if you ever **disconnect** the Vercel↔GitHub integration and want
the Action to deploy directly. Two minutes:

1. Create a token at https://vercel.com/account/tokens (scope: your account).
2. In the repo: **Settings → Secrets and variables → Actions → New repository
   secret**, name it `VERCEL_TOKEN`, paste the token.
3. Add this step to the end of the `refresh` job in `refresh.yml` (runs only
   when the secret exists):

   ```yaml
       - name: Deploy to Vercel
         if: ${{ secrets.VERCEL_TOKEN != '' }}
         run: |
           npm i -g vercel
           vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
           vercel deploy --prod --yes --token="$VERCEL_TOKEN"
         env:
           VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
   ```

   (With git-integration connected, skip this — you'd get duplicate deploys.)

## Local development

```bash
python3 -m http.server 8899 --directory .
# open http://localhost:8899
```

Refresh data locally (stdlib only):

```bash
python3 data/fetch_incidents.py
```
