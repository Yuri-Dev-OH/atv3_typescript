import assert from 'node:assert/strict';
import type { EstadoProjeto, Pagamento } from '../src/domain/model.js';
import type { ResumoServico, ServicoDados } from '../src/domain/servicos.js';
import { projetoExemplo } from './fixtures.js';

// Demonstração da atividade 3 contra a API em execução (npm run dev ou npm start).
const base = process.env.API_URL ?? 'http://127.0.0.1:3000';
async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const resposta = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`${resposta.status}: ${texto}`);
  return (texto ? JSON.parse(texto) : undefined) as T;
}
const imprimir = (s: ResumoServico, nivel = 0): void => {
  console.log(`${'  '.repeat(nivel)}- ${s.nome}${s.papel ? ` [${s.papel}]` : ''}: R$ ${s.custo.toFixed(2)}, ${s.prazo} dias${s.coberto ? '' : ' (sem profissional)'}`);
  for (const filho of s.subservicos) imprimir(filho, nivel + 1);
};

console.log('== Composite: projeto descrito por uma hierarquia de serviços ==');
const servicoPrincipal: ServicoDados = { tipo: 'pacote', nome: 'Curta independente', paralelo: true, itens: [
  { tipo: 'atomico', nome: 'Direção', papel: 'DIRETOR', custo: 2500, prazo: 25 },
  { tipo: 'pacote', nome: 'Pós-produção', itens: [
    { tipo: 'atomico', nome: 'Edição de vídeo', papel: 'EDITOR', custo: 1200, prazo: 10 },
    { tipo: 'pacote', nome: 'Finalização', paralelo: true, itens: [
      { tipo: 'atomico', nome: 'Coloração', papel: 'EDITOR', custo: 500, prazo: 4 },
      { tipo: 'atomico', nome: 'Efeitos visuais', papel: 'EFEITOS_VISUAIS', custo: 1800, prazo: 6 },
    ] },
    { tipo: 'atomico', nome: 'Mixagem de áudio', papel: 'SONOPLASTA', custo: 700, prazo: 5 },
  ] },
] };
const { papeis: _papeis, ...semPapeis } = projetoExemplo();
let estado = await request<EstadoProjeto>('/projetos', { ...semPapeis, servicoPrincipal });
const projetoId = estado.projeto.id;
assert.equal(estado.equipe.membros.length, 4, 'Execute npm run db:seed antes da demonstração.');
imprimir(await request<ResumoServico>(`/projetos/${projetoId}/servicos`));
console.table(estado.equipe.membros.map(m => ({ papel: m.papel, nome: m.nome, preco: m.preco })));

console.log('\n== Decorator: cache, auditoria e compressão sobre o recomendador ==');
await request('/projetos', { ...semPapeis, titulo: 'Projeto semelhante', servicoPrincipal });
await request('/projetos', { ...semPapeis, titulo: 'Preferência do produtor', servicoPrincipal, decoradores: ['compressao'] });
const metricas = await request<{ politica: string[]; cache: object; auditoria: { total: number }; compressao: object }>('/recomendador');
console.log('Política:', metricas.politica.join(' > '), '| cache:', metricas.cache, '| auditadas:', metricas.auditoria.total);
console.log('Compressão:', metricas.compressao);

console.log('\n== Adapter: arquivos e pagamentos pelos provedores configurados ==');
const saude = await request<{ provedores: Record<string, string> }>('/saude');
console.log('Provedores:', saude.provedores);
const arquivo = await request<{ id: string; arquivo: string }>(`/projetos/${projetoId}/arquivos`,
  { nome: 'roteiro.txt', tipoConteudo: 'text/plain', conteudoBase64: Buffer.from('INT. SET - DIA').toString('base64') });
const baixado = await fetch(`${base}/projetos/${projetoId}/arquivos/${arquivo.arquivo}`).then(r => r.text());
assert.equal(baixado, 'INT. SET - DIA');
console.log('Arquivo salvo e lido de volta:', arquivo.id);
for (const membro of estado.equipe.membros) {
  estado = await request(`/projetos/${projetoId}/membros/${membro.papel}`, { acao: 'aceitar' });
  const convite = estado.convites.find(c => c.papel === membro.papel && c.status === 'pendente')!;
  estado = await request(`/projetos/${projetoId}/convites/${convite.id}/responder`, { aceitar: true });
}
assert.equal(estado.equipe.status, 'formada');
const { efetuados } = await request<{ efetuados: Pagamento[] }>(`/projetos/${projetoId}/pagamentos`, {});
console.table(efetuados.map(p => ({ papel: p.papel, valor: p.valor, provedor: p.provedor, transacao: p.transacaoId, status: p.status })));
const { profissionais: _ids, ...importacao } = await request<{ provedor: string; importados: number; inalterados: number; profissionais: string[] }>('/profissionais/importacoes', {});
console.log('Importação de profissionais:', importacao);
console.log(`\nRelatório: ${base}/projetos/${projetoId}/relatorio`);
