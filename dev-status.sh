#!/bin/bash

# Check status of all Universal Agent Chat services

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Universal Agent Chat - Service Status${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check PostgreSQL
echo -e "${BLUE}PostgreSQL (5432):${NC}"
if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Running${NC}"
else
    echo -e "  ${RED}✗ Not running${NC}"
fi

# Check Netquery Backend
echo ""
echo -e "${BLUE}Netquery Backend (8000):${NC}"
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
fi

# Check logs
echo ""
echo -e "${BLUE}Log files:${NC}"
if [ -f /tmp/netquery-backend.log ]; then
    LINES=$(wc -l < /tmp/netquery-backend.log)
    echo -e "  Backend:  /tmp/netquery-backend.log (${LINES} lines)"
fi
if [ -f /tmp/netquery-adapter.log ]; then
    LINES=$(wc -l < /tmp/netquery-adapter.log)
    echo -e "  Adapter:  /tmp/netquery-adapter.log (${LINES} lines)"
fi
if [ -f /tmp/react-frontend.log ]; then
    LINES=$(wc -l < /tmp/react-frontend.log)
    echo -e "  Frontend: /tmp/react-frontend.log (${LINES} lines)"
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
