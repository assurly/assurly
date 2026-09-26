/**
 * Everything the connector returns is read by a language model, and some of it
 * (a masked key, a status line) was shaped by the site being scanned. Control
 * characters, bidi overrides, zero-width characters, variation selectors and
 * Unicode tag characters (used to smuggle invisible ASCII) are removed so a
 * value cannot hide text or start a new instruction line, whitespace
 * collapses, and the length is capped.
 */
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

export function toSafeText(value: string, maxLength: number): string {
  const cleaned = value.replace(INVISIBLE_OR_CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}
