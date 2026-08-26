/**
 * Eval-only LLM provider seed helpers.
 *
 * Default remains MiniMax-M3 for formal scores (plan 019).
 * Optional OpenAI-compatible path (Grok via CLIProxyAPI, etc.):
 *
 *   PROVIDER=custom_openai \
 *   BASE_URL=http://127.0.0.1:8317/v1 \
 *   MODEL=grok-4.5 \
 *   OPENAI_API_KEY=...   # or GROK_EVAL_API_KEY / EVAL_API_KEY
 *
 * Never hardcode keys. client.env is loaded as a fallback only.
 */
import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveEvalProxyArgs(env = process.env) {
  const rawProxy =
    env.EVAL_PROXY_URL ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    '';
  if (!rawProxy) return [];

  let proxy;
  try {
    proxy = new URL(rawProxy);
  } catch {
    throw new Error('eval proxy URL is invalid');
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(proxy.protocol) || !proxy.hostname) {
    throw new Error('eval proxy URL uses an unsupported protocol');
  }
  if (proxy.username || proxy.password)
    throw new Error('eval proxy credentials must not be passed on the command line');
  return [`--proxy-server=${proxy.protocol}//${proxy.host}`];
}

export function discoverChromeForTesting(homeDir = os.homedir(), platform = process.platform) {
  const roots = [path.join(homeDir, '.cache/puppeteer/chrome'), path.join(homeDir, 'Library/Caches/puppeteer/chrome')];
  const matches = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const versionRoot = path.join(root, entry.name);
        for (const bundle of readdirSync(versionRoot, { withFileTypes: true })) {
          if (!bundle.isDirectory()) continue;
          const executable =
            platform === 'darwin'
              ? path.join(
                  versionRoot,
                  bundle.name,
                  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                )
              : platform === 'win32'
                ? path.join(versionRoot, bundle.name, 'chrome.exe')
                : path.join(versionRoot, bundle.name, 'chrome');
          if (existsSync(executable)) matches.push(executable);
        }
      }
    } catch {
      // Cache discovery is optional; callers retain explicit candidates.
    }
  }
  return matches.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1) || '';
}

function expectedBrowserProduct(executable, platform = process.platform) {
  const normalized = String(executable || '').replaceAll('\\', '/');
  if (platform === 'darwin') {
    if (/\/Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing$/.test(normalized)) {
      return 'Google Chrome for Testing';
    }
    if (/\/Chromium\.app\/Contents\/MacOS\/Chromium$/.test(normalized)) return 'Chromium';
    return '';
  }
  if (/\/chrome-(?:linux|win)[^/]*\/(?:chrome|chrome\.exe)$/i.test(normalized)) {
    return 'Google Chrome for Testing';
  }
  if (/\/(?:chromium|chromium-browser)(?:\.exe)?$/i.test(normalized)) return 'Chromium';
  return '';
}

function binaryFormat(executable, platform = process.platform) {
  try {
    const descriptor = openSync(executable, 'r');
    const header = Buffer.alloc(4);
    readSync(descriptor, header, 0, header.length, 0);
    closeSync(descriptor);
    const hex = header.toString('hex');
    if (platform === 'darwin' && ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex)) {
      return 'mach-o';
    }
    if (platform === 'linux' && hex === '7f454c46') return 'elf';
    if (platform === 'win32' && hex.startsWith('4d5a')) return 'pe';
  } catch {
    // Invalid or unreadable executables fail the product probe below.
  }
  return '';
}

