#!/bin/bash

# Frontend Development Startup Script for Netquery Insight Chat
# This script ONLY starts the frontend adapter and React app
# The Netquery backend must be started separately using its own scripts

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
ADAPTER_PORT="${ADAPTER_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
NETQUERY_PORT="${NETQUERY_PORT:-8000}"
NETQUERY_API_URL="${NETQUERY_API_URL:-http://localhost:$NETQUERY_PORT}"

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Netquery Insight Chat - Frontend Startup${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if Netquery backend is running
echo -e "${BLUE}[1/4] Checking Netquery Backend...${NC}"
if ! curl -s "$NETQUERY_API_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}✗ Netquery Backend is not running at $NETQUERY_API_URL${NC}"
    echo ""
    echo -e "${YELLOW}Please start the Netquery backend first:${NC}"
    echo -e "${YELLOW}  cd ~/Code/netquery${NC}"
    echo -e "${YELLOW}  ./start-dev.sh    # For dev mode (SQLite)${NC}"
    echo -e "${YELLOW}  ./start-prod.sh   # For prod mode (PostgreSQL)${NC}"
    echo -e "${YELLOW}  ./api-server.sh   # Start the API server${NC}"
    echo ""
    exit 1
else
    echo -e "${GREEN}✓ Netquery Backend is running at $NETQUERY_API_URL${NC}"
fi

# Start Adapter (netquery_server.py)
echo ""
echo -e "${BLUE}[2/4] Starting Backend Adapter...${NC}"

# Truncate old logs to prevent indefinite growth
> /tmp/chat-adapter.log
> /tmp/react-frontend.log

# Check adapter virtual environment
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}  Creating virtual environment...${NC}"
    python3 -m venv .venv
    source .venv/bin/activate
    echo -e "${YELLOW}  Installing dependencies...${NC}"
    pip install -r requirements.txt
else
    source .venv/bin/activate
    echo -e "${GREEN}✓ Virtual environment ready${NC}"
fi

# Check if port is already in use
if lsof -Pi :$ADAPTER_PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}  Port $ADAPTER_PORT already in use. Killing existing process...${NC}"
    lsof -ti:$ADAPTER_PORT | xargs kill -9 2>/dev/null || true
    sleep 2
fi

NETQUERY_API_URL="$NETQUERY_API_URL" ADAPTER_PORT=$ADAPTER_PORT python chat_adapter.py > /tmp/chat-adapter.log 2>&1 &
ADAPTER_PID=$!
echo -e "${GREEN}✓ Backend Adapter started (PID: $ADAPTER_PID, Port: $ADAPTER_PORT)${NC}"
echo -e "${YELLOW}  Log: tail -f /tmp/chat-adapter.log${NC}"

# Wait for adapter to be ready
echo -e "${YELLOW}  Waiting for adapter to be ready...${NC}"
for i in {1..15}; do
    if curl -s http://localhost:$ADAPTER_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Adapter is ready${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${RED}✗ Adapter failed to start. Check logs: tail -f /tmp/chat-adapter.log${NC}"
        kill $ADAPTER_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Check Node.js dependencies
echo ""
echo -e "${BLUE}[3/4] Checking Node.js dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  Installing npm packages...${NC}"
    npm install
fi
echo -e "${GREEN}✓ Dependencies ready${NC}"

# Start React frontend
echo ""
echo -e "${BLUE}[4/4] Starting React Frontend...${NC}"

# Check if port is already in use
if lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
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
echo -e "${GREEN}  ✓ Frontend services started successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Services running:${NC}"
echo -e "  • Netquery Backend: $NETQUERY_API_URL (managed separately)"
echo -e "  • Backend Adapter:  http://localhost:$ADAPTER_PORT"
echo -e "  • React Frontend:   ${GREEN}http://localhost:$FRONTEND_PORT${NC}"
echo ""
echo -e "${BLUE}Process IDs:${NC}"
echo "  • Adapter:  $ADAPTER_PID"
echo "  • Frontend: $FRONTEND_PID"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo "  • tail -f /tmp/chat-adapter.log"
echo "  • tail -f /tmp/react-frontend.log"
echo ""
echo -e "${YELLOW}To stop frontend services:${NC}"
echo "  ./dev-stop.sh"
echo ""
echo -e "${YELLOW}To check service status:${NC}"
echo "  ./dev-status.sh"
echo ""
echo -e "${GREEN}Open http://localhost:$FRONTEND_PORT in your browser to get started!${NC}"
echo ""

# Save PIDs to file for easy cleanup
echo "$ADAPTER_PID $FRONTEND_PID" > /tmp/netquery-insight-chat.pids
