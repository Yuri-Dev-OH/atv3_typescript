import { estrategias } from '../src/recommendation/strategies.js';
import { id } from '../src/domain/model.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from './fixtures.js';

// Rótulos sintéticos separados do score: avaliação >= 4 pelo produtor é considerada relevante.
// Substitua este conjunto por avaliações reais antes de tirar conclusões de qualidade.
const lista = profissionaisExemplo().map(p => ({ ...p, id: id() }));
const projeto = comServicos({ ...projetoExemplo(), id: id() });
for (const [nome, estrategia] of Object.entries(estrategias)) {
  const ranking = estrategia.recomendar(projeto, lista.map(p => ({ ...p, avaliacoes: p.avaliacoes.filter(a => a.produtorId !== projeto.produtorId) })));
  const acertos = [...ranking.values()].filter(candidatos => {
    const primeiro = candidatos[0];
    return primeiro && lista.find(p => p.id === primeiro.profissionalId)!.avaliacoes.some(a => a.produtorId === projeto.produtorId && a.nota >= 4);
  }).length;
  console.log(`${nome}: precisão@1 = ${(acertos / projeto.papeis.length).toFixed(3)} (amostra sintética)`);
}
