'use strict';
// Normalização e validação dos quizzes vindos do editor.
const { nanoid } = require('nanoid');

const RANKING_MODES = ['during', 'end', 'never'];
const RANKING_SIZES = [3, 5, 10, 20, 0]; // 0 = todos

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const imgUrl = v => (typeof v === 'string' && /^\/uploads\/[\w.-]+$/.test(v) ? v : null);

function normalizeQuiz(input, existing) {
  const now = new Date().toISOString();
  const s = input.settings || {};
  const quiz = {
    id: existing ? existing.id : nanoid(10),
    title: str(input.title, 120),
    description: str(input.description, 1000),
    coverImage: imgUrl(input.coverImage),
    openingMessage: str(input.openingMessage, 500),
    closingMessage: str(input.closingMessage, 500),
    settings: {
      speedScoring: !!s.speedScoring,
      showCorrectAnswer: s.showCorrectAnswer !== false,
      rankingMode: RANKING_MODES.includes(s.rankingMode) ? s.rankingMode : 'during',
      rankingSize: RANKING_SIZES.includes(Number(s.rankingSize)) ? Number(s.rankingSize) : 5,
      showPersonalScore: s.showPersonalScore !== false,
      shuffleQuestions: !!s.shuffleQuestions,
      shuffleOptions: !!s.shuffleOptions,
    },
    questions: (Array.isArray(input.questions) ? input.questions : []).slice(0, 200).map(q => ({
      id: typeof q.id === 'string' && q.id ? q.id.slice(0, 20) : nanoid(8),
      text: str(q.text, 500),
      image: imgUrl(q.image),
      timeLimit: clampInt(q.timeLimit, 5, 120, 20),
      points: clampInt(q.points, 0, 100000, 1000),
      multiple: !!q.multiple,
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(o => ({
        id: typeof o.id === 'string' && o.id ? o.id.slice(0, 20) : nanoid(6),
        text: str(o.text, 200),
        correct: !!o.correct,
      })),
    })),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  return quiz;
}

// Erros que impedem iniciar uma sessão (o rascunho pode ser salvo incompleto).
function validateForLive(quiz) {
  const errors = [];
  if (!quiz.title) errors.push('O quiz precisa de um título.');
  if (!quiz.questions.length) errors.push('Cadastre pelo menos uma pergunta.');
  quiz.questions.forEach((q, i) => {
    const n = `Pergunta ${i + 1}`;
    if (!q.text && !q.image) errors.push(`${n}: informe o texto ou uma imagem.`);
    if (q.options.length < 2) errors.push(`${n}: são necessárias pelo menos 2 alternativas.`);
    if (q.options.some(o => !o.text)) errors.push(`${n}: há alternativas sem texto.`);
    const c = q.options.filter(o => o.correct).length;
    if (c === 0) errors.push(`${n}: marque a alternativa correta.`);
    if (!q.multiple && c > 1) errors.push(`${n}: marcada como resposta única, mas tem ${c} corretas.`);
  });
  return errors;
}

function duplicateQuiz(quiz) {
  const copy = JSON.parse(JSON.stringify(quiz));
  copy.title = (quiz.title + ' (cópia)').slice(0, 120);
  return normalizeQuiz(copy, null);
}

module.exports = { normalizeQuiz, validateForLive, duplicateQuiz, RANKING_SIZES };
