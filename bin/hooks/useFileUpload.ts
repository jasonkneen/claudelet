/**
 * useFileUpload Hook
 *
 * Extracted from claudelet-opentui.tsx
 *
 * Responsibilities:
 * - Manage file upload state and progress
 * - Resolve file references from filesystem
 * - Validate file paths (security checks)
 * - Convert file content to message format
 * - Estimate token usage for files
 * - Handle file size limits
 *
 * Dependencies:
 * - useCallback, useState from React
 * - fs/promises for file operations
 * - path for file path operations
 */

import { useCallback, useState } from 'react';
import * as fsp from 'fs/promises';
import * as path from 'path';

const MAX_FILE_SIZE = 500_000; // 500KB

export interface FileUploadState {
  uploadProgress: number | null;
  uploadError: string | null;
  uploadedFiles: Map<string, string>; // Map of filename to content
}

export interface FileUploadActions {
  resolveFileReference: (filePath: string) => Promise<string | null>;
  addFileChip: (filePath: string) => Promise<boolean>;
  estimateTokenCount: (text: string) => number;
  removeFile: (filePath: string) => void;
  clearFiles: () => void;
}

/**
 * useFileUpload Hook
 *
 * Handles file reference resolution and uploading:
 * - Validates file paths (must be within cwd)
 * - Enforces size limits
 * - Caches file content
 * - Converts content for message embedding
 * - Estimates token usage
 *
 * Returns:
 * - uploadProgress: Upload progress percentage (0-100) or null
 * - uploadError: Any upload errors
 * - uploadedFiles: Map of uploaded file contents
 * - resolveFileReference: Load a file and validate it
 * - addFileChip: Add a file to the upload queue
 * - estimateTokenCount: Calculate tokens for text
 * - removeFile: Remove cached file content
 * - clearFiles: Clear all cached files
 */
export function useFileUpload() {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Map<string, string>>(new Map());

  const resolveFileReference = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const resolved = path.resolve(process.cwd(), filePath);

      // Security: ensure file is within cwd
      const cwd = process.cwd();
      const normalized = path.normalize(resolved);
      if (!normalized.startsWith(path.normalize(cwd))) {
        setUploadError(`Security: file must be within working directory: ${cwd}`);
        return null;
      }

      const stat = await fsp.stat(resolved);
      if (!stat.isFile()) {
        setUploadError(`Not a file: ${filePath}`);
        return null;
      }

      if (stat.size > MAX_FILE_SIZE) {
        setUploadError(`File too large: ${filePath} (max ${MAX_FILE_SIZE / 1000}KB)`);
        return null;
      }

      const content = await fsp.readFile(resolved, 'utf-8');
      setUploadError(null);
      return content;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setUploadError(`Failed to read file: ${msg}`);
      return null;
    }
  }, []);

  const addFileChip = useCallback(
    async (filePath: string): Promise<boolean> => {
      try {
        setUploadProgress(50);

        // Resolve file reference
        const content = await resolveFileReference(filePath);
        if (!content) {
          setUploadProgress(null);
          return false;
        }

        // Cache the content
        setUploadedFiles((prev) => {
          const next = new Map(prev);
          next.set(filePath, content);
          return next;
        });

        setUploadProgress(100);
        setTimeout(() => setUploadProgress(null), 500); // Clear progress after 500ms

        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setUploadError(msg);
        setUploadProgress(null);
        return false;
      }
    },
    [resolveFileReference]
  );

  const estimateTokenCount = useCallback((text: string): number => {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }, []);

  const removeFile = useCallback((filePath: string): void => {
    setUploadedFiles((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const clearFiles = useCallback((): void => {
    setUploadedFiles(new Map());
    setUploadError(null);
    setUploadProgress(null);
  }, []);

  return {
    // State
    uploadProgress,
    uploadError,
    uploadedFiles,

    // Actions
    resolveFileReference,
    addFileChip,
    estimateTokenCount,
    removeFile,
    clearFiles
  };
}

/**
 * Helper function to convert file segments to message content
 * This should be in a separate utility but is here for convenience
 */
export async function segmentsToMessageContent(
  segments: Array<{
    type: 'text' | 'chip' | 'context';
    text?: string;
    chip?: { label: string; filePath: string };
    context?: { isInclude: boolean; label: string };
  }>,
  fileResolver: (path: string) => Promise<string | null>
): Promise<string> {
  const parts = await Promise.all(
    segments.map(async (seg) => {
      if (seg.type === 'text') {
        return seg.text || '';
      } else if (seg.type === 'chip' && seg.chip) {
        const content = await fileResolver(seg.chip.filePath);
        if (content) {
          return '```' + seg.chip.label + '\n' + content + '\n```';
        } else {
          return `[File not found: ${seg.chip.label}]`;
        }
      } else if (seg.type === 'context' && seg.context) {
        // Context chips: include as metadata in message
        return `[Context: ${seg.context.isInclude ? 'INCLUDE' : 'EXCLUDE'} ${seg.context.label}]`;
      }
      return '';
    })
  );
  return parts.join('');
}

/**
 * Helper function to convert segments to display string (without resolving file content)
 */
export function segmentsToDisplayString(
  segments: Array<{
    type: 'text' | 'chip' | 'context';
    text?: string;
    chip?: { label: string };
    context?: { isInclude: boolean; label: string };
  }>
): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') {
        return seg.text || '';
      } else if (seg.type === 'chip' && seg.chip) {
        return `[${seg.chip.label}]`;
      } else if (seg.type === 'context' && seg.context) {
        return `[${seg.context.isInclude ? '+' : '-'}${seg.context.label}]`;
      }
      return '';
    })
    .join('');
}
