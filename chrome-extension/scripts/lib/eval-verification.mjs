import { hasAffirmedPredicateTarget, predicateTargetClaims } from './eval-claim-polarity.mjs';

export const FINAL_DELIVERABLE_SELECTOR = '[data-testid="completion-deliverable-copy"]';
export const COMPLETION_RESULT_SELECTOR = '[data-testid="completion-result"]';

const TEXT_DELIVERABLE_VERIFIERS = new Set([
  'action_scenarios',
  'answer_contains',
  'body_contains',
  'body_contains_all',
  'body_and_page',
  'frontier_catalog_modules',
  'frontier_compare',
  'frontier_recovery',
  'frontier_research',
  'frontier_spa_serial',
  'multi_source_delivery',
  'products_extract',
  'url_and_body',
]);

export function verifierRequiresTextDeliverable(verifier) {
  return TEXT_DELIVERABLE_VERIFIERS.has(String(verifier || ''));
}

const HONEST_FAILURE_STATUSES = new Set([
  'cancelled',
  'failed',
  'inputs_required',
  'interrupted',
  'paused',
  'running',
  'waiting_user',
]);

export function honestFailureStatus(status) {
  return HONEST_FAILURE_STATUSES.has(String(status || ''));
}

export function initialNavigationRetryDecision(error, attempt) {
  const message = String(error?.message || error || '');
  const errorCodes = [...new Set(message.match(/\bERR_[A-Z0-9_]+\b/g) || [])];
  return {
    errorCategory: errorCodes.length > 0 ? errorCodes.join('|') : 'NAVIGATION_ERROR',
    retry: attempt === 1 && errorCodes.length === 1 && errorCodes[0] === 'ERR_CONNECTION_CLOSED',
  };
}

export async function navigateInitialTargetWithRetry({
  navigate,
  url,
  retryDelayMs = 500,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
  onState = () => {},
}) {
  const errorCategories = [];
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    onState({ attempts, errorCategories: [...errorCategories] });
    try {
      await navigate(url);
      return { attempts, errorCategories };
    } catch (error) {
      const decision = initialNavigationRetryDecision(error, attempts);
      errorCategories.push(decision.errorCategory);
      onState({ attempts, errorCategories: [...errorCategories] });
      if (!decision.retry) throw error;
      await wait(retryDelayMs);
    }
  }
  throw new Error('initial navigation retry exhausted');
}

export function scopedCompletionSnapshot(cards, runtimeTask) {
  const taskId = String(runtimeTask?.id || '');
  const roundId = String(runtimeTask?.roundId || '');
  const matchingCards =
    taskId && roundId && Array.isArray(cards)
      ? cards.filter(card => String(card?.taskId || '') === taskId && String(card?.roundId || '') === roundId)
      : [];
  const card = matchingCards.length === 1 ? matchingCards[0] : null;
  const receiptIds = Array.isArray(card?.receiptIds) ? card.receiptIds.map(value => String(value || '')) : [];
  const resultTexts = Array.isArray(card?.resultTexts) ? card.resultTexts.map(value => String(value || '')) : [];
  const deliverableTexts = Array.isArray(card?.deliverableTexts)
    ? card.deliverableTexts.map(value => String(value || ''))
    : [];
  return {
    status: card?.status || null,
    scopedCardCount: matchingCards.length,
    uiTaskId: card?.taskId || '',
    uiRoundId: card?.roundId || '',
    receipt: receiptIds.length === 1,
    receiptCount: receiptIds.length,
    visibleReceiptId: receiptIds.length === 1 ? receiptIds[0] : '',
    resultCount: resultTexts.length,
    resultText: resultTexts.length === 1 ? resultTexts[0].trim() : '',
    deliverableCount: deliverableTexts.length,
    answer: deliverableTexts.length === 1 ? deliverableTexts[0].trim() : '',
  };
}

