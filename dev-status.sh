#!/bin/bash

# Check Status of Frontend Services for Netquery Insight Chat
# This script checks ONLY the frontend adapter and React app
# For backend status, check the Netquery repository separately

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Netquery Insight Chat - Frontend Service Status${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check Netquery Backend (informational only)
echo -e "${BLUE}Netquery Backend (8000):${NC}"
echo -e "${YELLOW}  (Managed by ~/Code/netquery/api-server.sh)${NC}"
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    PID=$(lsof -ti:8000)
    echo -e "  ${GREEN}✓ Running${NC} (PID: $PID)"
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:8000/health)
        echo -e "  ${GREEN}✓ Health check passed${NC}"
        echo "  Response: $HEALTH"
    else
        echo -e "  ${YELLOW}⚠ Port open but health check failed${NC}"
    fi
else
    echo -e "  ${RED}✗ Not running${NC}"
    echo -e "  ${YELLOW}→ Start with: cd ~/Code/netquery && ./api-server.sh${NC}"
fi

# Check Backend Adapter
echo ""
echo -e "${BLUE}Backend Adapter (8001):${NC}"
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    PID=$(lsof -ti:8001)
    echo -e "  ${GREEN}✓ Running${NC} (PID: $PID)"
    if curl -s http://localhost:8001/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:8001/health)
        echo -e "  ${GREEN}✓ Health check passed${NC}"
        echo "  Response: $HEALTH"
    else
        echo -e "  ${YELLOW}⚠ Port open but health check failed${NC}"
    fi
else
    echo -e "  ${RED}✗ Not running${NC}"
    echo -e "  ${YELLOW}→ Start with: ./dev-start.sh${NC}"
fi

# Check React Frontend
echo ""
echo -e "${BLUE}React Frontend (3000):${NC}"
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    PID=$(lsof -ti:3000)
    echo -e "  ${GREEN}✓ Running${NC} (PID: $PID)"
    echo -e "  ${GREEN}→ http://localhost:3000${NC}"
else
    echo -e "  ${RED}✗ Not running${NC}"
    echo -e "  ${YELLOW}→ Start with: ./dev-start.sh${NC}"
fi

# Check logs
echo ""
echo -e "${BLUE}Log files:${NC}"
if [ -f /tmp/netquery-adapter.log ]; then
    LINES=$(wc -l < /tmp/netquery-adapter.log)
    echo -e "  Adapter:  /tmp/netquery-adapter.log (${LINES} lines)"
else
    echo -e "  Adapter:  ${YELLOW}No log file found${NC}"
fi
if [ -f /tmp/react-frontend.log ]; then
    LINES=$(wc -l < /tmp/react-frontend.log)
    echo -e "  Frontend: /tmp/react-frontend.log (${LINES} lines)"
else
    echo -e "  Frontend: ${YELLOW}No log file found${NC}"
fi

# Overall status summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
BACKEND_OK=false
ADAPTER_OK=false
FRONTEND_OK=false

if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then BACKEND_OK=true; fi
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1; then ADAPTER_OK=true; fi
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then FRONTEND_OK=true; fi

if $BACKEND_OK && $ADAPTER_OK && $FRONTEND_OK; then
    echo -e "${GREEN}✓ All services are running!${NC}"
    echo -e "${GREEN}→ Open http://localhost:3000${NC}"
elif ! $BACKEND_OK; then
    echo -e "${YELLOW}⚠ Backend not running. Start it first:${NC}"
    echo "  cd ~/Code/netquery && ./api-server.sh"
elif ! $ADAPTER_OK || ! $FRONTEND_OK; then
    echo -e "${YELLOW}⚠ Frontend services not fully running. Start them:${NC}"
    echo "  ./dev-start.sh"
else
    echo -e "${RED}✗ Some services are not running${NC}"
fi
echo ""
