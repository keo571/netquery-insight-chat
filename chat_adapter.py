#!/usr/bin/env python3
"""
Chat Adapter - Backend-for-Frontend (BFF) Layer
================================================

This adapter sits between the React chat UI and the Netquery core backend API.
It implements the Backend-for-Frontend (BFF) pattern to optimize the API for
the specific needs of the chat interface.

ARCHITECTURE:
-------------
  Frontend (React, port 3000)
         ↓ HTTP requests
  Chat Adapter (this file, port 8002)  ← BFF Layer
         ↓ HTTP requests
  Netquery Backends (~/Code/netquery/server.py)  ← Core Services
    - Sample DB: port 8000
    - Neila DB: port 8001
         ↓ SQL queries
  PostgreSQL / SQLite Databases

RESPONSIBILITIES OF THIS ADAPTER (BFF):
---------------------------------------
✓ Session & Conversation Management
  - Track chat sessions with 1-hour timeout
  - Store conversation history for context-aware follow-ups
  - Build context prompts from previous exchanges

✓ Streaming Responses (Server-Sent Events)
  - Stream SQL, data, analysis, and visualization progressively
  - Provide real-time feedback during multi-step queries
  - Improve perceived performance (users see data faster)

✓ UI-Specific Features
  - User feedback collection (thumbs up/down)
  - Chat-specific endpoints optimized for frontend
  - Data transformation and formatting for chat UI

✓ Request Orchestration
  - Coordinate multiple Netquery backend calls
  - Combine generate-sql → execute → interpret into single /chat endpoint
  - Handle errors and retries at the BFF layer

RESPONSIBILITIES OF NETQUERY BACKEND (Core):
--------------------------------------------
✓ SQL Generation from natural language
✓ Query execution against database
✓ Data interpretation and analysis
✓ Schema management
✓ Core business logic
✗ NOT responsible for: sessions, streaming, UI features

IMPORTANT DATA LIMITS:
----------------------
- Backend caches maximum 30 rows per query
- Interpretation and visualization use ONLY these 30 cached rows
- For datasets > 30 rows, analysis is based on a sample
- Full data download available via CSV export

ENDPOINTS:
----------
POST /chat                  - Main chat endpoint (SSE streaming)
GET  /health                - Health check (checks Netquery backend)
GET  /schema/overview       - Proxy to Netquery with UI formatting
GET  /api/interpret/{id}    - On-demand interpretation (lazy loading)
GET  /api/download/{id}     - CSV download with UI-friendly headers
POST /api/feedback          - User feedback collection (UI-specific)

For more details, see ARCHITECTURE_DECISIONS.md
"""

import logging
import os
import uuid
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
import uvicorn
import httpx
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
SESSION_TIMEOUT = timedelta(hours=1)
MAX_CONVERSATION_HISTORY = 1
RECENT_EXCHANGES_FOR_CONTEXT = 3
DEFAULT_FRONTEND_INITIAL_ROWS = 30
DEFAULT_TIMEOUT = 30.0
DOWNLOAD_TIMEOUT = 300.0

# Session storage (in-memory for now, can be replaced with Redis/DB)
sessions: Dict[str, Dict[str, Any]] = {}

# FastAPI app setup
app = FastAPI(title="Netquery Insight Chat - FastAPI Adapter")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Models
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    include_interpretation: bool = False
    database: str = "sample"  # Default to 'sample' database

class SchemaOverviewResponse(BaseModel):
    schema_id: Optional[str] = None
    tables: List[Dict[str, Any]] = Field(default_factory=list)
    suggested_queries: List[str] = Field(default_factory=list)

class FeedbackRequest(BaseModel):
    type: str  # 'thumbs_up' or 'thumbs_down'
    query_id: Optional[str] = None
    user_question: Optional[str] = None
    sql_query: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    timestamp: str


