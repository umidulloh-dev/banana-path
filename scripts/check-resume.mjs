/**
 * Проверяет, что незаконченный урок переживает закрытие окна.
 *
 * Фронтенд — один файл без сборки, поэтому тест вырезает из него блок функций
 * возобновления и гоняет их на заглушках. Способ грубоватый, но он уже поймал
 * ошибку, из-за которой вычищался только что сохранённый снимок — то есть
 * ровно тот, к которому ученик собирался вернуться.
 *
 * Запуск: node scripts/check-resume.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const js = readFileSync('public/index.html', 'utf8').split('<script>').pop().split('</script>')[0];

// Берём только блок с функциями возобновления.
const start = js.indexOf('const RESUME_KEEP');
const end = js.indexOf('// Готовый урок из пака');
const block = js.slice(start, end);

const ctx = {
  S: { resume: {} },
  L: null,
  saved: 0,
  save() { ctx.saved += 1; },
  document: { getElementById: () => null },
};

const factory = new Function(
  'S_ref', 'ctxRef', 'save', 'document', 'mascot', 'esc', 'sfx', 'setFoot', 'step', 'startLesson',
  `let S = S_ref; let L = null;
   const sync = () => { L = ctxRef.L; };
   ${block}
   return { resumeFor, dropResume, saveResume, applyLesson, restoreLesson,
            setL: v => { L = v; ctxRef.L = v; }, getL: () => L, getS: () => S };`,
);

const api = factory(ctx.S, ctx, ctx.save, ctx.document, () => '', (x) => x, {}, () => {}, () => {}, () => {});

const lesson = {
  intro: { why: 'w', where: 'e', without: 'o', analogy: 'a' },
  cards: [{ title: 'c1', text: 't1' }, { title: 'c2', text: 't2' }],
  tasks: [
    { type: 'choice', question: 'q1', options: ['a', 'b'], answer: 0 },
    { type: 'choice', question: 'q2', options: ['a', 'b'], answer: 1 },
    { type: 'code', task: 'напиши функцию', starter: 'const f = () => {}' },
  ],
};
const node = { id: 'ts-functions', title: 'Типизация функций' };

// 1. Начали урок.
api.setL({ n: node, phase: 'loading', hearts: 3, cards: [], tasks: [], queue: [], code: {},
           correctFirst: 0, answered: 0, started: Date.now(), wrongSet: new Set() });
api.applyLesson(node, lesson, 1);
let L = api.getL();
assert.equal(L.phase, 'intro', 'урок начинается с экрана «зачем»');
assert.equal(L.total, 1 + 2 + 3, 'шагов = интро + карточки + задачи');

// 2. Ничего не сделали и закрыли — снимка быть не должно.
api.saveResume();
assert.equal(api.resumeFor('ts-functions'), null, 'пустой заход не сохраняется');

// 3. Прошли интро, обе карточки, ответили на первый вопрос, написали код.
L.phase = 'tasks'; L.cardIdx = 2; L.answered = 1; L.correctFirst = 1;
L.hearts = 2; L.wrongSet = new Set([1]);
L.queue = [L.queue[1], L.queue[2]];
L.code[2] = 'const f = (x: number): string => String(x)';
api.saveResume();

const snap = api.resumeFor('ts-functions');
assert.ok(snap, 'снимок сохранён');
assert.deepEqual(snap.queue, [1, 2], 'очередь хранится индексами');

// 4. Закрыли окно и вернулись.
api.setL({ n: node, phase: 'loading', hearts: 3, cards: [], tasks: [], queue: [], code: {},
           correctFirst: 0, answered: 0, started: Date.now(), wrongSet: new Set() });
api.restoreLesson(node, snap);
const R = api.getL();

assert.equal(R.phase, 'tasks', 'вернулись к задачам');
assert.equal(R.hearts, 2, 'сердечки восстановлены');
assert.equal(R.answered, 1, 'засчитанные ответы на месте');
assert.equal(R.correctFirst, 1, 'счётчик «с первого раза» на месте');
assert.deepEqual([...R.wrongSet], [1], 'помеченные ошибки на месте');
assert.equal(R.queue.length, 2, 'осталось две задачи');
assert.equal(R.queue[0].question, 'q2', 'первой идёт та, на которой остановились');
assert.equal(R.queue[1].type, 'code', 'задача на код последняя');
assert.equal(R.code[2], 'const f = (x: number): string => String(x)', 'КОД СОХРАНИЛСЯ');
assert.equal(R.total, 6, 'общее число шагов не изменилось');

// 5. Урок закончен — снимок убирается.
api.dropResume('ts-functions');
assert.equal(api.resumeFor('ts-functions'), null, 'после завершения снимка нет');

// 6. Храним не больше трёх незаконченных, и всегда — только что сохранённый.
const stamps = { a: 1000, b: 2000, c: 3000, d: 4000 };
for (const id of ['a', 'b', 'c', 'd']) {
  api.setL({ n: { id }, phase: 'tasks', hearts: 3, cards: [], tasks: lesson.tasks,
             queue: [{ _i: 0 }], code: {}, correctFirst: 0, answered: 1,
             started: Date.now(), wrongSet: new Set(), cardIdx: 0 });
  api.saveResume();
  api.getS().resume[id].savedAt = stamps[id];
  assert.ok(api.resumeFor(id), `только что сохранённый снимок «${id}» не должен вычищаться`);
}
assert.equal(Object.keys(api.getS().resume).length, 3, 'старые снимки вычищаются');
assert.equal(api.resumeFor('a'), null, 'самый старый удалён');
for (const id of ['b', 'c', 'd']) assert.ok(api.resumeFor(id), `«${id}» остался`);

console.log('Все проверки прошли ✓');
