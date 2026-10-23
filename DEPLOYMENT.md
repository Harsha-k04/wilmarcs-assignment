# Local run and deployment

## Local setup

1. Create and activate a Python virtual environment.
2. Install backend packages: `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and `YOUTUBE_API_KEY`.
4. Start the API with `python run.py` (port 5001 by default).
5. In another terminal: `cd frontend && npm ci && npm run dev`.

The frontend uses `http://localhost:5001/api` in Vite development.

## Deploy backend to Render

1. Push this repository to GitHub after checking that `.env`, `instance/*.db`, `node_modules`, `.venv`, and backups are not tracked.
2. Create a Render Web Service from the repository or use `render.yaml`.
3. Set `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, and `CORS_ORIGINS` in the Render dashboard. `CORS_ORIGINS` must be the exact deployed Vercel origin (no trailing slash).
4. Configure a persistent database before using production data. The default SQLite file is appropriate for local development only; an ephemeral host filesystem can lose data on redeploy. Set `DATABASE_URL` to a managed PostgreSQL URL for durable production storage.
5. Confirm `/api/health` returns `status: ok`.

## Deploy frontend to Vercel

1. Import the GitHub repository in Vercel and set the project root directory to `frontend`.
2. Build command: `npm run build`; output directory: `dist`.
3. Add `VITE_API_BASE_URL` as `https://YOUR-BACKEND-HOST/api` (replace with the real backend URL). Redeploy after setting it.
4. Add the exact Vercel deployment origin to backend `CORS_ORIGINS`.

## Reliability notes

- Gemini calls use `GEMINI_TIMEOUT_MS` (default 45 seconds); an analysis has a 240-second wall-clock watchdog by default. A timed-out Python thread cannot be forcibly killed safely, but its job will be marked failed and late results will not overwrite the failure. Provider calls should still have their own timeouts.
- The watchlist scheduler currently runs in-process. Use one backend worker/instance for the demo to avoid duplicate checks; for multi-instance production, move scheduling to a dedicated worker/queue.
- The free-form provider APIs can still return rate limits, outages, or account/model access errors. Those are surfaced as failed jobs rather than infinite processing.
- `DEMO_MODE=true` generates synthetic sample data and must be clearly labelled in any demo; use `false` for real YouTube analysis.