# Session Management
def get_or_create_session(session_id: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    """Get existing session or create new one, cleaning up expired sessions."""
    _cleanup_expired_sessions()

    if session_id and session_id in sessions:
        sessions[session_id]['last_activity'] = datetime.now()
        return session_id, sessions[session_id]

    # Create new session
    new_id = str(uuid.uuid4())
    sessions[new_id] = {
        'created_at': datetime.now(),
        'last_activity': datetime.now(),
        'conversation_history': []
    }
    logger.info(f"Created new session: {new_id}")
    return new_id, sessions[new_id]


def _cleanup_expired_sessions():
    """Remove expired sessions from memory."""
    now = datetime.now()
    expired = [sid for sid, sess in sessions.items()
               if now - sess['last_activity'] > SESSION_TIMEOUT]
    for sid in expired:
        del sessions[sid]
        logger.info(f"Cleaned up expired session: {sid}")


def add_to_conversation(session_id: str, user_message: str, sql: str):
    """Add a query to the conversation history, keeping only recent exchanges."""
    if session_id in sessions:
        sessions[session_id]['conversation_history'].append({
            'user_message': user_message,
            'sql': sql,
            'timestamp': datetime.now().isoformat()
        })
        # Keep only last N exchanges to avoid context length issues
        history = sessions[session_id]['conversation_history']
        if len(history) > MAX_CONVERSATION_HISTORY:
            sessions[session_id]['conversation_history'] = history[-MAX_CONVERSATION_HISTORY:]


def build_context_prompt(session: Dict[str, Any], current_message: str) -> str:
    """
    Build a contextualized prompt with conversation history.

    The backend's LLM (classify_intent in query_rewriter.py) will decide whether
    to use the conversation context for rewriting follow-up questions.
    """
    history = session.get('conversation_history', [])
    if not history:
        return current_message

    # Always include conversation history - let backend LLM decide if it's needed
    context_parts = ["CONVERSATION HISTORY - Use this to understand follow-up questions:\n"]

    recent_history = history[-RECENT_EXCHANGES_FOR_CONTEXT:]
    for i, exchange in enumerate(recent_history, 1):
        context_parts.append(
            f"Exchange {i}:"
            f"\n  User asked: {exchange['user_message']}"
            f"\n  SQL query: {exchange['sql']}\n"
        )

    context_parts.append(f"USER'S NEW QUESTION: {current_message}")
    context_parts.append(_get_context_rules())

    return "\n".join(context_parts)


def _get_context_rules() -> str:
    """Get the context rules for follow-up questions."""
    return """
CONTEXT RULES FOR FOLLOW-UP QUESTIONS:

When the user's question builds on previous queries, use the conversation history to:

1. Resolve references to entities, tables, or columns mentioned previously
   - "the pool", "those servers", "their names" should reference entities from prior queries

2. Preserve the user's intent when modifying queries
   - "also show X" or "as well" → add columns/joins to previous query while preserving filters
   - "remove X" or "don't show Y" → exclude specified columns from previous SELECT
   - "sort by X instead" → keep same data but change ORDER BY clause

3. Maintain consistency with previous query patterns
   - If previous query returned detail rows, continue returning details unless user requests aggregation
   - If previous query used specific filters (WHERE) or limits, preserve them unless explicitly changed
   - If previous query joined certain tables, reuse those relationships when relevant

Generate SQL that naturally continues the conversation based on the context above."""


# Helper Functions
def build_display_info(data: List, total_count: Optional[int]) -> Dict[str, Any]:
    """Build display info for frontend pagination."""
    initial_display = int(os.getenv("FRONTEND_INITIAL_ROWS", str(DEFAULT_FRONTEND_INITIAL_ROWS)))
    return {
        "total_rows": len(data),
        "initial_display": initial_display,
        "has_scroll_data": len(data) > initial_display,
        "total_in_dataset": total_count if total_count is not None else "1000+"
    }


def build_analysis_explanation(interpretation_data: dict, total_count: Optional[int]) -> str:
    """
    Build markdown-formatted analysis from structured interpretation data.

    Expects interpretation_data to have this structure:
    {
        "interpretation": {
            "summary": "...",
            "key_findings": ["...", "..."],
            "recommendations": ["...", "..."]
        }
    }
    """
    parts = []
    interp = interpretation_data.get("interpretation", {})

    # Extract and format summary
    summary = interp.get("summary", "")
    if summary:
        parts.append(f"**Summary:**\n\n{summary}\n\n")

    # Extract and format key findings
    findings = interp.get("key_findings", [])
    if findings:
        parts.append("**Key Findings:**\n\n")
        for finding in findings:
            parts.append(f"- {finding}\n")
        parts.append("\n")

    # Extract and format recommendations
    recommendations = interp.get("recommendations", [])
    if recommendations:
        parts.append("**Recommendations:**\n\n")
        for recommendation in recommendations:
            parts.append(f"- {recommendation}\n")
        parts.append("\n")

    # Add data limitations note when dataset is large
    if total_count and total_count > 30:
        parts.append(f"**Analysis Note:**\n\nInsights based on first 30 rows of {total_count} rows. Download full dataset for complete analysis.\n\n")
    elif total_count is None:
        parts.append("**Analysis Note:**\n\nInsights based on first 30 rows of more than 1000 rows. Download full dataset for complete analysis.\n\n")

    return "".join(parts)


def extract_interpretation_fields(interpretation_data: dict) -> Tuple[Optional[dict], Optional[dict], List[str], bool]:
    """Extract and validate visualization, schema_overview, suggested_queries, and guidance from interpretation data."""
    visualization = interpretation_data.get("visualization")
    schema_overview = interpretation_data.get("schema_overview")
    suggested_queries = interpretation_data.get("suggested_queries") or []
    guidance = interpretation_data.get("guidance", False)

    # Fallback to nested interpretation payload if top-level fields are missing
    if not any([schema_overview, suggested_queries]):
        interp_payload = interpretation_data.get("interpretation", {})
        schema_overview = schema_overview or interp_payload.get("schema_overview")
        suggested_queries = suggested_queries or interp_payload.get("suggested_queries") or []
        guidance = guidance or interp_payload.get("guidance", False)

    # Validate and normalize field types
    schema_overview = schema_overview if isinstance(schema_overview, dict) else None
    suggested_queries = suggested_queries if isinstance(suggested_queries, list) else []

    return visualization, schema_overview, suggested_queries, guidance


def build_interpretation_payload(interpretation_data: dict, total_count: Optional[int]) -> dict:
    """
    Build complete interpretation payload from backend response.

    Args:
        interpretation_data: Structured dict from backend with interpretation, visualization, etc.
        total_count: Total number of rows in dataset for adding data limitation notes

    Returns:
        Dict with markdown-formatted analysis and other interpretation fields
    """
    # Build markdown-formatted analysis from structured interpretation data
    analysis_explanation = build_analysis_explanation(interpretation_data, total_count)

    # Extract visualization and other metadata fields
    visualization, schema_overview, suggested_queries, _ = extract_interpretation_fields(interpretation_data)

    payload = {
        'analysis': analysis_explanation,
        'visualization': visualization,
        'schema_overview': schema_overview,
        'suggested_queries': suggested_queries
    }

    # Debug logging to see what visualization is being sent
    logger.info(f"Built interpretation payload with visualization: {visualization}")

    return payload


def yield_sse_event(event_type: str, data: dict) -> str:
    """Helper to format Server-Sent Events consistently."""
    payload = {'type': event_type, **data}
    return f"data: {json.dumps(payload)}\n\n"


# Netquery Client
class NetqueryFastAPIClient:
    """Client to communicate with Netquery FastAPI server."""

    def __init__(self, base_url: Optional[str] = None):
        # Database-to-port mapping for dual backend setup
        self.database_urls = {
            "sample": os.getenv("NETQUERY_SAMPLE_URL", "http://localhost:8000"),
            "neila": os.getenv("NETQUERY_NEILA_URL", "http://localhost:8001"),
        }
        # Fallback to single backend URL if provided
        self.base_url = base_url or os.getenv("NETQUERY_API_URL", "http://localhost:8000")

    def get_backend_url(self, database: str = "sample") -> str:
        """Get the appropriate backend URL for the given database."""
        return self.database_urls.get(database, self.base_url)

    async def generate_sql(self, client: httpx.AsyncClient, message: str, database: str = "sample") -> Tuple[str, Optional[str], str, Optional[str]]:
        """
        Generate SQL from natural language query.

        Args:
            client: HTTP client
            message: Natural language query
            database: Database name (e.g., 'sample', 'neila')

        Returns:
            Tuple of (query_id, sql, intent, general_answer)
            - sql may be None for general questions
            - intent is "sql", "general", or "mixed"
            - general_answer is provided for general/mixed questions
        """
        backend_url = self.get_backend_url(database)
        # Log first line only (actual user query) to avoid verbose context rules
        first_line = message.split('\n')[0] if message else message
        logger.info(f"Generating SQL for database '{database}' at {backend_url}: {first_line}")
        response = await client.post(
            f"{backend_url}/api/generate-sql",
            json={"query": message}
        )
        response.raise_for_status()
        data = response.json()
        return (
            data["query_id"],
            data.get("sql"),  # May be None for general questions
            data.get("intent", "sql"),  # Default to "sql" for backward compat
            data.get("general_answer")  # May be None for pure SQL
        )

    async def execute_query(self, client: httpx.AsyncClient, query_id: str, database: str = "sample") -> dict:
        """Execute SQL query and get results."""
        backend_url = self.get_backend_url(database)
        logger.info(f"Executing SQL for query_id: {query_id} on database '{database}'")
        response = await client.get(f"{backend_url}/api/execute/{query_id}")
        response.raise_for_status()
        return response.json()

    async def interpret_results(self, client: httpx.AsyncClient, query_id: str, database: str = "sample") -> dict:
        """Get interpretation for query results."""
        backend_url = self.get_backend_url(database)
        logger.info(f"Getting interpretation for query_id: {query_id} on database '{database}'")
        response = await client.post(f"{backend_url}/api/interpret/{query_id}")
        response.raise_for_status()
        data = response.json()
        logger.info(f"Interpretation response type: {type(data)}, value: {str(data)[:200]}")
        return data

    async def schema_overview(self, database: str = "sample") -> Dict[str, Any]:
        """
        Get schema overview from Netquery backend.

        Args:
            database: Database name (e.g., 'sample', 'neila')
        """
        backend_url = self.get_backend_url(database)
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.get(
                f"{backend_url}/api/schema/overview",
                params={"database": database},
                timeout=DEFAULT_TIMEOUT
            )
            response.raise_for_status()
            return response.json()


# Initialize client
netquery_client = NetqueryFastAPIClient()


# =============================================================================
# API ENDPOINTS
# =============================================================================

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Main chat endpoint - Orchestrates the full chat workflow via SSE streaming.

    BFF Responsibilities:
    - Manage session and conversation context
    - Build context-aware prompts from chat history
    - Orchestrate: generate-sql → execute → interpret (optional)
    - Stream results progressively (SQL → data → analysis → visualization)

    Delegates to Netquery Backend:
    - SQL generation: POST /api/generate-sql
    - Query execution: GET /api/execute/{query_id}
    - Interpretation: POST /api/interpret/{query_id}

    Returns: Server-Sent Events (SSE) stream with progressive updates
    """

    async def event_generator():
        try:
            # Get or create session
            session_id, session = get_or_create_session(request.session_id)
            logger.info(f"Processing streaming query (session: {session_id}): {request.message[:80]}...")

            # Send session ID immediately
            yield yield_sse_event('session', {'session_id': session_id})

            async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
                # Build context-aware message if we have conversation history
                contextualized_message = request.message
                if session and session.get('conversation_history'):
                    contextualized_message = build_context_prompt(session, request.message)

                # Step 1: Generate SQL (or get general answer)
                try:
                    query_id, sql, intent, general_answer = await netquery_client.generate_sql(client, contextualized_message, request.database)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 422:
                        # Handle SQL generation errors
                        detail = exc.response.json().get("detail", {})
                        error_type = detail.get("type", "generation_error")

                        # Build guidance payload
                        guidance_payload = {
                            "message": detail.get("message", "I couldn't map that request to known data."),
                            "schema_overview": detail.get("schema_overview"),
                            "suggested_queries": detail.get("suggested_queries", [])
                        }

                        yield yield_sse_event('guidance', guidance_payload)
                        yield yield_sse_event('done', {})
                        return
                    raise

                # Handle based on intent type
                if intent == "general":
                    # Pure general question - no SQL needed
                    logger.info(f"General question detected: {request.message[:80]}...")

                    yield yield_sse_event('general_answer', {
                        'answer': general_answer,
                        'query_id': query_id
                    })

                    # Add to conversation history (without SQL)
                    add_to_conversation(session_id, request.message, None)

                    yield yield_sse_event('done', {})
                    return

                # For SQL and mixed intents, we need to execute SQL
                # First, send general answer if this is a mixed query
                if intent == "mixed" and general_answer:
                    yield yield_sse_event('general_answer', {
                        'answer': general_answer,
                        'query_id': query_id
                    })

                # Send SQL
                sql_explanation = f"**SQL Query:**\n```sql\n{sql}\n```\n\n"
                yield yield_sse_event('sql', {
                    'sql': sql,
                    'query_id': query_id,
                    'explanation': sql_explanation,
                    'intent': intent
                })

                # Step 2: Execute and get data
                execute_data = await netquery_client.execute_query(client, query_id, request.database)
                data = execute_data.get("data", [])
                total_count = execute_data.get("total_count")

                # Build and send display info
                display_info = build_display_info(data, total_count)
                yield yield_sse_event('data', {
                    'results': data,
                    'display_info': display_info
                })

                # Step 3: Get interpretation (only if requested)
                if request.include_interpretation:
                    interpretation_data = await netquery_client.interpret_results(client, query_id, request.database)
                    interpretation_payload = build_interpretation_payload(interpretation_data, total_count)

                    try:
                        yield yield_sse_event('interpretation', interpretation_payload)
                    except (TypeError, ValueError) as json_error:
                        logger.error(f"JSON serialization error: {json_error}")
                        # Send safe fallback payload
                        safe_payload = {
                            'analysis': interpretation_payload.get('analysis', ''),
                            'visualization': None,
                            'schema_overview': None,
                            'suggested_queries': []
                        }
                        yield yield_sse_event('interpretation', safe_payload)

                # Add to conversation history
                add_to_conversation(session_id, request.message, sql)

                # Send completion signal
                yield yield_sse_event('done', {})

        except Exception as e:
            logger.error(f"Streaming chat error: {e}")
            yield yield_sse_event('error', {'message': str(e)})

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/health")
async def health_check():
    """
    Health check endpoint - Verifies adapter and Netquery backend connectivity.

    BFF Responsibilities:
    - Check own health
    - Verify Netquery backend is reachable
    - Return combined health status

    Delegates to Netquery Backend:
    - GET /health (backend health check)
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{netquery_client.base_url}/health")
            response.raise_for_status()
            netquery_health = response.json()

        return {
            "status": "healthy",
            "netquery_api": "connected",
            "netquery_cache_size": netquery_health.get("cache_size", 0)
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "netquery_api": "disconnected",
            "error": str(e)
        }


@app.get("/schema/overview", response_model=SchemaOverviewResponse)
async def schema_overview_endpoint(database: str = "sample"):
    """
    Schema overview endpoint - Proxies schema metadata from Netquery backend.

    BFF Responsibilities:
    - Validate and format schema data for UI
    - Apply Pydantic model for type safety

    Delegates to Netquery Backend:
    - GET /api/schema/overview (schema metadata)

    Used by: Frontend welcome screen to show available tables
    
    Args:
        database: Database name (e.g., 'sample', 'neila')
    """
    try:
        overview = await netquery_client.schema_overview(database=database)
        return SchemaOverviewResponse(**overview)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/api/interpret/{query_id}")
async def get_interpretation_endpoint(query_id: str, database: str = "sample"):
    """
    On-demand interpretation endpoint - Lazy-loads analysis and visualization.

    BFF Responsibilities:
    - Orchestrate execute + interpret calls
    - Build interpretation payload with formatting
    - Add data limit warnings for UI

    Delegates to Netquery Backend:
    - GET /api/execute/{query_id} (get cached data for row count)
    - POST /api/interpret/{query_id} (generate analysis)

    Used by: "Show Analysis" button in chat UI (progressive disclosure)

    Args:
        query_id: The query identifier
        database: Database name (e.g., 'sample', 'neila')
    """
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            logger.info(f"Fetching interpretation for query_id: {query_id} on database '{database}'")

            # Get the cached data to determine total_count
            execute_data = await netquery_client.execute_query(client, query_id, database)
            total_count = execute_data.get("total_count")

            # Get interpretation from backend
            interpretation_data = await netquery_client.interpret_results(client, query_id, database)

            # Build and return interpretation payload
            return build_interpretation_payload(interpretation_data, total_count)

    except httpx.HTTPStatusError as e:
        logger.error(f"Interpretation failed for query_id {query_id}: {e}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Interpretation failed: {str(e)}")
    except Exception as e:
        import traceback
        logger.error(f"Interpretation error for query_id {query_id}: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Interpretation error: {str(e)}")


@app.get("/api/download/{query_id}")
async def download_csv_endpoint(query_id: str):
    """
    CSV download endpoint - Proxies full dataset download with UI enhancements.

    BFF Responsibilities:
    - Add user-friendly filename headers
    - Handle download timeouts gracefully
    - Provide UI-friendly error messages

    Delegates to Netquery Backend:
    - GET /api/download/{query_id} (full dataset CSV)

    Used by: Download buttons in data tables (bypasses 40-row cache limit)
    """
    try:
        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT) as client:
            logger.info(f"Downloading full dataset for query_id: {query_id}")
            response = await client.get(f"{netquery_client.base_url}/api/download/{query_id}")
            response.raise_for_status()

            content_length = len(response.content)
            logger.info(f"Downloaded {content_length} bytes for query_id: {query_id}")

            return Response(
                content=response.content,
                media_type="text/csv",
                headers={
                    "Content-Disposition": f'attachment; filename="query_results_{query_id[:8]}_{datetime.now().strftime("%Y-%m-%d")}.csv"'
                }
            )
    except httpx.HTTPStatusError as e:
        logger.error(f"Download failed for query_id {query_id}: {e}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Download failed: {str(e)}")
    except httpx.TimeoutException as e:
        logger.error(f"Download timeout for query_id {query_id}: {e}")
        raise HTTPException(status_code=504, detail="Download timeout - dataset too large or server busy. Please try again.")
    except Exception as e:
        logger.error(f"Download error for query_id {query_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Download error: {str(e)}")


