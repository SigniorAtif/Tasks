// Delete asks for the name of what it's about to delete, when deleting would
// lose history. Typing it is a speed bump and not a password, so the check is
// forgiving: "classes sem 3" is good enough for "Classes · Sem 3".

/**
 * Lowercase Unicode letters and digits; case, spaces and symbols dropped. So
 * are the marks some scripts write their vowels with (Hindi, Thai, Arabic):
 * forgiving there too, and an emoji's invisible modifiers never count.
 */
function lettersAndDigits(text: string): string {
  // NFKC first, so an accent typed as its own character joins its letter.
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Whether `typed` names `name`: the two are equal once only their letters and
 * digits are left, whatever the script. A name with none (emoji only) has to be
 * typed exactly, give or take the spaces around it, so an empty input never
 * matches.
 */
export function nameMatches(name: string, typed: string): boolean {
  const wanted = lettersAndDigits(name);
  if (wanted === '') return typed.trim() === name.trim();
  return lettersAndDigits(typed) === wanted;
}
