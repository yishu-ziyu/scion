export const FINAL_DELIVERABLE_SELECTOR = '[data-testid="completion-deliverable-copy"]';

export function expectedParts(value) {
  return String(value || '')
    .split('||')
    .map(part => part.trim())
    .filter(Boolean);
}

export function deliverableContainsAll(deliverable, expected) {
  const parts = expectedParts(expected);
  return parts.length > 0 && parts.every(part => String(deliverable || '').includes(part));
}

export function normalizeEvidenceText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsGlobalContradiction(value) {
  const text = normalizeEvidenceText(value);
  return /(?:以上|前述|这些|该)(?:.{0,12})(?:数据|表格|观察|信息|结论|交付)(?:.{0,8})(?:都|全部|均)?(?:.{0,4})(?:错误|不正确|不可信|捏造|未实际)|(?:未|没有)(?:.{0,8})(?:实际)?(?:访问|观察|核实|验证)|\b(?:all|above|these)\b(?:.{0,20})\b(?:wrong|false|fabricated|unverified)\b/i.test(
    text,
  );
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hostIs(parsed, hostname, { allowWww = true } = {}) {
  if (!parsed) return false;
  const actual = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const expected = hostname.toLowerCase().replace(/\.$/, '');
  return actual === expected || (allowWww && actual === `www.${expected}`);
}

function exactPath(parsed, pathname) {
  return Boolean(parsed && parsed.pathname === pathname);
}

function cleanRoute(parsed) {
  return Boolean(parsed && parsed.search === '' && parsed.hash === '');
}

/** Commit-versioned URL oracle. Tokens in query/fragment never satisfy a host/path task. */
export function taskUrlContractPass(taskId, value) {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return false;
  switch (taskId) {
    case '013-A01':
      return hostIs(parsed, 'wikipedia.org') && parsed.pathname === '/' && cleanRoute(parsed);
    case '013-A02':
      return hostIs(parsed, 'bilibili.com') && parsed.pathname === '/' && cleanRoute(parsed);
    case '013-A03':
      return hostIs(parsed, 'youtube.com');
    case '013-B01':
      return hostIs(parsed, 'bilibili.com') && /^\/video\/BV[\w-]+\/?$/.test(parsed.pathname) && cleanRoute(parsed);
    case '013-B04':
      return hostIs(parsed, 'wikipedia.org') && parsed.pathname === '/' && cleanRoute(parsed);
    case '013-B05':
      return (
        hostIs(parsed, 'en.wikipedia.org', { allowWww: false }) &&
        exactPath(parsed, '/wiki/Agent') &&
        cleanRoute(parsed)
      );
    case '013-B06':
      return hostIs(parsed, 'youtube.com') && exactPath(parsed, '/watch') && Boolean(parsed.searchParams.get('v'));
    case '013-B07':
      return hostIs(parsed, 'iana.org') && exactPath(parsed, '/help/example-domains') && cleanRoute(parsed);
    case '013-B08':
      return (
        hostIs(parsed, 'en.wikipedia.org', { allowWww: false }) &&
        exactPath(parsed, '/wiki/Artificial_intelligence') &&
        cleanRoute(parsed)
      );
    case '021-LH-01':
      return (
        hostIs(parsed, 'en.wikipedia.org', { allowWww: false }) &&
        exactPath(parsed, '/wiki/Artificial_intelligence') &&
        cleanRoute(parsed)
      );
    case '021-LH-02':
    case '021-LH-04':
      return (
        hostIs(parsed, 'en.wikipedia.org', { allowWww: false }) &&
        exactPath(parsed, '/wiki/Web_browser') &&
        cleanRoute(parsed)
      );
    default:
      return false;
  }
}

function matchingNavigation(payload, url) {
  return Array.isArray(payload?.navigation_evidence)
    ? payload.navigation_evidence.find(item => item?.url === url && normalizeEvidenceText(item?.title))
    : null;
}

function actionScenarioPass(taskId, payload) {
  if (!['018-O1', '013-C01'].includes(taskId)) return false;
  if (!Array.isArray(payload?.scenario_evidence) || payload.scenario_evidence.length !== 1) return false;
  const [form] = payload.scenario_evidence;
  return (
    form?.label === 'form' &&
    form?.terminal_status === 'completed' &&
    Boolean(String(form?.receipt_id || '').trim()) &&
    form?.deliverable === 'Saved successfully' &&
    form?.submit_count === 1 &&
    Number(form?.quiescence_ms) >= 2500 &&
    Number(form?.quiescence_confirmations) >= 3 &&
    form?.runtime_task_id === payload?.runtime_task_id &&
    payload?.receipt_count === 1 &&
    payload?.deliverable_count === 1 &&
    payload?.final_deliverable === 'Saved successfully' &&
    payload?.privacy_pass === true
  );
}

/** Re-run the registry-owned semantic oracle inside the gate. */
export function taskSpecificVerificationPass(taskId, payload) {
  if (!payload || payload.task_id !== taskId || payload.outcome !== 'verified_pass') return false;
  const finalUrl = String(payload.target_url || '');
  const deliverable = String(payload.final_deliverable || '');
  const finalNavigation = matchingNavigation(payload, finalUrl);

  switch (taskId) {
    case '013-A01':
      return (
        taskUrlContractPass(taskId, finalUrl) &&
        Boolean(finalNavigation) &&
        !containsGlobalContradiction(deliverable) &&
        !/(?:不是|并非|非|is\s+not|isn't|not)\s*(?:Wikipedia|www\.wikipedia\.org)/i.test(deliverable) &&
        deliverable.includes(new URL(finalUrl).hostname) &&
        deliverable.includes(normalizeEvidenceText(finalNavigation.title))
      );
    case '013-A02':
      return (
        taskUrlContractPass(taskId, finalUrl) &&
        /^(?:是(?:[，,:：。\s]|$)|yes(?:[,.!:;\s]|$))/i.test(deliverable.trim()) &&
        !/(?:不是|否|\bno\b)/i.test(deliverable) &&
        /bilibili\.com/i.test(deliverable)
      );
    case '013-A03':
    case '013-B01':
    case '013-B04':
    case '013-B05':
    case '013-B06':
    case '013-B07':
      return taskUrlContractPass(taskId, finalUrl) && Boolean(finalNavigation);
    case '013-B08': {
      const scroll = payload.page_state?.scroll;
      return (
        taskUrlContractPass(taskId, finalUrl) &&
        Number.isFinite(scroll?.top) &&
        Number.isFinite(scroll?.viewport) &&
        Number.isFinite(scroll?.height) &&
        scroll.top + scroll.viewport >= scroll.height - 300
      );
    }
    case '021-LH-01':
      return (
        taskUrlContractPass(taskId, finalUrl) &&
        Boolean(finalNavigation) &&
        /Artificial intelligence/i.test(
          `${normalizeEvidenceText(finalNavigation.title)} ${normalizeEvidenceText(finalNavigation.first_paragraph)}`,
        )
      );
    case '021-LH-02':
      return (
        taskUrlContractPass(taskId, finalUrl) &&
        Boolean(finalNavigation) &&
        /web browser/i.test(
          `${normalizeEvidenceText(finalNavigation.title)} ${normalizeEvidenceText(finalNavigation.first_paragraph)}`,
        )
      );
    case '021-LH-03':
    case '022-SKILL-01':
    case '018-R1':
      return productDeliverablePass(deliverable, payload.source_products);
    case '021-LH-04':
      return multiSourceDeliveryPass({
        finalUrl,
        deliverable,
        navigationEvidence: Array.isArray(payload.navigation_evidence) ? payload.navigation_evidence : [],
      });
    case '018-O1':
    case '013-C01':
      return actionScenarioPass(taskId, payload);
    default:
      return false;
  }
}

function chineseCharacterCount(value) {
  return (String(value || '').match(/[\u3400-\u9fff]/g) || []).length;
}

function deniesCoreClaim(value) {
  const text = normalizeEvidenceText(value);
  return /(?:不是|并非|不|未|无法)(?:.{0,12})(?:用于|用途|保留|访问|浏览|获取|应用|软件)|非(?:.{0,8})(?:应用|软件|用途)/.test(
    text,
  );
}

function substantiveIanaObservation(value) {
  const text = normalizeEvidenceText(value);
  return (
    chineseCharacterCount(text) >= 10 &&
    /IANA|Example Domains/i.test(text) &&
    /示例域名/.test(text) &&
    /文档|测试|保留|用途|注册|分配/.test(text) &&
    !/Wikipedia|维基百科/i.test(text) &&
    !deniesCoreClaim(text)
  );
}

function substantiveBrowserObservation(value) {
  const text = normalizeEvidenceText(value);
  return (
    chineseCharacterCount(text) >= 10 &&
    /Wikipedia|维基百科/i.test(text) &&
    /浏览器/.test(text) &&
    /应用|软件/.test(text) &&
    /访问|浏览|获取/.test(text) &&
    /网页|网站|万维网|网络/.test(text) &&
    !/IANA|Example Domains|示例域名/i.test(text) &&
    !deniesCoreClaim(text)
  );
}

export function multiSourceDeliveryPass({ finalUrl, deliverable, navigationEvidence }) {
  const ianaUrl = 'https://www.iana.org/help/example-domains';
  const wikipediaUrl = 'https://en.wikipedia.org/wiki/Web_browser';
  if (finalUrl !== wikipediaUrl) return false;
  const ianaIndex = navigationEvidence.findIndex(
    item => item.url === ianaUrl && /Example Domains/i.test(normalizeEvidenceText(item.title)),
  );
  const wikipediaIndex = navigationEvidence.findIndex(
    item => item.url === wikipediaUrl && /Web browser/i.test(normalizeEvidenceText(item.title)),
  );
  const iana = navigationEvidence[ianaIndex];
  const wikipedia = navigationEvidence[wikipediaIndex];
  if (!iana || !wikipedia?.first_paragraph) return false;
  if (ianaIndex < 0 || wikipediaIndex <= ianaIndex) return false;
  const ianaAt = Date.parse(iana.captured_at || '');
  const wikipediaAt = Date.parse(wikipedia.captured_at || '');
  if (!Number.isFinite(ianaAt) || !Number.isFinite(wikipediaAt) || wikipediaAt < ianaAt) return false;
  const definitionSentence = normalizeEvidenceText(wikipedia.first_paragraph).split(/(?<=[.!?])\s+/)[0];
  if (definitionSentence.length < 40) return false;
  const answer = normalizeEvidenceText(deliverable);
  if (containsGlobalContradiction(answer)) return false;
  const required = [ianaUrl, wikipediaUrl, 'Example Domains', 'Web browser', definitionSentence];
  const rawDeliverable = String(deliverable || '');
  const firstObservation = /观察\s*(?:一|1)\s*[:：]\s*([^\r\n]+)/.exec(rawDeliverable)?.[1];
  const secondObservation = /观察\s*(?:二|2)\s*[:：]\s*([^\r\n]+)/.exec(rawDeliverable)?.[1];
  const normalizedFirstObservation = normalizeEvidenceText(firstObservation);
  const normalizedSecondObservation = normalizeEvidenceText(secondObservation);
  const hasTwoChineseObservations =
    normalizedFirstObservation !== normalizedSecondObservation &&
    substantiveIanaObservation(normalizedFirstObservation) &&
    substantiveBrowserObservation(normalizedSecondObservation);
  return required.every(part => answer.includes(part)) && hasTwoChineseObservations;
}

export function tabProvenanceWrongTab(entries, allowedTabIds) {
  const allowed = new Set((allowedTabIds || []).filter(Number.isInteger));
  if (allowed.size === 0 || !Array.isArray(entries) || entries.length === 0) return null;
  if (entries.some(entry => entry?.scope_invalid)) return null;
  for (const entry of entries) {
    const values = [entry?.task_tab_id, entry?.target_tab_id];
    if (entry?.enforce_active === true) values.push(entry?.active_tab_id);
    for (const value of values) {
      if (value == null) continue;
      if (!Number.isInteger(value) || !allowed.has(value)) return 1;
    }
  }
  const hasObservedTab = entries.some(entry =>
    [entry?.task_tab_id, entry?.target_tab_id, entry?.enforce_active ? entry?.active_tab_id : null].some(
      Number.isInteger,
    ),
  );
  return hasObservedTab ? 0 : null;
}

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        field += character;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
      quoteClosed = false;
      continue;
    }
    if (character === '"') {
      if (field.trim() || quoteClosed) return null;
      quoted = true;
      continue;
    }
    if (quoteClosed && !/\s/.test(character)) return null;
    field += character;
  }

  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

