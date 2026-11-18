import type { z } from 'zod';

/** Parses input with a zod schema; a ZodError becomes a 400 in the error handler. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input ?? {});
}
