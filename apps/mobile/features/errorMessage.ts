/** The text of whatever was thrown (an Error's message, or the value as a string). */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
