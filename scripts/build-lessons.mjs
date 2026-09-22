#!/usr/bin/env node
/**
 * Pre-generates every lesson once and writes it to public/lessons/<id>.json.
 *
 * Why this exists: generating a lesson on every open burns API credits for
 * content that does not actually change. Built once, the pack is served as a
 * static file — the roadmap becomes free to walk through, and the model is
 * only spent on things that are genuinely per-student: code review and chat.
 *
 * The prompts are not duplicated here. UNITS, MENTOR_CTX and lessonPrompt are
 * read straight out of public/index.html, so the pack can never drift from
 * what the app would have asked for itself.
 *
 * Usage:
 *   node scripts/build-lessons.mjs --base https://<host> --password <APP_PASSWORD>
 *   node scripts/build-lessons.mjs --only ts-basic,ts-interface   # a subset
 *   node scripts/build-lessons.mjs --force                        # rebuild existing
 *   node scripts/build-lessons.mjs --dry-run                      # just list the work
 *
 * It is resumable: files that already exist are skipped unless --force.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'lessons');

const args = parseArgs(process.argv.slice(2));
const base = (args.base ?? process.env.BANANA_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const password = args.password ?? process.env.APP_PASSWORD;
const delayMs = Number(args.delay ?? 3000);

if (!password && !args['dry-run']) {
  fail('Need the site password: --password <APP_PASSWORD> (or set APP_PASSWORD).');
}

const { UNITS, lessonPrompt } = loadFrontendModule();

/** Only these two kinds go through the lesson generator. */
const nodes = UNITS.flatMap((unit) =>
  unit.nodes
    .filter((node) => !node.kind || node.kind === 'checkpoint')
    .map((node) => ({ ...node, unit })),
);

const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;
const wanted = nodes.filter((n) => !only || only.has(n.id));
const todo = wanted.filter((n) => args.force || !existsSync(lessonPath(n.id)));

console.log(`Roadmap: ${nodes.length} generated nodes`);
console.log(`Selected: ${wanted.length} · already built: ${wanted.length - todo.length} · to build: ${todo.length}`);

if (args['dry-run']) {
  for (const n of todo) console.log(`  would build ${n.id} — ${n.title}`);
  process.exit(0);
}
if (!todo.length) {
  console.log('Nothing to do.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const cookie = await login();
let built = 0;
const failed = [];

for (const [i, node] of todo.entries()) {
  const label = `[${i + 1}/${todo.length}] ${node.id}`;
  process.stdout.write(`${label} — ${node.title} … `);
  try {
    const started = Date.now();
    const lesson = await generate(node);
    writeFileSync(lessonPath(node.id), JSON.stringify(lesson, null, 2) + '\n', 'utf8');
    built += 1;
    console.log(`ok (${describe(lesson)}, ${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (error) {
    failed.push({ id: node.id, reason: String(error.message ?? error) });
    console.log(`FAILED — ${error.message ?? error}`);
  }
  // The API routes are rate limited on purpose; stay well under the budget.
  if (i < todo.length - 1) await sleep(delayMs);
}

console.log(`\nBuilt ${built} lesson(s) into public/lessons/`);
if (failed.length) {
  console.log(`${failed.length} failed — rerun to retry just those:`);
  for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
  process.exit(1);
}

/* ------------------------------ helpers ------------------------------ */

function lessonPath(id) {
  return join(outDir, `${id}.json`);
}

/**
 * Pulls UNITS / MENTOR_CTX / lessonPrompt out of the single-file frontend and
 * evaluates just those definitions, so prompts stay defined in exactly one place.
 */
function loadFrontendModule() {
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  const units = html.match(/const UNITS = \[[\s\S]*?\n\];/);
  const prompt = html.match(/const MENTOR_CTX = [\s\S]*?\n(?=function validLesson)/);
  if (!units || !prompt) fail('Could not find UNITS / lessonPrompt in public/index.html.');

  const source = `${units[0]}\n${prompt[0]}\nreturn { UNITS, lessonPrompt };`;
  return new Function(source)();
}

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) fail(`Login failed with HTTP ${res.status}. Wrong password, or ${base} is not reachable.`);

  const raw = res.headers.getSetCookie?.() ?? [];
  const session = raw.map((c) => c.split(';')[0]).join('; ');
  if (!session) fail('Login succeeded but returned no session cookie.');
  return session;
}

async function generate(node) {
  const res = await fetch(`${base}/api/ai/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    // variant 1: the pack is the canonical take on the topic.
    body: JSON.stringify({ prompt: lessonPrompt(node, 1), cache: true }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.code ? `${body.code}: ${body.message}` : `HTTP ${res.status}`);

  return check(body, node);
}

/** Mirrors validLesson() in the frontend: never ship a lesson the app would reject. */
function check(d, node) {
  if (!d || typeof d !== 'object') throw new Error('answer was not an object');

  const cards = Array.isArray(d.cards) ? d.cards.filter((c) => c && c.title && c.text) : [];
  const tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter((t) => {
    if (!t) return false;
    if (t.type === 'choice') {
      const answer = Number(t.answer);
      return (
        t.question &&
        Array.isArray(t.options) &&
        t.options.length >= 2 &&
        Number.isInteger(answer) &&
        answer >= 0 &&
        answer < t.options.length
      );
    }
    if (t.type === 'code') return !!t.task;
    return false;
  });

  if (!tasks.length) throw new Error('no usable tasks');
  if (node.kind !== 'checkpoint' && !cards.length) throw new Error('no theory cards');

  const intro = d.intro;
  const hasIntro =
    intro && typeof intro === 'object' && intro.why?.trim() && intro.where?.trim() && intro.without?.trim();
  if (node.kind !== 'checkpoint' && !hasIntro) throw new Error('missing the "why this topic" intro');

  return d;
}

function describe(lesson) {
  const cards = Array.isArray(lesson.cards) ? lesson.cards.length : 0;
  const tasks = Array.isArray(lesson.tasks) ? lesson.tasks.length : 0;
  return `${cards} cards, ${tasks} tasks`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
