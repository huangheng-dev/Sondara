export const pickProvided = <T extends Record<string, unknown>>(input: unknown, parsed: T): Partial<T> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.prototype.hasOwnProperty.call(source, key))) as Partial<T>
}
