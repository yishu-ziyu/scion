function globalRegex(pattern) {
  if (!(pattern instanceof RegExp)) throw new TypeError('claim pattern must be a RegExp');
  return new RegExp(pattern.source, [...new Set(`${pattern.flags.replace(/[gy]/g, '')}g`)].join(''));
}

function matches(pattern, value) {
  return [...String(value || '').matchAll(globalRegex(pattern))];
}

function semanticClauses(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/[\n。！？；!?;]+/)
    .map(clause => clause.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const NEGATION =
  /\bby\s+no\s+means\b|\b(?:did|do|does|is|are|was|were|have|has|had)\s+not\b|\b(?:cannot|can't|never|not|no)\b|并不是|并没有|并非|绝非|从未|未曾|并未|不是|没有|不要|不得|不能|不可|无法|禁止|切勿|请勿|别|没|未|不|非/gi;

const CONTRAST_BOUNDARY =
  /(?:[,，:：]|但是|然而|不过|而是|但|却|只是|只|且|并且|并(?!(?:非|未|不|没))|而且|\bbut\b|\bhowever\b|\brather\b|\bonly\b|\band\b)/gi;
const WEAK_PERMISSION = /(?:未|没有|并未)(?:明确)?禁止|\bnot\s+(?:explicitly\s+)?(?:prohibited|forbidden)\b/i;

function localPredicatePrefix(clause, predicateIndex) {
  const prefix = clause.slice(0, predicateIndex);
  const boundaries = [...prefix.matchAll(CONTRAST_BOUNDARY)];
  const local = boundaries.length > 0 ? prefix.slice(boundaries.at(-1).index + boundaries.at(-1)[0].length) : prefix;
  return local.slice(-64);
}

function predicatePolarity(clause, predicateIndex) {
  const prefix = localPredicatePrefix(clause, predicateIndex);
  if (WEAK_PERMISSION.test(prefix)) return 'uncertain';
  return matches(NEGATION, prefix).length % 2 === 0 ? 'affirmed' : 'negated';
}

function distance(left, right) {
  if (left.index + left[0].length <= right.index) return right.index - (left.index + left[0].length);
  if (right.index + right[0].length <= left.index) return left.index - (right.index + right[0].length);
  return 0;
}

/**
 * Resolve local claims as predicate + target + negation parity.
 * `anchor` selects which side owns the relation when one predicate or target is shared.
 */
export function predicateTargetClaims(
  value,
  { predicate, target, anchor = 'predicate', allowImplicitTarget = false, maxDistance = 96 },
) {
  const claims = [];
  for (const clause of semanticClauses(value)) {
    const predicates = matches(predicate, clause);
    const targets = target ? matches(target, clause) : [];
    if (allowImplicitTarget && targets.length === 0) {
      for (const predicateMatch of predicates) {
        claims.push({
          clause,
          predicate: predicateMatch[0],
          target: '',
          polarity: predicatePolarity(clause, predicateMatch.index),
        });
      }
      continue;
    }
    const owners = anchor === 'target' ? targets : predicates;
    const candidates = anchor === 'target' ? predicates : targets;
    for (const owner of owners) {
      const nearest = candidates
        .map(candidate => ({ candidate, distance: distance(owner, candidate) }))
        .filter(candidate => candidate.distance <= maxDistance)
        .sort((left, right) => left.distance - right.distance)[0]?.candidate;
      if (!nearest) continue;
      const predicateMatch = anchor === 'target' ? nearest : owner;
      const targetMatch = anchor === 'target' ? owner : nearest;
      claims.push({
        clause,
        predicate: predicateMatch[0],
        target: targetMatch[0],
        polarity: predicatePolarity(clause, predicateMatch.index),
      });
    }
  }
  return claims;
}

export function hasAffirmedPredicateTarget(value, options) {
  return predicateTargetClaims(value, options).some(claim => claim.polarity === 'affirmed');
}