function readMacBundleField(executable, field) {
  const appRoot = String(executable).replace(/\/Contents\/MacOS\/[^/]+$/, '');
  const plist = path.join(appRoot, 'Contents/Info.plist');
  const result = spawnSync('/usr/bin/plutil', ['-extract', field, 'raw', '-o', '-', plist], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function probeBrowserExecutable(executable, platform = process.platform) {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) return null;
  const version = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const match = /^(Google Chrome for Testing|Chromium) (\d+\.\d+\.\d+\.\d+)$/.exec(version);
  if (!match) return null;
  return {
    product: match[1],
    version: match[2],
    binary_format: binaryFormat(executable, platform),
    bundle_id: platform === 'darwin' ? readMacBundleField(executable, 'CFBundleIdentifier') : 'not_applicable',
    bundle_version:
      platform === 'darwin' ? readMacBundleField(executable, 'CFBundleShortVersionString') : 'not_applicable',
  };
}

export function browserProbePass(executable, observed, platform = process.platform) {
  const expected = expectedBrowserProduct(executable, platform);
  if (!expected || observed?.product !== expected || !/^\d+\.\d+\.\d+\.\d+$/.test(observed?.version || '')) {
    return false;
  }
  if (platform === 'darwin') {
    const expectedBundleId =
      expected === 'Google Chrome for Testing' ? 'com.google.chrome.for.testing' : 'org.chromium.Chromium';
    return (
      observed.binary_format === 'mach-o' &&
      observed.bundle_id === expectedBundleId &&
      observed.bundle_version === observed.version
    );
  }
  if (platform === 'linux') return observed.binary_format === 'elf';
  if (platform === 'win32') return observed.binary_format === 'pe';
  return false;
}

function supportsUnpackedExtensionLaunch(executable, platform = process.platform) {
  return browserProbePass(executable, probeBrowserExecutable(executable, platform), platform);
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveChromeForEval(explicitPath = process.env.CHROME_PATH || '', homeDir = os.homedir()) {
  if (explicitPath) {
    if (!isExecutable(explicitPath)) throw new Error(`CHROME_PATH is not executable or missing: ${explicitPath}`);
    if (!supportsUnpackedExtensionLaunch(explicitPath)) {
      throw new Error(`CHROME_PATH must be Chrome for Testing or Chromium, not stable Chrome: ${explicitPath}`);
    }
    return explicitPath;
  }
  const candidates = [
    discoverChromeForTesting(homeDir),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const resolved = candidates.find(candidate => isExecutable(candidate) && supportsUnpackedExtensionLaunch(candidate));
  if (!resolved) {
    throw new Error(
      'Chrome for Testing or Chromium is required; set CHROME_PATH to an unpacked-extension capable build',
    );
  }
  return resolved;
}

export function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    let text = line.trim();
    if (!text || text.startsWith('#')) continue;
    if (text.startsWith('export ')) text = text.slice(7).trim();
    const index = text.indexOf('=');
    if (index <= 0) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveModel() {
  return process.env.MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M3';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = (value || '').trim();
    if (text) return text;
  }
  return '';
}

function readKeyFromFiles(keys, files) {
  for (const file of files) {
    const env = parseEnvFile(file);
    for (const key of keys) {
      const value = (env[key] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

const envFileCandidates = [
  path.join(os.homedir(), '.cli-proxy-api/client.env'),
  path.join(os.homedir(), '.config/ai-providers/env.local'),
  path.join(os.homedir(), '.config/ai-providers/.env'),
  path.resolve(__dirname, '../../../../.env.local'),
  path.resolve(__dirname, '../../../.env.local'),
];

export function resolveOpenAICompatApiKey() {
  const fromEnv = firstNonEmpty(process.env.EVAL_API_KEY, process.env.GROK_EVAL_API_KEY, process.env.OPENAI_API_KEY);
  if (fromEnv) return fromEnv;
  return readKeyFromFiles(['EVAL_API_KEY', 'GROK_EVAL_API_KEY', 'OPENAI_API_KEY'], envFileCandidates);
}

export function resolveMiniMaxApiKey() {
  const fromEnv = firstNonEmpty(process.env.MINIMAX_API_KEY, process.env.MINIMAX_TOKEN_PLAN_KEY);
  if (fromEnv) return fromEnv;
  const fromFiles = readKeyFromFiles(
    ['MINIMAX_API_KEY', 'MINIMAX_TOKEN_PLAN_KEY'],
    envFileCandidates.filter(file => !file.includes('cli-proxy-api')),
  );
  if (fromFiles) return fromFiles;
  const secretsPath = path.resolve(__dirname, '../../src/personal/secrets.local.ts');
  if (existsSync(secretsPath)) {
    const text = readFileSync(secretsPath, 'utf8');
    const match = text.match(/PERSONAL_MINIMAX_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return match[1];
  }
  return '';
}

/**
 * Resolve which provider the eval e2e scripts should inject into chrome.storage.
 * Requires explicit PROVIDER / EVAL_PROVIDER for non-MiniMax paths so formal
 * MiniMax scores never switch by accident.
 */
export function resolveEvalProvider() {
  const provider = firstNonEmpty(process.env.EVAL_PROVIDER, process.env.PROVIDER).toLowerCase();
  const model = resolveModel();

  if (provider === 'custom_openai' || provider === 'openai' || provider === 'grok_proxy') {
    const baseUrl = firstNonEmpty(
      process.env.EVAL_BASE_URL,
      process.env.BASE_URL,
      process.env.OPENAI_BASE_URL,
      'http://127.0.0.1:8317/v1',
    ).replace(/\/+$/, '');
    return {
      kind: 'openai_compat',
      providerId: 'eval_custom',
      name: 'Eval OpenAI-compatible',
      type: 'custom_openai',
      apiKey: resolveOpenAICompatApiKey(),
      baseUrl,
      model,
    };
  }

  return {
    kind: 'minimax',
    providerId: 'minimax',
    name: 'MiniMax',
    type: 'custom_openai',
    apiKey: resolveMiniMaxApiKey(),
    baseUrl: firstNonEmpty(process.env.MINIMAX_BASE_URL, 'https://api.minimaxi.com/v1').replace(/\/+$/, ''),
    model: firstNonEmpty(process.env.MINIMAX_MODEL, process.env.MODEL, 'MiniMax-M3'),
  };
}

export function resolveEvalIdentity() {
  const config = resolveEvalProvider();
  return {
    provider: config.kind,
    model: config.model,
    provider_id: config.providerId,
    base_url: config.baseUrl,
    feature_flags: resolveEvalFeatureFlags(),
  };
}

export function buildEvalStoragePayload(cfg) {
  if (!cfg.apiKey) {
    if (cfg.kind === 'minimax') {
      throw new Error('MINIMAX_API_KEY is required (env or ~/.config/ai-providers/env.local)');
    }
    throw new Error(
      'OPENAI_API_KEY / GROK_EVAL_API_KEY / EVAL_API_KEY required for custom eval provider (e.g. source ~/.cli-proxy-api/client.env)',
    );
  }
  return {
    'llm-api-keys': {
      providers: {
        [cfg.providerId]: {
          name: cfg.name,
          type: cfg.type,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          modelNames: [cfg.model],
          createdAt: Date.now(),
        },
      },
    },
    'agent-models': {
      agents: {
        planner: {
          provider: cfg.providerId,
          modelName: cfg.model,
          parameters: { temperature: 0.1, topP: 0.1 },
        },
        navigator: {
          provider: cfg.providerId,
          modelName: cfg.model,
          parameters: { temperature: 0.1, topP: 0.1 },
        },
      },
    },
    'general-settings': {
      maxSteps: 100,
      maxActionsPerStep: 5,
      maxFailures: 3,
      useVision: false,
      useVisionForPlanner: false,
      planningInterval: 3,
      displayHighlights: false,
      minWaitPageLoad: 250,
      agentCoreBackend: 'control',
    },
    // Local fixture servers live on 127.0.0.1; the URL firewall denies private
    // hosts unless they are explicitly allowlisted. The eval harness
    // authorizes its own fixture origin here (product rule: explicit
    // allowlist entry wins; cloud metadata stays blocked).
    'firewall-settings': {
      enabled: true,
      allowList: ['127.0.0.1'],
      denyList: [],
    },
  };
}

/**
 * Optional eval feature-flag overlay (product/022 release campaign).
 * EVAL_FEATURE_FLAGS_JSON='{"enableObservationDiff":true,"enableBrowserKernelV1":false}'
 * or EVAL_ENABLE_OBSERVATION_DIFF=1 etc.
 */
export function resolveEvalFeatureFlags() {
  const base = {
    enableAgentStatusBar: true,
    enableDeterministicFormFill: true,
    enableDeterministicBilibili: true,
    enableDeterministicYouTube: true,
    enableRetryRecovery: true,
    enableContextCompression: true,
    enableBrowserKernelV1: true,
    enableObservationDiff: false,
    enableSkillRuntime: true,
    enableLearnedSkills: false,
    enableArtifactVerification: true,
  };
  if (process.env.EVAL_FEATURE_FLAGS_JSON) {
    try {
      Object.assign(base, JSON.parse(process.env.EVAL_FEATURE_FLAGS_JSON));
    } catch {
      // ignore bad json
    }
  }
  const map = {
    EVAL_ENABLE_BROWSER_KERNEL_V1: 'enableBrowserKernelV1',
    EVAL_ENABLE_OBSERVATION_DIFF: 'enableObservationDiff',
    EVAL_ENABLE_SKILL_RUNTIME: 'enableSkillRuntime',
    EVAL_ENABLE_LEARNED_SKILLS: 'enableLearnedSkills',
    EVAL_ENABLE_ARTIFACT_VERIFICATION: 'enableArtifactVerification',
  };
  for (const [envKey, flag] of Object.entries(map)) {
    const v = process.env[envKey];
    if (v === '1' || v === 'true') base[flag] = true;
    if (v === '0' || v === 'false') base[flag] = false;
  }
  return base;
}

/** Seed planner/navigator LLM settings into extension storage (eval only). */
export async function seedEvalLlm(panel) {
  const cfg = resolveEvalProvider();
  const payload = buildEvalStoragePayload(cfg);
  payload['eval-settings'] = {
    traceEnabled: true,
    featureFlags: resolveEvalFeatureFlags(),
  };
  console.log(
    `[eval-provider] seed kind=${cfg.kind} providerId=${cfg.providerId} model=${cfg.model} baseUrl=${cfg.baseUrl} keyLen=${cfg.apiKey.length} flags=${JSON.stringify(payload['eval-settings'].featureFlags)}`,
  );
  await panel.evaluate(async storagePayload => chrome.storage.local.set(storagePayload), payload);
  const observed = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['llm-api-keys', 'agent-models', 'eval-settings']);
    const planner = stored['agent-models']?.agents?.planner;
    const navigator = stored['agent-models']?.agents?.navigator;
    const provider = stored['llm-api-keys']?.providers?.[planner?.provider];
    return {
      planner_provider_id: planner?.provider || '',
      planner_model: planner?.modelName || '',
      navigator_provider_id: navigator?.provider || '',
      navigator_model: navigator?.modelName || '',
      provider_base_url: provider?.baseUrl || '',
      provider_type: provider?.type || '',
      feature_flags: stored['eval-settings']?.featureFlags || null,
    };
  });
  const errors = validateEvalSeedReadback(cfg, observed, payload['eval-settings'].featureFlags);
  if (errors.length > 0) throw new Error(`eval provider storage readback mismatch: ${errors.join(', ')}`);
  cfg.observedIdentity = observed;
  return cfg;
}

export function validateEvalSeedReadback(cfg, observed, expectedFeatureFlags = resolveEvalFeatureFlags()) {
  const errors = [];
  if (observed?.planner_provider_id !== cfg.providerId) errors.push('planner provider');
  if (observed?.navigator_provider_id !== cfg.providerId) errors.push('navigator provider');
  if (observed?.planner_model !== cfg.model) errors.push('planner model');
  if (observed?.navigator_model !== cfg.model) errors.push('navigator model');
  if (String(observed?.provider_base_url || '').replace(/\/+$/, '') !== cfg.baseUrl) errors.push('provider base URL');
  if (observed?.provider_type !== cfg.type) errors.push('provider type');
  const observedFlags = Object.entries(observed?.feature_flags || {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedFlags = Object.entries(expectedFeatureFlags || {}).sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(observedFlags) !== JSON.stringify(expectedFlags)) errors.push('feature flags');
  return errors;
}

function runtimeCriticalFiles(extensionPath) {
  const manifest = JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const files = new Set(['manifest.json']);
  const add = value => {
    if (!value) return;
    const normalized = path.posix.normalize(String(value).replace(/^\.\//, ''));
    if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`runtime entry escapes extension: ${value}`);
    }
    files.add(normalized);
  };
  add(manifest?.background?.service_worker);
  add(manifest?.side_panel?.default_path);
  add(manifest?.options_page);
  add(manifest?.options_ui?.page);
  add(manifest?.action?.default_popup);
  for (const entry of manifest?.content_scripts || []) {
    for (const file of [...(entry?.js || []), ...(entry?.css || [])]) add(file);
  }
  const visitedHtml = new Set();
  for (;;) {
    const htmlPath = [...files].find(file => file.endsWith('.html') && !visitedHtml.has(file));
    if (!htmlPath) break;
    visitedHtml.add(htmlPath);
    const html = readFileSync(path.join(extensionPath, htmlPath), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      add(path.posix.join(path.posix.dirname(htmlPath), match[1]));
    }
  }
  return [...files].sort();
}

export async function attestRuntimeExtension(panel, extensionPath) {
  const files = runtimeCriticalFiles(extensionPath);
  const local = files.map(file => ({
    path: file,
    sha256: createHash('sha256')
      .update(readFileSync(path.join(extensionPath, file)))
      .digest('hex'),
  }));
  const runtime = await panel.evaluate(async requestedFiles => {
    const records = [];
    for (const file of requestedFiles) {
      const response = await fetch(chrome.runtime.getURL(file), { cache: 'no-store' });
      if (!response.ok) throw new Error(`runtime extension file unavailable: ${file}`);
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      records.push({
        path: file,
        sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      });
    }
    return {
      extension_id: chrome.runtime.id,
      extension_version: chrome.runtime.getManifest().version,
      files: records,
    };
  }, files);
  if (JSON.stringify(runtime.files) !== JSON.stringify(local)) {
    throw new Error('loaded extension bundle differs from local dist');
  }
  return {
    ...runtime,
    bundle_hash: createHash('sha256').update(JSON.stringify(runtime.files)).digest('hex'),
  };
}

export function hasEvalApiKey() {
  try {
    return Boolean(resolveEvalProvider().apiKey);
  } catch {
    return false;
  }
}
