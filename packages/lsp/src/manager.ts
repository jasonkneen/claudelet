/**
 * LSP Manager
 *
 * Orchestrates LSP servers for a project:
 * - Automatically spawns servers based on file extensions
 * - Deduplicates spawn requests
 * - Manages client lifecycle
 * - Aggregates diagnostics across all servers
 */

import path from 'path'
import { EventEmitter } from 'events'
import { LSPClient } from './client'
import { SERVERS, findProjectRoot, getServersForExtension, getAllServers } from './servers'
import type {
  Diagnostic,
  DiagnosticsEvent,
  ServerStatus,
  LSPManagerOptions,
  LSPManagerEvents,
  Hover,
  CompletionItem,
  Location,
} from './types'
import { initInstaller } from './installer'

export interface LSPManagerEventEmitter {
  on<K extends keyof LSPManagerEvents>(event: K, listener: (data: LSPManagerEvents[K]) => void): this
  off<K extends keyof LSPManagerEvents>(event: K, listener: (data: LSPManagerEvents[K]) => void): this
  emit<K extends keyof LSPManagerEvents>(event: K, data: LSPManagerEvents[K]): boolean
}

/**
 * Retry strategy with exponential backoff
 */
class RetryStrategy {
  private retries = new Map<string, number>()
  private timers = new Map<string, NodeJS.Timeout>()
  private readonly MAX_RETRIES = 5
  private readonly RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000] // ms

  /**
   * Schedule a retry for a server
   */
  scheduleRetry(key: string, retryFn: () => Promise<void>): void {
    const currentRetries = this.retries.get(key) || 0

    if (currentRetries >= this.MAX_RETRIES) {
      console.log(`[LSP] Max retries reached for ${key}`)
      return
    }

    const delay = this.RETRY_DELAYS[currentRetries]
    console.log(`[LSP] Scheduling retry ${currentRetries + 1}/${this.MAX_RETRIES} for ${key} in ${delay}ms`)

    // Clear any existing timer
    const existingTimer = this.timers.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule retry
    const timer = setTimeout(async () => {
      this.timers.delete(key)
      try {
        await retryFn()
      } catch (err) {
        console.error(`[LSP] Retry failed for ${key}:`, err)
      }
    }, delay)

    this.timers.set(key, timer)
    this.retries.set(key, currentRetries + 1)
  }

  /**
   * Clear retry state after successful spawn
   */
  clearRetries(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
    this.retries.delete(key)
  }

  /**
   * Cancel all pending retries
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.retries.clear()
  }

  /**
   * Get retry count for a key
   */
  getRetryCount(key: string): number {
    return this.retries.get(key) || 0
  }
}

/**
 * LSP Manager class - manages all LSP servers for a project
 *
 * Multi-Session Support:
 * Each LSPManager instance is isolated to a specific project path.
 * Multiple instances can run concurrently in different shell sessions.
 */
export class LSPManager extends EventEmitter implements LSPManagerEventEmitter {
  private clients = new Map<string, LSPClient>()
  private spawning = new Map<string, Promise<LSPClient | null>>()
  private broken = new Set<string>()
  private projectPath: string
  private enabled = new Set<string>()
  private disabled = new Set<string>()
  private lazyMode: boolean = true // Defer server spawn until first use
  private retryStrategy = new RetryStrategy()
  private installerOptions: { appName?: string; cacheDir?: string; bunPath?: string }
  private installerInitialized = false
  private readonly instanceId: string

  constructor(options: LSPManagerOptions = {}) {
    super()

    // Project path can be provided via options or falls back to cwd
    // This enables multi-session support where each shell instance has its own LSPManager
    this.projectPath = options.projectPath || process.cwd()

    // Generate instance ID for debugging/logging (8 char hash of project path)
    this.instanceId = this._hashPath(this.projectPath).substring(0, 8)

    // Don't initialize installer here - lazy load on first spawn
    // Store options for later initialization
    this.installerOptions = {
      appName: options.appName,
      cacheDir: options.cacheDir,
      bunPath: options.bunPath,
    }

    // Enable all servers by default
    for (const id of Object.keys(SERVERS)) {
      this.enabled.add(id)
    }

    console.log(`[LSP:${this.instanceId}] Created manager for project: ${this.projectPath}`)
  }

