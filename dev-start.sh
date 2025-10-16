#!/bin/bash

# Development startup script for Netquery Insight Chat
# This script starts all required services without Docker

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
NETQUERY_PATH="${NETQUERY_PATH:-$HOME/Code/netquery}"
NETQUERY_ENV="${NETQUERY_ENV:-prod}"  # Default to prod, can override with NETQUERY_ENV=dev
ADAPTER_PORT="${ADAPTER_PORT:-8001}"
NETQUERY_PORT="${NETQUERY_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Netquery Insight Chat - Development Startup${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if netquery path exists
if [ ! -d "$NETQUERY_PATH" ]; then
    echo -e "${RED}✗ Error: Netquery backend not found at $NETQUERY_PATH${NC}"
    echo -e "${YELLOW}  Please set NETQUERY_PATH environment variable or ensure netquery is in ~/Code/netquery${NC}"
    exit 1
fi

# Check if PostgreSQL is running
echo -e "${BLUE}[1/5] Checking PostgreSQL...${NC}"
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo -e "${RED}✗ PostgreSQL is not running${NC}"
    echo -e "${YELLOW}  Please start PostgreSQL manually:${NC}"
    echo -e "${YELLOW}    - macOS (Homebrew): brew services start postgresql@16${NC}"
    echo -e "${YELLOW}    - Linux: sudo systemctl start postgresql${NC}"
    echo -e "${YELLOW}    - Or use Postgres.app on macOS${NC}"
    exit 1
else
    echo -e "${GREEN}✓ PostgreSQL is running${NC}"
fi

# Start Netquery backend
echo ""
echo -e "${BLUE}[2/5] Starting Netquery Backend (${NETQUERY_ENV})...${NC}"
cd "$NETQUERY_PATH"
if [ ! -d ".venv" ]; then
    echo -e "${RED}✗ Error: Netquery virtual environment not found${NC}"
    echo -e "${YELLOW}  Please run: cd $NETQUERY_PATH && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
fi

# Check if port is already in use
if lsof -Pi :$NETQUERY_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}  Port $NETQUERY_PORT already in use. Killing existing process...${NC}"
    lsof -ti:$NETQUERY_PORT | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start netquery in background
source .venv/bin/activate
NETQUERY_ENV=$NETQUERY_ENV python -m uvicorn src.api.server:app --reload --port $NETQUERY_PORT > /tmp/netquery-backend.log 2>&1 &
NETQUERY_PID=$!
echo -e "${GREEN}✓ Netquery Backend started (PID: $NETQUERY_PID, Port: $NETQUERY_PORT)${NC}"
echo -e "${YELLOW}  Log: tail -f /tmp/netquery-backend.log${NC}"

# Wait for backend to be ready
echo -e "${YELLOW}  Waiting for backend to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$NETQUERY_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ Backend failed to start. Check logs: tail -f /tmp/netquery-backend.log${NC}"
        kill $NETQUERY_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Start Adapter (netquery_server.py)
echo ""
echo -e "${BLUE}[3/5] Starting Backend Adapter...${NC}"
cd "$HOME/Code/netquery-insight-chat"

# Check adapter virtual environment
if [ ! -d ".venv" ]; then
    echo -e "${RED}✗ Error: Adapter virtual environment not found${NC}"
    echo -e "${YELLOW}  Please run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
fi

# Check if port is already in use
if lsof -Pi :$ADAPTER_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}  Port $ADAPTER_PORT already in use. Killing existing process...${NC}"
    lsof -ti:$ADAPTER_PORT | xargs kill -9 2>/dev/null || true
    sleep 2
fi

source .venv/bin/activate
NETQUERY_API_URL="http://localhost:$NETQUERY_PORT" ADAPTER_PORT=$ADAPTER_PORT python netquery_server.py > /tmp/netquery-adapter.log 2>&1 &
ADAPTER_PID=$!
echo -e "${GREEN}✓ Backend Adapter started (PID: $ADAPTER_PID, Port: $ADAPTER_PORT)${NC}"
echo -e "${YELLOW}  Log: tail -f /tmp/netquery-adapter.log${NC}"

# Wait for adapter to be ready
echo -e "${YELLOW}  Waiting for adapter to be ready...${NC}"
for i in {1..15}; do
    if curl -s http://localhost:$ADAPTER_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Adapter is ready${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${RED}✗ Adapter failed to start. Check logs: tail -f /tmp/netquery-adapter.log${NC}"
        kill $NETQUERY_PID $ADAPTER_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Check Node.js dependencies
echo ""
echo -e "${BLUE}[4/5] Checking Node.js dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Installing npm packages...${NC}"
    npm install
fi
echo -e "${GREEN}✓ Dependencies ready${NC}"

# Start React frontend
echo ""
echo -e "${BLUE}[5/5] Starting React Frontend...${NC}"

# Check if port is already in use
if lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}  Port $FRONTEND_PORT already in use. Killing existing process...${NC}"
    lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null || true
    sleep 2
fi

npm start > /tmp/react-frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ React Frontend started (PID: $FRONTEND_PID, Port: $FRONTEND_PORT)${NC}"
echo -e "${YELLOW}  Log: tail -f /tmp/react-frontend.log${NC}"

# Wait for frontend to be ready
echo -e "${YELLOW}  Waiting for frontend to compile...${NC}"
sleep 8

# Summary
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ All services started successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Services running:${NC}"
echo -e "  • PostgreSQL:       localhost:5432"
echo -e "  • Netquery Backend: http://localhost:$NETQUERY_PORT (env: $NETQUERY_ENV)"
echo -e "  • Backend Adapter:  http://localhost:$ADAPTER_PORT"
echo -e "  • React Frontend:   ${GREEN}http://localhost:$FRONTEND_PORT${NC}"
echo ""
echo -e "${BLUE}Process IDs:${NC}"
echo "  • Netquery: $NETQUERY_PID"
echo "  • Adapter:  $ADAPTER_PID"
echo "  • Frontend: $FRONTEND_PID"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo "  • tail -f /tmp/netquery-backend.log"
echo "  • tail -f /tmp/netquery-adapter.log"
echo "  • tail -f /tmp/react-frontend.log"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo "  kill $NETQUERY_PID $ADAPTER_PID $FRONTEND_PID"
echo ""
echo -e "${GREEN}Open http://localhost:$FRONTEND_PORT in your browser to get started!${NC}"
echo ""

# Save PIDs to file for easy cleanup
echo "$NETQUERY_PID $ADAPTER_PID $FRONTEND_PID" > /tmp/netquery-insight-chat.pids
echo -e "${YELLOW}PIDs saved to /tmp/netquery-insight-chat.pids${NC}"
