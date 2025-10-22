#!/usr/bin/env python3
"""Backend adapter between the Netquery FastAPI API and the React chat UI."""

import logging
import os
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Session storage (in-memory for now, can be replaced with Redis/DB)
sessions: Dict[str, Dict[str, Any]] = {}
SESSION_TIMEOUT = timedelta(hours=1)

app = FastAPI(title="Netquery Insight Chat - FastAPI Adapter")

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None  # Client can provide session ID to continue conversation

class ChatResponse(BaseModel):
    response: str
    explanation: str
    results: Optional[list] = None
    visualization: Optional[dict] = None  # LLM-suggested visualization
    display_info: Optional[dict] = None  # Display guidance for frontend
    query_id: Optional[str] = None  # For download functionality
    suggested_queries: Optional[List[str]] = None
    schema_overview: Optional[dict] = None
    guidance: Optional[bool] = False
    session_id: str  # Return session ID to client for continuity


class SchemaOverviewResponse(BaseModel):
    schema_id: Optional[str] = None
    tables: List[Dict[str, Any]] = Field(default_factory=list)
    suggested_queries: List[str] = Field(default_factory=list)

# Session management functions
def get_or_create_session(session_id: Optional[str] = None) -> tuple[str, Dict[str, Any]]:
    """Get existing session or create new one."""
    # Clean up expired sessions
    now = datetime.now()
    expired = [sid for sid, sess in sessions.items()
               if now - sess['last_activity'] > SESSION_TIMEOUT]
    for sid in expired:
        del sessions[sid]
        logger.info(f"Cleaned up expired session: {sid}")

    if session_id and session_id in sessions:
        # Return existing session
        sessions[session_id]['last_activity'] = now
        return session_id, sessions[session_id]

    # Create new session
    new_id = str(uuid.uuid4())
    sessions[new_id] = {
        'created_at': now,
        'last_activity': now,
        'conversation_history': []
    }
    logger.info(f"Created new session: {new_id}")
    return new_id, sessions[new_id]

def add_to_conversation(session_id: str, user_message: str, sql: str):
    """Add a query to the conversation history.

    Args:
        session_id: Session identifier
        user_message: User's natural language query
        sql: Generated SQL query
    """
    if session_id in sessions:
        sessions[session_id]['conversation_history'].append({
            'user_message': user_message,
            'sql': sql,
            'timestamp': datetime.now().isoformat()
        })
        # Keep only last 5 exchanges to avoid context length issues
        if len(sessions[session_id]['conversation_history']) > 5:
            sessions[session_id]['conversation_history'].pop(0)

def build_context_prompt(session: Dict[str, Any], current_message: str) -> str:
    """Build a contextualized prompt with conversation history."""
    history = session.get('conversation_history', [])

    if not history:
        # No history, return original message
        return current_message

    # Build context from previous exchanges
    context_parts = ["CONVERSATION HISTORY - Use this to understand follow-up questions:\n"]
    for i, exchange in enumerate(history[-3:], 1):  # Last 3 exchanges
        context_parts.append(
            f"Exchange {i}:"
            f"\n  User asked: {exchange['user_message']}"
            f"\n  SQL query: {exchange['sql']}\n"
        )

    context_parts.append(f"USER'S NEW QUESTION: {current_message}")
    context_parts.append("""
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

Generate SQL that naturally continues the conversation based on the context above.""")

    return "\n".join(context_parts)