export function completionProtocolErrors({
  status,
  scopedCardCount,
  uiTaskId,
  uiRoundId,
  receiptCount,
  visibleReceiptId,
  resultCount,
  resultText,
  deliverableCount,
  deliverableText,
  deliverableRequired,
  runtimeTask,
  priorReceiptIds = [],
}) {
  const errors = [];
  const receiptIds = new Set((priorReceiptIds || []).map(String));
  if (!runtimeTask?.id) errors.push('new runtime task missing');
  if (scopedCardCount !== 1) errors.push(`scoped_card_count=${scopedCardCount}`);
  if (uiTaskId !== runtimeTask?.id || uiRoundId !== runtimeTask?.roundId) {
    errors.push('UI task/round ownership mismatch');
  }
  if (runtimeTask?.status !== status) errors.push('runtime/UI status mismatch');

  if (status === 'completed') {
    if (receiptCount !== 1) errors.push(`receipt_count=${receiptCount}`);
    if (resultCount !== 1 || !normalizeEvidenceText(resultText)) {
      errors.push(`completion_result_count=${resultCount}`);
    }
    if (!Number.isInteger(deliverableCount) || deliverableCount < 0 || deliverableCount > 1) {
      errors.push(`deliverable_count=${deliverableCount}`);
    } else if (deliverableRequired && (deliverableCount !== 1 || !normalizeEvidenceText(deliverableText))) {
      errors.push(`deliverable_count=${deliverableCount} required=1`);
    } else if (deliverableCount === 1 && !normalizeEvidenceText(deliverableText)) {
      errors.push('empty deliverable');
    }

    const receipt = runtimeTask?.receipt;
    if (!receipt?.id || receiptIds.has(String(receipt.id))) errors.push('receipt is missing or stale');
    if (!visibleReceiptId || visibleReceiptId !== receipt?.id) errors.push('visible receipt ownership mismatch');
    if (receipt?.taskId !== runtimeTask?.id || receipt?.roundId !== runtimeTask?.roundId) {
      errors.push('receipt ownership mismatch');
    }
  } else if (['failed', 'cancelled'].includes(status)) {
    if (runtimeTask?.receipt) errors.push('terminal failure retains runtime receipt');
    if (receiptCount !== 0 || resultCount !== 0 || deliverableCount !== 0) {
      errors.push('terminal failure exposes completion nodes');
    }
  } else {
    errors.push(`non-terminal status=${status || '<empty>'}`);
  }
  return errors;
}

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

const EPISTEMIC_PREDICATE =
  /未经(?:核实|验证|证实|查证)|待(?:核实|验证|证实|查证)|未实际(?:访问|观察|核实|验证)|没有实际(?:访问|观察|核实|验证)|不确定|存疑|猜测|臆测|推测|假设|瞎说|胡编乱造|编的|编造|捏造|虚构|杜撰|瞎编|推翻|改口|撤回|收回|撤销|否认|作废|无效|不可信|不正确|错误|为假|假话|主观判断|(?:只是|仅仅是|仅为)?理论|\b(?:bogus|speculation|guess(?:work)?|assumption|conjecture|uncertain|unsure|unverified|unconfirmed|uncorroborated|fabricated|invented|fictional|made[ -]?up|retract(?:ed|ion)?|withdrawn?|disavow(?:ed|al)?|rescind(?:ed|ing)?|renounce(?:d|ment)?|take\s+(?:it\s+)?back|false|untrue|wrong|merely\s+a\s+theory|subjective\s+(?:judg(?:e)?ment|opinion))\b/gi;
const EPISTEMIC_TARGET =
  /上述|以上|前述|先前|这些|该(?:数据|表格|观察|信息|结论|交付|说法|声明|答案|回答|判断)|这个(?:结论|判断|观察|回答)|这句话|整份|整个|全部|\b(?:all|above|these|this|that|it|previous|preceding|entire|whole)(?:\s+(?:content|data|table|observation|information|conclusion|delivery|claim|statement|answer|judg(?:e)?ment))?\b/gi;

function containsDisqualifyingEpistemicClaim(value, { fieldScoped = false } = {}) {
  return hasAffirmedPredicateTarget(value, {
    predicate: EPISTEMIC_PREDICATE,
    target: EPISTEMIC_TARGET,
    allowImplicitTarget: fieldScoped || /未实际|没有实际/.test(String(value || '')),
    maxDistance: 72,
  });
}

