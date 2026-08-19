const MAX_ATOMIC_INSTRUCTION_CHARS = 320;

const STRUCTURED_LONG_HORIZON_MARKERS =
  /第\s*[一二三四五六七八九十\d]+\s*(?:阶段|步)|(?:first|second|third|fourth|fifth|final)\s+(?:stage|step)|多阶段|双来源|多步骤|multi-?phase|two[- ]sources/i;
const SEQUENTIAL_ACTION_MARKERS =
  /然后|接着|随后|再然后|最后|then|after\s+that|finally|(?:并|并且).{0,8}(?:打开第|点开第|写出|写下|总结|搜索|记录|记下)/i;
const NUMBERED_STEP = /(?:^|[\s；;：:])\d{1,2}\s*[)）.、]\s*/g;

/**
 * The current Skill Runtime receives the original task instruction, not a phase-scoped subgoal.
 * Until phase-local skill inputs exist, deterministic skills must only preempt concise atomic tasks.
 */
export function isAtomicSkillInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_ATOMIC_INSTRUCTION_CHARS) return false;
  if (STRUCTURED_LONG_HORIZON_MARKERS.test(text)) return false;
  if (SEQUENTIAL_ACTION_MARKERS.test(text)) return false;
  if ((text.match(NUMBERED_STEP) ?? []).length >= 2) return false;
  if ((text.match(/(?:至少|at\s+least)/gi) ?? []).length > 1) return false;
  return true;
}
