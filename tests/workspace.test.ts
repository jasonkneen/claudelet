/**
 * Workspace structure and dependency resolution tests
 * Verifies that the monorepo workspace is properly configured
 */

import { readFileSync } from 'fs'
import { join } from 'path'

describe('Monorepo Workspace Configuration', () => {
  const rootDir = process.cwd()

  test('root package.json has workspaces configured', () => {
    const rootPackageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    )
    expect(rootPackageJson.workspaces).toBeDefined()
    expect(Array.isArray(rootPackageJson.workspaces)).toBe(true)
    expect(rootPackageJson.workspaces).toContain('packages/*')
  })

  test('no file:// dependencies in root package.json', () => {
    const rootPackageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    )
    const depsString = JSON.stringify(rootPackageJson.dependencies || {})
    expect(depsString).not.toMatch(/file:\/\//)
  })

  test('workspace dependencies use workspace: protocol', () => {
    const rootPackageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    )
    const workspaceDeps = [
      '@ai-cluso/fast-apply',
      '@ai-cluso/lsp-client',
      '@ai-cluso/mgrep-local',
      'claude-agent-loop'
    ]

    workspaceDeps.forEach(dep => {
      const depVersion = rootPackageJson.dependencies?.[dep]
      expect(depVersion).toBe('workspace:*')
    })
  })

  test('all required packages exist in workspace', () => {
    const requiredPackages = [
      'anthropic-oauth',
      'claude-agent-loop',
      'fast-apply',
      'lsp',
      'mgrep-local'
    ]

    requiredPackages.forEach(pkg => {
      const packageJsonPath = join(rootDir, 'packages', pkg, 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(packageJson.name).toBeDefined()
      expect(packageJson.version).toBeDefined()
    })
  })

  test('package names match expected scopes', () => {
    const packageMapping = {
      'anthropic-oauth': '@anthropic-ai/anthropic-oauth',
      'claude-agent-loop': 'claude-agent-loop',
      'fast-apply': '@ai-cluso/fast-apply',
      'lsp': '@ai-cluso/lsp-client',
      'mgrep-local': '@ai-cluso/mgrep-local'
    }

    Object.entries(packageMapping).forEach(([dir, expectedName]) => {
      const packageJsonPath = join(rootDir, 'packages', dir, 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(packageJson.name).toBe(expectedName)
    })
  })

  test('no relative file paths in package.json', () => {
    const rootPackageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    )
    const depsString = JSON.stringify(rootPackageJson.dependencies || {})
    expect(depsString).not.toMatch(/file:\.\.\//)
    expect(depsString).not.toMatch(/^/)
  })
})
