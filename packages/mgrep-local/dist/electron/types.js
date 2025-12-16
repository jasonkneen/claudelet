/**
 * Electron-specific types for mgrep-local
 *
 * Defines worker thread communication protocol and service configuration.
 */
// =============================================================================
// IPC Types
// =============================================================================
/**
 * IPC channel names
 */
export const IPC_CHANNELS = {
    SEARCH: 'mgrep:search',
    INDEX_FILE: 'mgrep:index-file',
    INDEX_WORKSPACE: 'mgrep:index-workspace',
    DELETE_FILE: 'mgrep:delete-file',
    GET_STATUS: 'mgrep:get-status',
    GET_STATS: 'mgrep:get-stats',
    FILE_CHANGE: 'mgrep:file-change',
    PROGRESS: 'mgrep:progress',
};
//# sourceMappingURL=types.js.map