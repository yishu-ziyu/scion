export type InstructionTarget =
  | 'returned_deliverable'
  | 'most_expensive'
  | 'structured_table'
  | 'conclusion'
  | 'ordered_sources'
  | 'complete_product_table'
  | 'table_format'
  | 'product_row_count';

export type InstructionActor = 'agent' | 'external';
export type InstructionPolarity = 'affirmed' | 'negated';

export interface InstructionTargetMention {
  target: InstructionTarget;
  actor: InstructionActor;
  polarity: InstructionPolarity;
  predicate: string;
  start: number;
  end: number;
  value?: string | number;
}

export interface InstructionClause {
  text: string;
  start: number;
  end: number;
  targets: InstructionTargetMention[];
}

export type InstructionUrlOccurrence = { value: string; start: number; end: number };
export type InstructionLanguageAnalysis = { clauses: InstructionClause[]; urls: InstructionUrlOccurrence[] };

type Span = { start: number; end: number };

const URL_LITERAL = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+=%]+/gi;
const CLAUSE_DELIMITER = /[\n，,；;。.!！？?+]/;
const COORDINATOR = /并且|而且|但是|并(?!非)|且|但|而|\b(?:and|but)\b/gi;
const OUTPUT_ACTION =
  /返回|输出|回复|回答|给出|提供|写(?:出)?|列出|总结|摘要|概括|说明|指出|报告|告诉|交付|复制|提取|抽取|导出|识别|找出|查找|查询|查|\b(?:return|answer|output|provid|giv|tell|told|writ|list|summari|report|stat|describ|identif|extract|export|cop|quot)\w*\b/gi;
const OMISSION_ACTION =
  /漏掉|遗漏|省略|\b(?:omit(?:s|ted|ting)?|skip(?:s|ped|ping)?|leave\s+out|leaves\s+out|left\s+out)\b/gi;
const QUESTION_ACTION =
  /是什么|是多少|是否|有没有|谁|何时|什么时候|多少钱|\b(?:what|who|when|how\s+many|how\s+much|does)\b/gi;
const DISCOVERY_ACTION = /找出|查找|寻找|识别|确定|找|\b(?:find\w*|found|locat\w*|determin\w*|identif\w*)\b/gi;
const TABLE_ACTION = /整理成|做成|制作|生成|做|显示|展示|\b(?:mak\w*|made|creat\w*|format\w*|display\w*|show\w*)\b/gi;
const NAVIGATION_ACTION =
  /访问|打开|进入|前往|回到|\b(?:visit\w*|open\w*|navigat\w*\s+to|go\w*\s+to|went\s+to|return\w*\s+to)\b/gi;
const MOST_EXPENSIVE = /最贵|价格最高|最高价(?:格)?|\b(?:most\s+expensive|highest[-\s]+priced|highest\s+price)\b/i;
const TABLE_OBJECT = /对比表格|数据表|表格|清单|CSV|Markdown|\b(?:csv|markdown|table)\b/i;
const CONCLUSION_OBJECT = /结论|\bconclusions?\b/i;
const TABLE_FORMAT = /CSV|Markdown|\b(?:csv|markdown)\b/gi;
const COMPLETE_PRODUCT_TABLE =
  /(?:所有|全部|完整)(?:的)?(?:行|商品|产品|列表|清单)|\b(?:all|every|complete)\s+(?:rows?|products?|items?|list(?:ing)?s?)\b/gi;
const PRODUCT_ROW_COUNT =
  /(?:只\s*)?(?:前|最多)\s*([一二两三四五六七八九十]|\d{1,2})(?:\s*(?:个|件|行|项|商品|产品))?|([一二两三四五六七八九十]|\d{1,2})\s*(?:行|(?:个|件)?(?:商品|产品))|\b(?:first|top|only)\s+(\d{1,2})\b/gi;
const ANTI_FABRICATION_ACTION = /猜|编造|杜撰|\b(?:guess|invent|fabricate)\b/i;
const DELIVERABLE_OBJECT =
  /答案|结果|内容|数据|表格|清单|报告|结论|摘要|观察|输出|回复|交付|\b(?:answer|result|content|data|table|list|report|conclusion|summary|output|response|deliverable)\b/i;
