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
Build context prompts in the adapter ([chat_adapter.py:100-138](chat_adapter.py#L100-L138)) that include:
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
1. **Backend limit:** 40 rows max from Netquery API
2. **Initial display:** 20 rows rendered immediately
3. **Progressive load:** "Load more" button reveals additional rows (up to 40)
4. **Full download:** Server-side CSV export for complete datasets

**Rationale:**
- **Performance:** Fast initial render (~20 rows) gives instant feedback
- **Bandwidth:** Transfer only what's needed for preview
- **Flexibility:** Users can explore data incrementally or download everything
- **User Experience:** Avoids "loading forever" for large datasets

**Consequences:**
- **Positive:** Fast perceived performance; works well on mobile
- **Negative:** Users must click to see full cached data
- **Implementation:** Clean separation between preview (frontend) and full export (backend)

**Configuration:**
```javascript
pageSize = 20              // Rows per "Load more" click (default, can be overridden by backend)
maxDisplay = data.length   // Max rows shown = all cached rows (40 from backend)
BACKEND_LIMIT = 40         // Netquery API limit
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
Add raw `sql` field to `_format_response()` return value ([chat_adapter.py:287-298](chat_adapter.py#L287-L298)):
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

1. **Backend** ([chat_adapter.py:314-448](chat_adapter.py#L314-L448)):
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
- Backend: [chat_adapter.py:314-448](chat_adapter.py#L314-L448)
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

## ADR-013: Consistent Section Headers and Formatting

**Status:** Accepted (2025-10-27)

**Context:**
The chat UI displays various sections (SQL Query, Summary, Key Findings, Analysis Note, Data Preview) with different formatting styles. Some headers appeared inline with their content, while others had inconsistent spacing. This created visual inconsistency and made it harder for users to scan through results quickly.

**Original Format:**
```
**SQL Query:**
```sql
SELECT ...
```

**Summary:** The query results show...

**Analysis Note:** Insights based on...

[Table with no header]
```

**Decision:**
Standardize all section headers to have their own lines with consistent formatting:

1. **Backend formatting** ([chat_adapter.py:238-250, 401-413](chat_adapter.py#L238-L250)):
   - Add blank line after "Summary:" before content
   - Add blank line after "Key Findings:" before numbered list
   - Add blank line after "Analysis Note:" before content

2. **Frontend component** ([PaginatedTable.js:92](src/components/PaginatedTable.js#L92)):
   - Add "Data Preview:" header in its own div above table controls
   - Style consistently with other section headers

**Updated Format:**
```
**SQL Query:**
```sql
SELECT ...
```

**Summary:**

The query results show...

**Key Findings:**

1. First finding
2. Second finding

**Analysis Note:**

Insights based on...

**Data Preview:**
[Table with row count and download controls]
```

**Rationale:**
- **Visual Consistency:** All section headers follow the same pattern (bold header on own line)
- **Scannability:** Users can quickly identify sections by scanning for bold headers
- **Readability:** Whitespace separation makes content easier to parse
- **Professional:** Matches markdown best practices and documentation standards

**Implementation:**
```python
# Backend: Add \n\n after headers
if summary:
    explanation += f"**Summary:**\n\n{summary}\n\n"

if findings:
    explanation += "**Key Findings:**\n\n"
    for i, finding in enumerate(findings, 1):
        explanation += f"{i}. {finding}\n"
```

```jsx
// Frontend: Separate header div
<div className="data-preview-header">Data Preview:</div>
<div className="table-header">
  {/* Row count and controls */}
</div>
```

**CSS Styling:**
```css
.data-preview-header {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #333;
}
```

**Consequences:**

**Positive:**
- ✅ **Better visual hierarchy** - Clear separation between sections
- ✅ **Improved scannability** - Users can quickly find relevant sections
- ✅ **Consistent UX** - All headers follow same pattern
- ✅ **Professional appearance** - Matches documentation standards

**Negative:**
- ❌ **Slightly more vertical space** - Headers take an extra line (acceptable trade-off)
- ❌ **Requires both backend and frontend changes** - Two-layer formatting update

**Trade-offs:**
- Chose consistency over compactness: Extra whitespace improves readability
- Chose markdown formatting over React components: Simpler, works with existing markdown renderer

**Files Changed:**
- Backend: [chat_adapter.py:238-250, 401-413](chat_adapter.py#L238-L250)
- Component: [PaginatedTable.js:92](src/components/PaginatedTable.js#L92)
- Styles: [PaginatedTable.css:5-9](src/components/PaginatedTable.css#L5-L9)

**Related Improvements:**
- Removed unused `downloadError` state variable in PaginatedTable
- Added error handling for JSON serialization in streaming endpoint
- Improved type validation for visualization and schema data

---

## ADR-014: User Feedback Collection System

**Status:** Accepted (2025-01-11)

**Context:**
To improve the quality of SQL generation and interpretations, we need to collect feedback from users about which responses were helpful and which weren't. This feedback will be used to:
- Identify problematic queries that generate poor SQL
- Improve prompts and embeddings in the backend
- Build training datasets for fine-tuning
- Track quality metrics over time

The feedback system needs to be:
- Non-intrusive (doesn't interrupt workflow)
- Optional (users can skip providing details)
- Contextual (captures the query and SQL that produced the response)

**Decision:**
Implement a thumbs up/down feedback system with an optional modal dialog for additional details on negative feedback.

**Architecture:**

```
┌─────────────────────────────────────┐
│  StreamingMessage Component         │
│  └─ MessageFeedback Component       │
│     ├─ Thumbs Up Button (👍)       │
│     └─ Thumbs Down Button (👎)     │
│        └─ FeedbackModal (on click)  │
└─────────────────────────────────────┘
         ↓
    POST /api/feedback
         ↓
┌─────────────────────────────────────┐
│  chat_adapter.py                    │
│  └─ submit_feedback_endpoint()      │
│     └─ Appends to feedback.jsonl    │
└─────────────────────────────────────┘
```

**Implementation Details:**

**1. Frontend Components:**

- **MessageFeedback.js** ([src/components/MessageFeedback.js](src/components/MessageFeedback.js))
  - Thumbs up/down buttons
  - Disabled after feedback given (prevents duplicate submissions)
  - Shows "Thanks for your feedback!" message
  - Only displays for messages with query_id (not welcome messages)

- **FeedbackModal.js** ([src/components/FeedbackModal.js](src/components/FeedbackModal.js))
  - Modal dialog with overlay
  - Optional textarea: "What went wrong?"
  - Submit/Cancel buttons
  - Can close with Escape key or clicking overlay
  - Accessible (aria-modal, role="dialog")

**2. User Flow:**

**Thumbs Up:**
1. User clicks 👍
2. Silent submission to backend
3. Button shows as active, both buttons disabled
4. "Thanks for your feedback!" message appears

**Thumbs Down:**
1. User clicks 👎
2. Modal opens with optional text field
3. User can describe issue or submit empty (optional)
4. On submit: saves feedback, closes modal, shows thanks message
5. On cancel: closes modal, no feedback saved

**3. Data Collection:**

**Feedback Data Structure:**
```json
{
  "type": "thumbs_up" | "thumbs_down",
  "query_id": "uuid",
  "user_question": "Show me all VIPs",
  "sql_query": "SELECT * FROM vips",
  "description": "Optional user complaint",
  "timestamp": "2025-01-11T10:30:00Z"
}
```

**Storage Format:** JSON Lines (`.jsonl`)
- One JSON object per line
- Easy to parse and analyze
- File location: `feedback.jsonl` in project root
- Append-only (no database required for MVP)

**4. Backend Endpoint:**

**POST /api/feedback** ([chat_adapter.py:579-593](chat_adapter.py#L579-L593))
- Receives feedback data
- Appends to `feedback.jsonl`
- Returns success/failure status
- **BFF-only feature** (not in core Netquery backend)

**5. Frontend State Management:**

**useChat.js Updates** ([src/hooks/useChat.js:63-77](src/hooks/useChat.js#L63-L77))
- Added `user_question` field to messages
- Added `sql_query` field (raw SQL, not markdown)
- Stored when SQL event received

**API Client** ([src/services/api.js:91-108](src/services/api.js#L91-L108))
- `submitFeedback()` function
- POST to `/api/feedback`
- Error handling with user alerts

**Rationale:**

**1. Why Thumbs Up/Down?**
- ✅ Universal, well-understood UI pattern
- ✅ Low friction (one click for positive feedback)
- ✅ Quick to implement
- ✅ Easy to analyze (binary signal)

**2. Why Modal for Negative Feedback?**
- ✅ Focuses user attention
- ✅ Clean UI (doesn't push content around)
- ✅ Optional description (user decides detail level)
- ✅ Professional appearance
- ✅ Easy to dismiss (multiple ways to close)

**3. Why JSON Lines (.jsonl)?**
- ✅ Simple to implement (no database setup)
- ✅ Easy to parse (one record per line)
- ✅ Append-only (no locking issues)
- ✅ Human-readable (easy debugging)
- ✅ Easy to analyze with scripts/jq/Python
- ✅ Can migrate to database later if needed

**4. Why Store in Adapter (BFF) vs Backend?**
- ✅ Chat UI-specific feature
- ✅ Doesn't affect core Netquery logic
- ✅ Quick to implement without backend changes
- ✅ Feedback data stays with chat project
- ✅ Can sync to backend later if needed

**Consequences:**

**Positive:**
- ✅ **Data collection** - Start gathering quality signals immediately
- ✅ **Non-intrusive** - Doesn't interrupt user workflow
- ✅ **Contextual** - Captures full query context for analysis
- ✅ **Simple** - No database setup required
- ✅ **Flexible** - Easy to analyze with any tool
- ✅ **Scalable** - Can migrate to database when needed

**Negative:**
- ❌ **No dashboard** - Manual analysis required (acceptable for MVP)
- ❌ **No deduplication** - Users could spam (low risk, can fix later)
- ❌ **File-based** - Doesn't scale to millions of records (acceptable for now)

**Trade-offs:**
- Chose simplicity over sophistication: File storage good enough for MVP
- Chose optional over required: Don't force users to explain every downvote
- Chose chat-specific over cross-app: Feedback stored locally, not in core backend

**Analysis Opportunities:**

With this data, you can:

1. **Identify Problem Patterns:**
   ```bash
   # Find most downvoted query types
   cat feedback.jsonl | jq -r 'select(.type=="thumbs_down") | .user_question' | sort | uniq -c | sort -rn
   ```

2. **Categorize Issues:**
   ```bash
   # Extract descriptions
   cat feedback.jsonl | jq -r 'select(.description != null) | .description'
   ```

3. **Quality Metrics:**
   ```bash
   # Calculate thumbs up ratio
   thumbs_up=$(cat feedback.jsonl | jq -r 'select(.type=="thumbs_up")' | wc -l)
   thumbs_down=$(cat feedback.jsonl | jq -r 'select(.type=="thumbs_down")' | wc -l)
   echo "Thumbs up: $thumbs_up, Thumbs down: $thumbs_down"
   ```

4. **Prompt Engineering:**
   - Review SQL for downvoted queries
   - Improve prompts for problematic patterns
   - Add few-shot examples for common failures

5. **Embedding Improvements:**
   - Identify queries with poor schema matching
   - Update embeddings for misunderstood tables
   - Add synonyms for common terms

**Files Created:**
- Frontend: [src/components/MessageFeedback.js](src/components/MessageFeedback.js)
- Frontend: [src/components/FeedbackModal.js](src/components/FeedbackModal.js)
- Styles: [src/components/MessageFeedback.css](src/components/MessageFeedback.css)
- Styles: [src/components/FeedbackModal.css](src/components/FeedbackModal.css)
- API: [src/services/api.js:91-108](src/services/api.js#L91-L108) - submitFeedback()
- Hook: [src/hooks/useChat.js:63-77](src/hooks/useChat.js#L63-L77) - Store query context
- Backend: [chat_adapter.py:579-593](chat_adapter.py#L579-L593) - /api/feedback endpoint
- Models: [chat_adapter.py:62-68](chat_adapter.py#L62-L68) - FeedbackRequest pydantic model

**Files Modified:**
- [src/components/StreamingMessage.js:217-220](src/components/StreamingMessage.js#L217-L220) - Integrated feedback buttons
- [src/components/index.js:9-10](src/components/index.js#L9-L10) - Exported new components

**Data Schema:**
```python
class FeedbackRequest(BaseModel):
    type: str  # 'thumbs_up' or 'thumbs_down'
    query_id: Optional[str] = None
    user_question: Optional[str] = None
    sql_query: Optional[str] = None
    description: Optional[str] = None  # Only for thumbs_down
    timestamp: str
```

**Future Enhancements:**

When feedback volume increases, consider:

1. **Analytics Dashboard:**
   - Visualize feedback trends over time
   - Group by query type, table, user
   - Show thumbs up/down ratios per feature

2. **Database Migration:**
   - Move from `.jsonl` to PostgreSQL
   - Add indexes for fast querying
   - Enable real-time analytics

3. **Feedback Categories:**
   - Add structured issue types (wrong results, slow query, SQL error)
   - Dropdown instead of free text
   - Easier to categorize and fix

4. **Admin Interface:**
   - View feedback in UI
   - Mark as resolved
   - Track improvements

5. **Automated Analysis:**
   - Weekly reports of common issues
   - Alerts for sudden quality drops
   - A/B test prompt changes

**Testing:**
```bash
# Submit test feedback
curl -X POST http://localhost:8001/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "type": "thumbs_down",
    "query_id": "test-123",
    "user_question": "Show all servers",
    "sql_query": "SELECT * FROM servers",
    "description": "Wrong results",
    "timestamp": "2025-01-11T10:00:00Z"
  }'

# View feedback
cat feedback.jsonl | jq .
```

**Related Decisions:**
- ADR-015: Backend-for-Frontend Naming (this is a BFF-specific feature)
- Feedback collection is chat UI-specific, not in core Netquery backend

---

## ADR-015: Backend-for-Frontend (BFF) Naming and Documentation

**Status:** Accepted (2025-01-11)

**Context:**
The adapter layer was originally named `netquery_server.py`, which created confusion with the core backend (`~/Code/netquery/server.py`). Both files had FastAPI endpoints, and it wasn't immediately clear which layer was responsible for what functionality. This naming ambiguity made it harder for new developers to understand the architecture and violated the principle of explicit over implicit.

**Problem:**
```
netquery-insight-chat/
  ├── netquery_server.py    ← Adapter layer (BFF)
  └── ...

~/Code/netquery/
  ├── server.py              ← Core backend
  └── ...
```

Questions developers asked:
- "Why do we have two servers?"
- "Which endpoints should I call from the frontend?"
- "Where should I add the feedback feature?"
- "Why does the adapter have `/api/feedback` but backend doesn't?"

**Decision:**
Rename `netquery_server.py` → `chat_adapter.py` and add comprehensive documentation explaining the Backend-for-Frontend (BFF) pattern.

**Changes Made:**

1. **File Renamed:**
   - `netquery_server.py` → `chat_adapter.py` (using git mv to preserve history)

2. **References Updated:**
   - [dev-start.sh](dev-start.sh#L70) - Startup script
   - [package.json](package.json#L40) - npm backend script
   - [README.md](README.md#L75) - Manual workflow section
   - [README.md](README.md#L112) - Project layout
   - [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) - All ADR references
   - [chat_adapter.py](chat_adapter.py#L562) - uvicorn module reference

3. **Architecture Documentation Added:**
   - Comprehensive file header docstring ([chat_adapter.py:1-68](chat_adapter.py#L1-L68))
   - ASCII diagram showing BFF architecture
   - Clear responsibility matrix (what BFF does vs what backend does)
   - Endpoint inventory with purpose

4. **Endpoint-Level Documentation:**
   Each endpoint now explicitly documents:
   - BFF responsibilities (what adapter layer handles)
   - Backend delegation (what core backend handles)
   - Usage context (which UI component calls it)

**Architecture Clarification:**

```
┌─────────────────────┐
│  React Frontend     │  Port 3000 (This repo)
└──────────┬──────────┘
           │ HTTP
┌──────────▼──────────┐
│  Chat Adapter (BFF) │  Port 8001 (This repo)
│  chat_adapter.py    │
│                     │
│  Responsibilities:  │
│  • Sessions         │
│  • Context building │
│  • Streaming (SSE)  │
│  • Feedback         │
│  • Orchestration    │
└──────────┬──────────┘
           │ HTTP
┌──────────▼──────────┐
│  Netquery Backend   │  Port 8000 (~/Code/netquery)
│  server.py          │
│                     │
│  Responsibilities:  │
│  • SQL generation   │
│  • Query execution  │
│  • Interpretation   │
│  • Schema metadata  │
│  • Core logic       │
└─────────────────────┘
```

**Endpoint Responsibility Matrix:**

| Endpoint | Location | BFF Adds | Backend Provides |
|----------|----------|----------|------------------|
| POST /chat | Adapter | Sessions, context, streaming | SQL gen, execution, interpretation |
| GET /health | Adapter | Combined status | Backend health |
| GET /schema/overview | Adapter | Validation, formatting | Schema metadata |
| GET /api/interpret/{id} | Adapter | Orchestration, formatting | Analysis & visualization |
| GET /api/download/{id} | Adapter | UI headers, timeout handling | Full CSV data |
| POST /api/feedback | Adapter only | **Entire feature** | N/A (UI-specific) |

**Rationale:**

1. **Naming Clarity:**
   - `chat_adapter.py` clearly indicates it's an adapter
   - Follows naming convention (purpose + layer type)
   - No confusion with `server.py` in backend repo

2. **Explicit Architecture:**
   - BFF pattern is now explicit in code and docs
   - Clear separation of concerns documented
   - New developers can understand at a glance

3. **Maintenance Benefits:**
   - Endpoint responsibilities are documented
   - Easy to decide where new features belong
   - Reduces "where should this go?" questions

4. **Industry Standards:**
   - Follows BFF best practices
   - Common pattern in microservices architectures
   - Well-documented pattern with community resources

**Example Documentation (chat_adapter.py header):**

```python
"""
Chat Adapter - Backend-for-Frontend (BFF) Layer
================================================

RESPONSIBILITIES OF THIS ADAPTER (BFF):
---------------------------------------
✓ Session & Conversation Management
✓ Streaming Responses (Server-Sent Events)
✓ UI-Specific Features (feedback, formatting)
✓ Request Orchestration

RESPONSIBILITIES OF NETQUERY BACKEND (Core):
--------------------------------------------
✓ SQL Generation from natural language
✓ Query execution against database
✓ Data interpretation and analysis
✗ NOT responsible for: sessions, streaming, UI features
"""
```

**Consequences:**

**Positive:**
- ✅ **Clear architecture** - No confusion about responsibilities
- ✅ **Better onboarding** - New developers understand quickly
- ✅ **Maintenance clarity** - Easy to decide where features belong
- ✅ **Standard pattern** - Follows BFF best practices
- ✅ **Self-documenting** - File name indicates purpose
- ✅ **Scalability** - Clear boundaries for future features

**Negative:**
- ❌ **Breaking change** - Requires updating references (done)
- ❌ **Documentation overhead** - Need to maintain clarity (acceptable)

**Trade-offs:**
- Chose explicit over implicit: File name clearly indicates role
- Chose documentation over inference: Better to over-document than under-document
- Chose standard patterns over custom: BFF is well-understood pattern

**Files Changed:**
- Renamed: [chat_adapter.py](chat_adapter.py) (was netquery_server.py)
- Updated: [dev-start.sh](dev-start.sh#L70), [package.json](package.json#L40), [README.md](README.md#L75)
- Documentation: [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (this file)

**Migration Notes:**
- All references updated in same commit
- Git history preserved using `git mv`
- No breaking changes for users (same endpoints)
- Improved startup banner shows architecture clearly

**Related Decisions:**
- ADR-001: Three-Tier Architecture (this clarifies the middle tier)
- ADR-012: Server-Sent Events (BFF feature, not in core backend)
- This ADR makes explicit what was implicit in ADR-001

**Guidelines for Future Development:**

**Add to Chat Adapter (BFF) if:**
- ✅ Chat UI-specific feature (feedback, preferences)
- ✅ Requires session/conversation state
- ✅ Needs to orchestrate multiple backend calls
- ✅ Transforms data for specific UI needs
- ✅ Implements chat-specific protocols (SSE, WebSocket)

**Add to Netquery Backend if:**
- ✅ Core SQL/data functionality
- ✅ Reusable across multiple UIs (CLI, API, chat)
- ✅ Business logic independent of presentation
- ✅ Database interactions
- ✅ Domain-specific logic (schema, embeddings)

**When in doubt:** If it's chat UI-specific → adapter. If it's reusable data logic → backend.

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
