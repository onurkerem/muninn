/**
 * MCP Server setup for muninn
 *
 * Registers all tools and sets up the MCP server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { encode } from '@toon-format/toon';
import { GitHubClient, parseRepoString, buildFileHtmlUrl, GitHubError } from './github.js';
import { StorageManager } from './storage/index.js';
import { SyncManager } from './storage/sync.js';
import { SearchEngine } from './search/index.js';

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure the MCP server with all tools
 */
export function createMcpServer(
  repos: string[],
  githubClient: GitHubClient,
  storageManager: StorageManager,
  syncManager: SyncManager,
  searchEngine: SearchEngine
): McpServer {
  const server = new McpServer({
    name: 'muninn',
    version: '0.1.0',
  });

  // Register list_repos tool
  server.tool(
    'list_repos',
    'Returns the configured repository list.',
    {},
    async () => {
      const output = encode({ repos });
      return {
        content: [{ type: 'text', text: output }],
      };
    }
  );

  // Register get_repo_info tool
  server.tool(
    'get_repo_info',
    'Returns metadata and README preview for a single repo. Helps agents orient before exploring.',
    {
      repo: z.string().describe('Repository in owner/repo format'),
    },
    async ({ repo }) => {
      const parsed = parseRepoString(repo);
      if (!parsed) {
        const error: GitHubError = {
          error: 'repository_not_found',
          repo,
          message: `Invalid repository format: ${repo}. Expected format: owner/repo`,
        };
        return { content: [{ type: 'text', text: encode(error) }] };
      }

      // Fetch repo info and README in parallel (still uses GitHub API)
      const [repoResult, readmeResult] = await Promise.all([
        githubClient.getRepo(parsed.owner, parsed.repo),
        githubClient.getReadme(parsed.owner, parsed.repo),
      ]);

      if (!repoResult.ok) {
        return { content: [{ type: 'text', text: encode(repoResult.error) }] };
      }

      const repoData = repoResult.data;

      // Build response object
      const response: Record<string, unknown> = {
        repo: repoData.full_name,
      };

      if (repoData.description) {
        response.description = repoData.description;
      }
      response.default_branch = repoData.default_branch;
      response.last_push = repoData.pushed_at;

      // Add README preview if available
      if (readmeResult.ok && readmeResult.data.content) {
        const readmeContent = GitHubClient.decodeContent(readmeResult.data.content);
        response.readme_preview = readmeContent.substring(0, 500);
      }

      return {
        content: [{ type: 'text', text: encode(response) }],
      };
    }
  );

  // Register list_docs tool
  server.tool(
    'list_docs',
    'Recursively lists all .md and .txt files in a repo, with path, size, and last commit date per file.',
    {
      repo: z.string().describe('Repository in owner/repo format'),
      path: z.string().optional().describe('Optional path to list from (defaults to repo root)'),
    },
    async ({ repo, path }) => {
      const parsed = parseRepoString(repo);
      if (!parsed) {
        const error: GitHubError = {
          error: 'repository_not_found',
          repo,
          message: `Invalid repository format: ${repo}. Expected format: owner/repo`,
        };
        return { content: [{ type: 'text', text: encode(error) }] };
      }

      // Ensure repo is synced (lazy sync)
      await syncManager.ensureSynced(repo);

      // List files from local storage
      const files = await storageManager.listFiles(repo, path);

      // Build response using TOON format with indexed array
      const output = encode({
        repo: repo,
        files: files.map((f, i) => ({
          index: i + 1,
          path: f.path,
          size_kb: f.size_kb,
          last_modified: f.last_modified,
        })),
      });

      return {
        content: [{ type: 'text', text: output }],
      };
    }
  );

  // Register get_doc tool
  server.tool(
    'get_doc',
    'Fetches the raw content of a single file by path.',
    {
      repo: z.string().describe('Repository in owner/repo format'),
      path: z.string().describe('File path within the repository'),
    },
    async ({ repo, path }) => {
      const parsed = parseRepoString(repo);
      if (!parsed) {
        const error: GitHubError = {
          error: 'file_not_found',
          repo,
          path,
          message: `Invalid repository format: ${repo}. Expected format: owner/repo`,
        };
        return { content: [{ type: 'text', text: encode(error) }] };
      }

      // Ensure repo is synced (lazy sync)
      await syncManager.ensureSynced(repo);

      // Try to get file from local storage
      const localFile = await storageManager.getFile(repo, path);

      if (localFile) {
        // Build TOON frontmatter + content from local storage
        const repoState = await syncManager.getRepoState(repo);
        const branch = repoState?.branch || 'main';
        const htmlUrl = buildFileHtmlUrl(parsed.owner, parsed.repo, branch, path);

        const frontmatter = encode({
          repo,
          path,
          last_modified: localFile.metadata.last_modified,
          html_url: htmlUrl,
          size_kb: localFile.metadata.size_kb,
        });

        // Indent content by 2 spaces for TOON format
        const indentedContent = localFile.content
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');

        const output = `${frontmatter}\ncontent:\n${indentedContent}`;

        return {
          content: [{ type: 'text', text: output }],
        };
      }

      // File not found locally - fetch from GitHub API (fallback always enabled)
      // Fallback: fetch from GitHub API
      const [repoResult, fileResult, commitResult] = await Promise.all([
        githubClient.getRepo(parsed.owner, parsed.repo),
        githubClient.getFileContent(parsed.owner, parsed.repo, path),
        githubClient.getLastCommit(parsed.owner, parsed.repo, path),
      ]);

      if (!repoResult.ok) {
        return { content: [{ type: 'text', text: encode(repoResult.error) }] };
      }

      if (!fileResult.ok) {
        return { content: [{ type: 'text', text: encode(fileResult.error) }] };
      }

      const branch = repoResult.data.default_branch;
      const fileData = fileResult.data;

      if (!fileData.content) {
        const error: GitHubError = {
          error: 'file_not_found',
          repo,
          path,
          message: `File has no content: ${path}`,
        };
        return { content: [{ type: 'text', text: encode(error) }] };
      }

      // Decode content
      const content = GitHubClient.decodeContent(fileData.content);
      const sizeKb = Math.round((fileData.size / 1024) * 10) / 10;
      const lastModified =
        commitResult.ok && commitResult.data
          ? commitResult.data.commit.committer.date
          : null;
      const htmlUrl = buildFileHtmlUrl(parsed.owner, parsed.repo, branch, path);

      // Cache the file locally for future requests
      await storageManager.setFile(repo, path, content, {
        sha: fileData.sha,
        size_kb: sizeKb,
        last_modified: lastModified,
      });
      searchEngine.indexDocument(repo, path, content);

      // Build TOON frontmatter + content
      const frontmatter = encode({
        repo,
        path,
        last_modified: lastModified,
        html_url: htmlUrl,
        size_kb: sizeKb,
      });

      // Indent content by 2 spaces for TOON format
      const indentedContent = content
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');

      const output = `${frontmatter}\ncontent:\n${indentedContent}`;

      return {
        content: [{ type: 'text', text: output }],
      };
    }
  );

  // Register search_docs tool
  server.tool(
    'search_docs',
    'Full-text search across configured repos. Returns matching files with snippets. Note: Single-character queries return no results - use 2+ characters for meaningful matches. Snippets show [start]/[end] markers to indicate truncation.',
    {
      query: z.string().describe('Search query'),
      repo: z.string().optional().describe('Optional repository to search (omit to search all configured repos)'),
    },
    async ({ query, repo }) => {
      // Determine which repos to search
      let reposToSearch: string[];
      if (repo) {
        const parsed = parseRepoString(repo);
        if (!parsed) {
          const error: GitHubError = {
            error: 'repository_not_found',
            repo,
            message: `Invalid repository format: ${repo}. Expected format: owner/repo`,
          };
          return { content: [{ type: 'text', text: encode(error) }] };
        }
        reposToSearch = [repo];
      } else {
        reposToSearch = repos;
      }

      // Ensure all repos are synced (lazy sync)
      await Promise.all(reposToSearch.map((r) => syncManager.ensureSynced(r)));

      // Search using local search engine
      const searchResults = await searchEngine.search(query, repo);

      // Build HTML URLs for results
      const resultsWithUrls = await Promise.all(
        searchResults.map(async (result) => {
          const repoState = await syncManager.getRepoState(result.repo);
          const parsed = parseRepoString(result.repo);
          const branch = repoState?.branch || 'main';
          const htmlUrl = parsed
            ? buildFileHtmlUrl(parsed.owner, parsed.repo, branch, result.path)
            : '';

          return {
            repo: result.repo,
            path: result.path,
            snippet: result.snippet,
            html_url: htmlUrl,
          };
        })
      );

      // Build response
      const response = {
        query,
        total_matches: resultsWithUrls.length,
        results: resultsWithUrls.map((r, i) => ({
          index: i + 1,
          repo: r.repo,
          path: r.path,
          snippet: r.snippet,
          html_url: r.html_url,
        })),
      };

      return {
        content: [{ type: 'text', text: encode(response) }],
      };
    }
  );

  return server;
}
