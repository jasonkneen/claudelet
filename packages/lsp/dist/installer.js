"use strict";
/**
 * LSP Server Installer
 *
 * Handles automatic downloading and installation of LSP servers.
 * Three installation methods:
 * 1. NPM packages (via bundled bun or system npm)
 * 2. Go packages (via go install)
 * 3. GitHub releases (binary downloads)
 *
 * Binaries are cached in app data directory for persistence.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_VERSION = void 0;
exports.initInstaller = initInstaller;
exports.getCacheDir = getCacheDir;
exports.getBinDir = getBinDir;
exports.getNodeModulesDir = getNodeModulesDir;
exports.ensureCacheDir = ensureCacheDir;
exports.clearCache = clearCache;
exports.getCacheInfo = getCacheInfo;
exports.which = which;
exports.getBundledBunPath = getBundledBunPath;
exports.getNpmPath = getNpmPath;
exports.installNpmPackage = installNpmPackage;
exports.installGoPackage = installGoPackage;
exports.installFromGitHub = installFromGitHub;
exports.isCached = isCached;
exports.getCachedBinaryPath = getCachedBinaryPath;
exports.getNpmBinaryPath = getNpmBinaryPath;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const zlib_1 = __importDefault(require("zlib"));
// Cache version - bump to invalidate all cached LSP servers
exports.CACHE_VERSION = '1';
// Configurable app name (set via init or use default)
let appName = 'lsp-client';
let customCacheDir = null;
let bundledBunPath = null;
/**
 * Initialize the installer with options
 */
function initInstaller(options) {
    if (options.appName)
        appName = options.appName;
    if (options.cacheDir)
        customCacheDir = options.cacheDir;
    if (options.bunPath)
        bundledBunPath = options.bunPath;
}
/**
 * Get the LSP cache directory (XDG-compliant on Linux/macOS)
 */
function getCacheDir() {
    if (customCacheDir)
        return customCacheDir;
    if (process.platform === 'darwin') {
        return path_1.default.join(os_1.default.homedir(), 'Library', 'Application Support', appName, 'lsp');
    }
    else if (process.platform === 'win32') {
        return path_1.default.join(process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming'), appName, 'lsp');
    }
    else {
        // Linux - use XDG_DATA_HOME
        const xdgData = process.env.XDG_DATA_HOME || path_1.default.join(os_1.default.homedir(), '.local', 'share');
        return path_1.default.join(xdgData, appName, 'lsp');
    }
}
/**
 * Get the bin directory for installed LSP servers
 */
function getBinDir() {
    return path_1.default.join(getCacheDir(), 'bin');
}
/**
 * Get the node_modules directory for npm packages
 */
function getNodeModulesDir() {
    return path_1.default.join(getCacheDir(), 'node_modules');
}
/**
 * Ensure cache directories exist and validate cache version
 */
async function ensureCacheDir() {
    const cacheDir = getCacheDir();
    const versionFile = path_1.default.join(cacheDir, '.cache-version');
    try {
        await promises_1.default.mkdir(cacheDir, { recursive: true });
        await promises_1.default.mkdir(getBinDir(), { recursive: true });
        // Check cache version
        try {
            const version = await promises_1.default.readFile(versionFile, 'utf-8');
            if (version.trim() !== exports.CACHE_VERSION) {
                console.log('[LSP Installer] Cache version mismatch, clearing cache');
                await clearCache();
            }
        }
        catch {
            // Version file doesn't exist, write it
            await promises_1.default.writeFile(versionFile, exports.CACHE_VERSION);
        }
    }
    catch (err) {
        console.error('[LSP Installer] Failed to create cache directory:', err);
        throw err;
    }
}
/**
 * Clear the entire LSP cache
 */
async function clearCache() {
    const cacheDir = getCacheDir();
    try {
        const entries = await promises_1.default.readdir(cacheDir);
        for (const entry of entries) {
            if (entry === '.cache-version')
                continue;
            await promises_1.default.rm(path_1.default.join(cacheDir, entry), { recursive: true, force: true });
        }
        await promises_1.default.mkdir(getBinDir(), { recursive: true });
        await promises_1.default.writeFile(path_1.default.join(cacheDir, '.cache-version'), exports.CACHE_VERSION);
        console.log('[LSP Installer] Cache cleared');
    }
    catch (err) {
        console.error('[LSP Installer] Failed to clear cache:', err);
    }
}
/**
 * Get cache info for display
 */
async function getCacheInfo() {
    const cacheDir = getCacheDir();
    let size = 0;
    const packages = [];
    async function getSize(dir) {
        let total = 0;
        try {
            const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path_1.default.join(dir, entry.name);
                if (entry.isDirectory()) {
                    total += await getSize(fullPath);
                }
                else {
                    const stat = await promises_1.default.stat(fullPath);
                    total += stat.size;
                }
            }
        }
        catch {
            // Ignore errors
        }
        return total;
    }
    try {
        size = await getSize(cacheDir);
        // List installed packages
        const binDir = getBinDir();
        try {
            const binEntries = await promises_1.default.readdir(binDir);
            packages.push(...binEntries.filter((e) => !e.startsWith('.')));
        }
        catch {
            // No bin dir yet
        }
        const nodeModulesDir = getNodeModulesDir();
        try {
            const nodeModulesBin = path_1.default.join(nodeModulesDir, '.bin');
            const binEntries = await promises_1.default.readdir(nodeModulesBin);
            packages.push(...binEntries.filter((e) => !e.startsWith('.')));
        }
        catch {
            // No node_modules yet
        }
    }
    catch {
        // Cache doesn't exist yet
    }
    return {
        path: cacheDir,
        size,
        version: exports.CACHE_VERSION,
        packages: [...new Set(packages)], // Deduplicate
    };
}
/**
 * Check if a binary exists in PATH using execFileSync (safe, no shell injection)
 */
