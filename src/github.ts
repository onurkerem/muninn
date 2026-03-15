/**
 * GitHub API Client for muninn MCP server
 *
 * Provides typed access to GitHub REST API endpoints needed for
 * documentation retrieval from repositories.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Error types that can be returned by the GitHub API client
 */
export type GitHubErrorCode =
  | 'repository_not_found'
  | 'file_not_found'
  | 'rate_limit_exceeded'
  | 'authentication_failed'
  | 'api_error'
  | 'network_error';

/**
 * Structured error returned by GitHub API operations
 */
export interface GitHubError {
  error: GitHubErrorCode;
  message: string;
  retry_after_seconds?: number;
  status?: number;
  path?: string;
  repo?: string;
}

/**
 * Repository metadata from GitHub API
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
  };
  description: string | null;
  default_branch: string;
  private: boolean;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  clone_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
}

/**
 * File content response from GitHub Contents API
 */
export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content: string | null;  // Base64 encoded
  encoding: string | null;
}

/**
 * Tree entry from GitHub Git Trees API
 */
export interface GitHubTreeEntry {
  mode: string;
  path: string;
  sha: string;
  size?: number;
  type: 'blob' | 'tree' | 'commit';
  url: string;
}

/**
 * Git tree response from GitHub API
 */
export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/**
 * Commit author/committer info
 */
export interface GitHubCommitAuthor {
  name: string;
  email: string;
  date: string;
}

/**
 * Commit details from GitHub API
 */
export interface GitHubCommit {
  sha: string;
  node_id: string;
  commit: {
    author: GitHubCommitAuthor;
    committer: GitHubCommitAuthor;
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
  };
  url: string;
  html_url: string;
  author: {
    login: string;
    id: number;
    avatar_url: string;
  } | null;
  committer: {
    login: string;
    id: number;
    avatar_url: string;
  } | null;
  parents: Array<{
    sha: string;
    url: string;
    html_url: string;
  }>;
}

/**
 * Text match for search results
 */
export interface GitHubTextMatch {
  object_url: string;
  object_type: string;
  property: string;
  fragment: string;
  matches: Array<{
    text: string;
    indices: [number, number];
  }>;
}

/**
 * Search result item from GitHub Code Search API
 */
export interface GitHubSearchCodeItem {
  name: string;
  path: string;
  sha: string;
  url: string;
  git_url: string;
  html_url: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
      avatar_url: string;
    };
    html_url: string;
    description: string | null;
    default_branch: string;
  };
  score: number;
  text_matches?: GitHubTextMatch[];
}

/**
 * Code search response from GitHub API
 */
export interface GitHubSearchCodeResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchCodeItem[];
}

/**
 * Result type for operations that can fail - success variant
 */
export interface GitHubSuccess<T> {
  ok: true;
  data: T;
}

/**
 * Result type for operations that can fail - error variant
 */
export interface GitHubFailure {
  ok: false;
  error: GitHubError;
}

/**
 * Result type for operations that can fail
 */
export type GitHubResult<T> = GitHubSuccess<T> | GitHubFailure;

// ============================================================================
// GitHub API Client
// ============================================================================

/**
 * GitHub API client with rate limit awareness and error handling
 */
