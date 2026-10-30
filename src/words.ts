/**
 * Word boundaries for text editing, following readline:
 * - a "word" is a run of letters, digits, combining marks, and `_`, so
 *   `/var/www/data` is three words and ctrl+left stops at each;
 * - a "big word" is a run of non-whitespace, used by ctrl+w
 *   (`unix-word-rubout`) to delete a whole path at once.
 *
 * Offsets are UTF-16 indices; the functions step by code point, so they never
 * split a surrogate pair.
 */

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
const SPACE = /\s/;

/** The code point ending at `offset`. */
function before(text: string, offset: number): string {
  const low = text.charCodeAt(offset - 1);

  if (low >= 0xdc00 && low <= 0xdfff && offset >= 2) {
    const high = text.charCodeAt(offset - 2);

    if (high >= 0xd800 && high <= 0xdbff) {
      return text.slice(offset - 2, offset);
    }
  }

  return text[offset - 1];
}

/** The code point starting at `offset`. */
function after(text: string, offset: number): string {
  return String.fromCodePoint(text.codePointAt(offset)!);
}

/** Start of the word before `offset`: skip separators, then word characters, stopping at `min`. */
export function wordStart(text: string, offset: number, min = 0): number {
  let i = offset;

  while (i > min) {
    const char = before(text, i);

    if (WORD_CHAR.test(char)) {
      break;
    }

    i -= char.length;
  }

  while (i > min) {
    const char = before(text, i);

    if (!WORD_CHAR.test(char)) {
      break;
    }

    i -= char.length;
  }

  return i;
}

/** End of the word after `offset`: skip separators, then word characters, stopping at `max`. */
export function wordEnd(
  text: string,
  offset: number,
  max = text.length,
): number {
  let i = offset;

  while (i < max) {
    const char = after(text, i);

    if (WORD_CHAR.test(char)) {
      break;
    }

    i += char.length;
  }

  while (i < max) {
    const char = after(text, i);

    if (!WORD_CHAR.test(char)) {
      break;
    }

    i += char.length;
  }

  return i;
}

/** Start of the whitespace-delimited word before `offset`, stopping at `min` (ctrl+w). */
export function bigWordStart(text: string, offset: number, min = 0): number {
  let i = offset;

  while (i > min && SPACE.test(text[i - 1])) {
    i--;
  }

  while (i > min && !SPACE.test(text[i - 1])) {
    i--;
  }

  return i;
}
