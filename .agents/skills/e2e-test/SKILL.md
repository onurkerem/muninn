---
name: e2e-test
description: >
  End-to-end testing skill for the muninn MCP server. Use this skill when you need to test,
  validate, or verify muninn MCP tools are working correctly. Triggers on phrases like
  "run e2e tests", "test muninn", "validate MCP tools", "test all tools", "verify muninn works",
  or when doing any kind of end-to-end or integration testing for this project. This skill
  guides agents to discover all muninn features, create test cases dynamically, and validate
  functionality by modifying the test-repo submodule and using MCP tools.
---

# Muninn E2E Testing Skill

This skill guides you through comprehensive end-to-end testing of the muninn MCP server by discovering features and creating test cases dynamically.

## Prerequisites

1. **MCP must be configured** - Check `.mcp.json` at project root for muninn server configuration
2. **Test repo must be available** - The `test-repo/` submodule should exist with test documents
3. **Server must be rebuilt** - Run `npm run build` if there are uncompiled changes
4. **Git access** - You need push access to the test-repo remote for sync testing

---

## Testing Approach

### Step 1: Discover Available MCP Tools

List all available muninn MCP tools by checking the available MCP functions (tools starting with `mcp__muninn__`).

Document each tool found with:
- Tool name
- Parameters and their types
- Expected behavior (based on AGENTS.md or source code)

### Step 2: Prioritize Testing Order

**Test non-released/unstable features first**, then stable ones:

1. Check `src/server.ts` for any new tools not documented in AGENTS.md
2. Check recent git commits for newly added functionality
3. Test new/experimental features before stable ones
4. Test error handling scenarios last

### Step 3: Create Test Cases Dynamically

For each discovered tool, create test cases that verify:

1. **Happy path** - Normal operation with valid inputs
2. **Edge cases** - Empty inputs, boundary values
3. **Error scenarios** - Invalid inputs, non-existent resources

### Step 4: Execute Tests Using MCP Tools

Run each test case by calling the actual MCP tools and verifying responses.

### Step 5: Test Sync Behavior

Modify the test-repo to verify sync works correctly:

1. Create new files in test-repo
2. Modify existing files
3. Delete files
4. **Push each change to GitHub** - muninn syncs from remote, not local
5. Use MCP tools to verify changes are reflected

---

## Test Execution Guidelines

### Response Format Verification

All muninn tools return responses in **TOON format**. Verify:
- Key-value pairs use `=` syntax
- Arrays are properly indexed
- Error responses contain `error` field with descriptive message

### Modifying Test-Repo

The test-repo is a git submodule connected to GitHub. To test sync:

```bash
# Navigate to test-repo
cd test-repo

# Make changes (create, modify, delete files)
echo "# Test Content" > docs/test-file.md

# Commit and push (required for muninn to detect changes)
git add .
git commit -m "test: add test file"
git push origin master
```

### Cleanup After Testing

Always restore test-repo to original state after testing:

```bash
cd test-repo
git checkout .
git clean -fd
git push origin master --force
```

---

## Testing Patterns

### Pattern 1: Basic Tool Validation

For each tool:
1. Call with minimal required parameters
2. Verify response structure matches expected format
3. Verify response contains expected data

### Pattern 2: Error Handling

For each tool:
1. Call with invalid parameters (wrong format, non-existent resources)
2. Verify error response format
3. Verify error message is descriptive

### Pattern 3: Sync Verification

1. Capture baseline with `list_docs`
2. Modify test-repo (create/modify/delete file)
3. Push to GitHub
4. Call muninn tools to verify change is detected
5. Verify search index is updated

### Pattern 4: Search Testing

1. Add unique searchable content to test-repo
2. Push to GitHub
3. Use `search_docs` with unique term
4. Verify results include new content
5. Delete content and verify it's removed from search

---

## Test Report Template

After testing, generate a summary:

```markdown
# Muninn E2E Test Report

## Tools Discovered
[List all muninn MCP tools found]

## Testing Priority
1. [Non-released/unstable features]
2. [Stable features]
3. [Error handling]

## Test Results

### [Tool Name]
- Happy path: PASSED/FAILED
- Edge cases: PASSED/FAILED
- Error handling: PASSED/FAILED
- Notes: [Any observations]

## Sync Behavior
- New file sync: PASSED/FAILED
- Modified file sync: PASSED/FAILED
- Delete sync: PASSED/FAILED

## Issues Found
[List any bugs or unexpected behavior]

## Recommendations
[Suggestions for improvements]
```

---

## Important Notes

- **Push is required**: muninn syncs from GitHub, not local files
- **Sync timing**: Changes may take a moment to appear after push
- **Search index**: May retain deleted content until full re-sync
- **TOON format**: All responses use TOON - verify structure carefully
- **State location**: Check `~/.muninn/state.json` for sync state