const ORDER_MODE = /依次|按顺序|\b(?:in\s+order|sequentially)\b/gi;
const ORDER_TRANSITION =
  /先|再|然后|随后|接着|接下来|继而|之后|最后|\b(?:then|next|after\s+that|afterwards?|before|later|subsequently|finally|followed\s+by)\b/gi;
const ORDINAL =
  /(?:^|[\n；;。])\s*\d{1,2}\s*[.)、：:]|第\s*(?:[一二两三四五六七八九十]|\d{1,2})\s*(?:步|项|个|阶段)|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi;
const EXTERNAL_ACTOR_SUFFIX =
  /(?:接口|API|服务|系统|页面|网页|网站|标签页)(?:将|会|已|已经|尚未|正在)?\s*$|(?:(?:the|this|current)\s+)?(?:page|webpage|site|tab|api|interface|service|system)(?:\s+(?:will|has|had|does|did|can|may|must|to))?\s*$/i;
const EXTERNAL_ACTOR_LEAD =
  /^\s*(?:当|一旦|等|待)?\s*(?:接口|API|服务|系统|页面|网页|网站|标签页)|^\s*(?:(?:once|when|after|until)\s+|wait\s+for\s+)?(?:(?:the|this|current)\s+)?(?:page|webpage|site|tab|api|interface|service|system)\b/i;

