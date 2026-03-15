/**
 * MCP Server setup for muninn
 *
 * Registers all tools and sets up the MCP server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { encode } from '@toon-format/toon';
import { GitHubClient, parseRepoString, buildFileHtmlUrl, GitHubError } from './github.js';

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure the MCP server with all tools
 */
export function createMcpServer(repos: string[], githubClient: GitHubClient): McpServer {
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

      // Fetch repo info and README in parallel
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

      // First get repo to find default branch
      const repoResult = await githubClient.getRepo(parsed.owner, parsed.repo);
      if (!repoResult.ok) {
        return { content: [{ type: 'text', text: encode(repoResult.error) }] };
      }

      const branch = repoResult.data.default_branch;

      // Get the file tree
      const treeResult = await githubClient.getTree(parsed.owner, parsed.repo, branch);
      if (!treeResult.ok) {
        return { content: [{ type: 'text', text: encode(treeResult.error) }] };
      }

      // Filter for .md and .txt files, optionally by path prefix
      const docFiles = treeResult.data.tree.filter((entry) => {
        if (entry.type !== 'blob') return false;
        const isDoc = entry.path.endsWith('.md') || entry.path.endsWith('.txt');
        if (!isDoc) return false;
        if (path && !entry.path.startsWith(path)) return false;
        return true;
      });

      // Get last commit dates for each file (batch with Promise.all)
      const filesWithDates = await Promise.all(
        docFiles.map(async (file) => {
          const commitResult = await githubClient.getLastCommit(
            parsed.owner,
            parsed.repo,
            file.path
          );
          return {
            path: file.path,
            size_kb: file.size ? Math.round((file.size / 1024) * 10) / 10 : 0,
            last_modified:
              commitResult.ok && commitResult.data
                ? commitResult.data.commit.committer.date
                : null,
          };
        })
      );

      // Sort by path
      filesWithDates.sort((a, b) => a.path.localeCompare(b.path));

      // Build response using TOON format with indexed array
      const output = encode({
        repo: repo,
        files: filesWithDates.map((f, i) => ({
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

      // Get repo for default branch and file content in parallel
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
    'Full-text search across configured repos using GitHub Search API. Returns matching files with snippets.',
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

      // Search each repo and merge results
      const allResults: Array<{
        repo: string;
        path: string;
        snippet: string;
        html_url: string;
      }> = [];

      for (const repoName of reposToSearch) {
        const parsed = parseRepoString(repoName);
        if (!parsed) continue;

        const searchResult = await githubClient.searchCode(query, parsed.owner, parsed.repo);

        if (!searchResult.ok) {
          // If rate limited, return the error
          if (searchResult.error.error === 'rate_limit_exceeded') {
            return { content: [{ type: 'text', text: encode(searchResult.error) }] };
          }
          // Skip repos with errors when searching all repos
          continue;
        }

        for (const item of searchResult.data.items) {
          // Strip HTML tags from text_matches if available
          let snippet = '';
          if (item.text_matches && item.text_matches.length > 0) {
            snippet = item.text_matches[0].fragment.replace(/<[^>]*>/g, '');
          } else {
            snippet = `...${item.name}`;
          }

          allResults.push({
            repo: repoName,
            path: item.path,
            snippet,
            html_url: item.html_url,
          });
        }
      }

      // Build response
      const response = {
        query,
        total_matches: allResults.length,
        results: allResults.map((r, i) => ({
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
