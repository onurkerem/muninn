/**
 * State Manager for muninn
 *
 * Manages sync state for repositories in ~/.muninn/state.json
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Repository sync state
 */
export interface RepoState {
  repo: string;
  treeSha: string;
  branch: string;
  lastSync: string; // ISO timestamp
  fileCount: number;
}

/**
 * State file structure
 */
interface StateFile {
  version: number;
  repos: {
    [repo: string]: RepoState;
  };
}

/**
 * State Manager
 *
 * Manages sync state for repositories.
 * State is stored in ~/.muninn/state.json
 */
export class StateManager {
  private readonly statePath: string;
  private state: StateFile | null = null;

  constructor(storagePath: string) {
    this.statePath = path.join(storagePath, 'state.json');
  }

  /**
   * Load state from disk
   */
  private async loadState(): Promise<StateFile> {
    if (this.state) {
      return this.state;
    }

    try {
      const content = await fs.promises.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content) as StateFile;
      return this.state;
    } catch (error) {
      // State file doesn't exist yet
      this.state = { version: 1, repos: {} };
      return this.state;
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    if (!this.state) {
      return;
    }
    await fs.promises.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.promises.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /**
   * Get state for a specific repository
   */
  async getRepoState(repo: string): Promise<RepoState | null> {
    const state = await this.loadState();
    return state.repos[repo] || null;
  }

  /**
   * Set state for a specific repository
   */
  async setRepoState(repo: string, repoState: RepoState): Promise<void> {
    const state = await this.loadState();
    state.repos[repo] = repoState;
    await this.saveState();
  }

  /**
   * Get all repository states
   */
  async getAllRepoStates(): Promise<RepoState[]> {
    const state = await this.loadState();
    return Object.values(state.repos);
  }

  /**
   * Delete state for a repository
   */
  async deleteRepoState(repo: string): Promise<void> {
    const state = await this.loadState();
    delete state.repos[repo];
    await this.saveState();
  }
}