  /**
   * Hash a path to create a stable identifier
   * Simple hash function for creating project-specific identifiers
   */
  private _hashPath(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }

  /**
   * Lazy initialize the installer on first server spawn
   */
  private ensureInstallerInitialized(): void {
    if (!this.installerInitialized) {
      initInstaller(this.installerOptions)
      this.installerInitialized = true
    }
  }

  /**
   * Get the project path for this manager instance
   */
  getProjectPath(): string {
    return this.projectPath
  }

  /**
   * Get the instance ID (hash of project path)
   */
  getInstanceId(): string {
    return this.instanceId
  }

  /**
   * Set the current project path
   * @deprecated Use constructor options instead. This method is kept for backward compatibility.
   * Creating a new LSPManager instance is preferred for switching projects.
   */
  setProjectPath(projectPath: string): void {
    if (this.clients.size > 0) {
      console.warn(
        `[LSP:${this.instanceId}] Warning: setProjectPath called after servers already started. ` +
          `This may cause unexpected behavior. Consider creating a new LSPManager instance instead.`
      )
    }
    this.projectPath = projectPath
    console.log(`[LSP:${this.instanceId}] Project path changed to: ${projectPath}`)
  }

  /**
   * Enable or disable a server
   */
  setServerEnabled(serverId: string, enabled: boolean): void {
    if (enabled) {
      this.disabled.delete(serverId)
      this.enabled.add(serverId)
    } else {
      this.enabled.delete(serverId)
      this.disabled.add(serverId)
      // Shutdown any running clients for this server
      this._shutdownServer(serverId)
    }
    this.emit('server-status-changed', { serverId, enabled })
  }

  /**
   * Check if a server is enabled
   */
  isServerEnabled(serverId: string): boolean {
    return this.enabled.has(serverId) && !this.disabled.has(serverId)
  }

  /**
   * Shutdown all clients for a specific server
   */
  private async _shutdownServer(serverId: string): Promise<void> {
    const toRemove: string[] = []
    for (const [key, client] of this.clients) {
      if (client.serverID === serverId) {
        toRemove.push(key)
        await client.shutdown()
      }
    }
    for (const key of toRemove) {
      this.clients.delete(key)
    }
  }

  /**
   * Get or spawn clients for a file
   */
  async getClientsForFile(filePath: string): Promise<LSPClient[]> {
    const ext = path.extname(filePath).toLowerCase()
    const servers = getServersForExtension(ext)
    const clients: LSPClient[] = []

    for (const server of servers) {
      // Skip disabled servers
      if (!this.isServerEnabled(server.id)) continue

      // Find project root for this server
      const root = await findProjectRoot(filePath, server.rootPatterns, server.excludePatterns)

      if (!root) continue

      const key = `${server.id}:${root}`

      // Skip broken servers
      if (this.broken.has(key)) continue

      // Return existing client
      if (this.clients.has(key)) {
        clients.push(this.clients.get(key)!)
        continue
      }

      // Wait for in-flight spawn
      if (this.spawning.has(key)) {
        try {
          const client = await this.spawning.get(key)
          if (client) clients.push(client)
        } catch {
          // Spawn failed
        }
        continue
      }

      // Spawn new client
      const spawnPromise = this._spawnClient(server, root, key)
      this.spawning.set(key, spawnPromise)

      try {
        const client = await spawnPromise
        if (client) {
          clients.push(client)
        } else {
          // Spawn failed, schedule retry
          this.retryStrategy.scheduleRetry(key, async () => {
            this.emit('server-retrying', { serverId: server.id, root, attempt: this.retryStrategy.getRetryCount(key) })
            await this._retrySpawn(server, root, key)
          })
        }
      } catch (err) {
        console.error(`[LSP] Failed to spawn ${server.id}:`, err)
        this.broken.add(key)
        // Schedule retry
        this.retryStrategy.scheduleRetry(key, async () => {
          this.emit('server-retrying', { serverId: server.id, root, attempt: this.retryStrategy.getRetryCount(key) })
          await this._retrySpawn(server, root, key)
        })
      } finally {
        this.spawning.delete(key)
      }
    }

    return clients
  }