function tupleKey(values) {
  return JSON.stringify(values.map(value => normalizeEvidenceText(value)));
}

function numericPrice(value) {
  const normalized = String(value || '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : Number.NaN;
}

function containsExactPriceToken(line, price) {
  const escaped = String(price).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_.])${escaped}(?=$|[^\\p{L}\\p{N}_.])`, 'u').test(line);
}

export function productDeliverablePass(deliverable, products) {
  if (containsGlobalContradiction(deliverable)) return false;
  if (!Array.isArray(products) || products.length < 5) return false;
  const expectedRows = products.map(product => [product?.name, product?.price, product?.rating]);
  if (expectedRows.some(row => row.some(value => !normalizeEvidenceText(value)))) return false;

  const lines = String(deliverable || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const headerIndexes = lines.flatMap((line, index) => {
    const fields = parseCsvLine(line.replace(/^\uFEFF/, ''));
    return fields?.length === 3 && fields.map(field => field.toLowerCase()).join(',') === 'name,price,rating'
      ? [index]
      : [];
  });
  if (headerIndexes.length !== 1) return false;

  const headerIndex = headerIndexes[0];
  const actualRows = [];
  let tableEndIndex = headerIndex;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*```/.test(line)) {
      tableEndIndex = index;
      break;
    }
    const fields = parseCsvLine(line);
    if (!fields || fields.length !== 3) {
      tableEndIndex = index - 1;
      break;
    }
    actualRows.push(fields);
    tableEndIndex = index;
  }

  if (actualRows.length !== expectedRows.length) return false;
  const expectedTuples = expectedRows.map(tupleKey).sort();
  const actualTuples = actualRows.map(tupleKey).sort();
  if (expectedTuples.some((tuple, index) => tuple !== actualTuples[index])) return false;

  // A second CSV-shaped line outside the one contiguous table is ambiguous and can
  // hide duplicate or fabricated rows, so fail closed instead of token-scoring it.
  const outsideTable = lines.filter((_, index) => index < headerIndex || index > tableEndIndex);
  if (outsideTable.some(line => parseCsvLine(line)?.length === 3)) return false;

  const pricedRows = expectedRows.map(row => ({ row, price: numericPrice(row[1]) }));
  if (pricedRows.some(item => !Number.isFinite(item.price))) return false;
  const highestPrice = Math.max(...pricedRows.map(item => item.price));
  const mostExpensive = pricedRows.filter(item => item.price === highestPrice).map(item => item.row);
  const conclusionLines = outsideTable.map(normalizeEvidenceText).filter(Boolean);
  return conclusionLines.some(line => {
    if (!/最贵|价格最高|最高价格|most\s+expensive|highest[-\s]+priced|highest\s+price/i.test(line)) return false;
    if (/不是|并非|非最贵|not\s+(?:the\s+)?most\s+expensive|is\s+not|isn't/i.test(line)) return false;
    return mostExpensive.some(([name, price]) => {
      if (!line.includes(String(name)) || !containsExactPriceToken(line, price)) return false;
      return expectedRows.every(([otherName]) => otherName === name || !line.includes(String(otherName)));
    });
  });
}

/** null means the evaluator could not establish tab provenance. */
export function wrongTabFromIds(boundTabId, activeTabId) {
  if (!Number.isInteger(boundTabId) || !Number.isInteger(activeTabId)) return null;
  return boundTabId === activeTabId ? 0 : 1;
}
