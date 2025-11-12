/**
 * Converts technical error messages to user-friendly ones
 * Logs the actual error for debugging while showing diplomatic messages to users
 */

export const getUserFriendlyError = (error, context = 'general') => {
  // Log the actual error for debugging
  console.error(`[${context}] Detailed error:`, error);

  // Extract error message if it's an Error object
  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  const lowerMessage = errorMessage.toLowerCase();

  // Network-related errors
  if (lowerMessage.includes('fetch') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('connection') ||
      errorMessage.includes('Failed to fetch')) {
    return "We're having trouble connecting to the server. Please check your connection and try again.";
  }

  // Timeout errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return "The request is taking longer than expected. Please try again.";
  }

  // Server errors (5xx)
  if (lowerMessage.includes('500') ||
      lowerMessage.includes('502') ||
      lowerMessage.includes('503') ||
      lowerMessage.includes('server error')) {
    return "Our server encountered an issue. Please try again in a moment.";
  }

  // Authentication/Authorization errors
  if (lowerMessage.includes('401') ||
      lowerMessage.includes('403') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('forbidden')) {
    return "You don't have permission to access this resource. Please contact support if this persists.";
  }

  // Not found errors
  if (lowerMessage.includes('404') || lowerMessage.includes('not found')) {
    return "The requested resource couldn't be found. Please try again.";
  }

  // Parse errors (JSON, data format issues)
  if (lowerMessage.includes('parse') ||
      lowerMessage.includes('json') ||
      lowerMessage.includes('unexpected token')) {
    return "We received an unexpected response from the server. Please try again.";
  }

  // Query/Database errors
  if (lowerMessage.includes('sql') ||
      lowerMessage.includes('query') ||
      lowerMessage.includes('database')) {
    return "We encountered an issue processing your query. Please try rephrasing your question.";
  }

  // Schema errors
  if (context === 'schema' || lowerMessage.includes('schema')) {
    return "We're having trouble loading the database structure. Please refresh the page.";
  }

  // Streaming errors
  if (context === 'streaming' || lowerMessage.includes('stream')) {
    return "There was an issue with the real-time connection. Please try your query again.";
  }

  // Feedback submission errors
  if (context === 'feedback') {
    return "We couldn't submit your feedback at this time. Please try again later.";
  }

  // Generic fallback - diplomatic but not exposing technical details
  return "Something unexpected happened. Please try again, and if the issue persists, contact support.";
};

/**
 * Gets a user-friendly message for empty or invalid results
 */
export const getNoResultsMessage = () => {
  return "Your query ran successfully, but didn't return any results. Try adjusting your search criteria.";
};

/**
 * Gets a user-friendly message for loading failures
 */
export const getLoadingFailureMessage = (resourceType = 'data') => {
  return `We're having trouble loading the ${resourceType}. Please try again.`;
};
