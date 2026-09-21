/**
 * Pulls a JSON value out of a model response.
 *
 * Models are asked to answer with JSON only, but they sometimes wrap it in a
 * fenced code block or add a sentence around it. Three attempts, cheapest
 * first — this mirrors what `sample.json` did on claude.ai:
 *
 *   1. the whole response,
 *   2. the contents of a ``` fenced block,
 *   3. the slice from the first `{`/`[` to the last matching `}`/`]`.
 *
 * The result is a discriminated union rather than `unknown | null`, because a
 * model that answers with the literal `null` did return valid JSON — that is
 * not the same thing as "no JSON found here".
 */
export type JsonExtractResult = { ok: true; value: unknown } | { ok: false };

export function extractJson(raw: string): JsonExtractResult {
  const text = raw.trim();
  if (!text) return { ok: false };

  const direct = tryParse(text);
  if (direct.ok) return direct;

  for (const block of fencedBlocks(text)) {
    const parsed = tryParse(block);
    if (parsed.ok) return parsed;
  }

  const sliced = outermostSlice(text);
  if (sliced !== null) {
    const parsed = tryParse(sliced);
    if (parsed.ok) return parsed;
  }

  return { ok: false };
}

function tryParse(text: string): JsonExtractResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Every ```…``` block in the text, with an optional language tag stripped. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```[ \t]*[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

/**
 * The widest `{...}` or `[...]` span in the text. Whichever bracket comes
 * first decides which closing bracket we look for, so an object containing an
 * array (or the other way round) is not cut in half.
 */
function outermostSlice(text: string): string | null {
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return null;

  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  const closing = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(closing);
  if (end <= start) return null;

  return text.slice(start, end + 1);
}
