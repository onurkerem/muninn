# muninn — AGENTS.md

> MCP server that gives agents fresh, on-demand access to documentation stored in GitHub repositories.

**Package:** `@onurkerem/muninn`
**Runtime:** Node.js 18+ (ESM)
**Language:** TypeScript

---

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Test locally (with lazy sync - files sync on first tool call)
node dist/index.js --repos "owner/repo"

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js --repos "owner/repo"

# With custom storage path
node dist/index.js --repos "owner/repo" --storage-path /path/to/storage

# Disable fallback to GitHub API (only use local files)
node dist/index.js --repos "owner/repo" --no-fallback
```

---

## Project Architecture

```
muninn/
├── src/
│   ├── index.ts              # CLI entry point, manager initialization
│   ├── server.ts             # MCP server setup, tool registration
│   ├── github.ts             # GitHub API client with error handling
│   ├── storage/
│   │   ├── index.ts          # StorageManager - local file storage
│   │   ├── state.ts          # StateManager - sync state tracking
│   │   └── sync.ts           # SyncManager - lazy/on-demand sync
│   └── search/
│       └── index.ts          # SearchEngine - MiniSearch full-text search
├── dist/                     # Compiled output
└── .agents/
    └── skills/
        └── mcp-builder/      # MCP development skill
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI parsing, manager initialization, server startup |
| `src/server.ts` | MCP server factory with 5 tools registered |
| `src/github.ts` | GitHub REST API client with typed responses |
| `src/storage/index.ts` | Local file storage management |
| `src/storage/state.ts` | Sync state tracking (tree SHA, last sync) |
| `src/storage/sync.ts` | Lazy/on-demand sync with deduplication |
| `src/search/index.ts` | MiniSearch-based full-text search |

---

## Local Storage Architecture

```
~/.muninn/
├── state.json              # Sync state (tree SHA, last sync time per repo)
├── search-index.json       # Serialized MiniSearch index
└── storage/
    └── {owner}/
        └── {repo}/
            ├── .index.json     # File metadata (path, sha, size, last_modified)
            └── {path...}       # Actual file content
```

### Lazy Sync

- **No startup sync delay** - server starts immediately
- **On-demand sync** - each tool checks if sync is needed before responding
- **Tree SHA comparison** - only sync when repository has changed
- **Incremental downloads** - only download changed files (different SHA)
- **Deduplication** - concurrent requests share the same sync promise

---

## Tools Implemented

| Tool | Purpose | Response Format |
|------|---------|-----------------|
| `list_repos` | List configured repositories | TOON |
| `get_repo_info` | Repo metadata + README preview | TOON |
| `list_docs` | List .md/.txt files with metadata | TOON |
| `get_doc` | Fetch file content by path | TOON frontmatter + Markdown |
| `search_docs` | Full-text search (local, instant) | TOON |

---

## CLI Options

| Option | Required | Description |
|--------|----------|-------------|
| `--repos <repos>` | **Yes** | Comma-separated list of repositories (e.g., `owner/repo1,owner/repo2`) |
| `--github-pat <token>` | No | GitHub Personal Access Token (required for private repos) |

---

## Coding Conventions

### TypeScript

- **ESM modules**: Use `.js` extensions in imports even for `.ts` files
- **Strict mode**: Enabled in tsconfig.json
- **Discriminated unions**: Use `GitHubResult<T>` pattern for error handling

### Error Handling Pattern

```typescript
// Discriminated union for results
type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: GitHubError };

// Always return new objects, never mutate
if (!result.ok) {
  const error: GitHubError = { ...result.error, repo: `${owner}/${repo}` };
  return { ok: false, error };
}
```

### Response Format

- Use TOON format (`@toon-format/toon`) for structured data
- Use `encode()` function - never hand-build TOON strings
- `get_doc` returns TOON frontmatter + indented markdown content

```typescript
import { encode } from '@toon-format/toon';

// For structured data
return { content: [{ type: 'text', text: encode(data) }] };

// For file content (TOON frontmatter + markdown)
const frontmatter = encode({ repo, path, last_modified, html_url, size_kb });
const output = `${frontmatter}\ncontent:\n${indentedContent}`;
```

### Sync Pattern

Each tool that needs repo data follows this pattern:

```typescript
async ({ repo }) => {
  // 1. Ensure repo is synced (lazy sync)
  await syncManager.ensureSynced(repo);

  // 2. Use local storage
  const files = await storageManager.listFiles(repo, path);

  // 3. Return response
  return { content: [{ type: 'text', text: encode(result) }] };
}
```

---

## MCP Development Guidelines

> Follow the `.agents/skills/mcp-builder/SKILL.md` for comprehensive MCP development guidance.

### Tool Registration Pattern

```typescript
server.tool(
  'tool_name',
  'Tool description for agents',
  {
    param: z.string().describe('Parameter description'),
  },
  async ({ param }) => {
    // Implementation
    return { content: [{ type: 'text', text: encode(result) }] };
  }
);
```

### Input Validation

- Use Zod schemas for all tool parameters
- Add `.describe()` to all schema fields
- Parse repo strings with `parseRepoString()` helper

### Error Responses

Return structured errors in TOON format:

```typescript
const error: GitHubError = {
  error: 'repository_not_found',
  repo: 'owner/repo',
  message: 'Repository not found or not accessible',
};
return { content: [{ type: 'text', text: encode(error) }] };
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `@toon-format/toon` | Structured data output format |
| `commander` | CLI argument parsing |
| `minisearch` | Local full-text search |
| `zod` | Schema validation |

---

## Testing

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js --repos "owner/repo"
```

### Manual Testing

```bash
# Build
npm run build

# Test sync behavior
node dist/index.js --repos "onurkerem/muninn"

# First tool call triggers sync (slower)
# Subsequent calls use local cache (instant)
```

---

## Future Enhancements (Post-MVP)

- Vector / semantic search
- Write operations (create/update files)
- Webhook-based sync
- Additional file types (PDF, images)

---

## References

- [MCP Protocol Docs](https://modelcontextprotocol.io/)
- [TOON Format](https://toonformat.dev)
- [GitHub REST API](https://docs.github.com/en/rest)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MiniSearch](https://lucaong.github.io/minisearch/)
