'use strict';
// Regras de pontuação.
//
// Pontuação fixa: correta = pontuação integral; incorreta/sem resposta = 0.
// Pontuação por tempo (estilo Kahoot):
//   pontos = máx × (1 − 0,5 × tempoGasto / tempoLimite)
//   → resposta instantânea vale 100%, no último segundo vale 50%.
// Várias respostas corretas: "tudo ou nada" — só pontua quem marcar
// exatamente o conjunto de alternativas corretas.

const MIN_SPEED_FACTOR = 0.5;

function isCorrect(question, selectedIds) {
  const correct = question.options.filter(o => o.correct).map(o => o.id).sort();
  const chosen = [...new Set(selectedIds || [])].sort();
  if (!chosen.length || chosen.length !== correct.length) return false;
  return chosen.every((id, i) => id === correct[i]);
}

function scoreAnswer(question, selectedIds, elapsedMs, speedScoring) {
  const correct = isCorrect(question, selectedIds);
  if (!correct) return { correct: false, points: 0 };
  const max = Number(question.points) || 0;
  if (!speedScoring) return { correct: true, points: max };
  const limitMs = question.timeLimit * 1000;
  const ratio = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return { correct: true, points: Math.round(max * (1 - (1 - MIN_SPEED_FACTOR) * ratio)) };
}

// Ordena por pontuação (desc); empate → menor tempo total nas corretas; depois ordem de entrada.
// Posição no estilo "competição": empates de pontuação dividem a mesma posição.
function rank(participants) {
  const sorted = [...participants].sort((a, b) =>
    b.score - a.score || a.correctTimeMs - b.correctTimeMs || a.joinedAt - b.joinedAt);
  let lastScore = null, lastRank = 0;
  return sorted.map((p, i) => {
    const r = p.score === lastScore ? lastRank : i + 1;
    lastScore = p.score; lastRank = r;
    return { p, rank: r };
  });
}

module.exports = { isCorrect, scoreAnswer, rank, MIN_SPEED_FACTOR };
