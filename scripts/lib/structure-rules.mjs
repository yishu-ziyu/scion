/** Layer and cycle rules for `pnpm check:structure`. Paths are repo-root regexes. */

export const CRUISE_TARGETS = [
  'chrome-extension/src',
  'pages/content/src',
  'pages/memory/src',
  'pages/options/src',
  'pages/side-panel/src',
  'packages/dev-utils',
  'packages/hmr/lib',
  'packages/i18n',
  'packages/schema-utils/lib',
  'packages/shared/lib',
  'packages/storage/lib',
  'packages/ui/lib',
  'packages/zipper',
];

export const SOURCE_ROOTS = ['chrome-extension/src', 'pages', 'packages'];

export const SOURCE_EXCLUDES = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])build([/\\]|$)/,
  /(^|[/\\])__tests__([/\\]|$)/,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /secrets\.local\.ts$/,
];

export const WARN_LINES = 400;
export const FAIL_LINES = 800;
export const GIANT_SLACK = 50;
export const NEW_COMPLEXITY_MAX = 15;

const TASK_CONTRACT = 'chrome-extension/src/background/task/(contracts|action-frame)\\.ts$';

export const forbidden = [
  {
    name: 'no-circular',
    comment: 'New import cycles fail. Existing cycles belong in the known-violations list.',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
  {
    name: 'pages-not-to-extension',
    comment: 'Side panel, options, memory, and content pages talk through storage, not background source.',
    severity: 'error',
    from: { path: '^pages/' },
    to: { path: '(^|/)chrome-extension/' },
  },
  {
    name: 'extension-not-to-pages',
    comment: 'Background code must not import page implementations.',
    severity: 'error',
    from: { path: '^chrome-extension/' },
    to: { path: '^pages/' },
  },
  {
    name: 'packages-not-to-extension',
    comment: 'Workspace packages must not depend on the extension implementation.',
    severity: 'error',
    from: { path: '^packages/' },
    to: { path: '(^|/)chrome-extension/' },
  },
  {
    name: 'packages-not-to-pages',
    comment: 'Workspace packages must not depend on page implementations.',
    severity: 'error',
    from: { path: '^packages/' },
    to: { path: '^pages/' },
  },
  {
    name: 'skills-not-to-browser-context',
    comment: 'Skills act through BrowserKernel, not BrowserContext.',
    severity: 'error',
    from: { path: 'chrome-extension/src/background/agent/skills/' },
    to: {
      path: 'chrome-extension/src/background/browser/context',
      dependencyTypesNot: ['type-only'],
    },
  },
  {
    name: 'control-llm-not-to-sites',
    comment: 'The control loop must not import site-specific parsers; those live under skills.',
    severity: 'error',
    from: { path: 'chrome-extension/src/background/agent/backends/control-llm\\.ts$' },
    to: { path: 'chrome-extension/src/background/browser/sites/' },
  },
  {
    name: 'task-not-to-sites',
    comment: 'Task management must not grow new site-script imports. Existing ones are listed as known violations.',
    severity: 'error',
    from: { path: 'chrome-extension/src/background/task/' },
    to: { path: 'chrome-extension/src/background/browser/sites/' },
  },
  {
    name: 'browser-not-to-task-impl',
    comment: 'Browser kernel may share task contracts, not TaskManager or completion internals.',
    severity: 'error',
    from: { path: 'chrome-extension/src/background/browser/' },
    to: {
      path: 'chrome-extension/src/background/task/',
      pathNot: TASK_CONTRACT,
    },
  },
];

export const cruiseOptions = {
  doNotFollow: {
    path: '(^|/)node_modules/',
  },
  exclude: {
    path: '(^|/)(node_modules|dist|build|coverage|__tests__)/|\\.(test|spec)\\.(ts|tsx|js|mjs)$|secrets\\.local\\.ts$',
  },
  tsPreCompilationDeps: true,
  combinedDependencies: true,
  moduleSystems: ['es6', 'cjs'],
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default', 'types'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
};
