import { extractJson } from './json-extract';

/** Test helper: the parsed value, or a thrown error when extraction failed. */
function value(raw: string): unknown {
  const result = extractJson(raw);
  if (!result.ok) throw new Error(`expected JSON to be extracted from: ${raw}`);
  return result.value;
}

describe('extractJson', () => {
  describe('attempt 1 — the whole response', () => {
    it('parses a clean JSON object', () => {
      expect(value('{"pass": true, "feedback": "ok"}')).toEqual({ pass: true, feedback: 'ok' });
    });

    it('parses a clean JSON array', () => {
      expect(value('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('ignores surrounding whitespace', () => {
      expect(value('\n\n  {"a":1}  \n')).toEqual({ a: 1 });
    });

    it('accepts JSON scalars, including a literal null', () => {
      expect(value('true')).toBe(true);
      expect(value('42')).toBe(42);
      expect(value('"hello"')).toBe('hello');
      expect(value('null')).toBeNull();
    });
  });

  describe('attempt 2 — fenced code blocks', () => {
    it('unwraps a ```json block', () => {
      const raw = 'Вот урок:\n```json\n{"cards": [], "tasks": []}\n```\nГотово!';
      expect(value(raw)).toEqual({ cards: [], tasks: [] });
    });

    it('unwraps a block without a language tag', () => {
      expect(value('```\n{"a": 1}\n```')).toEqual({ a: 1 });
    });

    it('skips a non-JSON block and uses the next one', () => {
      const raw = '```ts\nconst a: number = 1;\n```\n```json\n{"ok":true}\n```';
      expect(value(raw)).toEqual({ ok: true });
    });
  });

  describe('attempt 3 — slicing between the outermost brackets', () => {
    it('drops prose around the object', () => {
      const raw = 'Конечно! {"pass": false, "feedback": "почини типы"} — вот и всё.';
      expect(value(raw)).toEqual({ pass: false, feedback: 'почини типы' });
    });

    it('keeps nested structures intact', () => {
      const raw = 'result: {"tasks": [{"id": 1}, {"id": 2}], "meta": {"n": 2}} done';
      expect(value(raw)).toEqual({ tasks: [{ id: 1 }, { id: 2 }], meta: { n: 2 } });
    });

    it('handles a top-level array containing objects', () => {
      expect(value('Here you go: [{"a": {"b": 1}}] ok')).toEqual([{ a: { b: 1 } }]);
    });
  });

  describe('failures', () => {
    it.each([
      ['plain prose', 'Извини, не могу ответить.'],
      ['an empty response', ''],
      ['a blank response', '   \n '],
      ['braces that never close', '{"pass": true'],
      ['a malformed slice', 'text {not json at all} more text'],
    ])('reports %s as not extractable', (_label, raw) => {
      expect(extractJson(raw)).toEqual({ ok: false });
    });
  });
});
