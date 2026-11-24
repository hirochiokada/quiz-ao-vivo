#!/usr/bin/env node
'use strict';
// Cria um quiz de demonstração. Uso: node scripts/seed-demo.js [url] [senhaAdmin]
const BASE = process.argv[2] || 'http://localhost:3000';
const PASS = process.argv[3] || process.env.ADMIN_PASSWORD || 'admin';

(async () => {
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) });
  const { token } = await login.json();
  const r = await fetch(BASE + '/api/quizzes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title: 'Quiz de Boas-vindas',
      description: 'Um aquecimento rápido de conhecimentos gerais.',
      openingMessage: 'Bem-vindos! Aponte a câmera para o QR Code, digite seu nome e aguarde o início.',
      closingMessage: 'Obrigado por participar! Os resultados serão compartilhados em breve.',
      settings: { speedScoring: true, showCorrectAnswer: true, rankingMode: 'during', rankingSize: 5, showPersonalScore: true },
      questions: [
        { text: 'Qual é a capital do Brasil?', timeLimit: 20, points: 1000, options: [
          { text: 'São Paulo' }, { text: 'Brasília', correct: true }, { text: 'Rio de Janeiro' }, { text: 'Salvador' }] },
        { text: 'Quais destes são planetas do Sistema Solar?', multiple: true, timeLimit: 30, points: 1500, options: [
          { text: 'Marte', correct: true }, { text: 'Plutão' }, { text: 'Vênus', correct: true }, { text: 'Lua' }, { text: 'Netuno', correct: true }] },
        { text: 'Quantos minutos tem uma partida oficial de futebol (sem acréscimos)?', timeLimit: 15, points: 1000, options: [
          { text: '80' }, { text: '90', correct: true }] },
        { text: 'Em que ano o homem pisou na Lua pela primeira vez?', timeLimit: 20, points: 1000, options: [
          { text: '1965' }, { text: '1969', correct: true }, { text: '1972' }, { text: '1959' }, { text: '1975' }, { text: '1961' }] },
      ],
    }),
  });
  const q = await r.json();
  console.log(`Quiz de demonstração criado: ${BASE}/admin/quiz/${q.id}`);
})().catch(e => { console.error(e); process.exit(1); });
