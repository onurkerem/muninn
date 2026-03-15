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

# Test locally
node dist/index.js --repos "owner/repo"

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js --repos "owner/repo"
```

---

## Project Architecture

```
muninn/
├── src/
│   ├── index.ts          # CLI entry point (commander)
│   ├── server.ts         # MCP server setup, tool registration
│   └── github.ts         # GitHub API client with error handling
├── dist/                 # Compiled output
├── docs/
│   └── initial-prd.md    # Product requirements
└── .agents/
    └── skills/
        └── mcp-builder/  # MCP development skill
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI parsing, repo validation, server startup |
| `src/server.ts` | MCP server factory with 5 tools registered |
| `src/github.ts` | GitHub REST API client with typed responses |

---

## Tools Implemented

| Tool | Purpose | Response Format |
|------|---------|-----------------|
| `list_repos` | List configured repositories | TOON |
| `get_repo_info` | Repo metadata + README preview | TOON |
| `list_docs` | List .md/.txt files with metadata | TOON |
| `get_doc` | Fetch file content by path | TOON frontmatter + Markdown |
| `search_docs` | Full-text search via GitHub API | TOON |

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

### GitHub API Client

- All methods return `GitHubResult<T>`
- Handles rate limiting (403 with x-ratelimit-remaining=0)
- Base64 decodes file content via `GitHubClient.decodeContent()`
- Uses native `fetch` (Node 18+)

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

## GitHub API Reference

| Purpose | Endpoint |
|---------|----------|
| Repo metadata | `GET /repos/{owner}/{repo}` |
| README content | `GET /repos/{owner}/{repo}/readme` |
| File tree (recursive) | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` |
| File content | `GET /repos/{owner}/{repo}/contents/{path}` |
| Last commit for file | `GET /repos/{owner}/{repo}/commits?path={path}&per_page=1` |
| Code search | `GET /search/code?q={query}+repo:{owner}/{repo}` |

### Required Headers

```
Authorization: Bearer {PAT}           # Optional for public repos
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

### Rate Limits

- **REST API**: 5,000 requests/hour (authenticated)
- **Search API**: 30 requests/minute (authenticated)

---

## Testing

### Unit Testing GitHub Client

```bash
node -e "
const { GitHubClient } = require('./dist/github.js');
const client = new GitHubClient();
client.getRepo('owner', 'repo').then(console.log);
"
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js --repos "owner/repo"
```

---

## Future Enhancements (Post-MVP)

- Vector / semantic search
- Caching layer
- Write operations (create/update files)
- Webhook-based sync
- Additional file types (PDF, images)

---

## References

- [MCP Protocol Docs](https://modelcontextprotocol.io/)
- [TOON Format](https://toonformat.dev)
- [GitHub REST API](https://docs.github.com/en/rest)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