function which(binary) {
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const result = (0, child_process_1.execFileSync)(cmd, [binary], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        // 'where' on Windows can return multiple lines, take the first
        return result.split('\n')[0].trim() || null;
    }
    catch {
        return null;
    }
}
/**
 * Get path to bundled bun binary
 */
function getBundledBunPath() {
    // Use configured bundled path if set
    if (bundledBunPath && fs_1.default.existsSync(bundledBunPath)) {
        return bundledBunPath;
    }
    // In development, use system bun
    if (process.env.NODE_ENV === 'development') {
        return which('bun');
    }
    // Try to find bun in resources (Electron app)
    const resourcesPath = process.resourcesPath ||
        path_1.default.join(__dirname, '..', '..', 'resources');
    const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunPath = path_1.default.join(resourcesPath, 'bin', bunName);
    if (fs_1.default.existsSync(bunPath)) {
        return bunPath;
    }
    // Fallback to system bun
    return which('bun');
}
/**
 * Get path to system npm
 */
function getNpmPath() {
    return which('npm');
}
/**
 * Install an npm package
 */
async function installNpmPackage(options, onProgress) {
    const { packageName, entryPoint } = options;
    await ensureCacheDir();
    const nodeModulesDir = getNodeModulesDir();
    const binPath = path_1.default.join(nodeModulesDir, entryPoint);
    // Check if already installed
    try {
        await promises_1.default.access(binPath);
        console.log(`[LSP Installer] ${packageName} already installed at ${binPath}`);
        return binPath;
    }
    catch {
        // Not installed, proceed
    }
    if (onProgress)
        onProgress({ stage: 'installing', package: packageName });
    console.log(`[LSP Installer] Installing npm package: ${packageName}`);
    // Try bun first (faster), then npm
    const bunPath = getBundledBunPath();
    const npmPath = getNpmPath();
    if (!bunPath && !npmPath) {
        throw new Error('Neither bun nor npm found. Cannot install LSP server.');
    }
    await promises_1.default.mkdir(nodeModulesDir, { recursive: true });
    // Create a minimal package.json if it doesn't exist
    const packageJsonPath = path_1.default.join(getCacheDir(), 'package.json');
    try {
        await promises_1.default.access(packageJsonPath);
    }
    catch {
        await promises_1.default.writeFile(packageJsonPath, JSON.stringify({ name: `${appName}-lsp`, private: true }, null, 2));
    }
    return new Promise((resolve, reject) => {
        const cwd = getCacheDir();
        let proc;
        // Split package names if multiple are provided (e.g., "typescript-language-server typescript")
        const packages = packageName.split(/\s+/).filter(Boolean);
        if (bunPath) {
            console.log(`[LSP Installer] Using bun: ${bunPath}`);
            console.log(`[LSP Installer] Installing packages:`, packages);
            proc = (0, child_process_1.spawn)(bunPath, ['add', ...packages], {
                cwd,
                env: { ...process.env, BUN_INSTALL_CACHE_DIR: path_1.default.join(cwd, '.bun-cache') },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        else {
            console.log(`[LSP Installer] Using npm: ${npmPath}`);
            console.log(`[LSP Installer] Installing packages:`, packages);
            proc = (0, child_process_1.spawn)(npmPath, ['install', ...packages, '--save'], {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        let stderr = '';
        let progressReported = false;
        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
            // Report 50% progress when we see activity
            if (!progressReported && onProgress) {
                onProgress({ stage: 'downloading', package: packageName });
                progressReported = true;
            }
        });
        proc.stdout?.on('data', () => {
            // Report progress when stdout activity detected
            if (!progressReported && onProgress) {
                onProgress({ stage: 'downloading', package: packageName });
                progressReported = true;
            }
        });
        proc.on('close', async (code) => {
            if (code !== 0) {
                console.error(`[LSP Installer] Install failed:`, stderr);
                reject(new Error(`Failed to install ${packageName}: ${stderr}`));
                return;
            }
            // Report extracting stage before verifying
            if (onProgress)
                onProgress({ stage: 'extracting', package: packageName });
            // Verify the binary exists
            try {
                await promises_1.default.access(binPath);
                console.log(`[LSP Installer] Successfully installed ${packageName}`);
                if (onProgress)
                    onProgress({ stage: 'complete', package: packageName });
                resolve(binPath);
            }
            catch {
                reject(new Error(`Installed ${packageName} but binary not found at ${entryPoint}`));
            }
        });
        proc.on('error', (err) => {
            reject(new Error(`Failed to spawn package manager: ${err.message}`));
        });
    });
}
/**
 * Install a Go package
 */
async function installGoPackage(options, onProgress) {
    const { packagePath, binaryName } = options;
    await ensureCacheDir();
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path_1.default.join(getBinDir(), binaryName + ext);
    // Check if already installed
    try {
        await promises_1.default.access(binPath);
        console.log(`[LSP Installer] ${binaryName} already installed at ${binPath}`);
        return binPath;
    }
    catch {
        // Not installed, proceed
    }
    // Check for Go
    const goPath = which('go');
    if (!goPath) {
        throw new Error('Go is required to install ' + binaryName);
    }
    if (onProgress)
        onProgress({ stage: 'installing', package: binaryName });
    console.log(`[LSP Installer] Installing Go package: ${packagePath}`);
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(goPath, ['install', packagePath], {
            env: { ...process.env, GOBIN: getBinDir() },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        let progressReported = false;
        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
            // Report progress when we see activity
            if (!progressReported && onProgress) {
                onProgress({ stage: 'downloading', package: binaryName });
                progressReported = true;
            }
        });
        proc.stdout?.on('data', () => {
            // Report progress when stdout activity detected
            if (!progressReported && onProgress) {
                onProgress({ stage: 'downloading', package: binaryName });
                progressReported = true;
            }
        });
        proc.on('close', async (code) => {
            if (code !== 0) {
                console.error(`[LSP Installer] Go install failed:`, stderr);
                reject(new Error(`Failed to install ${binaryName}: ${stderr}`));
                return;
            }
            // Report extracting stage
            if (onProgress)
                onProgress({ stage: 'extracting', package: binaryName });
            // Verify the binary exists
            try {
                await promises_1.default.access(binPath);
                console.log(`[LSP Installer] Successfully installed ${binaryName}`);
                if (onProgress)
                    onProgress({ stage: 'complete', package: binaryName });
                resolve(binPath);
            }
            catch {
                reject(new Error(`Installed ${binaryName} but binary not found`));
            }
        });
        proc.on('error', (err) => {
            reject(new Error(`Failed to run go install: ${err.message}`));
        });
    });
}
/**
 * Download and install from GitHub releases
 */
async function installFromGitHub(options, onProgress) {
    const { repo, binaryName, getAssetName } = options;
    await ensureCacheDir();
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path_1.default.join(getBinDir(), binaryName + ext);
    // Check if already installed
    try {
        await promises_1.default.access(binPath);
        console.log(`[LSP Installer] ${binaryName} already installed at ${binPath}`);
        return binPath;
    }
    catch {
        // Not installed, proceed
    }
    if (onProgress)
        onProgress({ stage: 'fetching', package: binaryName });
    console.log(`[LSP Installer] Fetching latest release from ${repo}`);
    // Fetch latest release info
    const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const releaseRes = await fetch(releaseUrl, {
        headers: { 'User-Agent': `${appName}-LSP-Installer` },
    });
    if (!releaseRes.ok) {
        throw new Error(`Failed to fetch release info: ${releaseRes.status}`);
    }
    const release = (await releaseRes.json());
    const platform = process.platform;
    const arch = process.arch;
    // Get the appropriate asset name
    const assetName = getAssetName(release, platform, arch);
    if (!assetName) {
        throw new Error(`No compatible release found for ${platform}-${arch}`);
    }
    // Find the asset
    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) {
        throw new Error(`Asset ${assetName} not found in release`);
    }
    if (onProgress)
        onProgress({ stage: 'downloading', package: binaryName, size: asset.size });
    console.log(`[LSP Installer] Downloading ${assetName} (${(asset.size / 1024 / 1024).toFixed(2)} MB)`);
    // Download the asset
    const downloadRes = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': `${appName}-LSP-Installer` },
    });
    if (!downloadRes.ok) {
        throw new Error(`Failed to download: ${downloadRes.status}`);
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    const archivePath = path_1.default.join(getBinDir(), assetName);
    await promises_1.default.writeFile(archivePath, buffer);
    if (onProgress)
        onProgress({ stage: 'extracting', package: binaryName });
    console.log(`[LSP Installer] Extracting ${assetName}`);
    // Extract based on file type
    try {
        if (assetName.endsWith('.zip')) {
            await extractZip(archivePath, getBinDir(), binaryName);
        }
        else if (assetName.endsWith('.tar.gz') || assetName.endsWith('.tar.xz')) {
            await extractTar(archivePath, getBinDir(), binaryName);
        }
        else if (assetName.endsWith('.gz') && !assetName.endsWith('.tar.gz')) {
            // Single gzipped file
            await extractGz(archivePath, binPath);
        }
        else {
            // Assume it's the binary itself
            await promises_1.default.rename(archivePath, binPath);
        }
    }
    finally {
        // Clean up archive
        try {
            await promises_1.default.unlink(archivePath);
        }
        catch {
            // Ignore
        }
    }
    // Make executable on Unix
    if (process.platform !== 'win32') {
        await promises_1.default.chmod(binPath, 0o755);
    }
    // Verify the binary exists
    try {
        await promises_1.default.access(binPath);
        console.log(`[LSP Installer] Successfully installed ${binaryName}`);
        if (onProgress)
            onProgress({ stage: 'complete', package: binaryName });
        return binPath;
    }
    catch {
        throw new Error(`Extracted ${binaryName} but binary not found`);
    }
}
/**
 * Extract a zip archive
 */
