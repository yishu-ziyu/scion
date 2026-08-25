import { z } from 'zod';
import type { ActionSchema } from './schemas';

function unwrapZodType(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodEffects) {
      current = current._def.schema;
      continue;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current._def.innerType;
      continue;
    }
    return current;
  }
}

function objectShape(schema: z.ZodType): Record<string, z.ZodTypeAny> {
  const current = unwrapZodType(schema as z.ZodTypeAny);
  if (current instanceof z.ZodObject) {
    return current.shape as Record<string, z.ZodTypeAny>;
  }
  return {};
}

function fieldTypeLabel(value: z.ZodTypeAny): string {
  if (value.description) return value.description;
  const inner = unwrapZodType(value);
  if (inner.description) return inner.description;
  if (inner instanceof z.ZodString) return 'string';
  if (inner instanceof z.ZodNumber) return 'number';
  if (inner instanceof z.ZodBoolean) return 'boolean';
  if (inner instanceof z.ZodEnum) return 'enum';
  if (inner instanceof z.ZodArray) return 'array';
  if (inner instanceof z.ZodObject) return 'object';
  return 'unknown';
}

/** Model-facing ACI text for one action schema. Shared by Action.prompt() and the control system prompt. */
export function renderActionSchemaPrompt(schema: ActionSchema): string {
  const schemaProperties = Object.entries(objectShape(schema.schema)).map(([key, value]) => {
    return `'${key}': {'type': '${fieldTypeLabel(value)}', ${value.isOptional() ? "'optional': true" : "'required': true"}}`;
  });

  const schemaStr =
    schemaProperties.length > 0 ? `{${schema.name}: {${schemaProperties.join(', ')}}}` : `{${schema.name}: {}}`;

  const lines = [schema.description];
  if (schema.whenToUse) lines.push(`When to use: ${schema.whenToUse}`);
  if (schema.whenNotToUse) lines.push(`Do NOT use when: ${schema.whenNotToUse}`);
  if (schema.examples?.length) lines.push(`Examples: ${schema.examples.join(' | ')}`);
  if (schema.returns) lines.push(`Returns: ${schema.returns}`);
  if (schema.costHint) lines.push(`Cost hint: ${schema.costHint}`);
  return `${lines.join('\n')}:\n${schemaStr}`;
}
