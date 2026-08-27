/**
 * Task Artifact protocol (product/022).
 * Artifacts are deliverables — not success by themselves; Verifier must still pass.
 */

import { safePageUrl } from '@extension/context-engine';

export type ArtifactType = 'text' | 'table' | 'recordset' | 'file';

export interface ArtifactSource {
  url?: string;
  title?: string;
  retrievedAt?: number;
}

export interface TaskArtifact {
  id: string;
  type: ArtifactType;
  title: string;
  data: unknown;
  sources: ArtifactSource[];
  createdAt: number;
  /** Optional schema hint for table/recordset verification. */
  schema?: string[];
}

export interface TableArtifactData {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

let artifactSeq = 0;

export function nextArtifactId(): string {
  artifactSeq += 1;
  return `art-${Date.now().toString(36)}-${artifactSeq}`;
}

export function createTableArtifact(input: {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  sources?: ArtifactSource[];
  id?: string;
}): TaskArtifact {
  return {
    id: input.id ?? nextArtifactId(),
    type: 'table',
    title: input.title,
    data: { columns: input.columns, rows: input.rows } satisfies TableArtifactData,
    sources: input.sources ?? [],
    createdAt: Date.now(),
    schema: input.columns,
  };
}

export function createTextArtifact(input: {
  title: string;
  text: string;
  sources?: ArtifactSource[];
  id?: string;
}): TaskArtifact {
  return {
    id: input.id ?? nextArtifactId(),
    type: 'text',
    title: input.title,
    data: { text: input.text },
    sources: input.sources ?? [],
    createdAt: Date.now(),
  };
}

export function tableDataRows(artifact: TaskArtifact): TableArtifactData['rows'] {
  if (artifact.type !== 'table' && artifact.type !== 'recordset') return [];
  const data = artifact.data as TableArtifactData | undefined;
  return Array.isArray(data?.rows) ? data.rows : [];
}

export function tableRowCount(artifact: TaskArtifact): number {
  return tableDataRows(artifact).length;
}

export function tableColumns(artifact: TaskArtifact): string[] {
  if (artifact.schema && artifact.schema.length > 0) return artifact.schema;
  const data = artifact.data as TableArtifactData | undefined;
  return Array.isArray(data?.columns) ? data.columns : [];
}

function sourceKey(source: ArtifactSource): string {
  const fromUrl = safePageUrl(source.url);
  if (fromUrl) return fromUrl.toLowerCase();
  return (source.title || '').trim().toLowerCase();
}

function sanitizeSource(source: ArtifactSource): ArtifactSource {
  const url = safePageUrl(source.url);
  return url ? { ...source, url } : source;
}

export function uniqueArtifactSources(artifacts: readonly TaskArtifact[]): ArtifactSource[] {
  const seen = new Set<string>();
  const out: ArtifactSource[] = [];
  for (const artifact of artifacts) {
    for (const source of artifact.sources ?? []) {
      const next = sanitizeSource(source);
      const key = sourceKey(next);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(next);
    }
  }
  return out;
}

export function artifactSourceCount(artifact: TaskArtifact): number {
  return uniqueArtifactSources([artifact]).length;
}

export function tableArtifacts(artifacts: readonly TaskArtifact[]): TaskArtifact[] {
  return artifacts.filter(artifact => artifact.type === 'table' || artifact.type === 'recordset');
}

function sourceStamp(artifact: TaskArtifact): string {
  const source = artifact.sources.find(item => item.url || item.title);
  if (!source) return '';
  return safePageUrl(source.url) || (source.title || '').trim();
}

function unionTableColumns(tables: readonly TaskArtifact[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    for (const column of tableColumns(table)) {
      const key = column.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(column);
    }
  }
  if (!seen.has('source')) columns.push('source');
  return columns;
}

/** One table the user can take: later sources are rows, not extra deliverables. */
export function mergeTableArtifacts(artifacts: readonly TaskArtifact[]): TaskArtifact | null {
  const tables = tableArtifacts(artifacts);
  if (tables.length === 0) return null;
  if (tables.length === 1) return tables[0]!;
  const columns = unionTableColumns(tables);
  const rows: TableArtifactData['rows'] = [];
  for (const table of tables) {
    const stamp = sourceStamp(table);
    for (const row of tableDataRows(table)) {
      const next: Record<string, string | number | boolean | null> = { ...row };
      if (!String(next.source ?? '').trim() && stamp) next.source = stamp;
      rows.push(next);
    }
  }
  return createTableArtifact({
    title: tables[0]!.title,
    columns,
    rows,
    sources: uniqueArtifactSources(tables),
  });
}

export function artifactContains(artifact: TaskArtifact, needle: string): boolean {
  try {
    return JSON.stringify(artifact.data).includes(needle);
  } catch {
    return false;
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** User-facing `TaskResult.body`: CSV for tables, body text, or a file name. */
export function artifactToResultText(artifact: TaskArtifact): string {
  if (artifact.type === 'text') {
    if (!artifact.data || typeof artifact.data !== 'object') return '';
    const text = (artifact.data as { text?: unknown }).text;
    return typeof text === 'string' ? text.trim() : '';
  }
  if (artifact.type === 'table' || artifact.type === 'recordset') {
    const columns = tableColumns(artifact);
    const rows = tableDataRows(artifact);
    if (columns.length === 0 || rows.length === 0) return '';
    return [
      columns.map(csvCell).join(','),
      ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
    ].join('\n');
  }
  if (artifact.type === 'file') {
    const filename =
      artifact.data && typeof artifact.data === 'object'
        ? (artifact.data as { filename?: unknown }).filename
        : undefined;
    if (typeof filename === 'string' && filename.trim()) return filename.trim();
    return artifact.title.replace(/\s+/g, ' ').trim();
  }
  return '';
}
