# muninn

An MCP server that gives agents fresh, on-demand access to documentation stored in GitHub repositories (public or private).

## Installation

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "muninn": {
      "command": "npx",
      "args": [
        "-y", "@onurkerem/muninn@latest",
        "--github-pat", "YOUR_GITHUB_PAT",
        "--repos", "owner/repo1,owner/repo2"
      ]
    }
  }
}
```

**Note:** `--github-pat` is optional for public repos, required for private repos.

### Version Options

| Config | Behavior |
|--------|----------|
| `@onurkerem/muninn@latest` | Always uses the newest version (recommended) |
| `@onurkerem/muninn@1.0.0` | Pins to a specific version for stability |
| `@onurkerem/muninn` | Uses cached version (may not auto-update) |

**Note:** Without `@latest` or a specific version, npx caches the package and may not automatically update to newer releases.

## Configuration

- `--github-pat`: GitHub Personal Access Token (optional for public repos, required for private)
- `--repos`: Comma-separated list of repositories in `owner/repo` format

## Tools

### `list_repos`
Returns the configured repository list.

### `get_repo_info`
Returns metadata and README preview for a single repo.

**Parameters:**
- `repo`: Repository in `owner/repo` format

### `list_docs`
Recursively lists all `.md` and `.txt` files in a repo.

**parameters:**
- `repo`: Repository in `owner/repo` format
- `path`: Optional path to list from (defaults to root)

### `get_doc`
Fetches the raw content of a single file by path.

**Parameters:**
- `repo`: Repository in `owner/repo` format
- `path`: File path within the repository

### `search_docs`
Full-text search across configured repos using GitHub Search API.

**Parameters:**
- `query`: Search query
- `repo`: Optional repository to search (omit to search all configured repos)

## Response Format

Tools return data in [TOON format](https://toonformat.dev) for structured data, or raw markdown for file content.

## License

MIT
