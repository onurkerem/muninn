/**
 * Sync Manager for muninn
 *
 * Handles lazy/on-demand sync for repositories.
 * Compares tree SHA to detect changes and only downloads modified files.
 */

import * as path from 'path';
import { GitHubClient, parseRepoString } from '../github.js';
import { StorageManager, FileMetadata } from './index.js';
import { StateManager, RepoState } from './state.js';

// ============================================================================
// Helper Functions
// ============================================================================

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function isTextFile(filePath: string): boolean {
  return filePath.endsWith('.md') || filePath.endsWith('.txt');
}

function isSupportedFile(filePath: string): boolean {
  return isTextFile(filePath) || isImageFile(filePath);
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  repo: string;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  error?: string;
}

/**
 * Sync Manager
 *
 * Handles lazy/on-demand sync for repositories.
 * - Uses tree SHA comparison to detect changes
 * - Downloads only new/modified files
 * - Tracks in-flight sync operations to avoid duplicates
 */
export class SyncManager {
  private readonly githubClient: GitHubClient;
  private readonly storageManager: StorageManager;
  private readonly stateManager: StateManager;
  private readonly searchEngine: SearchEngineInterface;
  private readonly syncPromises: Map<string, Promise<SyncResult>> = new Map();

  constructor(
    githubClient: GitHubClient,
    storageManager: StorageManager,
    stateManager: StateManager,
    searchEngine: SearchEngineInterface
  ) {
    this.githubClient = githubClient;
    this.storageManager = storageManager;
    this.stateManager = stateManager;
    this.searchEngine = searchEngine;
  }

  /**
   * Quick check if sync is needed
   * Compares stored tree SHA with remote
   */
  async needsSync(repo: string): Promise<boolean> {
    const parsed = parseRepoString(repo);
    if (!parsed) return false;

    const storedState = await this.stateManager.getRepoState(repo);
    if (!storedState) {
      return true; // Never synced
    }

    // Fetch repo to get default branch
    const repoResult = await this.githubClient.getRepo(parsed.owner, parsed.repo);
    if (!repoResult.ok) {
      return false; // Can't determine, assume no sync needed
    }

    // Fetch tree to get current SHA
    const treeResult = await this.githubClient.getTree(
      parsed.owner,
      parsed.repo,
      repoResult.data.default_branch
    );
    if (!treeResult.ok) {
      return false; // Can't determine, assume no sync needed
    }

    return treeResult.data.sha !== storedState.treeSha;
  }

  /**
   * Ensure repo is synced - used by all tools
   * Checks if sync is needed and syncs if so
   * Deduplicates concurrent sync requests
   */
  async ensureSynced(repo: string): Promise<SyncResult> {
    // Check if sync is already in progress
    const existing = this.syncPromises.get(repo);
    if (existing) {
      return existing;
    }

    // Quick check if sync needed
    const needsSync = await this.needsSync(repo);
    if (!needsSync) {
      const state = await this.stateManager.getRepoState(repo);
      return {
        repo,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: state?.fileCount || 0,
      };
    }

    // Start sync and store promise
    const syncPromise = this.syncRepo(repo);
    this.syncPromises.set(repo, syncPromise);

    try {
      const result = await syncPromise;
      return result;
    } finally {
      this.syncPromises.delete(repo);
    }
  }

  /**
   * Sync a repository
   * Downloads only changed files since last sync
   */
  private async syncRepo(repo: string): Promise<SyncResult> {
    const parsed = parseRepoString(repo);
    if (!parsed) {
      return {
        repo,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        error: `Invalid repository format: ${repo}`,
      };
    }

    const { owner, repo: repoName } = parsed;

    // 1. Get repo info for default branch
    const repoResult = await this.githubClient.getRepo(owner, repoName);
    if (!repoResult.ok) {
      return {
        repo,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        error: repoResult.error.message,
      };
    }

    const branch = repoResult.data.default_branch;

    // 2. Get current tree from GitHub
    const treeResult = await this.githubClient.getTree(owner, repoName, branch);
    if (!treeResult.ok) {
      return {
        repo,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        error: treeResult.error.message,
      };
    }

    const tree = treeResult.data;

    // 3. Filter for supported files (.md, .txt, and images)
    const supportedFiles = tree.tree.filter(
      (entry) =>
        entry.type === 'blob' && isSupportedFile(entry.path)
    );

    // 4. Get stored file index
    const storedIndex = await this.storageManager.getFileIndex(repo);

    // 5. Calculate diff by SHA
    const toAdd: Array<{ path: string; sha: string; size?: number }> = [];
    const toUpdate: Array<{ path: string; sha: string; size?: number }> = [];
    const toDelete: string[] = [];

    for (const file of supportedFiles) {
      const stored = storedIndex[file.path];
      if (!stored) {
        toAdd.push({ path: file.path, sha: file.sha, size: file.size });
      } else if (stored.sha !== file.sha) {
        toUpdate.push({ path: file.path, sha: file.sha, size: file.size });
      }
    }

    for (const filePath of Object.keys(storedIndex)) {
      if (!supportedFiles.find((f) => f.path === filePath)) {
        toDelete.push(filePath);
      }
    }

    // 6. Download changed/new files
    for (const file of [...toAdd, ...toUpdate]) {
      const fileResult = await this.githubClient.getFileContent(owner, repoName, file.path);
      if (!fileResult.ok || !fileResult.data.content) {
        console.error(`Failed to download ${file.path}: ${fileResult.ok ? 'no content' : fileResult.error.message}`);
        continue;
      }

      // Get last commit for the file
      const commitResult = await this.githubClient.getLastCommit(owner, repoName, file.path);
      const lastModified =
        commitResult.ok && commitResult.data
          ? commitResult.data.commit.committer.date
          : null;

      const metadata: FileMetadata = {
        sha: file.sha,
        size_kb: file.size ? Math.round((file.size / 1024) * 10) / 10 : 0,
        last_modified: lastModified,
      };

      if (isImageFile(file.path)) {
        // Binary file - store as Buffer, skip search indexing
        const content = GitHubClient.decodeBinaryContent(fileResult.data.content);
        await this.storageManager.setBinaryFile(repo, file.path, content, metadata);
        // DO NOT index images for search
      } else {
        // Text file - existing behavior
        const content = GitHubClient.decodeContent(fileResult.data.content);
        await this.storageManager.setFile(repo, file.path, content, metadata);
        this.searchEngine.indexDocument(repo, file.path, content);
      }
    }

    // 7. Delete removed files
    for (const filePath of toDelete) {
      await this.storageManager.deleteFile(repo, filePath);
      this.searchEngine.removeDocument(repo, filePath);
    }

    // 8. Update state
    const repoState: RepoState = {
      repo,
      treeSha: tree.sha,
      branch,
      lastSync: new Date().toISOString(),
      fileCount: supportedFiles.length,
    };
    await this.stateManager.setRepoState(repo, repoState);

    // 9. Save search index
    await this.searchEngine.saveIndex();

    return {
      repo,
      added: toAdd.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
      unchanged: supportedFiles.length - toAdd.length - toUpdate.length,
    };
  }

  /**
   * Get the repo state (exposed for tools that need branch info)
   */
  async getRepoState(repo: string): Promise<RepoState | null> {
    return this.stateManager.getRepoState(repo);
  }
}

/**
 * Interface for search engine (to avoid circular dependency)
 */
export interface SearchEngineInterface {
  indexDocument(repo: string, path: string, content: string): void;
  removeDocument(repo: string, path: string): void;
  saveIndex(): Promise<void>;
}
