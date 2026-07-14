export const RECORD_NAME_ERROR = 'Name must be 1–40 characters.';

export function isValidRecordName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= 1 && length <= 40;
}

export function normalizeRecordName(value: string): string {
  if (!isValidRecordName(value)) throw new Error(RECORD_NAME_ERROR);
  return value.trim();
}
