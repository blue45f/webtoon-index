/**
 * Korean Hangul Chosung (초성) and fuzzy search utility for the ToonSpectrum Command Palette.
 * Supports Korean consonant decomposition, prefix matching, and multi-keyword synonyms.
 */

const CHOSUNG_LIST = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/**
 * Extracts Korean Chosung (initial consonants) from a string.
 * Non-Hangul characters are preserved as-is.
 */
export function extractChosung(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 44032;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG_LIST[Math.floor(code / 588)];
    } else {
      result += str.charAt(i);
    }
  }
  return result;
}

/**
 * Checks if a string contains only Korean Chosung consonants.
 */
export function isChosungOnly(str: string): boolean {
  if (!str) return false;
  return /^[ㄱ-ㅎ\s]+$/.test(str);
}

/**
 * Matches target text against query supporting:
 * 1. Direct substring search (case-insensitive)
 * 2. Korean Chosung search (e.g. 'ㅅㅌㄷㅇ' -> '스튜디오')
 * 3. Additional keywords/synonyms search
 */
export function matchesCommandSearch(
  target: string,
  query: string,
  keywords?: readonly string[],
  subtitle?: string
): boolean {
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ) return true;

  const cleanT = target.toLowerCase();
  if (cleanT.includes(cleanQ)) return true;

  if (subtitle && subtitle.toLowerCase().includes(cleanQ)) return true;

  // Chosung matching
  if (isChosungOnly(cleanQ)) {
    const targetChosung = extractChosung(cleanT);
    if (targetChosung.includes(cleanQ)) return true;
    if (subtitle && extractChosung(subtitle.toLowerCase()).includes(cleanQ)) return true;
  }

  // Also check if target's chosung matches the query's chosung
  const targetChosung = extractChosung(cleanT);
  const queryChosung = extractChosung(cleanQ);
  if (targetChosung.includes(queryChosung)) return true;

  // Synonyms and aliases matching
  if (keywords && keywords.length > 0) {
    for (const kw of keywords) {
      const cleanKw = kw.toLowerCase();
      if (cleanKw.includes(cleanQ)) return true;
      if (isChosungOnly(cleanQ) && extractChosung(cleanKw).includes(cleanQ)) return true;
      if (extractChosung(cleanKw).includes(queryChosung)) return true;
    }
  }

  return false;
}
