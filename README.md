# Tracker

A local-first daily tracker with tasks, timer, weekly logs, error log, customizable daily metrics, and custom benchmarks.

## Run locally

Run:

    node tracker-server.js

Then open the URL shown in the terminal, usually:

    http://localhost:8765

If that port is busy, run:

    PORT=8766 node tracker-server.js

## Data

Your personal data is saved locally to tracker-data.json. This file is ignored by git so private tracking data is not accidentally committed.

## Files

- index.html - main app shell
- styles.css - app styles
- app.js - app logic
- tracker-server.js - local server and autosave API
- motivation_quotes.json - quote data
- assets/ - audio/assets
