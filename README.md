# Universal Agent Chat + Netquery

React chat UI for the Netquery FastAPI backend. Ask infrastructure questions in natural language, get contextual SQL with markdown explanations, and surface schema hints when Netquery recommends a different direction.

## Highlights
- Conversational SQL with lightweight session tracking so follow-ups stay in context.
- Schema guidance blocks that list relevant tables and suggested prompts when Netquery sends guidance instead of SQL.
- Recharts visualisations that suppress themselves when the data is unsuitable (entity lists, non-aggregates, etc.).
- Progressive data tables with CSV downloads and server-side export support.
- Docker-free workflow managed by helper scripts for macOS and Linux shells.

## Requirements
- Node.js 16+
- Python 3.9+
- Local Netquery checkout (defaults to `~/Code/netquery`)
- PostgreSQL running on `localhost:5432`

## Quick Start
```bash
cp .env.example .env
./dev-start.sh
```
The script checks PostgreSQL, starts Netquery (8000), the adapter (8001), and the React dev server (3000). Visit [http://localhost:3000](http://localhost:3000) when it finishes. Stop everything with `./dev-stop.sh`, or inspect running services and log locations with `./dev-status.sh`.

### Script Overrides
```bash
# Use development data instead of production
NETQUERY_ENV=dev ./dev-start.sh

# Override port bindings
NETQUERY_PORT=8080 ADAPTER_PORT=8081 FRONTEND_PORT=3001 ./dev-start.sh

# Custom Netquery checkout
NETQUERY_PATH=/path/to/netquery ./dev-start.sh
```
Process IDs are cached in `/tmp/netquery-insight-chat.pids` for easy manual cleanup.

## Manual Workflow
If you would rather run each process yourself:

1. **Netquery backend**
    ```bash
    cd ~/Code/netquery
    source .venv/bin/activate
    NETQUERY_ENV=prod python -m uvicorn src.api.server:app --reload --port 8000
    ```
2. **Adapter**
    ```bash
    cd ~/Code/netquery-insight-chat
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    python netquery_server.py
    ```
3. **React frontend**
    ```bash
    npm install
    npm start
    ```

## PostgreSQL Checklist
All services assume a local PostgreSQL instance.

### Install / Start
- **macOS (Homebrew)**
  ```bash
  brew install postgresql@16
  brew services start postgresql@16
  ```
- **macOS (Postgres.app)** – install, launch, then click *Initialize*.
- **Ubuntu / Debian**
  ```bash
  sudo apt update
  sudo apt install postgresql postgresql-contrib
  sudo systemctl start postgresql
  sudo systemctl enable postgresql
  ```
- **Fedora / RHEL**
  ```bash
  sudo dnf install postgresql-server postgresql-contrib
  sudo postgresql-setup --initdb
  sudo systemctl start postgresql
  sudo systemctl enable postgresql
  ```

Verify connectivity:
```bash
pg_isready -h localhost -p 5432
```

Provision the database if it is missing:
```bash
psql postgres
CREATE USER netquery WITH PASSWORD 'netquery_dev_password';
CREATE DATABASE netquery OWNER netquery;
\\q
```

Prefer SQLite temporarily? Run `NETQUERY_ENV=dev ./dev-start.sh` inside the Netquery repo to use the bundled SQLite database (`data/infrastructure.db`).

## Logs & Health Checks
- Adapter log: `tail -f /tmp/netquery-adapter.log`
- Netquery log: `tail -f /tmp/netquery-backend.log`
- React log: `tail -f /tmp/react-frontend.log`
- Adapter health: `curl http://localhost:8001/health`
- Netquery health: `curl http://localhost:8000/health`
- Schema overview: `curl http://localhost:8000/api/schema/overview`

## Configuration Reference
Copy `.env.example` to `.env` and adjust as needed:
```bash
REACT_APP_API_URL=http://localhost:8001
REACT_APP_NETQUERY_API_URL=http://localhost:8000
REACT_APP_AGENT_NAME=Netquery
REACT_APP_WELCOME_TITLE=Welcome to Netquery!
REACT_APP_WELCOME_MESSAGE=Ask me about your infrastructure data.
REACT_APP_INPUT_PLACEHOLDER=Ask about your infrastructure data...
NETQUERY_API_URL=http://localhost:8000
ADAPTER_PORT=8001
```
`src/utils/constants.js` provides sensible defaults if a value is missing.

## Project Layout
```
├── src/
│   ├── components/        # Chat UI, tables, guidance blocks, visualisations
│   ├── hooks/             # useChat, useScrollToBottom
│   ├── services/api.js    # Adapter + schema overview calls
│   ├── utils/debug.js     # Dev-time logging helper
│   └── __mocks__/         # react-markdown Jest mock
├── netquery_server.py     # FastAPI adapter with sessions + guidance
├── dev-start.sh / stop.sh / status.sh
├── README.md              # This consolidated guide
├── .env.example, LICENSE, package.json, requirements.txt
```

## Troubleshooting
- **Port already in use** – kill the existing listener (`lsof -ti:8000 | xargs kill -9`).
- **PostgreSQL not running** – repeat the install/start steps above and confirm with `pg_isready`.
- **Dependency issues** – recreate the Python venv and run `npm run clean` to reinstall Node deps.
- **Schema overview failing** – ensure Netquery exposes `/api/schema/overview`, then check the adapter log.

## Architecture
```
┌─────────────────┐
│  React Frontend │  Port 3000
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Backend Adapter │  Port 8001
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Netquery API    │  Port 8000
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ PostgreSQL      │  Port 5432
└─────────────────┘
```

Before opening issues or pull requests, copy `.env.example` to `.env`, confirm all services start locally, and keep contributions focused and well described. Happy querying! 🚀