@app.post("/api/feedback")
async def submit_feedback_endpoint(request: FeedbackRequest):
    """
    User feedback endpoint - Collects thumbs up/down feedback from chat UI.

    BFF Responsibilities:
    - Store user feedback in feedback.jsonl file
    - Collect query context (user question, SQL, query_id)
    - This is a UI-specific feature (not in core Netquery backend)

    Does NOT delegate to backend - purely chat UI feature

    Used by: Thumbs up/down buttons in chat messages
    Storage: feedback.jsonl (JSON Lines format for easy analysis)
    """
    try:
        feedback_file = "feedback.jsonl"

        # Prepare feedback data
        feedback_data = {
            "type": request.type,
            "query_id": request.query_id,
            "user_question": request.user_question,
            "sql_query": request.sql_query,
            "description": request.description,
            "tags": request.tags,
            "timestamp": request.timestamp
        }

        # Append to JSONL file (one JSON object per line)
        with open(feedback_file, "a") as f:
            f.write(json.dumps(feedback_data) + "\n")

        logger.info(f"Feedback saved: {request.type} for query_id: {request.query_id}")

        return {"status": "success", "message": "Feedback submitted successfully"}

    except Exception as e:
        logger.error(f"Failed to save feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


if __name__ == "__main__":
    netquery_url = os.getenv("NETQUERY_API_URL", "http://localhost:8000")
    adapter_port = int(os.getenv("ADAPTER_PORT", "8002"))

    print("=" * 60)
    print("Netquery Chat Adapter (BFF Layer)")
    print("=" * 60)
    print(f"Adapter (BFF):      http://localhost:{adapter_port}")
    print(f"Netquery Backend:   {netquery_url}")
    print(f"Frontend UI:        http://localhost:3000 (when started)")
    print()
    print("This adapter orchestrates chat-specific features:")
    print("  - Session & conversation management")
    print("  - Streaming responses (SSE)")
    print("  - User feedback collection")
    print("=" * 60)
    print()

    uvicorn.run("chat_adapter:app", host="0.0.0.0", port=adapter_port, reload=True)
