import { z } from 'zod'

/** Query strings arrive as text; `z.coerce.boolean()` treats every non-empty string as true. */
export const booleanQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform(value => value === 'true'),
]).default(false)
