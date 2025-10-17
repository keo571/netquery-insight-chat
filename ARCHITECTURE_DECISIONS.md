# Architecture Decision Records

## Overview
This document captures the key architectural decisions made in the Netquery Insight Chat project, explaining the reasoning behind each choice and their trade-offs.

---

## ADR-001: Three-Tier Architecture with Adapter Layer

**Status:** Accepted

**Context:**
The Netquery backend is a specialized FastAPI server that generates SQL from natural language queries. We needed a web interface that could work with this backend while adding features like session management, conversation context, and progressive data display.

**Decision:**
Implement a three-tier architecture:
```
React Frontend (Port 3000)
    ↓
Backend Adapter (Port 8001) - FastAPI
    ↓
Netquery API (Port 8000) - FastAPI
    ↓
PostgreSQL (Port 5432)
```

**Rationale:**
- **Separation of Concerns:** The adapter handles chat-specific logic (sessions, context) without modifying Netquery core
- **Independent Evolution:** Netquery can evolve independently; only the adapter needs updates
- **Multiple UIs:** Other interfaces (CLI, Slack bot) could use the same Netquery backend
- **Protocol Translation:** Adapter transforms Netquery's multi-step API (generate → execute → interpret) into a simple chat endpoint

**Consequences:**
- **Positive:** Clean separation, easier testing, independent deployment
- **Negative:** Additional network hop adds ~10-20ms latency
- **Neutral:** More moving parts to monitor and maintain

**Alternatives Considered:**
1. **Direct React → Netquery:** Rejected due to lack of session management in Netquery
2. **Monolithic Backend:** Rejected to avoid coupling chat UI logic with SQL generation logic

---

## ADR-002: In-Memory Session Management

**Status:** Accepted

**Context:**
Chat conversations require context to handle follow-up questions like "show me the pool as well" or "remove the id column". The Netquery backend is stateless.

**Decision:**
Implement in-memory session storage in the adapter with 1-hour timeout:
```python
sessions: Dict[str, Dict[str, Any]] = {}
SESSION_TIMEOUT = timedelta(hours=1)
```

Each session stores:
- Last 5 conversation exchanges (user message, SQL, summary)
- Creation timestamp and last activity timestamp
- Auto-cleanup of expired sessions

**Rationale:**
- **Simplicity:** No external dependencies (Redis, DB) for initial deployment
- **Fast Access:** Sub-millisecond session lookup
- **Good Enough:** 1-hour timeout handles typical usage patterns
- **Stateless Netquery:** Keeps the core SQL engine stateless and cacheable

**Consequences:**
- **Positive:** Simple deployment, fast, no persistence overhead
- **Negative:** Sessions lost on adapter restart; doesn't scale horizontally
- **Mitigation:** Document Redis upgrade path in code comments

**Trade-offs:**
- Development velocity over horizontal scalability
- Acceptable for single-server deployments (current use case)
- Clear migration path when needed

---

## ADR-003: Context-Aware Prompt Engineering

**Status:** Accepted

**Context:**
Follow-up questions like "show their names" or "remove the id" require understanding previous queries. Netquery's LLM needs conversation history to generate correct SQL.