  /**
   * Spawn a new LSP client
   */
  private async _spawnClient(
    server: (typeof SERVERS)[string],
    root: string,
    key: string
  ): Promise<LSPClient | null> {
    // Lazy initialize installer on first spawn
    this.ensureInstallerInitialized()

    console.log(`[LSP] Spawning ${server.id} for ${root}`)

    // Create progress callback that emits events
    const onProgress = (progress: { stage: string; package: string }) => {
      this.emit('server-installing', {
        serverId: server.id,
        progress: {
          stage: progress.stage as 'fetching' | 'downloading' | 'installing' | 'extracting' | 'complete',
          package: progress.package,
        },
      })
    }

    const childProcess = await server.spawn(root, { onProgress })
    if (!childProcess) {
      console.log(`[LSP] ${server.id} not available (binary not found)`)
      return null
    }

    const client = new LSPClient({
      serverID: server.id,
      root,
      process: childProcess,
      initialization: server.initialization as Record<string, unknown>,
    })

    // Forward diagnostics events
    client.on('diagnostics', (event: DiagnosticsEvent) => {
      this.emit('diagnostics', event)
    })

    client.on('close', () => {
      console.log(`[LSP] ${server.id} closed for ${root}`)
      this.clients.delete(key)
      this.emit('server-closed', { serverId: server.id, root })
    })

    client.on('error', () => {
      this.broken.add(key)
    })

    try {
      await client.initialize()
      this.clients.set(key, client)
      // Clear retry state on successful initialization
      this.retryStrategy.clearRetries(key)
      this.broken.delete(key)
      this.emit('server-started', { serverId: server.id, root })
      return client
    } catch (err) {
      console.error(`[LSP] ${server.id} initialization failed:`, err)
      this.broken.add(key)
      await client.shutdown()
      return null
    }
  }

  /**
   * Retry spawning a failed server
   */
  private async _retrySpawn(
    server: (typeof SERVERS)[string],
    root: string,
    key: string
  ): Promise<void> {
    try {
      const client = await this._spawnClient(server, root, key)
      if (client) {
        console.log(`[LSP] Retry successful for ${server.id}`)
      } else {
        // Retry failed, schedule another retry
        this.retryStrategy.scheduleRetry(key, async () => {
          this.emit('server-retrying', { serverId: server.id, root, attempt: this.retryStrategy.getRetryCount(key) })
          await this._retrySpawn(server, root, key)
        })
      }
    } catch (err) {
      console.error(`[LSP] Retry failed for ${server.id}:`, err)
      // Schedule another retry
      this.retryStrategy.scheduleRetry(key, async () => {
        this.emit('server-retrying', { serverId: server.id, root, attempt: this.retryStrategy.getRetryCount(key) })
        await this._retrySpawn(server, root, key)
      })
    }
  }

  /**
   * Notify LSP servers that a file was opened/touched
   */
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<number> {
    const clients = await this.getClientsForFile(filePath)

    for (const client of clients) {
      await client.openDocument(filePath)
    }

    if (waitForDiagnostics && clients.length > 0) {
      // Wait for diagnostics from all clients
      await Promise.all(clients.map((client) => client.waitForDiagnostics(filePath, 3000)))
    }

    return clients.length
  }

  /**
   * Notify LSP servers that a file changed
   */
  async fileChanged(filePath: string, content?: string): Promise<void> {
    const clients = await this.getClientsForFile(filePath)

    for (const client of clients) {
      if (content) {
        await client.changeDocument(filePath, content)
      } else {
        // Re-read the file if no content provided
        await client.openDocument(filePath)
      }
    }
  }

  /**
   * Notify LSP servers that a file was saved
   */
  async fileSaved(filePath: string): Promise<void> {
    const clients = await this.getClientsForFile(filePath)

    for (const client of clients) {
      await client.saveDocument(filePath)
    }
  }

