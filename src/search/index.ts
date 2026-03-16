/**
 * Search Engine for muninn
 *
 * Local full-text search using MiniSearch.
 */

import * as fs from 'fs';
import * as path from 'path';
import MiniSearch from 'minisearch';
import type { SearchEngineInterface } from '../storage/sync.js';

/**
 * Search document structure
 */
interface SearchDocument {
  id: string; // `${repo}:${path}`
  repo: string;
  path: string;
  filename: string;
  content: string;
}

/**
 * Search result
 */
export interface SearchResult {
  repo: string;
  path: string;
  snippet: string;
  score: number;
}

/**
 * Search Engine
 *
 * Provides local full-text search using MiniSearch.
 * Index is persisted to disk for fast startup.
 */
export class SearchEngine implements SearchEngineInterface {
  private readonly indexPath: string;
  private miniSearch: MiniSearch<SearchDocument>;
  private documents: Map<string, SearchDocument> = new Map();
  private initialized: boolean = false;

  constructor(storagePath?: string) {
    this.indexPath = storagePath ? path.join(storagePath, 'search-index.json') : '';
    this.miniSearch = new MiniSearch({
      fields: ['filename', 'path', 'content'],
      storeFields: ['repo', 'path', 'filename'],
      searchOptions: {
        boost: { filename: 2, path: 1.5 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Load existing index from disk
   */
  async loadIndex(): Promise<void> {
    if (!this.indexPath || this.initialized) {
      return;
    }

    try {
      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(content);

      if (data.documents && Array.isArray(data.documents)) {
        for (const doc of data.documents) {
          this.documents.set(doc.id, doc);
        }
        this.miniSearch.addAll(data.documents);
      }

      this.initialized = true;
    } catch (error) {
      // Index doesn't exist yet, that's okay
      this.initialized = true;
    }
  }

  /**
   * Save index to disk
   */
  async saveIndex(): Promise<void> {
    if (!this.indexPath) {
      return;
    }

    const data = {
      version: 1,
      indexedAt: new Date().toISOString(),
      documentCount: this.documents.size,
      documents: Array.from(this.documents.values()),
    };

    await fs.promises.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.promises.writeFile(this.indexPath, JSON.stringify(data), 'utf-8');
  }

  /**
   * Generate a unique document ID
   */
  private getDocumentId(repo: string, filePath: string): string {
    return `${repo}:${filePath}`;
  }

  /**
   * Index a document
   */
  indexDocument(repo: string, filePath: string, content: string): void {
    const id = this.getDocumentId(repo, filePath);
    const filename = path.basename(filePath);

    // Remove existing document if present
    if (this.documents.has(id)) {
      try {
        this.miniSearch.remove(this.documents.get(id)!);
      } catch {
        // Ignore if document wasn't in index
      }
    }

    // Add new document
    const doc: SearchDocument = {
      id,
      repo,
      path: filePath,
      filename,
      content,
    };

    this.documents.set(id, doc);
    this.miniSearch.add(doc);
  }

  /**
   * Remove a document from the index
   */
  removeDocument(repo: string, filePath: string): void {
    const id = this.getDocumentId(repo, filePath);
    const doc = this.documents.get(id);

    if (doc) {
      try {
        this.miniSearch.remove(doc);
      } catch {
        // Ignore if document wasn't in index
      }
      this.documents.delete(id);
    }
  }

  /**
   * Search across all or specific repositories
   */
  async search(query: string, repo?: string): Promise<SearchResult[]> {
    // Ensure index is loaded
    await this.loadIndex();

    if (this.documents.size === 0) {
      return [];
    }

    // Perform search with stricter options
    const results = this.miniSearch.search(query, {
      boost: { filename: 2, path: 1.5 },
      fuzzy: 0.1, // Reduced from 0.2 for stricter matching
      prefix: true,
      combineWith: 'AND', // Require all terms to match for better precision
    });

    // Filter by repo if specified and format results
    const searchResults: SearchResult[] = [];
    for (const result of results) {
      const doc = result as unknown as SearchDocument;
      if (repo && doc.repo !== repo) {
        continue;
      }

      // Skip low-quality matches (score threshold)
      // MiniSearch scores are normalized; very low scores indicate weak matches
      if (result.score < 0.01) {
        continue;
      }

      // Generate snippet from content
      const fullDoc = this.documents.get(doc.id);
      const snippet = fullDoc
        ? this.generateSnippet(fullDoc.content, query)
        : doc.path;

      // Only include results where the snippet actually contains a match
      // This filters out fuzzy matches that don't have actual term matches
      if (fullDoc && !this.hasMatchingTerm(fullDoc.content, query)) {
        continue;
      }

      searchResults.push({
        repo: doc.repo,
        path: doc.path,
        snippet,
        score: result.score,
      });
    }

    return searchResults;
  }

  /**
   * Check if content contains any matching terms from the query
   */
  private hasMatchingTerm(content: string, query: string): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    const lowerContent = content.toLowerCase();

    for (const term of terms) {
      if (lowerContent.includes(term)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate a snippet around the first matching term
   * Uses [start]/[end] markers to clearly indicate truncation context
   */
  private generateSnippet(content: string, query: string, maxLength = 150): string {
    const terms = query.toLowerCase().split(/\s+/);
    const lowerContent = content.toLowerCase();

    // Find first matching term position
    let matchIndex = -1;
    for (const term of terms) {
      if (term.length < 2) continue; // Skip very short terms
      matchIndex = lowerContent.indexOf(term);
      if (matchIndex !== -1) break;
    }

    if (matchIndex === -1) {
      // No match found, return beginning of content with [end] if truncated
      const trimmed = content.substring(0, maxLength).trim();
      return trimmed.length < content.length ? trimmed + ' [end]' : trimmed;
    }

    // Extract context around match
    const contextBefore = 50;
    const contextAfter = maxLength - contextBefore;
    const start = Math.max(0, matchIndex - contextBefore);
    const end = Math.min(content.length, matchIndex + contextAfter);

    let snippet = content.substring(start, end);

    // Add context markers
    if (start > 0) {
      snippet = '[start] ' + snippet;
    }
    if (end < content.length) {
      snippet = snippet + ' [end]';
    }

    // Clean up whitespace
    snippet = snippet.replace(/\s+/g, ' ').trim();

    return snippet;
  }

  /**
   * Clear all indexed data
   */
  clear(): void {
    this.documents.clear();
    this.miniSearch = new MiniSearch({
      fields: ['filename', 'path', 'content'],
      storeFields: ['repo', 'path', 'filename'],
      searchOptions: {
        boost: { filename: 2, path: 1.5 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Get document count
   */
  getDocumentCount(): number {
    return this.documents.size;
  }
}
