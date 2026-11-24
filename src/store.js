'use strict';
// Persistência simples em arquivo JSON com escrita atômica.
// Suficiente para centenas de quizzes; o estado da sessão ao vivo fica em memória.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = { quizzes: [], results: [] };
    if (fs.existsSync(this.file)) {
      try {
        this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch (e) {
        const bak = this.file + '.corrompido-' + Date.now();
        fs.copyFileSync(this.file, bak);
        console.error('[store] db.json inválido; cópia salva em', bak);
      }
    }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  // ---- quizzes
  listQuizzes() { return this.data.quizzes; }
  getQuiz(id) { return this.data.quizzes.find(q => q.id === id) || null; }
  upsertQuiz(quiz) {
    const i = this.data.quizzes.findIndex(q => q.id === quiz.id);
    if (i >= 0) this.data.quizzes[i] = quiz; else this.data.quizzes.unshift(quiz);
    this.save();
    return quiz;
  }
  deleteQuiz(id) {
    const before = this.data.quizzes.length;
    this.data.quizzes = this.data.quizzes.filter(q => q.id !== id);
    this.save();
    return this.data.quizzes.length !== before;
  }

  // ---- resultados de sessões encerradas
  addResult(r) {
    this.data.results = this.data.results.filter(x => x.sessionId !== r.sessionId);
    this.data.results.unshift(r);
    this.save();
  }
  listResults() { return this.data.results; }
  getResult(sessionId) { return this.data.results.find(r => r.sessionId === sessionId) || null; }
  deleteResult(sessionId) {
    this.data.results = this.data.results.filter(r => r.sessionId !== sessionId);
    this.save();
  }
}

module.exports = Store;