  /**
   * Get all diagnostics across all servers
   */
  getAllDiagnostics(): Record<string, Diagnostic[]> {
    const result: Record<string, Diagnostic[]> = {}

    for (const client of this.clients.values()) {
      const diags = client.getDiagnostics()
      for (const [filePath, diagnostics] of Object.entries(diags)) {
        if (!result[filePath]) {
          result[filePath] = []
        }
        // Tag diagnostics with server ID
        result[filePath].push(
          ...diagnostics.map((d) => ({ ...d, source: d.source || client.serverID }))
        )
      }
    }

    return result
  }

  /**
   * Get diagnostics for a specific file
   */
  getDiagnosticsForFile(filePath: string): Diagnostic[] {
    const result: Diagnostic[] = []

    for (const client of this.clients.values()) {
      const diags = client.getDiagnostics()
      if (diags[filePath]) {
        result.push(...diags[filePath].map((d) => ({ ...d, source: d.source || client.serverID })))
      }
    }

    return result
  }

  /**
   * Get hover info at a position
   */
  async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
    const clients = await this.getClientsForFile(filePath)

    for (const client of clients) {
      try {
        const result = await client.hover(filePath, line, character)
        if (result) return result
      } catch {
        // Try next client
      }
    }

    return null
  }

  /**
   * Get completions at a position
   */
  async completion(filePath: string, line: number, character: number): Promise<CompletionItem[]> {
    const clients = await this.getClientsForFile(filePath)
    const results: CompletionItem[] = []

    for (const client of clients) {
      try {
        const result = await client.completion(filePath, line, character)
        if (result) {
          const items = Array.isArray(result) ? result : result.items || []
          results.push(...items)
        }
      } catch {
        // Continue with other clients
      }
    }

    return results
  }

  /**
   * Get definition at a position
   */
  async definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null> {
    const clients = await this.getClientsForFile(filePath)

    for (const client of clients) {
      try {
        const result = await client.definition(filePath, line, character)
        if (result) return result
      } catch {
        // Try next client
      }
    }

    return null
  }

  /**
   * Get references at a position
   */
  async references(filePath: string, line: number, character: number): Promise<Location[]> {
    const clients = await this.getClientsForFile(filePath)
    const results: Location[] = []

    for (const client of clients) {
      try {
        const result = await client.references(filePath, line, character)
        if (result) {
          results.push(...result)
        }
      } catch {
        // Continue with other clients
      }
    }

    return results
  }

  /**
   * Get status of all servers (for Settings UI)
   */
  async getStatus(): Promise<ServerStatus[]> {
    const servers = getAllServers()
    const status: ServerStatus[] = []

    for (const [id, server] of Object.entries(servers)) {
      const installed = await server.checkInstalled()
      const running = Array.from(this.clients.values())
        .filter((c) => c.serverID === id)
        .map((c) => ({
          root: c.root,
          openDocuments: c.openDocuments.size,
          diagnosticCount: Array.from(c.diagnostics.values()).reduce((sum, d) => sum + d.length, 0),
        }))

      status.push({
        id,
        name: server.name,
        extensions: server.extensions,
        enabled: this.isServerEnabled(id),
        installed,
        installable: server.installable,
        running: running.length > 0,
        instances: running,
      })
    }

    return status
  }

  /**
   * Shutdown all LSP servers and cancel pending retries
   */
  async shutdown(): Promise<void> {
    console.log('[LSP] Shutting down all servers...')

    // Cancel all pending retries
    this.retryStrategy.cancelAll()

    // Shutdown all active clients
    const promises: Promise<void>[] = []
    for (const client of this.clients.values()) {
      promises.push(client.shutdown())
    }
    await Promise.all(promises)

    this.clients.clear()
    this.broken.clear()
    this.spawning.clear()
    console.log('[LSP] All servers shut down')
  }
}

/**
 * Format a diagnostic for display
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const severityNames = ['', 'Error', 'Warning', 'Info', 'Hint']
  const severity = severityNames[diagnostic.severity || 0] || 'Unknown'
  const range = diagnostic.range
  const location = `${range.start.line + 1}:${range.start.character + 1}`
  const source = diagnostic.source || 'unknown'
  return `[${severity}] ${location} (${source}): ${diagnostic.message}`
}