async function extractZip(archivePath, destDir, binaryName) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const targetBin = binaryName + ext;
    // Use unzip on Unix, PowerShell on Windows
    if (process.platform === 'win32') {
        (0, child_process_1.execFileSync)('powershell', [
            '-Command',
            `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`,
        ]);
    }
    else {
        (0, child_process_1.execFileSync)('unzip', ['-o', '-q', archivePath, '-d', destDir]);
    }
    // Find the binary in extracted files
    await findAndMoveBinary(destDir, targetBin);
}
/**
 * Extract a tar.gz or tar.xz archive
 */
async function extractTar(archivePath, destDir, binaryName) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const targetBin = binaryName + ext;
    (0, child_process_1.execFileSync)('tar', ['-xf', archivePath, '-C', destDir]);
    // Find the binary in extracted files
    await findAndMoveBinary(destDir, targetBin);
}
/**
 * Extract a gzipped file
 */
async function extractGz(archivePath, destPath) {
    const compressed = await promises_1.default.readFile(archivePath);
    const decompressed = zlib_1.default.gunzipSync(compressed);
    await promises_1.default.writeFile(destPath, decompressed);
}
/**
 * Find a binary in extracted directory and move it to bin root
 */
async function findAndMoveBinary(dir, binaryName) {
    const binPath = path_1.default.join(dir, binaryName);
    // Check if already at root
    try {
        await promises_1.default.access(binPath);
        return;
    }
    catch {
        // Not at root, search subdirectories
    }
    // Search recursively (max 3 levels deep)
    async function searchDir(searchPath, depth = 0) {
        if (depth > 3)
            return null;
        const entries = await promises_1.default.readdir(searchPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(searchPath, entry.name);
            if (entry.isFile() && entry.name === binaryName) {
                return fullPath;
            }
            if (entry.isDirectory()) {
                const found = await searchDir(fullPath, depth + 1);
                if (found)
                    return found;
            }
        }
        return null;
    }
    const found = await searchDir(dir);
    if (found && found !== binPath) {
        await promises_1.default.rename(found, binPath);
    }
}
/**
 * Check if a binary exists in our cache
 */
async function isCached(binaryName) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path_1.default.join(getBinDir(), binaryName + ext);
    try {
        await promises_1.default.access(binPath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get the path to a cached binary
 */
function getCachedBinaryPath(binaryName) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path_1.default.join(getBinDir(), binaryName + ext);
}
/**
 * Get path to an npm package binary
 */
function getNpmBinaryPath(entryPoint) {
    return path_1.default.join(getNodeModulesDir(), entryPoint);
}
//# sourceMappingURL=installer.js.map