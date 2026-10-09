// ── Tool argument readers ──
// Each throws an `Error` naming the argument when the model sent the wrong type, which the MCP
// handler turns into an `isError` result. `null` means "clear this field" where a reader allows it.

import type { IcalDateValue } from '@spy4x/time/ical';
import { TodoStatus } from '@spy4x/time/ical-tasks';
import { parseDateArg, startInstant } from '../caldav/dates.ts';
import type { EngineResult } from '../caldav/types.ts';

export type Args = Record<string, unknown>;

const TODO_STATUSES: Record<string, TodoStatus> = {
  'NEEDS-ACTION': TodoStatus.NeedsAction,
  'IN-PROCESS': TodoStatus.InProcess,
  'COMPLETED': TodoStatus.Completed,
  'CANCELLED': TodoStatus.Cancelled,
};

export const TODO_STATUS_ENUM = Object.keys(TODO_STATUSES);

/** JSON Schema of a date argument; `nullable` adds `null` to clear it. */
export function dateSchema(description: string, nullable = false) {
  return {
    type: nullable ? ['string', 'null'] : 'string',
    description: `${description}. \`YYYY-MM-DD\` for a whole day, \`YYYY-MM-DDTHH:MM:SSZ\` or ` +
      `with an offset (\`+07:00\`) for a moment, \`YYYY-MM-DDTHH:MM:SS[Area/City]\` to keep a ` +
      `time zone the task already uses${nullable ? '; null clears it' : ''}.`,
  };
}

function bad(name: string, what: string): never {
  throw new Error(`${name} must be ${what}`);
}

export function requiredString(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value === '') bad(name, 'a non-empty string');
  return value;
}

export function optionalString(args: Args, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') bad(name, 'a string');
  return value;
}

/** `undefined` leaves the field alone, `null` clears it. */
export function nullableString(args: Args, name: string): string | null | undefined {
  const value = args[name];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') bad(name, 'a string or null');
  return value;
}

export function nullableInteger(
  args: Args,
  name: string,
  min: number,
  max: number,
): number | null | undefined {
  const value = args[name];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    bad(name, `an integer from ${min} to ${max}, or null`);
  }
  return value;
}

export function optionalInteger(args: Args, name: string, min: number, max: number) {
  const value = nullableInteger(args, name, min, max);
  return value ?? undefined;
}

export function optionalBoolean(args: Args, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') bad(name, 'true or false');
  return value;
}

export function nullableStringList(args: Args, name: string): string[] | null | undefined {
  const value = args[name];
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    bad(name, 'an array of strings, or null');
  }
  return value as string[];
}

export function nullableDate(args: Args, name: string): IcalDateValue | null | undefined {
  const value = args[name];
  if (value === undefined || value === null) return value;
  const parsed = typeof value === 'string' ? parseDateArg(value) : undefined;
  if (!parsed) bad(name, 'a date like 2026-10-12, 2026-10-12T09:00:00Z or null');
  return parsed;
}

/** A filter bound as an instant; whole days and floating times are read in `zone`. */
export function optionalInstant(args: Args, name: string, zone?: string): Date | undefined {
  const value = nullableDate(args, name);
  if (!value) return undefined;
  const instant = startInstant(value, zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!instant) bad(name, 'a date in a known time zone');
  return instant;
}

export function todoStatus(args: Args, name: string): TodoStatus | null | undefined {
  const value = args[name];
  if (value === undefined || value === null) return value;
  const status = typeof value === 'string' ? TODO_STATUSES[value.toUpperCase()] : undefined;
  if (!status) bad(name, `one of ${TODO_STATUS_ENUM.join(', ')}`);
  return status;
}

/** The engine's output, or `{ error, code }` that the MCP handler marks `isError`. */
export function reply<T>(result: EngineResult<T>): T | { error: string; code: string } {
  return result.success ? result.output : { error: result.error.message, code: result.error.code };
}
