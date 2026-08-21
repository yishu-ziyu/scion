/**
 * CSV / Markdown table shape used by `checkInstructionDeliverable`
 * (`csvOrMarkdownBlockSpans`) and by `resultIsPresentAndMatches` (`looksLikeTable`).
 * Comma prose and header+separator-only Markdown are not tables.
 */

export function structuredTableCells(segment: string): string[] {
  const value = segment.trim();
  if (!value) return [];
  if (value.startsWith('|') && value.endsWith('|')) {
    return value
      .slice(1, -1)
      .split('|')
      .map(cell => cell.replace(/\\\|/g, '|').trim())
      .filter(Boolean);
  }

  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return quoted ? [] : cells.filter(Boolean);
}

export function canonicalTableField(value: string): string {
  const field = value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(?:name|title|名称|名字|商品)$/.test(field)) return 'name';
  if (/^(?:price|cost|价格|价钱)$/.test(field)) return 'price';
  if (/^(?:rating|score|评分|星级)$/.test(field)) return 'rating';
  return field;
}

export function isTableSeparator(segment: string): boolean {
  const cells = structuredTableCells(segment);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

export function looksLikeGenericTableHeader(segment: string): boolean {
  const cells = structuredTableCells(segment).map(canonicalTableField);
  if (cells.length < 2) return false;
  return cells.every(cell =>
    /^(?:name|price|rating|source|result|competitor|product|feature|strength|weakness|url|名称|价格|评分|来源|结果|竞品|产品|商品|功能|优点|缺点|网址|链接|指标|维度)$/.test(
      cell,
    ),
  );
}

/** Header plus at least one data row of CSV or Markdown. Comma prose is not a table. */
export function looksLikeCsvOrMarkdownHeader(line: string): boolean {
  if (!line || isTableSeparator(line)) return false;
  const cells = structuredTableCells(line);
  if (cells.length < 2) return false;
  if (line.startsWith('|') && line.endsWith('|')) return true;
  if (looksLikeGenericTableHeader(line)) return true;
  return cells.every(cell => /^[A-Za-z0-9_\u4e00-\u9fff]{1,32}$/.test(cell));
}

/** Continue a table run only for a real data row of the header width, not comma prose. */
export function csvOrMarkdownDataRow(line: string, width: number, markdown: boolean): boolean {
  const rowMarkdown = line.startsWith('|') && line.endsWith('|');
  if (markdown !== rowMarkdown) return false;
  const cells = structuredTableCells(line);
  if (cells.length !== width) return false;
  if (!markdown && csvRowHasProseUrl(cells)) return false;
  return true;
}

function csvRowHasProseUrl(cells: string[]): boolean {
  return cells.some(cell => {
    const trimmed = cell.trim();
    if (!/https?:\/\//i.test(trimmed)) return false;
    return !/^https?:\/\/\S+$/i.test(trimmed);
  });
}

function lineOffsetSpans(text: string): Array<{ start: number; end: number; line: string }> {
  const spans: Array<{ start: number; end: number; line: string }> = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    spans.push({
      start,
      end,
      line: text.slice(start, end).replace(/\r$/, '').trim(),
    });
    if (newline < 0) break;
    start = newline + 1;
  }
  return spans;
}

export function csvOrMarkdownBlockSpans(answer: string): Array<{ start: number; end: number; dataRows: number }> {
  const lines = lineOffsetSpans(answer);
  const spans: Array<{ start: number; end: number; dataRows: number }> = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index]!;
    if (!looksLikeCsvOrMarkdownHeader(header.line)) {
      index += 1;
      continue;
    }
    const markdown = header.line.startsWith('|') && header.line.endsWith('|');
    const width = structuredTableCells(header.line).length;
    let endIndex = index;
    let dataRows = 0;
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]!.line;
      if (!line) break;
      if (isTableSeparator(line)) {
        endIndex = next;
        continue;
      }
      if (!csvOrMarkdownDataRow(line, width, markdown)) break;
      endIndex = next;
      dataRows += 1;
    }
    if (dataRows >= 1) {
      spans.push({ start: header.start, end: lines[endIndex]!.end, dataRows });
      index = endIndex + 1;
      continue;
    }
    index += 1;
  }
  return spans;
}

export function csvOrMarkdownDataRowCount(body: string): number {
  const spans = csvOrMarkdownBlockSpans(body);
  if (spans.length === 0) return 0;
  return Math.max(...spans.map(span => span.dataRows));
}

export function firstCsvOrMarkdownHeaderLine(body: string): string | undefined {
  const span = csvOrMarkdownBlockSpans(body)[0];
  if (!span) return undefined;
  return lineOffsetSpans(body.slice(span.start, span.end))[0]?.line || undefined;
}
