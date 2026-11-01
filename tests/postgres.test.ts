import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBanco } from '../src/infrastructure/database.js';
import { RepositorioPostgres } from '../src/infrastructure/postgres-repository.js';
import { criarApp } from '../src/http/app.js';
import { id } from '../src/domain/model.js';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';
import { criarCatalogoApp } from '../src/http/catalog-app.js';
import { CatalogoHttp } from '../src/infrastructure/http-clients.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { AdaptadorS3 } from '../src/adapters/armazenamento.js';
import { AdaptadorStripe } from '../src/adapters/pagamento.js';
import { AdaptadorInterno, AdaptadorLinkedIn } from '../src/adapters/profissional.js';
import { PacoteServico, ServicoAtomico } from '../src/domain/servicos.js';
import { LinkedInSimulado } from '../src/infrastructure/externos/profissionais.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('Integração com PostgreSQL real', () => {
  const banco = criarBanco(url ?? 'postgres://localhost/cinebridge_test');
  const repo = new RepositorioPostgres(banco);
  const contexto = criarApp(repo, { processarEventos: false });
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL deve apontar para um banco com sufixo _test.');
    await banco.initialize();
    await banco.runMigrations();
    await banco.query('TRUNCATE integracao, notificacao, auditoria, evento, convite, recomendacao, projeto, avaliacao, competencia, profissional');
    for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
    await contexto.eventos.processar();
  }, 30000);
  afterAll(async () => { await contexto.app.close(); if (banco.isInitialized) await banco.destroy(); });
  it('persiste competências, avaliações, projeto, convites e histórico de recomendações', async () => {
    expect(await repo.saudavel()).toBe(true);
    expect(await repo.listarProfissionais()).toHaveLength(18);
    let estado = await contexto.sistema.criar(projetoExemplo());
    const projetoId = estado.projeto.id;
    expect(await repo.obterProjeto(id())).toBeUndefined();
    for (const m of estado.equipe.membros) {
      estado = await contexto.sistema.decidir(projetoId, m.papel, 'aceitar');
      const convite = estado.convites.find(c => c.papel === m.papel && c.status === 'pendente')!;
      estado = await contexto.sistema.responderConvite(projetoId, convite.id, true);
    }
    await contexto.eventos.processar();
    expect((await repo.obterProjeto(projetoId))!.equipe.status).toBe('formada');
    expect(await repo.integracoes()).toHaveLength(2);
    const registros = await repo.auditoria(projetoId);
    expect(registros.some(e => e.tipo === 'EQUIPE_FORMADA')).toBe(true);
    expect((await repo.auditoria()).length).toBeGreaterThan(registros.length);
    expect((await repo.notificacoes('produtor-demo')).length).toBeGreaterThan(0);
    expect((await repo.notificacoes()).length).toBeGreaterThan(0);
    expect((await repo.eventos()).length).toBeGreaterThan(0);
    await contexto.eventos.processar();
    expect(await repo.eventos(true)).toEqual([]);
    const evento = registros[0]!;
    await repo.confirmarEntrega(evento.id, 'auditoria');
    await repo.registrarAuditoria(evento);
    expect((await repo.auditoria(projetoId)).length).toBe(registros.length);
    const anterior = structuredClone(estado);
    await contexto.sistema.reavaliar(projetoId, { estrategia: 'orcamento' });
    await expect(repo.salvarProjeto(anterior, anterior.versao - 1, [])).rejects.toMatchObject({ statusCode: 409 });
    expect((await banco.query('SELECT * FROM recomendacao WHERE projeto_id=$1', [projetoId])).length).toBe(2);
    expect((await banco.query('SELECT * FROM convite WHERE projeto_id=$1', [projetoId])).every((c: { status: string }) => c.status === 'cancelado')).toBe(true);
  }, 30000);
  it('persiste cada tipo em JSONB e o reconstrói com a fábrica correta', async () => {
    for (const [tipoCaptacao, trecho] of [['documentario', 'documentário'], ['animacao', 'render estimado'], ['publicitario', 'peça publicitária']] as const) {
      const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), duracao: 1, tipoCaptacao } });
      expect(r.statusCode, r.body).toBe(201);
      const projetoId = r.json().projeto.id;
      await contexto.eventos.processar();
      expect((await repo.obterProjeto(projetoId))!.projeto.tipoCaptacao).toBe(tipoCaptacao);
      expect((await repo.notificacoes('produtor-demo')).some(n => n.mensagem.includes(projetoId) && n.mensagem.includes(trecho))).toBe(true);
      const relatorio = (await contexto.app.inject(`/projetos/${projetoId}/relatorio`)).json();
      expect(relatorio.tipo).toBe(tipoCaptacao);
      // A reavaliação lê o estado do banco e volta a passar pelo validador do tipo.
      const reavaliado = await contexto.app.inject({ method: 'POST', url: `/projetos/${projetoId}/reavaliar`, payload: { papeis: projetoExemplo().papeis.slice(0, 1) } });
      expect(reavaliado.statusCode).toBe(422);
    }
  }, 30000);
  it('transação reverte projeto quando não consegue gravar o evento', async () => {
    const estado = await contexto.sistema.criar(projetoExemplo());
    await contexto.eventos.processar();
    const versao = estado.versao;
    const repetido = (await repo.eventos())[0]!;
    estado.versao++;
    await expect(repo.salvarProjeto(estado, versao, [repetido])).rejects.toThrow();
    expect((await repo.obterProjeto(estado.projeto.id))!.versao).toBe(versao);
  });
  it('persiste convite com profissional externo e projeto parcial quando esse serviço cai', async () => {
    const catalogo = criarCatalogoApp(new RepositorioMemoria());
    const remoto = new CatalogoHttp(await catalogo.listen({ port: 0, host: '127.0.0.1' }));
    const externo = criarApp(repo, { profissionais: remoto, processarEventos: false });
    const frio = criarApp(repo, { profissionais: remoto, processarEventos: false });
    try {
      const profissional = await externo.sistema.cadastrarProfissional({ ...profissionaisExemplo()[0]!, email: 'externo@example.com' });
      expect((await repo.listarProfissionais()).some(p => p.id === profissional.id)).toBe(false);
      const entrada = { ...projetoExemplo(), papeis: projetoExemplo().papeis.slice(0, 1) };
      let estado = await externo.sistema.criar(entrada);
      estado = await externo.sistema.decidir(estado.projeto.id, 'DIRETOR', 'aceitar');
      expect((await repo.obterProjeto(estado.projeto.id))!.convites).toHaveLength(1);
      await catalogo.close();
      const parcial = await frio.sistema.criar(entrada);
      expect((await repo.obterProjeto(parcial.projeto.id))!.equipe.status).toBe('parcial');
      await externo.eventos.processar();
    } finally { await externo.app.close(); await frio.app.close(); await catalogo.close(); }
  });
  it('persiste a árvore de serviços, os pagamentos e as reimportações de profissionais', async () => {
    const servicoPrincipal = new PacoteServico('Curta', [new ServicoAtomico('Direção', 'DIRETOR', 3000, 20),
      new PacoteServico('Pós', [new ServicoAtomico('Edição', 'EDITOR', 1500, 10)], true)], true).paraDados();
    const { papeis: _papeis, ...base } = projetoExemplo();
    let estado = await contexto.sistema.criar({ ...base, servicoPrincipal });
    const projetoId = estado.projeto.id;
    expect((await repo.obterProjeto(projetoId))!.projeto.servicoPrincipal).toEqual(servicoPrincipal);
    for (const m of estado.equipe.membros) {
      estado = await contexto.sistema.decidir(projetoId, m.papel, 'aceitar');
      const convite = estado.convites.find(c => c.papel === m.papel && c.status === 'pendente')!;
      estado = await contexto.sistema.responderConvite(projetoId, convite.id, true);
    }
    expect((await contexto.sistema.pagarEquipe(projetoId)).efetuados).toHaveLength(2);
    expect((await repo.obterProjeto(projetoId))!.pagamentos.map(p => p.status)).toEqual(['aprovado', 'aprovado']);
    // Avaliar e reimportar regravam o mesmo profissional (upsert), sem duplicar.
    const [primeiro] = await repo.listarProfissionais();
    await contexto.sistema.avaliarProfissional(primeiro!.id, { produtorId: 'produtor-pg', nota: 5, comentario: 'Persistido.' });
    expect((await repo.listarProfissionais()).find(p => p.id === primeiro!.id)!.avaliacoes).toContainEqual(expect.objectContaining({ produtorId: 'produtor-pg', nota: 5 }));
    const linkedin = new LinkedInSimulado(), total = (await repo.listarProfissionais()).length;
    contexto.sistema.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), new AdaptadorLinkedIn(linkedin));
    try {
      expect(await contexto.sistema.importarProfissionais()).toMatchObject({ importados: 4 });
      await linkedin.avaliarProfissional('li-1001', 3);
      expect(await contexto.sistema.importarProfissionais()).toMatchObject({ importados: 0, atualizados: 1, inalterados: 3 });
      expect(await contexto.sistema.importarProfissionais()).toMatchObject({ importados: 0, atualizados: 0, inalterados: 4 });
      expect(await repo.listarProfissionais()).toHaveLength(total + 4);
    } finally { contexto.sistema.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), new AdaptadorInterno(repo)); }
    await contexto.eventos.processar();
  });
  it('migração pode ser desfeita e reaplicada no banco de teste', async () => {
    await contexto.eventos.processar();
    await banco.undoLastMigration();
    await banco.undoLastMigration();
    await banco.runMigrations();
    expect(await repo.listarProfissionais()).toEqual([]);
    const p = { ...profissionaisExemplo()[0]!, historico: [], avaliacoes: [], competencias: [] };
    await contexto.sistema.cadastrarProfissional(p);
    expect(await repo.listarProfissionais()).toHaveLength(1);
    await contexto.eventos.processar();
  });
  it('retorna saúde indisponível após encerramento da conexão', async () => {
    await contexto.app.close();
    await banco.destroy();
    expect(await repo.saudavel()).toBe(false);
  });
});
