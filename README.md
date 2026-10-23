# Wilmarcs YouTube Video Presence Analyser

Flask + SQLAlchemy backend and React/Vite frontend for analysing public YouTube channel metadata, producing evidence-grounded AI reports, maintaining an analysis history, and monitoring channels for changes.

## Requirements

- Python 3.11+ (Python 3.12 recommended)
- Node.js compatible with Vite 8
- YouTube Data API key and Gemini API key for real analyses

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # add real API keys to .env
python run.py
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

API health: `http://localhost:5001/api/health`; Vite frontend: `http://localhost:5173`.

## Configuration

See `.env.example` and `frontend/.env.example`. Never commit `.env` or API keys. `DEMO_MODE=true` uses synthetic data and must be clearly identified as such; use `false` for real channel analysis.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Render backend and Vercel frontend setup. Configure a durable PostgreSQL database for production; the default SQLite database is for local development.

## Limitations

- YouTube Data API quota and public availability constrain channel/video metadata.
- Transcript retrieval is best-effort and depends on the video's captions and the transcript library.
- Gemini output is schema-validated and checked for evidence specificity, but AI judgements remain estimates and may need human review.
- Watchlist scheduling currently runs in the backend process. A production multi-instance deployment should use a separate durable worker/queue to avoid duplicate scheduled checks.