**Decision:**
Build context prompts in the adapter ([netquery_server.py:95-156](netquery_server.py#L95-L156)) that include:
- Last 3 conversation exchanges
- Explicit rules for common patterns (entity details vs aggregates, adding columns, removing columns)
- Context resolution guidelines

Example context injection:
```python
context_parts = ["CONVERSATION HISTORY:\n"]
for exchange in history[-3:]:
    context_parts.append(f"User: {exchange['user_message']}")
    context_parts.append(f"SQL: {exchange['sql']}")
context_parts.append(f"NEW QUESTION: {current_message}")
```

**Rationale:**
- **Accuracy:** LLM needs previous SQL to understand "as well", "also", "their"
- **Rule-Based Guidance:** Explicit rules prevent common mistakes (COUNT when user wants entity lists)
- **Sliding Window:** 3-5 exchanges balance context richness with token limits

**Consequences:**
- **Positive:** Handles complex follow-ups correctly; explicit rules improve consistency
- **Negative:** Larger prompts → higher LLM costs; rules need maintenance
- **Risk:** Context window overflow if exchanges have large SQL queries

**Alternatives Considered:**
1. **Client-Side Context:** Rejected; would expose prompt engineering to browser
2. **Vector DB with Embeddings:** Overkill for current scale; added complexity

---

## ADR-004: Progressive Data Disclosure

**Status:** Accepted

**Context:**
SQL queries can return thousands of rows, but users typically need to see a preview first. Full datasets can be slow to render and unnecessary.

**Decision:**
Implement multi-tier data loading ([PaginatedTable.js](src/components/PaginatedTable.js)):
1. **Backend limit:** 100 rows max from Netquery API
2. **Initial display:** 10-20 rows rendered immediately
3. **Progressive load:** "Load more" button reveals additional rows (up to 100)
4. **Full download:** Server-side CSV export for complete datasets

**Rationale:**
- **Performance:** Fast initial render (~10 rows) gives instant feedback
- **Bandwidth:** Transfer only what's needed for preview
- **Flexibility:** Users can explore data incrementally or download everything
- **User Experience:** Avoids "loading forever" for large datasets

**Consequences:**
- **Positive:** Fast perceived performance; works well on mobile
- **Negative:** Users must click to see full cached data
- **Implementation:** Clean separation between preview (frontend) and full export (backend)

**Configuration:**
```javascript
pageSize = 10              // Rows per "Load more" click
maxDisplay = 30            // Max rows shown in browser (UX limit)
BACKEND_LIMIT = 100        // Netquery API limit
```

---

## ADR-005: Smart Chart Suppression

**Status:** Accepted

**Context:**
The LLM suggests visualizations, but not all data is suitable for charts. Entity lists (VIP → Pool mappings) shouldn't be visualized as bar/pie charts.

**Decision:**
Implement client-side chart validation ([DataVisualization.js:42-87](src/components/DataVisualization.js#L42-L87)):
- Suppress charts for relationship data (multiple string columns, no aggregates)
- Suppress charts for non-aggregated entity lists
- Only show charts when data has numeric aggregates (count, sum, avg)

**Rationale:**
- **User Experience:** Bad charts are worse than no charts
- **LLM Limitations:** LLM sees SQL but not actual data shape; can't always predict suitability
- **Client-Side Decision:** Frontend has the actual data and can make informed UI decisions

**Consequences:**
- **Positive:** No confusing/misleading visualizations
- **Negative:** Sometimes suppresses valid charts (tuning needed)
- **Future:** Could add user override ("show chart anyway")

**Example Suppression Logic:**
```javascript
const hasNumericAggregate = Object.keys(row).some(key =>
  typeof row[key] === 'number' &&
  key.match(/count|sum|avg|total/)
);
if (!hasNumericAggregate) return null; // Suppress chart
```

---

## ADR-006: Separate Repository Development Scripts

**Status:** Accepted (Updated 2025)

**Context:**
Originally, this repository's `dev-start.sh` managed both backend (Netquery) and frontend services. However, the Netquery backend is a separate repository with its own lifecycle, setup scripts, and database management. Tightly coupling the two repositories' startup scripts created unnecessary complexity and violated separation of concerns.

**Decision:**
Split development scripts by repository responsibility:
- **Backend repo (`~/Code/netquery`):** Manages database setup, API server lifecycle
  - `start-dev.sh` / `start-prod.sh` - Environment setup (SQLite/PostgreSQL)
  - `api-server.sh` - Starts Netquery API on port 8000
- **Frontend repo (this repo):** Manages only UI and adapter layer
  - `dev-start.sh` - Checks backend health, starts adapter (8001) + React (3000)
  - `dev-stop.sh` - Stops only frontend services
  - `dev-status.sh` - Shows status of all services with guidance

**Rationale:**
- **Separation of Concerns:** Each repo manages its own services
- **Independent Deployment:** Backend and frontend can be deployed separately
- **Clear Ownership:** Backend team owns database + API; frontend team owns UI + adapter
- **Easier Onboarding:** New developers understand which repo controls what
- **Reusability:** Multiple frontends (CLI, Slack bot, web UI) can use the same backend

**Consequences:**
- **Positive:**
  - Clean separation between repos
  - Backend can run without frontend and vice versa
  - Easier to understand dependencies
  - No "magic" cross-repo file paths
- **Negative:**
  - Requires two terminal windows (one for backend, one for frontend)
  - Must start backend before frontend
- **Mitigation:**
  - Clear error messages in `dev-start.sh` if backend not running
  - `dev-status.sh` shows backend status for convenience

**Configuration Options:**
```bash
# Frontend repo options
ADAPTER_PORT=8081 ./dev-start.sh      # Custom adapter port
NETQUERY_API_URL=http://localhost:8080 ./dev-start.sh  # Custom backend URL

# Backend repo manages its own config
cd ~/Code/netquery
./start-dev.sh    # SQLite
./start-prod.sh   # PostgreSQL in Docker
```

**Workflow:**
```bash
# Terminal 1: Backend
cd ~/Code/netquery
./start-dev.sh && ./api-server.sh

# Terminal 2: Frontend
cd ~/Code/netquery-insight-chat
./dev-start.sh
```

---

## ADR-007: Recharts for Visualization

**Status:** Accepted

**Context:**
Need a React-compatible charting library that handles bar, pie, line, and scatter plots with reasonable defaults.

**Decision:**
Use Recharts library for all visualizations.

**Rationale:**
- **React Native:** Built for React (not a jQuery wrapper)
- **Declarative:** Fits React's component model
- **Responsive:** ResponsiveContainer handles layout automatically
- **Customizable:** Easy to add custom tooltips, labels, colors
- **MIT License:** No licensing concerns

**Consequences:**
- **Positive:** Good documentation, active community, works well with hooks
- **Negative:** Bundle size (~400KB); limited 3D/advanced chart types
- **Alternatives:** Chart.js (imperative), Victory (heavier), D3 (too low-level)

**Usage Pattern:**
```jsx
<ResponsiveContainer width="100%" height={400}>
  <BarChart data={processedData}>
    <XAxis dataKey={x_column} />
    <Bar dataKey={y_column} fill="#8884d8" />
  </BarChart>
</ResponsiveContainer>
```

---

## ADR-008: Environment-Based Configuration

**Status:** Accepted

**Context:**
Different environments (dev, staging, prod) need different API URLs and settings. Configuration should be flexible but have sensible defaults.

**Decision:**
Use layered configuration:
1. **Environment variables** (`.env` file, highest priority)
2. **Constants file** ([src/utils/constants.js](src/utils/constants.js), defaults)
3. **Runtime overrides** (shell script environment variables)

**Configuration Files:**
- `.env.example` - Template with all available options
- `.env` - User's local configuration (gitignored)
- `src/utils/constants.js` - Default values

**Rationale:**
- **Flexibility:** Easy to override for different environments
- **Sensible Defaults:** Works out-of-box for localhost:3000/8000/8001
- **No Secrets:** `.env` is gitignored; template shows structure only
- **12-Factor App:** Follows best practices for configuration management

**Consequences:**
- **Positive:** Easy to deploy to different environments
- **Negative:** Multiple places to check for configuration values
- **Documentation:** [README.md](README.md) documents all options

**Example:**
```bash
# .env file
REACT_APP_API_URL=http://localhost:8001
REACT_APP_NETQUERY_API_URL=http://localhost:8000
ADAPTER_PORT=8001
```

---

## ADR-009: Schema Overview at Startup

**Status:** Accepted

**Context:**
Users need to know what data is available before asking questions. Netquery exposes a schema overview endpoint but doesn't proactively show it.

**Decision:**
Fetch schema overview on app load ([App.js:30-55](src/App.js#L30-L55)) and display in welcome message:
- List of available tables with descriptions
- Suggested example queries
- Graceful degradation if schema unavailable

**Rationale:**
- **Discoverability:** Users see what's possible before typing
- **Reduced Errors:** Prevents questions about non-existent tables
- **Onboarding:** New users get immediate guidance
- **Non-Blocking:** Loads asynchronously; chat still works if it fails

**Consequences:**
- **Positive:** Better UX; reduces "I don't know what to ask" friction
- **Negative:** Additional HTTP request on startup (~50-100ms)
- **Error Handling:** Continues to work if schema endpoint fails

**Implementation:**
```javascript
useEffect(() => {
  const loadOverview = async () => {
    try {
      const data = await fetchSchemaOverview();
      setSchemaOverview(data);
    } catch (err) {
      setSchemaError(err.message);
    }
  };
  loadOverview();
}, []);
```

---

## ADR-010: Guidance vs Results Mode

**Status:** Accepted

**Context:**
When Netquery can't map a query to known tables, it returns schema guidance instead of SQL. The UI needs to handle both success (results) and guidance (suggestions) modes.

**Decision:**
Backend returns `guidance: true` flag; frontend displays:
- **Results mode:** SQL + data table + visualization
- **Guidance mode:** Helpful message + table list + suggested queries

**Rationale:**
- **Clear Feedback:** User knows whether query succeeded or needs refinement
- **Helpful Redirection:** Suggestions guide users toward valid queries
- **Consistent API:** Same `/chat` endpoint handles both cases
- **LLM-Friendly:** Backend decides based on schema matching confidence

**Consequences:**
- **Positive:** Reduces user frustration with "query failed" errors
- **Negative:** Adds complexity to response handling
- **UX:** Guidance feels conversational, not like an error

**Backend Response Schema:**
```python
class ChatResponse(BaseModel):
    response: str
    explanation: str
    results: Optional[list] = None
    guidance: Optional[bool] = False
    schema_overview: Optional[dict] = None
    suggested_queries: Optional[List[str]] = None
```

---

## Technology Stack Summary

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Frontend | React | 19.1.0 | Modern hooks API, excellent ecosystem |
| State | React Hooks | Built-in | Simple state needs; no Redux overhead |
| Charts | Recharts | 3.2.1 | React-native, declarative, responsive |
| Backend Adapter | FastAPI | 0.117.1 | Fast async, automatic API docs, Pydantic validation |
| HTTP Client | httpx | 0.28.1 | Async-native Python HTTP (for FastAPI) |
| Backend API | Netquery | External | LLM-powered SQL generation |
| Database | PostgreSQL | 16+ | Robust, well-supported, JSON support |
| Dev Server | uvicorn | 0.36.0 | ASGI server for FastAPI |
| Process Mgmt | Bash scripts | Native | Simple, transparent, no orchestration overhead |

---

## Future Considerations

### When to Revisit Decisions

1. **Session Management (ADR-002):** Switch to Redis when:
   - Multiple adapter instances needed (horizontal scaling)
   - Session persistence across restarts required
   - Active users > 1000 concurrent sessions

2. **Progressive Disclosure (ADR-004):** Consider streaming if:
   - Users regularly need to scroll through 100+ rows
   - Network bandwidth is constrained
   - Real-time data updates needed

3. **Docker-Free Workflow (ADR-006):** Add Docker when:
   - Team needs consistent environments
   - CI/CD requires containers
   - Deployment target is Kubernetes

4. **In-Memory Context (ADR-003):** Use vector DB when:
   - Conversation history exceeds 10+ exchanges
   - Need semantic search across past queries
   - Multi-user query sharing required

---

## Contributing

When making significant architectural changes:
1. Document the decision in this file following the ADR format
2. Include context, decision, rationale, and consequences
3. Reference specific code locations using `[file:line](path#Lline)` syntax
4. Update the "Future Considerations" section if applicable