function containsGlobalContradiction(value) {
  return containsDisqualifyingEpistemicClaim(value);
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

function containsWikipediaDomain(value) {
  return /(?:^|[^\w.-])(?:www\.)?wikipedia\.org(?:[^\w.-]|$)/i.test(String(value || ''));
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
  const actionOwnershipPass =
    form?.terminal_status === 'completed' &&
    form?.runtime_status === 'completed' &&
    form?.ui_status === 'completed' &&
    form?.runtime_status === form?.ui_status &&
    form?.runtime_task_id === payload?.runtime_task_id &&
    form?.runtime_round_id === payload?.runtime_round_id &&
    form?.ui_task_id === form?.runtime_task_id &&
    form?.ui_round_id === form?.runtime_round_id &&
    form?.visible_receipt_id === form?.runtime_receipt_id &&
    form?.has_runtime_receipt === true &&
    form?.runtime_receipt_id === form?.receipt_id &&
    form?.runtime_receipt_task_id === form?.runtime_task_id &&
    form?.runtime_receipt_task_id === form?.ui_task_id &&
    form?.runtime_receipt_round_id === form?.runtime_round_id &&
    form?.runtime_receipt_round_id === form?.ui_round_id &&
    payload?.terminal_status === 'completed' &&
    payload?.runtime_status === 'completed' &&
    payload?.ui_status === 'completed' &&
    payload?.runtime_status === payload?.ui_status &&
    payload?.scoped_card_count === 1 &&
    payload?.ui_task_id === payload?.runtime_task_id &&
    payload?.ui_round_id === payload?.runtime_round_id &&
    payload?.visible_receipt_id === payload?.runtime_receipt_id &&
    payload?.has_runtime_receipt === true &&
    payload?.runtime_receipt_id === form?.receipt_id &&
    payload?.runtime_receipt_task_id === payload?.runtime_task_id &&
    payload?.runtime_receipt_task_id === payload?.ui_task_id &&
    payload?.runtime_receipt_round_id === payload?.runtime_round_id &&
    payload?.runtime_receipt_round_id === payload?.ui_round_id &&
    payload?.runtime_receipt_task_id === form?.runtime_receipt_task_id &&
    payload?.runtime_receipt_round_id === form?.runtime_receipt_round_id;
  const o1EvidencePass =
    taskId !== '018-O1' ||
    (form?.receipt_count === 1 &&
      form?.completion_result_count === 1 &&
      Boolean(normalizeEvidenceText(form?.completion_result)) &&
      form?.deliverable_count === 1 &&
      form?.page_evidence === 'Saved successfully' &&
      form?.expected_effect === 'Saved successfully' &&
      form?.scoped_card_count === 1 &&
      form?.visible_receipt_id === form?.receipt_id &&
      payload?.completion_result_count === 1 &&
      Boolean(normalizeEvidenceText(payload?.completion_result)));
  return (
    form?.label === 'form' &&
    actionOwnershipPass &&
    Boolean(String(form?.receipt_id || '').trim()) &&
    form?.deliverable === 'Saved successfully' &&
    form?.submit_count === 1 &&
    Number(form?.quiescence_ms) >= 2500 &&
    Number(form?.quiescence_confirmations) >= 3 &&
    form?.runtime_task_id === payload?.runtime_task_id &&
    payload?.receipt_count === 1 &&
    payload?.deliverable_count === 1 &&
    payload?.final_deliverable === 'Saved successfully' &&
    payload?.privacy_pass === true &&
    o1EvidencePass
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
        containsWikipediaDomain(deliverable) &&
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
      return productDeliverablePass(deliverable, payload.source_products);
    case '018-R1':
      return r1ProductDeliverablePass(deliverable, payload.source_products);
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

const IANA_PURPOSE_PREDICATE =
  /(?:保留|预留)(?:作|为|用作)?|用途(?:是|为)|用于|用作|供(?:给)?|专供|作为|\b(?:reserved|intended|designated|used)\b/gi;
const IANA_DOCUMENTATION_TARGET = /文档|文件|说明书|\bdocument(?:ation|ary)?\b/gi;
const IANA_TESTING_TARGET = /测试|\btest(?:ing)?\b/gi;
const IANA_DISPOSITION_PREDICATE =
  /注册|分配|转让|\b(?:register(?:ed|ing|ation)?|allocat(?:e|ed|ing|ion)|assign(?:ed|ing|ment)?|transfer(?:red|ring)?)\b/gi;
const IANA_DOMAIN_TARGET = /示例域名|这些域名|该域名|\bexample\s+domains?\b/gi;

function hasPositiveIanaPurpose(value) {
  const options = {
    predicate: IANA_PURPOSE_PREDICATE,
    anchor: 'target',
    maxDistance: 72,
  };
  return (
    hasAffirmedPredicateTarget(value, { ...options, target: IANA_DOCUMENTATION_TARGET }) ||
    hasAffirmedPredicateTarget(value, { ...options, target: IANA_TESTING_TARGET })
  );
}

function hasAffirmedIanaDisposition(value) {
  return predicateTargetClaims(value, {
    predicate: IANA_DISPOSITION_PREDICATE,
    target: IANA_DOMAIN_TARGET,
    anchor: 'predicate',
    maxDistance: 128,
  }).some(claim => claim.polarity === 'affirmed');
}

function substantiveIanaObservation(value) {
  const text = normalizeEvidenceText(value);
  return (
    chineseCharacterCount(text) >= 10 &&
    /IANA|Example Domains/i.test(text) &&
    /示例域名/.test(text) &&
    hasPositiveIanaPurpose(text) &&
    !hasAffirmedIanaDisposition(text) &&
    !/Wikipedia|维基百科/i.test(text) &&
    !containsDisqualifyingEpistemicClaim(text, { fieldScoped: true })
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
    !deniesCoreClaim(text) &&
    !containsDisqualifyingEpistemicClaim(text, { fieldScoped: true })
  );
}

function substantiveBrowserDefinition(value) {
  const text = normalizeEvidenceText(value);
  return (
    text.length >= 40 &&
    /web browser/i.test(text) &&
    /application|software/i.test(text) &&
    /access|browse|retrieve|view/i.test(text) &&
    /websites?|web pages?|World Wide Web/i.test(text) &&
    !/not|isn't|is not|never/i.test(text)
  );
}

function structuredDeliverableLines(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^```(?:csv|markdown|md)?$/i.test(line));
}

function exactLabeledLine(line, requiredParts, allowedLabels) {
  let remainder = normalizeEvidenceText(line);
  for (const part of requiredParts) {
    if (!part || remainder.split(part).length !== 2) return false;
    remainder = remainder.replace(part, ' ');
  }
  for (const label of [...allowedLabels].sort((left, right) => right.length - left.length)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remainder = remainder.replace(new RegExp(escaped, 'gi'), ' ');
  }
  return /^[\s:：,，;；|｜/—-]*$/.test(remainder);
}

function exactUrlOnlyFooter(line, requiredUrls) {
  return exactLabeledLine(line, requiredUrls, ['来源', '来源链接', 'Source', 'Sources', 'URL', 'URLs', '链接', '网址']);
}

export function recordNavigationEvidence(entries, observed) {
  const previous = entries.at(-1);
  if (previous?.url === observed.url) {
    Object.assign(previous, {
      ...observed,
      captured_at: previous.captured_at,
      sequence: previous.sequence,
    });
    return previous;
  }
  const previousTime = Date.parse(previous?.captured_at || '');
  const observedTime = Date.parse(observed.captured_at || '');
  const capturedAt =
    Number.isFinite(previousTime) && (!Number.isFinite(observedTime) || observedTime <= previousTime)
      ? new Date(previousTime + 1).toISOString()
      : observed.captured_at;
  const entry = { ...observed, captured_at: capturedAt, sequence: entries.length + 1 };
  entries.push(entry);
  return entry;
}

export function multiSourceDeliveryPass({ finalUrl, deliverable, navigationEvidence }) {
  const ianaUrl = 'https://www.iana.org/help/example-domains';
  const wikipediaUrl = 'https://en.wikipedia.org/wiki/Web_browser';
  if (finalUrl !== wikipediaUrl || !Array.isArray(navigationEvidence)) return false;
  let orderedPair = null;
  for (let ianaIndex = 0; ianaIndex < navigationEvidence.length && !orderedPair; ianaIndex += 1) {
    const iana = navigationEvidence[ianaIndex];
    if (iana?.url !== ianaUrl || !/Example Domains/i.test(normalizeEvidenceText(iana?.title))) continue;
    const ianaAt = Date.parse(iana.captured_at || '');
    if (!Number.isFinite(ianaAt)) continue;
    for (let wikipediaIndex = ianaIndex + 1; wikipediaIndex < navigationEvidence.length; wikipediaIndex += 1) {
      const wikipedia = navigationEvidence[wikipediaIndex];
      const wikipediaAt = Date.parse(wikipedia?.captured_at || '');
      if (
        wikipedia?.url === wikipediaUrl &&
        /Web browser/i.test(normalizeEvidenceText(wikipedia?.title)) &&
        substantiveBrowserDefinition(wikipedia?.first_paragraph) &&
        Number.isFinite(wikipediaAt) &&
        wikipediaAt >= ianaAt
      ) {
        orderedPair = { iana, wikipedia };
        break;
      }
    }
  }
  if (!orderedPair) return false;
  const { wikipedia } = orderedPair;
  const definitionSentence = normalizeEvidenceText(wikipedia.first_paragraph).split(/(?<=[.!?])\s+/)[0];
  if (!substantiveBrowserDefinition(definitionSentence)) return false;
  let lines = structuredDeliverableLines(deliverable);
  if (/^双来源交付\s*[:：]$/.test(lines[0] || '')) lines = lines.slice(1);
  if (exactUrlOnlyFooter(lines.at(-1), [ianaUrl, wikipediaUrl])) lines = lines.slice(0, -1);
  if (lines.length !== 5) return false;
  const classifiers = [
    line =>
      exactLabeledLine(
        line,
        ['Example Domains', ianaUrl],
        ['IANA', '来源一', '来源1', '标题', 'URL', '完整URL', '网址'],
      ),
    line =>
      exactLabeledLine(
        line,
        ['Web browser', wikipediaUrl],
        ['Wikipedia', '维基百科', '来源二', '来源2', '标题', 'URL', '完整URL', '网址'],
      ),
    line =>
      exactLabeledLine(line, [definitionSentence], ['Wikipedia', '维基百科', '首段', '定义', '第一句', '英文原文']),
    line => substantiveIanaObservation(/^观察\s*(?:一|1)\s*[:：]\s*(.+)$/.exec(line)?.[1]),
    line => substantiveBrowserObservation(/^观察\s*(?:二|2)\s*[:：]\s*(.+)$/.exec(line)?.[1]),
  ];
  const matchedCategories = new Set();
  for (const line of lines) {
    const matches = classifiers.flatMap((classify, index) => (classify(line) ? [index] : []));
    if (matches.length !== 1 || matchedCategories.has(matches[0])) return false;
    matchedCategories.add(matches[0]);
  }
  return matchedCategories.size === classifiers.length;
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

function parseMarkdownRow(line) {
  const text = String(line || '').trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return null;
  const fields = [];
  let field = '';
  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index];
    if (character === '\\' && text[index + 1] === '|') {
      field += '|';
      index += 1;
    } else if (character === '|') {
      fields.push(field.trim());
      field = '';
    } else {
      field += character;
    }
  }
  fields.push(field.trim());
  return fields;
}

/** Drop list wrappers and other empty nodes the DOM oracle may scrape. */
export function productOracleRows(products) {
  if (!Array.isArray(products)) return [];
  return products.filter(
    product =>
      Boolean(normalizeEvidenceText(product?.name)) &&
      Boolean(normalizeEvidenceText(product?.price)) &&
      Boolean(normalizeEvidenceText(product?.rating)),
  );
}

function validatedProductTable(deliverable, products, allowedFormats) {
  const oracleRows = productOracleRows(products);
  if (oracleRows.length < 5) return null;
  const expectedRows = oracleRows.map(product => [product.name, product.price, product.rating]);

  let lines = structuredDeliverableLines(deliverable);
  if (/^商品提取结果\s*[:：]$/.test(lines[0] || '')) lines = lines.slice(1);
  const formatterPrefix = /^已提取 ([1-9]\d*) 件商品（(CSV|Markdown)）：$/.exec(lines[0] || '');
  let declaredFormat = '';
  if (formatterPrefix) {
    if (Number(formatterPrefix[1]) !== expectedRows.length) return null;
    declaredFormat = formatterPrefix[2] === 'CSV' ? 'csv' : 'md';
    lines = lines.slice(1);
  }

  let format = '';
  let actualRows = [];
  let remainder = [];
  const csvHeader = parseCsvLine((lines[0] || '').replace(/^\uFEFF/, ''));
  if (csvHeader?.length === 3 && csvHeader.map(field => field.toLowerCase()).join(',') === 'name,price,rating') {
    format = 'csv';
    actualRows = lines.slice(1, expectedRows.length + 1).map(parseCsvLine);
    remainder = lines.slice(expectedRows.length + 1);
  } else {
    const markdownHeader = parseMarkdownRow(lines[0]);
    const separator = parseMarkdownRow(lines[1]);
    if (
      markdownHeader?.length !== 3 ||
      markdownHeader.map(field => field.toLowerCase()).join(',') !== 'name,price,rating' ||
      separator?.length !== 3 ||
      !separator.every(field => /^:?-{3,}:?$/.test(field))
    ) {
      return null;
    }
    format = 'md';
    actualRows = lines.slice(2, expectedRows.length + 2).map(parseMarkdownRow);
    remainder = lines.slice(expectedRows.length + 2);
  }
  if (!allowedFormats.has(format) || (declaredFormat && declaredFormat !== format)) return null;
  if (actualRows.length !== expectedRows.length || actualRows.some(fields => !fields || fields.length !== 3)) {
    return null;
  }
  const expectedTuples = expectedRows.map(tupleKey).sort();
  const actualTuples = actualRows.map(tupleKey).sort();
  if (expectedTuples.some((tuple, index) => tuple !== actualTuples[index])) return null;
  return { expectedRows, format, remainder };
}

function numericPrice(value) {
  const normalized = String(value || '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : Number.NaN;
}

function containsExactPriceToken(line, price) {
  const escaped = String(price).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...String(line || '').matchAll(new RegExp(escaped, 'gu'))];
  return matches.some(match => {
    const before = line[match.index - 1] || '';
    const after = line[match.index + match[0].length] || '';
    if (before && /[\p{L}\p{N}_.$]/u.test(before)) return false;
    if (after && /[\p{L}\p{N}_]/u.test(after)) return false;
    if (after === '.' && /\d/u.test(line[match.index + match[0].length + 1] || '')) return false;
    return true;
  });
}

const HIGHEST_PRICE_PREDICATE = /最贵|价格最高|最高价格|most\s+expensive|highest[-\s]+priced|highest\s+price/gi;

function highestPriceClaims(line, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return predicateTargetClaims(line, {
    predicate: HIGHEST_PRICE_PREDICATE,
    target: new RegExp(escapedName, 'gi'),
    anchor: 'predicate',
    maxDistance: 72,
  });
}

export function productDeliverablePass(deliverable, products) {
  const parsed = validatedProductTable(deliverable, products, new Set(['csv']));
  if (!parsed || parsed.remainder.length !== 1) return false;
  const { expectedRows } = parsed;

  const pricedRows = expectedRows.map(row => ({ row, price: numericPrice(row[1]) }));
  if (pricedRows.some(item => !Number.isFinite(item.price))) return false;
  const highestPrice = Math.max(...pricedRows.map(item => item.price));
  const mostExpensive = pricedRows.filter(item => item.price === highestPrice).map(item => item.row);
  const [conclusion] = parsed.remainder;
  if (containsDisqualifyingEpistemicClaim(conclusion, { fieldScoped: true })) return false;
  if (!/最贵|价格最高|最高价格|most\s+expensive|highest[-\s]+priced|highest\s+price/i.test(conclusion)) {
    return false;
  }
  return mostExpensive.some(([name, price]) => {
    const line = normalizeEvidenceText(conclusion);
    const claims = highestPriceClaims(line, name);
    if (claims.length === 0 || claims.some(claim => claim.polarity !== 'affirmed')) return false;
    if (!line.includes(String(name)) || !containsExactPriceToken(line, price)) return false;
    return expectedRows.every(([otherName]) => otherName === name || !line.includes(String(otherName)));
  });
}

export function r1ProductDeliverablePass(deliverable, products) {
  const parsed = validatedProductTable(deliverable, products, new Set(['csv', 'md']));
  return Boolean(parsed && parsed.remainder.length === 0);
}

/** null means the evaluator could not establish tab provenance. */
export function wrongTabFromIds(boundTabId, activeTabId) {
  if (!Number.isInteger(boundTabId) || !Number.isInteger(activeTabId)) return null;
  return boundTabId === activeTabId ? 0 : 1;
}
