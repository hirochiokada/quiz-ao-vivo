'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreAnswer, isCorrect, rank } = require('../src/scoring');
const { normalizeQuiz, validateForLive } = require('../src/quiz');
const { toCsv } = require('../src/export');

const single = { timeLimit: 20, points: 1000, options: [{ id: 'a', correct: true }, { id: 'b' }, { id: 'c' }] };
const multi = { timeLimit: 10, points: 500, multiple: true, options: [{ id: 'a', correct: true }, { id: 'b', correct: true }, { id: 'c' }] };

test('pontuação fixa', () => {
  assert.deepStrictEqual(scoreAnswer(single, ['a'], 19000, false), { correct: true, points: 1000 });
  assert.deepStrictEqual(scoreAnswer(single, ['b'], 100, false), { correct: false, points: 0 });
  assert.deepStrictEqual(scoreAnswer(single, [], 100, false), { correct: false, points: 0 });
});

test('pontuação por tempo: 100% instantâneo, 50% no fim, linear no meio', () => {
  assert.strictEqual(scoreAnswer(single, ['a'], 0, true).points, 1000);
  assert.strictEqual(scoreAnswer(single, ['a'], 10000, true).points, 750);
  assert.strictEqual(scoreAnswer(single, ['a'], 20000, true).points, 500);
  assert.strictEqual(scoreAnswer(single, ['a'], 99999, true).points, 500);
  assert.strictEqual(scoreAnswer(single, ['c'], 0, true).points, 0);
});

test('várias corretas: tudo ou nada', () => {
  assert.ok(isCorrect(multi, ['b', 'a']));
  assert.ok(!isCorrect(multi, ['a']));
  assert.ok(!isCorrect(multi, ['a', 'b', 'c']));
  assert.ok(isCorrect(multi, ['a', 'a', 'b']));
});

test('ranking: empate divide posição; desempate por tempo na ordem', () => {
  const r = rank([
    { name: 'A', score: 900, correctTimeMs: 5000, joinedAt: 1 },
    { name: 'B', score: 1200, correctTimeMs: 9000, joinedAt: 2 },
    { name: 'C', score: 900, correctTimeMs: 3000, joinedAt: 3 },
    { name: 'D', score: 100, correctTimeMs: 0, joinedAt: 4 },
  ]);
  assert.deepStrictEqual(r.map(x => [x.p.name, x.rank]), [['B', 1], ['C', 2], ['A', 2], ['D', 4]]);
});

test('normalização limita tempo 5–120 e alternativas a 6', () => {
  const q = normalizeQuiz({ title: 'T', questions: [{ text: 'x', timeLimit: 500, options: Array(9).fill({ text: 'o' }) }, { text: 'y', timeLimit: 1, options: [] }] });
  assert.strictEqual(q.questions[0].timeLimit, 120);
  assert.strictEqual(q.questions[1].timeLimit, 5);
  assert.strictEqual(q.questions[0].options.length, 6);
  const errs = validateForLive(q);
  assert.ok(errs.some(e => e.includes('Pergunta 2')));
});

test('CSV usa ; e BOM, escapa aspas', () => {
  const csv = toCsv({
    questions: [{ id: 'q', options: [{ id: 'a', text: 'Sim; "ok"' }] }],
    participants: [{ rank: 1, name: 'Ana', score: 10, correctCount: 1, answers: { q: { ids: ['a'], correct: true, points: 10, elapsedMs: 1234 } } }],
  });
  assert.ok(csv.startsWith('﻿Posição;Nome'));
  assert.ok(csv.includes('"Sim; ""ok"""'));
  assert.ok(csv.includes(';1,2'));
});
