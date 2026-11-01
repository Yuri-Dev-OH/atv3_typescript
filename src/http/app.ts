import Fastify from 'fastify';
import { criarAdaptadores, type ProvedoresConfigurados } from '../adapters/configuracao.js';
import { SistemaRecomendacao } from '../application/service.js';
import { ErroDominio, exigir, type NomeDecorador, type NovoProjeto, type Papel, type ProfissionalDados } from '../domain/model.js';
import type { AdaptadoresExternos, CriteriosProfissional, NovaAvaliacao, PublicadorIntegracao, Repositorio, RepositorioProfissionais } from '../domain/ports.js';
import { AuditoriaRecomendacao, EventosEmMemoria, IntegracaoEquipe, NotificadorEmail, NotificadorInterno, ObservadorComposicao, type EnviadorEmail } from '../events/observers.js';
import { MontadorPilhaRecomendacao, POLITICA_PADRAO } from '../recommendation/decorators.js';
import * as schemas from './schemas.js';
import { ControleConcorrencia } from './concurrency.js';

export interface OpcoesApp {
  logger?: boolean;
  email?: EnviadorEmail;
  processarEventos?: boolean;
  profissionais?: RepositorioProfissionais;
  integracao?: PublicadorIntegracao;
  /** Adaptadores prontos; têm prioridade sobre `provedores`. */
  adaptadores?: Partial<AdaptadoresExternos>;
  /** Nomes dos provedores (variáveis de ambiente); padrão: S3, Stripe e cadastro interno simulados. */
  provedores?: ProvedoresConfigurados;
  /** Política de decoradores do recomendador; padrão: cache e auditoria. */
  decoradores?: NomeDecorador[];
}

