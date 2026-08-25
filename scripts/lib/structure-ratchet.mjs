import { FAIL_LINES, GIANT_SLACK, NEW_COMPLEXITY_MAX, WARN_LINES } from './structure-rules.mjs';

export function lineCount(content) {
  if (!content) return 0;
  const parts = content.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

export function isSameViolation(left, right) {
  if (left.rule?.name !== right.rule?.name) return false;
  if (left.cycle && right.cycle) {
    if (left.cycle.length !== right.cycle.length) return false;
    const rightNames = new Set(right.cycle.map(item => item.name ?? item));
    return left.cycle.every(item => rightNames.has(item.name ?? item));
  }
  return left.from === right.from && left.to === right.to;
}

export function diffViolations(current, known) {
  const errors = [];
  for (const violation of current) {
    if (!known.some(item => isSameViolation(item, violation))) {
      errors.push({
        kind: 'new-violation',
        rule: violation.rule?.name,
        from: violation.from,
        to: violation.to,
        message: `new ${violation.rule?.name}: ${violation.from} -> ${violation.to}`,
      });
    }
  }
  for (const violation of known) {
    if (!current.some(item => isSameViolation(item, violation))) {
      errors.push({
        kind: 'unused-known',
        rule: violation.rule?.name,
        from: violation.from,
        to: violation.to,
        message: `known violation no longer present, remove it: ${violation.rule?.name} ${violation.from} -> ${violation.to}`,
      });
    }
  }
  return { errors, warnings: [] };
}

export function diffFileSizes(files, giants, limits = {}) {
  const warnAt = limits.warnAt ?? WARN_LINES;
  const failAt = limits.failAt ?? FAIL_LINES;
  const slack = limits.giantSlack ?? GIANT_SLACK;
  const errors = [];
  const warnings = [];

  for (const file of files) {
    const recorded = giants[file.path];
    if (typeof recorded === 'number') {
      const allowed = recorded + slack;
      if (file.lines > allowed) {
        errors.push({
          kind: 'giant-growth',
          path: file.path,
          lines: file.lines,
          allowed,
          message: `${file.path} grew to ${file.lines} lines (max ${allowed}; split before adding more)`,
        });
      }
      continue;
    }

    if (file.lines > failAt) {
      errors.push({
        kind: 'new-giant',
        path: file.path,
        lines: file.lines,
        message: `${file.path} is ${file.lines} lines (new files must stay at ${failAt} or below; split it)`,
      });
    } else if (file.lines > warnAt) {
      warnings.push({
        kind: 'large-file',
        path: file.path,
        lines: file.lines,
        message: `${file.path} is ${file.lines} lines (warn at ${warnAt})`,
      });
    }
  }

  return { errors, warnings };
}

export function diffComplexity(current, baseline, limits = {}) {
  const newMax = limits.newMax ?? NEW_COMPLEXITY_MAX;
  const errors = [];
  const warnings = [];
  const currentMap = new Map(current.map(item => [item.key, item]));
  const baselineMap = new Map(Object.entries(baseline));

  for (const item of current) {
    const recorded = baselineMap.get(item.key);
    if (recorded == null) {
      if (item.complexity > newMax) {
        errors.push({
          kind: 'new-complexity',
          key: item.key,
          complexity: item.complexity,
          message: `${item.key} complexity ${item.complexity} (new functions max ${newMax})`,
        });
      }
      continue;
    }
    if (item.complexity > recorded) {
      errors.push({
        kind: 'complexity-increase',
        key: item.key,
        complexity: item.complexity,
        recorded,
        message: `${item.key} complexity rose ${recorded} -> ${item.complexity}`,
      });
    }
  }

  for (const [key, recorded] of baselineMap) {
    if (!currentMap.has(key)) {
      warnings.push({
        kind: 'unused-complexity',
        key,
        recorded,
        message: `complexity baseline entry gone (update baseline): ${key}`,
      });
    }
  }

  return { errors, warnings };
}

export function diffDuplication(current, baseline) {
  const errors = [];
  const warnings = [];
  const recordedLines = baseline.duplicatedLines ?? 0;
  const recordedPairs = new Set(baseline.pairs ?? []);
  const currentPairs = new Set(current.pairs ?? []);

  if (current.duplicatedLines > recordedLines) {
    errors.push({
      kind: 'duplication-lines',
      duplicatedLines: current.duplicatedLines,
      recorded: recordedLines,
      message: `duplicated lines rose ${recordedLines} -> ${current.duplicatedLines}`,
    });
  }

  for (const pair of currentPairs) {
    if (!recordedPairs.has(pair)) {
      errors.push({
        kind: 'new-clone-pair',
        pair,
        message: `new duplicated pair: ${pair}`,
      });
    }
  }

  for (const pair of recordedPairs) {
    if (!currentPairs.has(pair)) {
      warnings.push({
        kind: 'unused-clone-pair',
        pair,
        message: `clone pair gone (update baseline): ${pair}`,
      });
    }
  }

  return { errors, warnings };
}

export function parseComplexityMessage(message) {
  const match = String(message).match(/from (\d+) to/);
  return match ? Number(match[1]) : null;
}

const CALLBACK_NAMES = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'then',
  'catch',
  'finally',
  'sort',
  'find',
  'some',
  'every',
  'flatMap',
]);

export function isStableFunctionName(name) {
  return Boolean(name) && name !== 'default' && !CALLBACK_NAMES.has(name) && !/^L\d+$/.test(name);
}

export function enclosingFunctionName(lines, lineIndex) {
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i];
    const declared = line.match(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (declared) return declared[1];
    const exported = line.match(
      /\b(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$])/,
    );
    if (exported) return exported[1];
    const method = line.match(
      /^\s+(?:public|private|protected|static|async|override|get|set)*\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/,
    );
    if (method && !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(method[1])) return method[1];
  }
  return '';
}

export function functionKey(filePath, name, line) {
  const label = isStableFunctionName(name) ? name : `L${line}`;
  return `${filePath}:${label}`;
}

export function clonePairKey(left, right) {
  return [left, right].sort().join(' | ');
}

export function repoPathFromClone(filePath, root) {
  let normalized = String(filePath || '')
    .split('\\')
    .join('/');
  const rootPosix = String(root || '')
    .split('\\')
    .join('/')
    .replace(/\/$/, '');
  if (rootPosix && (normalized === rootPosix || normalized.startsWith(`${rootPosix}/`))) {
    normalized = normalized.slice(rootPosix.length).replace(/^\//, '');
  }
  return normalized.replace(/^\.\//, '');
}

export function giantsFromSizes(sizes, failAt = FAIL_LINES) {
  const giants = {};
  for (const [path, lines] of Object.entries(sizes)) {
    if (lines > failAt) giants[path] = lines;
  }
  return giants;
}

export function mergeFindings(...results) {
  return {
    errors: results.flatMap(result => result.errors ?? []),
    warnings: results.flatMap(result => result.warnings ?? []),
  };
}
