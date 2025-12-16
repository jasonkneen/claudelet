"use strict";
/**
 * LSP Server Definitions
 *
 * Each server definition includes:
 * - id: Unique identifier
 * - name: Human-readable name
 * - extensions: File extensions this server handles
 * - rootPatterns: Files/dirs that indicate project root
 * - spawn: Function to spawn the server process
 * - install: Function to install the server (if installable)
 * - checkInstalled: Function to check if installed
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVERS = void 0;
exports.findProjectRoot = findProjectRoot;
exports.getServersForExtension = getServersForExtension;
exports.getServer = getServer;
exports.getAllServers = getAllServers;
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const installer = __importStar(require("./installer"));
/**
 * Find the nearest directory containing one of the target files
 */
async function findProjectRoot(startPath, patterns, excludePatterns = []) {
    let current = path_1.default.dirname(startPath);
    const home = os_1.default.homedir();
    while (current !== home && current !== '/' && current !== path_1.default.parse(current).root) {
        // Check exclusions first
        for (const exclude of excludePatterns) {
            try {
                await promises_1.default.access(path_1.default.join(current, exclude));
                return null; // Found exclusion, skip this server
            }
            catch {
                // Not found, continue
            }
        }
        // Check for root patterns
        for (const pattern of patterns) {
            try {
                await promises_1.default.access(path_1.default.join(current, pattern));
                return current;
            }
            catch {
                // Not found, continue up
            }
        }
        current = path_1.default.dirname(current);
    }
    return null;
}
/**
 * Server Definitions
 */