export function criarApp(repo: Repositorio, options: OpcoesApp = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false, multipleOfPrecision: 2 } } });
  const eventos = new EventosEmMemoria(repo, app.log);
  eventos.adicionarObservador(new AuditoriaRecomendacao(repo, app.log));
  eventos.adicionarObservador(new NotificadorInterno(repo));
  eventos.adicionarObservador(new NotificadorEmail(repo, options.email));
  eventos.adicionarObservador(new IntegracaoEquipe(repo, options.integracao));
  const profissionais = options.profissionais ?? repo;
  // Ponto de composição: só aqui as classes concretas de provedor são escolhidas.
  const adaptadores = { ...criarAdaptadores(options.provedores ?? {}, profissionais), ...options.adaptadores };
  const pilha = new MontadorPilhaRecomendacao({ politica: options.decoradores ?? POLITICA_PADRAO, logger: app.log });
  const sistema = new SistemaRecomendacao(repo, eventos, { profissionais, adaptadores, pilha });
  eventos.adicionarObservador(new ObservadorComposicao(evento => sistema.aplicarRespostaConvite(evento)));
  const gravacoes = new ControleConcorrencia();
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    if (options.processarEventos !== false) {
      timer = setInterval(() => { void eventos.processar(); }, 1000);
      timer.unref();
      void eventos.processar();
    }
  });
  app.addHook('onClose', async () => { clearInterval(timer); await eventos.processar(); });
  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ErroDominio) return reply.code(erro.statusCode).send({ erro: erro.message });
    if (erro instanceof Error) {
      if ('validation' in erro && Array.isArray(erro.validation)) return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: erro.validation });
      if ('statusCode' in erro && typeof erro.statusCode === 'number' && erro.statusCode >= 400 && erro.statusCode < 500) {
        return reply.code(erro.statusCode).send({ erro: erro.message });
      }
    }
    request.log.error({ err: erro }, 'Falha ao atender solicitação');
    return reply.code(503).send({ erro: 'Serviço indisponível. Tente novamente.' });
  });
  app.get('/saude', async (_req, reply) => {
    const banco = await repo.saudavel();
    return reply.code(banco ? 200 : 503).send({ status: banco ? 'ok' : 'indisponivel', banco, provedores: sistema.provedores() });
  });
  app.post<{ Body: Omit<ProfissionalDados, 'id'> }>('/profissionais', { schema: { body: schemas.profissionalSchema } }, async (req, reply) => {
    return reply.code(201).send(await gravacoes.executar(() => sistema.cadastrarProfissional(req.body)));
  });
  app.get('/profissionais', async () => profissionais.listarProfissionais());
  app.post<{ Body: CriteriosProfissional }>('/profissionais/importacoes', { schema: { body: schemas.criteriosSchema } },
    async req => gravacoes.executar(() => sistema.importarProfissionais(req.body)));
  app.get<{ Params: { id: string } }>('/profissionais/:id', { schema: { params: schemas.projetoParams } }, async req => sistema.detalharProfissional(req.params.id));
  app.post<{ Params: { id: string }; Body: NovaAvaliacao }>('/profissionais/:id/avaliacoes', { schema: { params: schemas.projetoParams, body: schemas.avaliacaoSchema } }, async (req, reply) => {
    await gravacoes.executar(() => sistema.avaliarProfissional(req.params.id, req.body));
    return reply.code(204).send();
  });
  app.post<{ Body: NovoProjeto }>('/projetos', { schema: { body: schemas.projetoSchema } }, async (req, reply) => {
    return reply.code(201).send(await gravacoes.executar(() => sistema.criar(req.body)));
  });
  app.post<{ Body: NovoProjeto }>('/recomendacoes/simulacoes', { schema: { body: schemas.projetoSchema } }, async req => sistema.simular(req.body));
  app.get<{ Params: { id: string } }>('/projetos/:id', { schema: { params: schemas.projetoParams } }, async req => sistema.obter(req.params.id));
  app.post<{ Params: { id: string }; Body: Parameters<SistemaRecomendacao['reavaliar']>[1] }>('/projetos/:id/reavaliar', { schema: { params: schemas.projetoParams, body: schemas.reavaliacaoSchema } }, async req => gravacoes.executar(() => sistema.reavaliar(req.params.id, req.body)));
  app.post<{ Params: { id: string; papel: Papel }; Body: { acao: 'aceitar' | 'rejeitar' | 'substituir'; profissionalId?: string } }>('/projetos/:id/membros/:papel', { schema: { params: schemas.membroParams, body: schemas.decisaoSchema } }, async req => {
    exigir(!req.body.profissionalId || req.body.acao === 'substituir', 'profissionalId só deve ser informado em uma substituição.');
    return gravacoes.executar(() => sistema.decidir(req.params.id, req.params.papel, req.body.acao, req.body.profissionalId));
  });
  app.post<{ Params: { id: string; conviteId: string }; Body: { aceitar: boolean } }>('/projetos/:id/convites/:conviteId/responder', { schema: { params: schemas.conviteParams, body: schemas.respostaSchema } }, async req => gravacoes.executar(() => sistema.responderConvite(req.params.id, req.params.conviteId, req.body.aceitar)));
  app.get<{ Params: { id: string } }>('/projetos/:id/relatorio', { schema: { params: schemas.projetoParams } }, async req => sistema.gerarRelatorio(req.params.id));
  app.get<{ Params: { id: string } }>('/projetos/:id/servicos', { schema: { params: schemas.projetoParams } }, async req => sistema.servicos(req.params.id));
  app.post<{ Params: { id: string }; Body: { nome: string; tipoConteudo: string; conteudoBase64: string } }>('/projetos/:id/arquivos',
    { bodyLimit: Math.ceil(schemas.ARQUIVO_MAXIMO_BYTES / 3) * 4 + 4096, schema: { params: schemas.projetoParams, body: schemas.arquivoSchema } }, async (req, reply) => {
      const { nome, tipoConteudo, conteudoBase64 } = req.body;
      return reply.code(201).send(await sistema.anexarArquivo(req.params.id, Buffer.from(conteudoBase64, 'base64'), { nome, tipoConteudo }));
    });
  app.get<{ Params: { id: string } }>('/projetos/:id/arquivos', { schema: { params: schemas.projetoParams } }, async req => sistema.listarArquivos(req.params.id));
  app.get<{ Params: { id: string; arquivo: string } }>('/projetos/:id/arquivos/:arquivo', { schema: { params: schemas.arquivoParams } }, async (req, reply) => {
    const conteudo = await sistema.obterArquivo(req.params.id, req.params.arquivo);
    return reply.type('application/octet-stream').header('content-disposition', `attachment; filename="${req.params.arquivo}"`).send(conteudo);
  });
  app.post<{ Params: { id: string } }>('/projetos/:id/pagamentos', { schema: { params: schemas.projetoParams } }, async req => gravacoes.executar(() => sistema.pagarEquipe(req.params.id)));
  app.get<{ Params: { id: string } }>('/projetos/:id/pagamentos', { schema: { params: schemas.projetoParams } }, async req => sistema.listarPagamentos(req.params.id));
  app.post<{ Params: { id: string; pagamentoId: string } }>('/projetos/:id/pagamentos/:pagamentoId/cancelamento', { schema: { params: schemas.pagamentoParams } },
    async req => gravacoes.executar(() => sistema.cancelarPagamento(req.params.id, req.params.pagamentoId)));
  app.get('/recomendador', async () => sistema.pilha.metricas());
  app.put<{ Body: { decoradores: NomeDecorador[] } }>('/recomendador/decoradores', { schema: { body: schemas.politicaSchema } }, async req => {
    sistema.pilha.definirPolitica(req.body.decoradores);
    return { politica: sistema.pilha.politica };
  });
  app.get<{ Querystring: { destinatarioId?: string } }>('/notificacoes', { schema: { querystring: schemas.destinatarioQuery } }, async req => repo.notificacoes(req.query.destinatarioId));
  app.get<{ Querystring: { projetoId?: string } }>('/auditoria', { schema: { querystring: schemas.auditoriaQuery } }, async req => repo.auditoria(req.query.projetoId));
  app.get('/eventos', async () => repo.eventos());
  app.get('/integracoes', async () => repo.integracoes());
  return { app, sistema, eventos };
}
