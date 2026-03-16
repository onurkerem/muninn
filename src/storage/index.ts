/**
 * Storage Manager for muninn
 *
 * Manages local file storage for repository documentation.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * File metadata stored in .index.json
 */
export interface FileMetadata {
  sha: string;
  size_kb: number;
  last_modified: string | null;
}

/**
 * Repository file index
 */
export interface RepoFileIndex {
  [path: string]: FileMetadata;
}

/**
 * File info returned by listFiles
 */
export interface FileInfo {
  path: string;
  size_kb: number;
  last_modified: string | null;
}

/**
 * Storage Manager
 *
 * Handles local file storage for repository documentation.
 * Files are stored at: {storagePath}/{owner}/{repo}/{path...}
 * Metadata is stored at: {storagePath}/{owner}/{repo}/.index.json
 */
export class StorageManager {
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * Get the storage directory for a repository
   */
  private getRepoDir(repo: string): string {
    return path.join(this.storagePath, 'storage', repo);
  }

  /**
   * Get the index file path for a repository
   */
  private getIndexFilePath(repo: string): string {
    return path.join(this.getRepoDir(repo), '.index.json');
  }

  /**
   * Get the file path for a document
   */
  public getFilePath(repo: string, filePath: string): string {
    return path.join(this.getRepoDir(repo), filePath);
  }

  /**
   * Ensure the storage directory exists
   */
  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.storagePath, { recursive: true });
    await fs.promises.mkdir(path.join(this.storagePath, 'storage'), { recursive: true });
  }

  /**
   * Ensure the repo directory exists
   */
  private async ensureRepoDir(repo: string): Promise<void> {
    const repoDir = this.getRepoDir(repo);
    await fs.promises.mkdir(repoDir, { recursive: true });
  }

  /**
   * Read the file index for a repository
   */
  async getFileIndex(repo: string): Promise<RepoFileIndex> {
    const indexPath = this.getIndexFilePath(repo);
    try {
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      return JSON.parse(content) as RepoFileIndex;
    } catch (error) {
      // Index doesn't exist yet
      return {};
    }
  }

  /**
   * Write the file index for a repository
   */
  private async setFileIndex(repo: string, index: RepoFileIndex): Promise<void> {
    await this.ensureRepoDir(repo);
    const indexPath = this.getIndexFilePath(repo);
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Get a file from local storage
   * Returns null if file doesn't exist
   */
  async getFile(repo: string, filePath: string): Promise<{ content: string; metadata: FileMetadata } | null> {
    const fullPath = this.getFilePath(repo, filePath);
    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const index = await this.getFileIndex(repo);
      const metadata = index[filePath];
      if (!metadata) {
        return null;
      }
      return { content, metadata };
    } catch (error) {
      return null;
    }
  }

  /**
   * Write a file to local storage
   */
  async setFile(
    repo: string,
    filePath: string,
    content: string,
    metadata: FileMetadata
  ): Promise<void> {
    await this.ensureRepoDir(repo);

    // Write file content
    const fullPath = this.getFilePath(repo, filePath);
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf-8');

    // Update index
    const index = await this.getFileIndex(repo);
    index[filePath] = metadata;
    await this.setFileIndex(repo, index);
  }

  /**
   * Delete a file from local storage
   */
  async deleteFile(repo: string, filePath: string): Promise<void> {
    const fullPath = this.getFilePath(repo, filePath);
    try {
      await fs.promises.unlink(fullPath);
    } catch (error) {
      // File might not exist, that's okay
    }

    // Update index
    const index = await this.getFileIndex(repo);
    delete index[filePath];
    await this.setFileIndex(repo, index);
  }

  /**
   * List text files (.md, .txt) in a repository with optional path prefix filter
   */
  async listFiles(repo: string, prefix?: string): Promise<FileInfo[]> {
    const index = await this.getFileIndex(repo);
    const textExtensions = ['.md', '.txt'];
    const files: FileInfo[] = [];

    for (const [filePath, metadata] of Object.entries(index)) {
      if (prefix && !filePath.startsWith(prefix)) {
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      if (textExtensions.includes(ext)) {
        files.push({
          path: filePath,
          size_kb: metadata.size_kb,
          last_modified: metadata.last_modified,
        });
      }
    }

    // Sort by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    return files;
  }

  /**
   * Check if a repository has been synced (has files in storage)
   */
  async hasRepoData(repo: string): Promise<boolean> {
    const index = await this.getFileIndex(repo);
    return Object.keys(index).length > 0;
  }

  /**
   * Get a binary file from local storage
   * Returns null if file doesn't exist
   */
  async getBinaryFile(repo: string, filePath: string): Promise<{ content: Buffer; metadata: FileMetadata } | null> {
    const fullPath = this.getFilePath(repo, filePath);
    try {
      const content = await fs.promises.readFile(fullPath);
      const index = await this.getFileIndex(repo);
      const metadata = index[filePath];
      if (!metadata) {
        return null;
      }
      return { content, metadata };
    } catch (error) {
      return null;
    }
  }

  /**
   * Write a binary file to local storage
   */
  async setBinaryFile(
    repo: string,
    filePath: string,
    content: Buffer,
    metadata: FileMetadata
  ): Promise<void> {
    await this.ensureRepoDir(repo);

    // Write file content (binary mode - no encoding)
    const fullPath = this.getFilePath(repo, filePath);
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, content);

    // Update index
    const index = await this.getFileIndex(repo);
    index[filePath] = metadata;
    await this.setFileIndex(repo, index);
  }

  /**
   * List image files in a repository with optional path prefix filter
   */
  async listImageFiles(repo: string, prefix?: string): Promise<FileInfo[]> {
    const index = await this.getFileIndex(repo);
    const imageExtensions = ['.jpg', '.jpeg', '.png'];
    const files: FileInfo[] = [];

    for (const [filePath, metadata] of Object.entries(index)) {
      if (prefix && !filePath.startsWith(prefix)) {
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      if (imageExtensions.includes(ext)) {
        files.push({
          path: filePath,
          size_kb: metadata.size_kb,
          last_modified: metadata.last_modified,
        });
      }
    }

    // Sort by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    return files;
  }

  /**
   * Clear all files for a repository
   */
  async clearRepo(repo: string): Promise<void> {
    const repoDir = this.getRepoDir(repo);
    try {
      await fs.promises.rm(repoDir, { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  }
}

/**
 * Get the default storage path (~/.muninn)
 */
export function getDefaultStoragePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.muninn');
}
