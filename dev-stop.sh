#!/bin/bash

# Stop Frontend Services for Netquery Insight Chat
# This script ONLY stops the frontend adapter and React app
# The Netquery backend must be stopped separately using its own methods

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Stopping Netquery Insight Chat - Frontend Services${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Try to read PIDs from file
if [ -f /tmp/netquery-insight-chat.pids ]; then
    echo -e "${BLUE}Reading PIDs from saved file...${NC}"
    PIDS=$(cat /tmp/netquery-insight-chat.pids)
    for PID in $PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping process $PID...${NC}"
            kill $PID 2>/dev/null || true
        fi
    done
    rm /tmp/netquery-insight-chat.pids
fi

# Kill by port (fallback method)
echo -e "${BLUE}Stopping services by port...${NC}"

# Stop frontend (3000)
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}Stopping React Frontend (port 3000)...${NC}"
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
fi

# Stop adapter (8001)
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}Stopping Backend Adapter (port 8001)...${NC}"
    lsof -ti:8001 | xargs kill -9 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}✓ Frontend services stopped${NC}"
echo ""
echo -e "${YELLOW}Note: Netquery backend is still running (managed separately).${NC}"
echo -e "${YELLOW}To stop the backend:${NC}"
echo "  • cd ~/Code/netquery"
echo "  • Kill the api-server.sh process (Ctrl+C if running in foreground)"
echo "  • Or: lsof -ti:8000 | xargs kill"
echo "  • For Docker PostgreSQL: docker compose down"
echo ""
