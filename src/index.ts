#!/usr/bin/env node
/**
 * muninn - MCP Server for GitHub Documentation Access
 *
 * Entry point that parses CLI arguments and starts the MCP server.
 */

import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GitHubClient } from './github.js';
import { createMcpServer } from './server.js';

const program = new Command();

program
  .name('muninn')
  .description('MCP server that gives agents fresh, on-demand access to documentation stored in GitHub repositories')
  .version('0.1.0')
  .requiredOption('--repos <repos>', 'Comma-separated list of repositories in owner/repo format')
  .option('--github-pat <token>', 'GitHub Personal Access Token (required for private repos)')
  .parse(process.argv);

const options = program.opts<{
  repos: string;
  githubPat?: string;
}>();

// Parse repos
const repos = options.repos.split(',').map((r) => r.trim());

// Validate repo format
const repoPattern = /^[\w.-]+\/[\w.-]+$/;
for (const repo of repos) {
  if (!repoPattern.test(repo)) {
    console.error(`Error: Invalid repository format: ${repo}`);
    console.error('Expected format: owner/repo');
    process.exit(1);
  }
}

// Create GitHub client
const githubClient = new GitHubClient(options.githubPat);

// Validate repos are accessible on startup
async function validateRepos(): Promise<void> {
  console.error('Validating repository access...');

  for (const repo of repos) {
    const [owner, repoName] = repo.split('/');
    const result = await githubClient.getRepo(owner, repoName);

    if (!result.ok) {
      if (result.error.error === 'repository_not_found' || result.error.error === 'authentication_failed') {
        // Check if it might be a private repo without PAT
        if (!options.githubPat && result.error.status === 404) {
          console.error(`Error: Repository ${repo} not found.`);
          console.error('If this is a private repository, provide --github-pat');
          process.exit(1);
        }
        console.error(`Error: Cannot access repository ${repo}`);
        console.error(result.error.message);
        process.exit(1);
      }
      console.error(`Error: Failed to validate repository ${repo}: ${result.error.message}`);
      process.exit(1);
    }

    console.error(`  ✓ ${repo} (default branch: ${result.data.default_branch})`);
  }

  console.error(`Validated ${repos.length} repositories`);
}

// Main entry point
async function main(): Promise<void> {
  try {
    // Validate repos first
    await validateRepos();

    // Create and configure MCP server
    const server = createMcpServer(repos, githubClient);

    // Connect using stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('muninn MCP server started successfully');
    console.error(`Configured repositories: ${repos.join(', ')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to start server: ${message}`);
    process.exit(1);
  }
}

main();
