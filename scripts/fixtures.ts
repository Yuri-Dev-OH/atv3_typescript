import { PAPEIS, type ProfissionalDados, type ProjetoDados } from '../src/domain/model.js';
import { servicosDePapeis } from '../src/domain/servicos.js';

export function profissionaisExemplo(): Omit<ProfissionalDados, 'id'>[] {
  return PAPEIS.flatMap((papel, i) => [0, 1, 2].map(n => ({
    nome: `${['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio'][i]} ${n + 1}`,
    email: `profissional${i}-${n}@example.com`, papeis: [papel],
    competencias: [{ nome: papel.toLowerCase(), nivel: n === 0 ? 1 : 0.8 }, { nome: 'producao', nivel: n === 0 ? 0.2 : 0.8 }],
    preco: [1200, 600, 400][n]!, faixaPreco: { minimo: [1000, 500, 300][n]!, maximo: [1500, 800, 500][n]! }, disponibilidade: { inicio: '2026-01-01', fim: '2030-12-31' },
    localizacao: 'São Paulo', remoto: false,
    historico: [{ projetoId: `anterior-${i}-${n}`, genero: n === 0 ? 'drama' : 'comedia', papel }],
    avaliacoes: [ { produtorId: 'produtor-demo', nota: n === 0 ? 3 : 5, comentario: 'Entrega realizada.', data: '2026-01-01' },
      { produtorId: 'produtor-parceiro', nota: n === 0 ? 3 : 5, comentario: 'Bom trabalho.', data: '2026-01-02' } ],
  })));
}
/** Corpo de criação no formato legado (lista de papéis); a API monta o serviço principal. */
export function projetoExemplo(): Omit<ProjetoDados, 'id' | 'servicoPrincipal'> {
  return { produtorId: 'produtor-demo', emailProdutor: 'produtor@example.com', titulo: 'Curta independente', genero: 'drama', duracao: 20,
    orcamento: 8000, inicio: '2027-02-01', prazo: '2027-03-01', tipoCaptacao: 'ficcao', localizacao: 'São Paulo',
    papeis: PAPEIS.map(papel => ({ papel, peso: papel === 'DIRETOR' ? 2 : 1, competencias: [{ nome: papel.toLowerCase(), nivel: 1 }] })),
    estrategia: 'cosseno', parametros: { pesoTecnico: 0.7, pesoHistorico: 0.3, notaMinima: 0 },
  };
}
/** Completa o projeto com o serviço principal derivado da lista de papéis, como faz a fábrica. */
export function comServicos<T extends Omit<ProjetoDados, 'servicoPrincipal'>>(p: T): T & Pick<ProjetoDados, 'servicoPrincipal'> {
  return { ...p, servicoPrincipal: servicosDePapeis(p).paraDados() };
}
