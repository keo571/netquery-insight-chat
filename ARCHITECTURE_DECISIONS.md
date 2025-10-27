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
- Last 5 conversation exchanges (user message, SQL query)
- Creation timestamp and last activity timestamp
- Auto-cleanup of expired sessions

**Storage Schema:**
```python
{
    'user_message': str,  # User's natural language query
    'sql': str,          # Generated SQL query (for context)
    'timestamp': str     # ISO format timestamp
}
```

**Note:** We intentionally do NOT store:
- Result data (frontend already has it)
- Interpretation summaries (frontend already has it in the explanation field)
- Row counts or metadata (not useful for LLM context)

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
Build context prompts in the adapter ([netquery_server.py:100-138](netquery_server.py#L100-L138)) that include:
- Last 3 conversation exchanges (user message + SQL query)
- Domain-agnostic context rules for common conversational patterns
- Clear separation of conversation history and new question

**Implementation:**
```python
context_parts = ["CONVERSATION HISTORY - Use this to understand follow-up questions:\n"]
for i, exchange in enumerate(history[-3:], 1):
    context_parts.append(
        f"Exchange {i}:"
        f"\n  User asked: {exchange['user_message']}"
        f"\n  SQL query: {exchange['sql']}\n"
    )
context_parts.append(f"USER'S NEW QUESTION: {current_message}")
```

**Context Rules (Domain-Agnostic):**
The prompt includes 3 general principles instead of specific examples:
1. **Resolve references** - "the pool", "those servers" → entities from prior queries
2. **Preserve intent** - "also show X", "remove Y", "sort by Z" → modify previous query appropriately
3. **Maintain consistency** - Keep filters, joins, and patterns from previous queries unless explicitly changed

**Rationale:**
- **Accuracy:** LLM needs previous SQL to understand "as well", "also", "their"
- **Generalization:** Domain-agnostic rules work across different data schemas (not just F5/load balancers)
- **Sliding Window:** 3 exchanges balance context richness with token limits (5 stored, 3 injected)
- **Simplicity:** Let LLM infer patterns rather than hardcoding specific rules

**Consequences:**
- **Positive:** Works with any domain; simpler prompt; easier to maintain
- **Negative:** May handle some edge cases less reliably than explicit rules
- **Trade-off:** Generalizability over prescriptiveness
- **Risk:** Context window overflow if exchanges have very long SQL queries

**Alternatives Considered:**
1. **Domain-Specific Rules:** Rejected; too brittle and doesn't generalize
2. **Client-Side Context:** Rejected; would expose prompt engineering to browser
3. **Vector DB with Embeddings:** Overkill for current scale; added complexity

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

## ADR-011: Raw SQL Response Field

**Status:** Accepted (2025-10-21)

**Context:**
The adapter was generating SQL query explanations in markdown format (``sql...```), then parsing the SQL back out with regex for conversation history storage. This was fragile, inefficient, and added unnecessary complexity.

**Problem:**
```python
# Backend formats SQL in markdown
explanation = f"**SQL Query:**\n```sql\n{sql}\n```\n\n"

# Then extracts it back with regex
sql_match = re.search(r'```sql\n(.*?)\n```', sql, re.DOTALL)
sql_query = sql_match.group(1) if sql_match else "N/A"
```

**Decision:**
Add raw `sql` field to `_format_response()` return value ([netquery_server.py:287-298](netquery_server.py#L287-L298)):
```python
return {
    "sql": sql,          # Raw SQL query (no markdown)
    "explanation": explanation,  # Formatted markdown (includes SQL)
    ...
}
```

**Rationale:**
- **Simplicity:** Direct access to SQL without parsing
- **Reliability:** No regex failures if markdown format changes
- **Performance:** One less operation per request
- **Clarity:** Separation of concerns (raw data vs formatted presentation)

**Consequences:**
- **Positive:** Cleaner code, more reliable, easier to maintain
- **Negative:** Slight increase in response payload size (~100 bytes per response)
- **Migration:** No breaking changes; frontend can ignore the new field

**Related Cleanup:**
- Removed redundant `response_summary` field (always empty)
- Simplified field extraction logic in `_format_response()` (reduced from 18 to 12 lines)
- Unified validation pattern for schema_overview and suggested_queries

---

## ADR-012: Server-Sent Events (SSE) Streaming Responses

**Status:** Accepted (2025-10-27)

**Context:**
Previously, the chat interface required users to wait for all three response parts (SQL + data execution + analysis + visualization) to complete before seeing any results. For queries that take 5-8 seconds to fully analyze, this created a poor user experience with no feedback during processing.

The original flow was:
```
User Query → [Wait 5-8s...] → All parts appear at once
```

**Problem:**
- Users couldn't see data immediately when it was ready
- No visibility into what stage of processing was occurring
- Perceived performance was poor even though data was available early
- Analysis and visualization generation blocked the entire response

**Decision:**
Implement Server-Sent Events (SSE) streaming as the **only** response mode:

1. **Backend** ([netquery_server.py:314-448](netquery_server.py#L314-L448)):
   - Single `/chat` endpoint returns SSE stream (removed non-streaming endpoint)
   - Progressive events: `session` → `sql` → `data` → `analysis` → `visualization` → `done`
   - Each part sent as soon as it's ready

2. **Frontend** ([src/services/api.js](src/services/api.js), [src/hooks/useChat.js](src/hooks/useChat.js)):
   - Single `queryAgent()` function consumes SSE stream
   - Progressive state updates with `loadingStates` tracking
   - Loading spinners for pending sections

3. **UI Components** ([src/components/StreamingMessage.js](src/components/StreamingMessage.js)):
   - Data table appears immediately when ready
   - "Analyzing results..." spinner while interpretation runs
   - "Generating visualization..." spinner while chart config loads

**SSE Event Flow:**
```javascript
// Event 1: Session ID
{ type: 'session', session_id: 'uuid' }

// Event 2: SQL Query (appears immediately)
{ type: 'sql', sql: 'SELECT...', query_id: 'id', explanation: '**SQL Query:**...' }

// Event 3: Data Results (~1-2s, shows data table)
{ type: 'data', results: [...], display_info: {...} }

// Event 4: Analysis (~3-5s, appends findings)
{ type: 'analysis', explanation: '**Summary:**...\n**Key Findings:**...' }

// Event 5: Visualization (~5-8s, shows chart)
{ type: 'visualization', visualization: {...}, schema_overview: {...} }

// Event 6: Complete
{ type: 'done' }
```

**Rationale:**
- **Perceived Performance:** Users see results 3-5x faster (data at ~1-2s vs waiting 5-8s)
- **Progressive Disclosure:** Each part appears as soon as it's ready
- **User Feedback:** Loading states show what's happening (no black box waiting)
- **Better UX:** Users can start reading data while analysis completes
- **No Overhead:** SSE is native HTTP (no WebSocket complexity)

**Implementation Details:**

**Backend (Python):**
```python
@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    async def event_generator():
        # 1. Send session
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"

        # 2. Generate & send SQL
        sql = await generate_sql(query)
        yield f"data: {json.dumps({'type': 'sql', 'sql': sql})}\n\n"

        # 3. Execute & send data immediately
        data = await execute_sql(query_id)
        yield f"data: {json.dumps({'type': 'data', 'results': data})}\n\n"

        # 4. Interpret & send analysis
        analysis = await interpret_results(query_id)
        yield f"data: {json.dumps({'type': 'analysis', 'explanation': analysis})}\n\n"

        # 5. Send visualization config
        viz = get_visualization(interpretation)
        yield f"data: {json.dumps({'type': 'visualization', 'visualization': viz})}\n\n"

        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**Frontend (React):**
```javascript
// api.js - SSE consumer
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Parse SSE data: events
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));
            onEvent(event);  // Callback with parsed event
        }
    }
}

// useChat.js - State management
const [message, setMessage] = useState({
    isLoading: true,
    loadingStates: { sql: false, data: false, analysis: false, visualization: false }
});

// Update state as events arrive
onEvent(event => {
    switch(event.type) {
        case 'data':
            setMessage(prev => ({...prev, results: event.results, loadingStates: {...prev.loadingStates, data: true}}));
            break;
        // ... other cases
    }
});
```

**UI Loading States:**
```jsx
{/* Show spinner until data arrives */}
{message.isLoading && !message.loadingStates.data ? (
  <div className="loading-section">
    <div className="loading-spinner"></div>
    <span>Loading data...</span>
  </div>
) : (
  <PaginatedTable data={message.results} />
)}

{/* Inline spinner for analysis */}
{message.isLoading && message.loadingStates.data && !message.loadingStates.analysis && (
  <div className="loading-inline">
    <div className="loading-spinner-small"></div>
    <span>Analyzing results...</span>
  </div>
)}
```

**Consequences:**

**Positive:**
- ✅ **3-5x faster perceived performance** - Data visible in ~1-2s instead of 5-8s
- ✅ **Progressive feedback** - Users know what's happening at each stage
- ✅ **Better UX** - Can read data while waiting for analysis/visualization
- ✅ **No additional infrastructure** - SSE is native HTTP, works through proxies
- ✅ **Simple protocol** - Easier than WebSockets, less overhead than polling

**Negative:**
- ❌ **Slightly more complex** - Event-driven frontend logic vs simple request/response
- ❌ **No reconnection logic** - If connection drops, full refresh needed (acceptable for chat UI)
- ❌ **Browser compatibility** - SSE not supported in IE11 (not a concern for modern apps)

**Trade-offs:**
- Chose SSE over WebSockets: Simpler, works with HTTP/2, one-way is sufficient
- Chose streaming-only over hybrid: Simpler codebase, one code path to maintain
- Chose client-side state management over server push: More control, easier debugging

**Performance Impact:**
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Time to first data | 5-8s | 1-2s | **3-5x faster** |
| Time to full response | 5-8s | 5-8s | Same (but progressive) |
| User wait perception | Long | Short | Significant |
| Network overhead | ~0 | +100 bytes (events) | Negligible |

**Alternatives Considered:**

1. **Long Polling:** Rejected - Higher latency, more server load, worse UX
2. **WebSockets:** Rejected - Overkill for one-way data flow, harder to deploy (proxy issues)
3. **Hybrid (streaming + non-streaming):** Rejected - Two code paths to maintain, added complexity
4. **GraphQL Subscriptions:** Rejected - Too heavy, requires GraphQL server

**Migration Notes:**
- Removed old `/chat` non-streaming endpoint completely
- Renamed `queryAgentStreaming` → `queryAgent` (single API)
- Updated `ChatResponse` model to remove unused fields
- All responses now stream by default (no opt-in flag)

**Files Changed:**
- Backend: [netquery_server.py:314-448](netquery_server.py#L314-L448)
- API Client: [src/services/api.js](src/services/api.js)
- State Hook: [src/hooks/useChat.js](src/hooks/useChat.js)
- UI Component: [src/components/StreamingMessage.js:112-154](src/components/StreamingMessage.js#L112-L154)
- CSS Styles: [src/components/Message.css:292-341](src/components/Message.css#L292-L341)

**Testing Recommendations:**
1. Test with slow network (Chrome DevTools throttling) to see progressive loading
2. Test error cases (backend timeout, network drop)
3. Test with large datasets (100+ rows) to verify pagination still works
4. Test conversation continuity (session ID maintained across streams)

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