class NetqueryFastAPIClient:
    """Client to communicate with Netquery FastAPI server."""

    def __init__(self, base_url: str = None):
        self.base_url = base_url or os.getenv("NETQUERY_API_URL", "http://localhost:8000")

    async def query(self, message: str, session: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Send query to Netquery FastAPI server with conversation context."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:

                # Build context-aware message if we have conversation history
                contextualized_message = message
                if session and session.get('conversation_history'):
                    contextualized_message = build_context_prompt(session, message)
                    logger.info(f"Using conversation context. History items: {len(session['conversation_history'])}")

                # Step 1: Generate SQL
                logger.info(f"Generating SQL for: {message[:80]}...")
                try:
                    generate_response = await client.post(
                        f"{self.base_url}/api/generate-sql",
                        json={"query": contextualized_message}
                    )
                    generate_response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 422:
                        detail = exc.response.json()
                        raise SchemaGuidance(detail)
                    raise

                generate_data = generate_response.json()

                query_id = generate_data["query_id"]
                sql = generate_data["sql"]

                # Step 2: Execute and get preview
                logger.info(f"Executing SQL for query_id: {query_id}")
                execute_response = await client.get(
                    f"{self.base_url}/api/execute/{query_id}"
                )
                execute_response.raise_for_status()
                execute_data = execute_response.json()

                # Step 3: Get interpretation
                logger.info(f"Getting interpretation for query_id: {query_id}")
                interpret_response = await client.post(
                    f"{self.base_url}/api/interpret/{query_id}"
                )
                interpret_response.raise_for_status()
                interpretation_data = interpret_response.json()

                # Format the response for the frontend
                return self._format_response(
                    sql=sql,
                    execute_data=execute_data,
                    interpretation_data=interpretation_data,
                    query_id=query_id
                )

        except httpx.HTTPError as e:
            logger.error(f"HTTP error communicating with Netquery API: {e}")
            raise Exception(f"Netquery API error: {e}")
        except Exception as e:
            logger.error(f"Netquery client error: {e}")
            raise

    async def schema_overview(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/schema/overview")
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            logger.error(f"Schema overview fetch failed: {exc}")
            raise

    def _format_response(self, sql: str, execute_data: dict,
                        interpretation_data: dict = None, query_id: str = None) -> Dict[str, Any]:
        """Format the API responses into the format expected by the frontend."""

        # Extract basic info
        data = execute_data.get("data", [])
        total_count = execute_data.get("total_count")

        # Build explanation
        explanation = f"**SQL Query:**\n```sql\n{sql}\n```\n\n"

        # Add interpretation if available
        if interpretation_data:
            interp = interpretation_data.get("interpretation", {})
            summary = interp.get("summary", "")
            findings = interp.get("key_findings", [])

            if summary:
                explanation += f"**Summary:**\n{summary}\n\n"

            if findings:
                explanation += "**Key Findings:**\n"
                for i, finding in enumerate(findings, 1):
                    explanation += f"{i}. {finding}\n"
                explanation += "\n"

            # Show analysis limitations only when dataset > 100 rows
            if total_count and total_count > 100:
                explanation += f"**Analysis Note:** Insights based on first 100 rows of {total_count} rows. Download full dataset for complete analysis.\n\n"
            elif total_count is None:  # >1000 rows case
                explanation += "**Analysis Note:** Insights based on first 100 rows of more than 1000 rows. Download full dataset for complete analysis.\n\n"


        # Return all data from backend (no additional limits in adapter)
        # The backend already applies its own limits (currently 100 rows max)
        display_data = data

        # Frontend pagination hint - could be made configurable via env var
        initial_display = int(os.getenv("FRONTEND_INITIAL_ROWS", "20"))

        display_info = {
            "total_rows": len(display_data),
            "initial_display": initial_display,
            "has_scroll_data": len(display_data) > initial_display,
            "total_in_dataset": total_count if total_count is not None else "1000+"
        }

        # Extract optional fields from interpretation data
        visualization = None
        schema_overview = None
        suggested_queries = []
        guidance = False

        if interpretation_data:
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

        return {
            "response": "",  # Empty for now, interpretation is in explanation
            "explanation": explanation,
            "sql": sql,  # Raw SQL query (no markdown wrapping)
            "results": display_data,
            "visualization": visualization,
            "display_info": display_info,
            "query_id": query_id,
            "schema_overview": schema_overview,
            "suggested_queries": suggested_queries,
            "guidance": guidance
        }

# Initialize netquery client
netquery_client = NetqueryFastAPIClient()


class SchemaGuidance(Exception):
    """Raised when Netquery returns schema guidance instead of SQL."""

    def __init__(self, payload: Dict[str, Any]):
        self.payload = payload
        super().__init__(payload)

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Handle chat requests from the React frontend with session management."""
    try:
        # Get or create session
        session_id, session = get_or_create_session(request.session_id)
        logger.info(f"Processing query (session: {session_id}): {request.message[:80]}...")

        # Query netquery FastAPI server with conversation context
        response_data = await netquery_client.query(request.message, session)

        # Get SQL for conversation history (already available as separate field)
        sql_query = response_data.get("sql", "")

        # Add to conversation history (store ORIGINAL message, not contextualized version)
        # This prevents context rules from being duplicated in future exchanges
        if sql_query:  # Only add if we have valid SQL
            add_to_conversation(session_id, request.message, sql_query)

        return ChatResponse(
            response=response_data.get("response", ""),
            explanation=response_data.get("explanation", ""),
            results=response_data.get("results"),
            visualization=response_data.get("visualization"),
            display_info=response_data.get("display_info"),
            query_id=response_data.get("query_id"),
            suggested_queries=response_data.get("suggested_queries"),
            schema_overview=response_data.get("schema_overview"),
            guidance=response_data.get("guidance", False),
            session_id=session_id  # Return session ID to client
        )

    except SchemaGuidance as guidance:
        # Get or create session even for guidance responses
        session_id, session = get_or_create_session(request.session_id)

        # Extract guidance details
        detail = guidance.payload.get("detail", guidance.payload)

        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("detail") or "I couldn't map that request to known data."
            schema_overview = detail.get("schema_overview")
            suggested_queries = detail.get("suggested_queries")

            # Fallback to nested schema_overview if top-level is missing
            if not suggested_queries and isinstance(schema_overview, dict):
                suggested_queries = schema_overview.get("suggested_queries")
        else:
            message = str(detail)
            schema_overview = None
            suggested_queries = None

        # Validate and normalize field types (reuse same logic as _format_response)
        schema_overview = schema_overview if isinstance(schema_overview, dict) else None
        suggested_queries = suggested_queries if isinstance(suggested_queries, list) else []

        return ChatResponse(
            response=message,
            explanation="",
            results=[],
            visualization=None,
            display_info=None,
            query_id=None,
            suggested_queries=suggested_queries,
            schema_overview=schema_overview,
            guidance=True,
            session_id=session_id
        )

    except Exception as e:
        logger.error(f"Chat endpoint error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process query: {str(e)}"
        )

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        # Test connection to Netquery API
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
async def schema_overview_endpoint():
    try:
        overview = await netquery_client.schema_overview()
        return SchemaOverviewResponse(**overview)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

if __name__ == "__main__":
    netquery_url = os.getenv("NETQUERY_API_URL", "http://localhost:8000")
    adapter_port = int(os.getenv("ADAPTER_PORT", "8001"))

    print("🚀 Starting Netquery Insight Chat - FastAPI Adapter")
    print(f"📡 Will connect to Netquery API at: {netquery_url}")
    print(f"🌐 Frontend should connect to: http://localhost:{adapter_port}")
    print()

    uvicorn.run("netquery_server:app", host="0.0.0.0", port=adapter_port, reload=True)