function normalizedUrlLiteral(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** ASCII URL lexer: Unicode prose adjacent to a URL is never part of the literal. */
export function extractInstructionUrlOccurrences(instruction: string): InstructionUrlOccurrence[] {
  const occurrences: InstructionUrlOccurrence[] = [];
  for (const match of instruction.matchAll(URL_LITERAL)) {
    let raw = match[0];
    while (/[.!?]$/.test(raw)) raw = raw.slice(0, -1);
    while (raw.endsWith(')') && raw.split(')').length > raw.split('(').length) raw = raw.slice(0, -1);
    while (raw.endsWith(']') && raw.split(']').length > raw.split('[').length) raw = raw.slice(0, -1);
    const value = normalizedUrlLiteral(raw);
    if (!value) continue;
    occurrences.push({ value, start: match.index, end: match.index + raw.length });
  }
  return occurrences;
}

function trimSpan(source: string, start: number, end: number): Span | null {
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
}

function instructionClauseSpans(instruction: string, urls: InstructionUrlOccurrence[]): Span[] {
  const protectedPositions = new Uint8Array(instruction.length);
  for (const url of urls) protectedPositions.fill(1, url.start, url.end);
  const spans: Span[] = [];
  let cursor = 0;
  for (let index = 0; index < instruction.length; index += 1) {
    if (!protectedPositions[index] && CLAUSE_DELIMITER.test(instruction[index])) {
      const span = trimSpan(instruction, cursor, index);
      if (span) spans.push(span);
      cursor = index + 1;
    }
  }
  const finalSpan = trimSpan(instruction, cursor, instruction.length);
  if (finalSpan) spans.push(finalSpan);
  return spans;
}

function lastCoordinatorEnd(clause: string, before: number): number {
  let end = 0;
  for (const match of clause.slice(0, before).matchAll(COORDINATOR)) end = match.index + match[0].length;
  return end;
}

function nextCoordinatorStart(clause: string, after: number): number {
  const match = COORDINATOR.exec(clause.slice(after));
  COORDINATOR.lastIndex = 0;
  return match ? after + match.index : clause.length;
}

function chineseNegationCount(prefix: string): number {
  const composite = [...prefix.matchAll(/不要|不可|不得|不能|不必|无需|无须|勿|别/g)].length;
  const semantic = [...prefix.matchAll(/忘(?:记|了)?(?:要)?\s*$/g)].length;
  const terminalBare = /不\s*$/.test(prefix) ? 1 : 0;
  const leadingBare = /^\s*(?:请\s*)?不(?!要|可|得|能|必|同|仅|止|过|管|但|如)/.test(prefix) ? 1 : 0;
  return composite + semantic + Math.max(terminalBare, leadingBare);
}

function englishNegationCount(prefix: string, suffix: string): number {
  const explicit = [
    ...prefix.matchAll(/\b(?:do\s+not|does\s+not|did\s+not|don['’]t|doesn['’]t|didn['’]t|never|not)\b/gi),
  ].filter(match => !/^not\s+only\b/i.test(prefix.slice(match.index))).length;
  const semantic = [...prefix.matchAll(/\b(?:fail(?:s|ed)?|forget(?:s|ting|got)?)\s+to\b/gi)].length;
  const postposed = /\b(?:nowhere|not\s+anywhere)\b/i.test(suffix) ? 1 : 0;
  return explicit + semantic + postposed;
}

function predicatePolarity(clause: string, predicateStart: number, predicateEnd: number, baseNegative = false) {
  let scopeStart = lastCoordinatorEnd(clause, predicateStart);
  const previousFormat = [...clause.slice(scopeStart, predicateStart).matchAll(TABLE_FORMAT)].at(-1);
  if (previousFormat) scopeStart += previousFormat.index + previousFormat[0].length;
  const scopeEnd = nextCoordinatorStart(clause, predicateEnd);
  const prefix = clause.slice(scopeStart, predicateStart);
  const suffix = clause.slice(predicateEnd, scopeEnd);
  const count = chineseNegationCount(prefix) + englishNegationCount(prefix, suffix) + (baseNegative ? 1 : 0);
  return count % 2 === 0 ? ('affirmed' as const) : ('negated' as const);
}

function predicateActor(clause: string, predicateStart: number, predicateEnd: number): InstructionActor {
  const scopeStart = lastCoordinatorEnd(clause, predicateStart);
  const scopeEnd = nextCoordinatorStart(clause, predicateEnd);
  const prefix = clause.slice(scopeStart, predicateStart);
  const suffix = clause.slice(predicateEnd, scopeEnd);
  if (/(?:给我|告诉我)/.test(suffix) || /\b(?:to|for)\s+me\b/i.test(suffix)) return 'agent';
  if (/(?:^|\s)(?:请|你)(?:\s|$)/.test(prefix) || /\b(?:please|you)\b/i.test(prefix)) return 'agent';
  return EXTERNAL_ACTOR_SUFFIX.test(prefix) || EXTERNAL_ACTOR_LEAD.test(clause) ? 'external' : 'agent';
}

function mentionFromMatch(
  target: InstructionTarget,
  clause: string,
  clauseStart: number,
  match: RegExpMatchArray,
  baseNegative = false,
  value?: string | number,
): InstructionTargetMention {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return {
    target,
    actor: predicateActor(clause, start, end),
    polarity: predicatePolarity(clause, start, end, baseNegative),
    predicate: match[0],
    start: clauseStart + start,
    end: clauseStart + end,
    ...(value === undefined ? {} : { value }),
  };
}

function returnedDeliverableMentions(clause: string, clauseStart: number): InstructionTargetMention[] {
  const mentions = [...clause.matchAll(OUTPUT_ACTION), ...clause.matchAll(QUESTION_ACTION)].map(match =>
    mentionFromMatch('returned_deliverable', clause, clauseStart, match),
  );
  for (const match of clause.matchAll(OMISSION_ACTION)) {
    if (!DELIVERABLE_OBJECT.test(clause.slice(match.index + match[0].length))) continue;
    mentions.push(mentionFromMatch('returned_deliverable', clause, clauseStart, match, true));
  }
  return mentions
    .filter(
      mention =>
        ![...mention.predicate.matchAll(NAVIGATION_ACTION)].length &&
        !/^(?:返回|return\w*)\s*(?:到\s*)?(?:上一页|首页|主页|列表|商品页|产品页|详情页|to\b)/i.test(
          clause.slice(mention.start - clauseStart),
        ),
    )
    .map(mention => {
      const localStart = mention.start - clauseStart;
      const scope = clause.slice(lastCoordinatorEnd(clause, localStart), nextCoordinatorStart(clause, localStart));
      const object = new RegExp(DELIVERABLE_OBJECT.source, DELIVERABLE_OBJECT.flags).exec(scope)?.[0];
      return { ...mention, value: (object ?? mention.predicate).toLowerCase() };
    })
    .sort((left, right) => left.start - right.start);
}

function matchesAsMentions(
  target: InstructionTarget,
  clause: string,
  clauseStart: number,
  pattern: RegExp,
): InstructionTargetMention[] {
  return [...clause.matchAll(pattern)].map(match => mentionFromMatch(target, clause, clauseStart, match));
}

function nearestRetargeted(
  target: InstructionTarget,
  targetIndex: number,
  mentions: InstructionTargetMention[],
  clauseStart: number,
): InstructionTargetMention | null {
  const nearest = mentions.sort(
    (left, right) =>
      Math.abs(left.start - clauseStart - targetIndex) - Math.abs(right.start - clauseStart - targetIndex),
  )[0];
  return nearest ? { ...nearest, target } : null;
}

function semanticTargetMentions(
  target: 'structured_table' | 'conclusion',
  clause: string,
  clauseStart: number,
  objectPattern: RegExp,
  returned: InstructionTargetMention[],
  extraAction?: RegExp,
): InstructionTargetMention[] {
  const objects = [...clause.matchAll(new RegExp(objectPattern.source, `${objectPattern.flags.replace('g', '')}g`))];
  if (objects.length === 0) return [];
  const actions = [...returned, ...(extraAction ? matchesAsMentions(target, clause, clauseStart, extraAction) : [])];
  return objects.flatMap(object => {
    const mention = nearestRetargeted(target, object.index, [...actions], clauseStart);
    return mention && ![...mention.predicate.matchAll(NAVIGATION_ACTION)].length ? [mention] : [];
  });
}

function mostExpensiveMentions(
  clause: string,
  clauseStart: number,
  returned: InstructionTargetMention[],
  inheritsReferent: boolean,
): InstructionTargetMention[] {
  const targets = [...clause.matchAll(new RegExp(MOST_EXPENSIVE.source, 'gi'))];
  const targetMatch = targets[0];
  const referents = [...clause.matchAll(/它|该商品|这个商品|\bit\b|\bthat\s+(?:product|item)\b/gi)];
  if (!targetMatch && !(inheritsReferent && referents.length > 0)) return [];

  const actions = [...returned, ...matchesAsMentions('most_expensive', clause, clauseStart, DISCOVERY_ACTION)].filter(
    mention => ![...mention.predicate.matchAll(NAVIGATION_ACTION)].length,
  );
  const applicableTargets = [...targets, ...(inheritsReferent || targets.length > 0 ? referents : [])];
  const mentions = applicableTargets.flatMap(target => {
    const mention = nearestRetargeted('most_expensive', target.index, [...actions], clauseStart);
    return mention ? [mention] : [];
  });
  if (mentions.length > 0) return mentions;
  if (ANTI_FABRICATION_ACTION.test(clause) || !targetMatch) return [];
  if ([...clause.matchAll(NAVIGATION_ACTION)].length || EXTERNAL_ACTOR_LEAD.test(clause)) return [];
  return [mentionFromMatch('most_expensive', clause, clauseStart, targetMatch)];
}

function tableShapeMentions(clause: string, clauseStart: number): InstructionTargetMention[] {
  const formats = [...clause.matchAll(TABLE_FORMAT)];
  return [
    ...formats.map(match =>
      mentionFromMatch('table_format', clause, clauseStart, match, false, /^markdown$/i.test(match[0]) ? 'md' : 'csv'),
    ),
    ...[...clause.matchAll(COMPLETE_PRODUCT_TABLE)].map(match =>
      mentionFromMatch('complete_product_table', clause, clauseStart, match),
    ),
    ...[...clause.matchAll(PRODUCT_ROW_COUNT)].flatMap(match => {
      const token = match[1] ?? match[2] ?? match[3];
      const count = Number(token) || (token === '两' ? 2 : '一二三四五六七八九十'.indexOf(token) + 1);
      return Number.isInteger(count) && count > 0
        ? [mentionFromMatch('product_row_count', clause, clauseStart, match, false, count)]
        : [];
    }),
  ];
}

function clauseForPosition(clauses: InstructionClause[], position: number): InstructionClause | null {
  return clauses.find(clause => position >= clause.start && position < clause.end) ?? null;
}

function orderedSourceMention(
  instruction: string,
  urls: InstructionUrlOccurrence[],
  clauses: InstructionClause[],
): InstructionTargetMention | null {
  const mode = [...instruction.matchAll(ORDER_MODE)][0];
  const gaps = urls.slice(1).map((url, index) => instruction.slice(urls[index].end, url.start));
  const transitions = gaps.map(gap => [...gap.matchAll(ORDER_TRANSITION)][0]);
  const everyGapOrdered = urls.length >= 2 && transitions.every(Boolean);
  const ordinals = [...instruction.matchAll(ORDINAL)];
  const ordinal = urls.length >= 2 && ordinals.length >= urls.length ? ordinals[0] : null;
  const pairedTransition =
    /(?:先|首先)[\s\S]+?(?:再|然后|随后|接着)|\b(?:first|start\s+with)\b[\s\S]+?\b(?:then|next|afterwards?)\b/i.exec(
      instruction,
    );
  if (!mode && !everyGapOrdered && !ordinal && !pairedTransition) return null;

  let predicate = mode ?? ordinal ?? pairedTransition;
  let predicateStart = predicate?.index ?? 0;
  if (!predicate && transitions[0]) {
    predicate = transitions[0];
    predicateStart = urls[0].end + transitions[0].index;
  }
  if (!predicate) return null;

  const predicateClause = clauseForPosition(clauses, predicateStart);
  let polarity: InstructionPolarity = 'affirmed';
  let actor: InstructionActor = 'agent';
  if (predicateClause) {
    const localStart = predicateStart - predicateClause.start;
    polarity = predicatePolarity(predicateClause.text, localStart, localStart + predicate[0].length);
    actor = predicateActor(predicateClause.text, localStart, localStart + predicate[0].length);
  }

  return {
    target: 'ordered_sources',
    actor,
    polarity,
    predicate: predicate[0],
    start: predicateStart,
    end: predicateStart + predicate[0].length,
  };
}

export function analyzeInstructionLanguage(instruction: string): InstructionLanguageAnalysis {
  const urls = extractInstructionUrlOccurrences(instruction);
  const clauses: InstructionClause[] = [];
  let mostExpensiveReferent = false;
  for (const span of instructionClauseSpans(instruction, urls)) {
    const text = instruction.slice(span.start, span.end);
    const returned = returnedDeliverableMentions(text, span.start).filter(
      mention => !urls.some(url => mention.start >= url.start && mention.start < url.end),
    );
    const shapes = tableShapeMentions(text, span.start);
    const targets = [
      ...returned,
      ...mostExpensiveMentions(text, span.start, returned, mostExpensiveReferent),
      ...semanticTargetMentions('structured_table', text, span.start, TABLE_OBJECT, returned, TABLE_ACTION),
      ...semanticTargetMentions('conclusion', text, span.start, CONCLUSION_OBJECT, returned),
      ...shapes,
      ...shapes
        .filter(mention => mention.target === 'table_format')
        .map(mention => ({ ...mention, target: 'structured_table' as const })),
    ];
    clauses.push({ text, ...span, targets });
    mostExpensiveReferent = MOST_EXPENSIVE.test(text);
  }

  const ordered = orderedSourceMention(instruction, urls, clauses);
  if (ordered) clauseForPosition(clauses, ordered.start)?.targets.push(ordered);
  return { clauses, urls };
}

export function instructionAffirmsTarget(analysis: InstructionLanguageAnalysis, target: InstructionTarget): boolean {
  const mentions = analysis.clauses
    .flatMap(clause => clause.targets)
    .filter(mention => mention.target === target && mention.actor === 'agent')
    .sort((left, right) => left.start - right.start);
  if (target !== 'returned_deliverable') return mentions.at(-1)?.polarity === 'affirmed';
  return mentions.some(
    (mention, index) =>
      mention.polarity === 'affirmed' &&
      !mentions.slice(index + 1).some(candidate => candidate.value === mention.value),
  );
}

export function instructionAffirmedTargetValue(
  analysis: InstructionLanguageAnalysis,
  target: 'table_format' | 'product_row_count',
): string | number | undefined {
  const mentions = analysis.clauses
    .flatMap(clause => clause.targets)
    .filter(mention => mention.target === target && mention.actor === 'agent')
    .sort((left, right) => left.start - right.start);
  return mentions
    .filter(
      (mention, index) =>
        mention.polarity === 'affirmed' &&
        !mentions.slice(index + 1).some(candidate => candidate.value === mention.value),
    )
    .at(-1)?.value;
}
