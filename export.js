'use strict';
// Exportação de resultados em CSV (padrão Excel pt-BR: ";" e BOM UTF-8) e XLSX.
const ExcelJS = require('exceljs');

function rows(result) {
  const header = ['Posição', 'Nome', 'Pontuação', 'Acertos', 'Total de perguntas'];
  result.questions.forEach((q, i) => {
    header.push(`P${i + 1} - Resposta`, `P${i + 1} - Correta?`, `P${i + 1} - Pontos`, `P${i + 1} - Tempo (s)`);
  });
  const body = result.participants.map(p => {
    const r = [p.rank, p.name, p.score, p.correctCount, result.questions.length];
    for (const q of result.questions) {
      const a = p.answers[q.id];
      if (!a) { r.push('(sem resposta)', 'Não', 0, ''); continue; }
      const txt = a.ids.map(id => (q.options.find(o => o.id === id) || {}).text || '?').join(' | ');
      r.push(txt, a.correct ? 'Sim' : 'Não', a.points, Math.round(a.elapsedMs / 100) / 10);
    }
    return r;
  });
  return { header, body };
}

function toCsv(result) {
  const { header, body } = rows(result);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const fmt = v => (typeof v === 'number' && !Number.isInteger(v) ? String(v).replace('.', ',') : v);
  return '﻿' + [header, ...body].map(r => r.map(v => esc(fmt(v))).join(';')).join('\r\n') + '\r\n';
}

async function toXlsx(result) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quiz ao Vivo';
  const bold = { bold: true, color: { argb: 'FFFFFFFF' } };
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };

  const info = wb.addWorksheet('Resumo');
  info.columns = [{ width: 28 }, { width: 50 }];
  [
    ['Quiz', result.quizTitle],
    ['Código da sessão', result.code],
    ['Início', result.startedAt ? new Date(result.startedAt).toLocaleString('pt-BR') : ''],
    ['Fim', result.endedAt ? new Date(result.endedAt).toLocaleString('pt-BR') : '(em andamento)'],
    ['Participantes', result.participants.length],
    ['Perguntas', result.questions.length],
    ['Pontuação por tempo', result.speedScoring ? 'Sim' : 'Não'],
  ].forEach(r => { const row = info.addRow(r); row.getCell(1).font = { bold: true }; });

  const { header, body } = rows(result);
  const ws = wb.addWorksheet('Classificação');
  ws.addRow(header);
  body.forEach(r => ws.addRow(r));
  ws.getRow(1).eachCell(c => { c.font = bold; c.fill = fill; });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 26 : i < 5 ? 12 : 18; });

  const qs = wb.addWorksheet('Perguntas');
  qs.addRow(['#', 'Pergunta', 'Alternativas', 'Corretas', 'Pontos máx.', 'Tempo (s)', 'Respostas', 'Acertos', '% acerto']);
  qs.getRow(1).eachCell(c => { c.font = bold; c.fill = fill; });
  result.questions.forEach((q, i) => {
    const answered = result.participants.filter(p => p.answers[q.id]).length;
    const right = result.participants.filter(p => p.answers[q.id] && p.answers[q.id].correct).length;
    qs.addRow([
      i + 1, q.text, q.options.map(o => o.text).join(' | '),
      q.options.filter(o => o.correct).map(o => o.text).join(' | '),
      q.points, q.timeLimit, answered, right,
      result.participants.length ? Math.round((right / result.participants.length) * 1000) / 10 : 0,
    ]);
  });
  qs.columns = [{ width: 5 }, { width: 50 }, { width: 50 }, { width: 30 }, { width: 12 }, { width: 10 }, { width: 11 }, { width: 10 }, { width: 10 }];

  return wb.xlsx.writeBuffer();
}

const fileName = (result, ext) =>
  `resultado-${(result.quizTitle || 'quiz').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)}-${result.code}.${ext}`;

module.exports = { toCsv, toXlsx, fileName };