exports.SERVERS = {
    typescript: {
        id: 'typescript',
        name: 'TypeScript',
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
        rootPatterns: ['package.json', 'tsconfig.json', 'jsconfig.json'],
        excludePatterns: ['deno.json', 'deno.jsonc'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/typescript-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            if (installer.which('typescript-language-server'))
                return true;
            return false;
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'typescript-language-server typescript',
                entryPoint: '.bin/typescript-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            // Check our cache first
            const cachedPath = installer.getNpmBinaryPath('.bin/typescript-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            // Try global install
            const globalBin = installer.which('typescript-language-server');
            if (globalBin) {
                return (0, child_process_1.spawn)(globalBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            // Auto-install if not found
            console.log('[LSP] Auto-installing typescript-language-server...');
            const installedPath = await this.install(options.onProgress);
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
        initialization: {
            preferences: {
                includeCompletionsForModuleExports: true,
                includeCompletionsWithInsertText: true,
            },
        },
    },
    eslint: {
        id: 'eslint',
        name: 'ESLint',
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'],
        rootPatterns: [
            '.eslintrc',
            '.eslintrc.js',
            '.eslintrc.json',
            '.eslintrc.yaml',
            'eslint.config.js',
            'eslint.config.mjs',
        ],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-eslint-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            if (installer.which('vscode-eslint-language-server'))
                return true;
            return false;
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'vscode-langservers-extracted',
                entryPoint: '.bin/vscode-eslint-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-eslint-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const globalBin = installer.which('vscode-eslint-language-server');
            if (globalBin) {
                return (0, child_process_1.spawn)(globalBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing vscode-eslint-language-server...');
            const installedPath = await this.install(options.onProgress);
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
        initialization: {
            settings: {
                validate: 'on',
                run: 'onType',
            },
        },
    },
    json: {
        id: 'json',
        name: 'JSON',
        extensions: ['.json', '.jsonc'],
        rootPatterns: ['package.json'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-json-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            if (installer.which('vscode-json-language-server'))
                return true;
            return false;
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'vscode-langservers-extracted',
                entryPoint: '.bin/vscode-json-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-json-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const globalBin = installer.which('vscode-json-language-server');
            if (globalBin) {
                return (0, child_process_1.spawn)(globalBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing vscode-json-language-server...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    css: {
        id: 'css',
        name: 'CSS/SCSS/Less',
        extensions: ['.css', '.scss', '.sass', '.less'],
        rootPatterns: ['package.json'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-css-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            if (installer.which('vscode-css-language-server'))
                return true;
            return false;
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'vscode-langservers-extracted',
                entryPoint: '.bin/vscode-css-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-css-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const globalBin = installer.which('vscode-css-language-server');
            if (globalBin) {
                return (0, child_process_1.spawn)(globalBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing vscode-css-language-server...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    html: {
        id: 'html',
        name: 'HTML',
        extensions: ['.html', '.htm'],
        rootPatterns: ['package.json', 'index.html'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-html-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            if (installer.which('vscode-html-language-server'))
                return true;
            return false;
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'vscode-langservers-extracted',
                entryPoint: '.bin/vscode-html-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/vscode-html-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const globalBin = installer.which('vscode-html-language-server');
            if (globalBin) {
                return (0, child_process_1.spawn)(globalBin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing vscode-html-language-server...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    python: {
        id: 'python',
        name: 'Python (Pyright)',
        extensions: ['.py', '.pyi'],
        rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/pyright-langserver');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            return !!installer.which('pyright-langserver') || !!installer.which('pyright');
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'pyright',
                entryPoint: '.bin/pyright-langserver',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/pyright-langserver');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const langserverBin = installer.which('pyright-langserver');
            if (langserverBin) {
                return (0, child_process_1.spawn)(langserverBin, ['--stdio'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            const pyrightBin = installer.which('pyright');
            if (pyrightBin) {
                return (0, child_process_1.spawn)(pyrightBin, ['--langserver', '--stdio'], {
                    cwd: root,
                    env,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            }
            console.log('[LSP] Auto-installing pyright...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    go: {
        id: 'go',
        name: 'Go (gopls)',
        extensions: ['.go'],
        rootPatterns: ['go.mod', 'go.sum'],
        installable: true,
        async checkInstalled() {
            if (await installer.isCached('gopls'))
                return true;
            return !!installer.which('gopls');
        },
        async install(onProgress) {
            return installer.installGoPackage({
                packagePath: 'golang.org/x/tools/gopls@latest',
                binaryName: 'gopls',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const env = { ...process.env, ...options.env };
            if (await installer.isCached('gopls')) {
                const cachedPath = installer.getCachedBinaryPath('gopls');
                return (0, child_process_1.spawn)(cachedPath, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            const bin = installer.which('gopls');
            if (bin) {
                return (0, child_process_1.spawn)(bin, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            // Try to auto-install if Go is available
            if (installer.which('go')) {
                console.log('[LSP] Auto-installing gopls...');
                const installedPath = await this.install();
                return (0, child_process_1.spawn)(installedPath, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            return null;
        },
    },
    rust: {
        id: 'rust',
        name: 'Rust (rust-analyzer)',
        extensions: ['.rs'],
        rootPatterns: ['Cargo.toml'],
        installable: true,
        async checkInstalled() {
            if (await installer.isCached('rust-analyzer'))
                return true;
            return !!installer.which('rust-analyzer');
        },
        async install(onProgress) {
            return installer.installFromGitHub({
                repo: 'rust-lang/rust-analyzer',
                binaryName: 'rust-analyzer',
                getAssetName: (_release, platform, arch) => {
                    const platformMap = {
                        darwin: 'apple-darwin',
                        linux: 'unknown-linux-gnu',
                        win32: 'pc-windows-msvc',
                    };
                    const archMap = {
                        x64: 'x86_64',
                        arm64: 'aarch64',
                    };
                    const p = platformMap[platform];
                    const a = archMap[arch];
                    if (!p || !a)
                        return null;
                    const ext = platform === 'win32' ? '.zip' : '.gz';
                    return `rust-analyzer-${a}-${p}${ext}`;
                },
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const env = { ...process.env, ...options.env };
            if (await installer.isCached('rust-analyzer')) {
                const cachedPath = installer.getCachedBinaryPath('rust-analyzer');
                return (0, child_process_1.spawn)(cachedPath, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            const bin = installer.which('rust-analyzer');
            if (bin) {
                return (0, child_process_1.spawn)(bin, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing rust-analyzer...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    yaml: {
        id: 'yaml',
        name: 'YAML',
        extensions: ['.yaml', '.yml'],
        rootPatterns: ['package.json'],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/yaml-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            return !!installer.which('yaml-language-server');
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: 'yaml-language-server',
                entryPoint: '.bin/yaml-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/yaml-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const bin = installer.which('yaml-language-server');
            if (bin) {
                return (0, child_process_1.spawn)(bin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing yaml-language-server...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
    tailwindcss: {
        id: 'tailwindcss',
        name: 'Tailwind CSS',
        extensions: ['.css', '.html', '.jsx', '.tsx', '.vue', '.svelte'],
        rootPatterns: [
            'tailwind.config.js',
            'tailwind.config.ts',
            'tailwind.config.cjs',
            'tailwind.config.mjs',
        ],
        installable: true,
        async checkInstalled() {
            const cachedPath = installer.getNpmBinaryPath('.bin/tailwindcss-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return true;
            }
            catch {
                // Not in cache
            }
            return !!installer.which('tailwindcss-language-server');
        },
        async install(onProgress) {
            return installer.installNpmPackage({
                packageName: '@tailwindcss/language-server',
                entryPoint: '.bin/tailwindcss-language-server',
            }, onProgress);
        },
        async spawn(root, options = {}) {
            const args = ['--stdio'];
            const env = { ...process.env, ...options.env };
            const cachedPath = installer.getNpmBinaryPath('.bin/tailwindcss-language-server');
            try {
                await promises_1.default.access(cachedPath);
                return (0, child_process_1.spawn)(cachedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch {
                // Not in cache
            }
            const bin = installer.which('tailwindcss-language-server');
            if (bin) {
                return (0, child_process_1.spawn)(bin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            console.log('[LSP] Auto-installing tailwindcss-language-server...');
            const installedPath = await this.install();
            return (0, child_process_1.spawn)(installedPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
        },
    },
};
/**
 * Get servers that handle a given file extension
 */
function getServersForExtension(ext) {
    return Object.values(exports.SERVERS).filter((server) => server.extensions.includes(ext.toLowerCase()));
}
/**
 * Get a server by ID
 */
function getServer(id) {
    return exports.SERVERS[id] || null;
}
/**
 * Get all server definitions
 */
function getAllServers() {
    return { ...exports.SERVERS };
}
//# sourceMappingURL=servers.js.map