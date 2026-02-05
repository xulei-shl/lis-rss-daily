/**
 * Vector Search Module
 *
 * Exports the unified search service interface.
 * All search operations go through search-service.ts.
 */

export { search, SearchMode } from './search-service.js';
export type { SearchRequest, SearchResponse, SearchResult } from './search-service.js';