export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';
  private readonly headers: Record<string, string>;

  /**
   * Create a new GitHub API client
   * @param pat - Optional Personal Access Token for authentication
   */
  constructor(pat?: string) {
    this.headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (pat) {
      this.headers['Authorization'] = `Bearer ${pat}`;
    }
  }

  /**
   * Make a request to the GitHub API
   */
  private async request<T>(endpoint: string): Promise<GitHubResult<T>> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
      });

      // Handle rate limiting
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');

        if (rateLimitRemaining === '0' && rateLimitReset) {
          const resetTime = parseInt(rateLimitReset, 10);
          const now = Math.floor(Date.now() / 1000);
          const retryAfter = Math.max(resetTime - now, 0);

          return {
            ok: false,
            error: {
              error: 'rate_limit_exceeded',
              message: 'GitHub API rate limit exceeded',
              retry_after_seconds: retryAfter,
              status: 403,
            },
          };
        }

        // Generic 403 error (could be auth issue)
        const body = await response.text();
        return {
          ok: false,
          error: {
            error: 'authentication_failed',
            message: `Access forbidden: ${body}`,
            status: 403,
          },
        };
      }

      // Handle not found
      if (response.status === 404) {
        return {
          ok: false,
          error: {
            error: 'repository_not_found',
            message: 'Resource not found or not accessible with the provided credentials',
            status: 404,
          },
        };
      }

      // Handle other errors
      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorBody = (await response.json()) as { message?: string };
          if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        return {
          ok: false,
          error: {
            error: 'api_error',
            message: errorMessage,
            status: response.status,
          },
        };
      }

      // Success - parse response
      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (error) {
      // Network or other errors
      const message = error instanceof Error ? error.message : 'Unknown network error';
      return {
        ok: false,
        error: {
          error: 'network_error',
          message,
        },
      };
    }
  }

  /**
   * Add error context (repo, path) to a failed result
   */
  private withErrorContext<T>(
    result: GitHubResult<T>,
    repo: string,
    path?: string
  ): GitHubResult<T> {
    if (result.ok) {
      return result;
    }
    return {
      ok: false,
      error: {
        ...result.error,
        repo,
        ...(path !== undefined && { path }),
      },
    };
  }

  /**
   * Get repository metadata
   * GET /repos/{owner}/{repo}
   */
  async getRepo(owner: string, repo: string): Promise<GitHubResult<GitHubRepository>> {
    const result = await this.request<GitHubRepository>(`/repos/${owner}/${repo}`);

    if (!result.ok) {
      const error: GitHubError = {
        ...result.error,
        repo: `${owner}/${repo}`,
      };
      if (result.error.error === 'repository_not_found') {
        error.message = `Repository ${owner}/${repo} not found or not accessible with the provided PAT.`;
      }
      return { ok: false, error };
    }

    return result;
  }

  /**
   * Get README content for a repository
   * GET /repos/{owner}/{repo}/readme
   */
  async getReadme(owner: string, repo: string): Promise<GitHubResult<GitHubFileContent>> {
    const result = await this.request<GitHubFileContent>(`/repos/${owner}/${repo}/readme`);

    if (!result.ok) {
      const error: GitHubError = {
        ...result.error,
        repo: `${owner}/${repo}`,
        path: 'README.md',
      };
      if (result.error.error === 'repository_not_found') {
        error.error = 'file_not_found';
        error.message = `README not found in repository ${owner}/${repo}`;
      }
      return { ok: false, error };
    }

    return result;
  }

  /**
   * Get recursive file tree for a branch
   * GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
   */
  async getTree(owner: string, repo: string, branch: string): Promise<GitHubResult<GitHubTree>> {
    const result = await this.request<GitHubTree>(
      `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    );

    return this.withErrorContext(result, `${owner}/${repo}`);
  }

  /**
   * Get file content by path
   * GET /repos/{owner}/{repo}/contents/{path}
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string
  ): Promise<GitHubResult<GitHubFileContent>> {
    const result = await this.request<GitHubFileContent>(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`
    );

    if (!result.ok) {
      const error: GitHubError = {
        ...result.error,
        repo: `${owner}/${repo}`,
        path,
      };
      if (result.error.error === 'repository_not_found') {
        error.error = 'file_not_found';
        error.message = `File not found: ${path} in repository ${owner}/${repo}`;
      }
      return { ok: false, error };
    }

    return result;
  }

  /**
   * Get last commit for a specific file path
   * GET /repos/{owner}/{repo}/commits?path={path}&per_page=1
   */
  async getLastCommit(
    owner: string,
    repo: string,
    path: string
  ): Promise<GitHubResult<GitHubCommit | null>> {
    const result = await this.request<GitHubCommit[]>(
      `/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`
    );

    if (!result.ok) {
      return this.withErrorContext(result, `${owner}/${repo}`, path);
    }

    // Return the first commit or null if no commits found
    const commit = result.data.length > 0 ? result.data[0] : null;
    return { ok: true, data: commit };
  }

  /**
   * Search code within a repository
   * GET /search/code?q={query}+repo:{owner}/{repo}
   *
   * Note: GitHub Search API has a rate limit of 30 requests/minute for authenticated users
   */
  async searchCode(
    query: string,
    owner: string,
    repo: string
  ): Promise<GitHubResult<GitHubSearchCodeResponse>> {
    // Build search query with repo scope
    const searchQuery = `${query} repo:${owner}/${repo}`;
    const result = await this.request<GitHubSearchCodeResponse>(
      `/search/code?q=${encodeURIComponent(searchQuery)}`
    );

    if (!result.ok && result.error.error === 'rate_limit_exceeded') {
      const error: GitHubError = {
        ...result.error,
        message: 'GitHub Search API rate limit exceeded (30 requests/minute)',
      };
      return { ok: false, error };
    }

    return result;
  }

  /**
   * Decode base64 encoded file content
   */
  static decodeContent(encoded: string): string {
    // GitHub returns base64 encoded content with newlines
    const cleaned = encoded.replace(/\n/g, '');
    return Buffer.from(cleaned, 'base64').toString('utf-8');
  }

  /**
   * Get the remaining rate limit for the authenticated user
   * This is a helper method for debugging/monitoring
   */
  async getRateLimit(): Promise<
    GitHubResult<{
      limit: number;
      remaining: number;
      reset: number;
      used: number;
    }>
  > {
    const response = await fetch(`${this.baseUrl}/rate_limit`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          error: 'api_error',
          message: 'Failed to fetch rate limit',
          status: response.status,
        },
      };
    }

    const data = (await response.json()) as {
      resources: {
        core: { limit: number; remaining: number; reset: number; used: number };
        search: { limit: number; remaining: number; reset: number; used: number };
      };
    };

    return {
      ok: true,
      data: data.resources.core,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a result is an error
 */
export function isGitHubError<T>(result: GitHubResult<T>): result is GitHubFailure {
  return !result.ok;
}

/**
 * Check if a result is successful
 */
export function isGitHubSuccess<T>(result: GitHubResult<T>): result is GitHubSuccess<T> {
  return result.ok;
}

/**
 * Create a GitHubError from various error conditions
 */
export function createGitHubError(
  error: GitHubErrorCode,
  message: string,
  options?: Partial<Omit<GitHubError, 'error' | 'message'>>
): GitHubError {
  return {
    error,
    message,
    ...options,
  };
}

/**
 * Parse a repo string in format "owner/repo" into its components
 */
export function parseRepoString(repo: string): { owner: string; repo: string } | null {
  const match = repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Validate a repo string format
 */
export function isValidRepoString(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo);
}

/**
 * Build HTML URL for a file in a repository
 */
export function buildFileHtmlUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string
): string {
  return `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
}
