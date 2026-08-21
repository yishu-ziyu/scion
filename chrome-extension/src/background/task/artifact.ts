/**
 * Task Artifact protocol (product/022).
 * Artifacts are deliverables — not success by themselves; Verifier must still pass.
 */

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

export function tableRowCount(artifact: TaskArtifact): number {
  if (artifact.type !== 'table' && artifact.type !== 'recordset') return 0;
  const data = artifact.data as TableArtifactData | undefined;
  return Array.isArray(data?.rows) ? data.rows.length : 0;
}

export function tableColumns(artifact: TaskArtifact): string[] {
  if (artifact.schema && artifact.schema.length > 0) return artifact.schema;
  const data = artifact.data as TableArtifactData | undefined;
  return Array.isArray(data?.columns) ? data.columns : [];
}

export function artifactSourceCount(artifact: TaskArtifact): number {
  return artifact.sources?.length ?? 0;
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
    const data = artifact.data as TableArtifactData | undefined;
    const rows = Array.isArray(data?.rows) ? data.rows : [];
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
