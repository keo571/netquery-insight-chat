# Netquery Insight Chat

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
- Local Netquery backend running (from `~/Code/netquery`)

## Quick Start

**Step 1: Start Netquery Backend** (in separate terminal)
```bash
cd ~/Code/netquery

# Choose dev or prod mode
./start-dev.sh    # Dev mode (SQLite, fast setup)
# OR
./start-prod.sh   # Prod mode (PostgreSQL in Docker)

# Then start the API server
./api-server.sh   # Starts on port 8000
```

**Step 2: Start Frontend Services** (in this repo)
```bash
cp .env.example .env
./dev-start.sh
```

The frontend script checks that Netquery backend is running, then starts the adapter (8001) and React dev server (3000). Visit [http://localhost:3000](http://localhost:3000) when ready.

**Stop Services:**
```bash
./dev-stop.sh         # Stops only frontend (adapter + React)
# Stop backend separately in ~/Code/netquery with Ctrl+C
```

**Check Status:**
```bash
./dev-status.sh       # Shows status of all services
```

### Script Overrides
```bash
# Override port bindings
ADAPTER_PORT=8081 FRONTEND_PORT=3001 ./dev-start.sh

# Connect to backend on different port/host
NETQUERY_API_URL=http://localhost:8080 ./dev-start.sh
```
Process IDs are cached in `/tmp/netquery-insight-chat.pids` for easy cleanup.

## Manual Workflow
If you would rather run each process yourself:

1. **Netquery backend** (see `~/Code/netquery` repo for setup instructions)
    ```bash
    cd ~/Code/netquery
    ./api-server.sh
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

## Logs & Health Checks
- Adapter log: `tail -f /tmp/netquery-adapter.log`
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
- **Backend not running** – Start Netquery backend first: `cd ~/Code/netquery && ./api-server.sh`
- **Port already in use** – `./dev-stop.sh` or kill manually: `lsof -ti:8001 | xargs kill -9`
- **Dependency issues** – Recreate Python venv: `rm -rf .venv && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- **Node issues** – Clean reinstall: `npm run clean`
- **Schema overview failing** – Check Netquery backend is running and healthy: `curl http://localhost:8000/health`

## Architecture
```
┌─────────────────┐
│  React Frontend │  Port 3000  (This repo)
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Backend Adapter │  Port 8001  (This repo)
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Netquery API    │  Port 8000  (~/Code/netquery)
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ PostgreSQL/     │  Port 5432 / SQLite
│ SQLite          │  (Managed by Netquery backend)
└─────────────────┘
```

**Repository Responsibilities:**
- **This repo (netquery-insight-chat):** Frontend UI + Chat adapter
- **~/Code/netquery:** Backend API + SQL generation + Database

Before opening issues or pull requests, copy `.env.example` to `.env`, confirm all services start locally, and keep contributions focused and well described. Happy querying! 🚀
