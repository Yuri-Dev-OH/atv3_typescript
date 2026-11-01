import { isDeepStrictEqual } from 'node:util';
import Fastify from 'fastify';
import { agora, ErroDominio, id, validarProfissional, type ProfissionalDados } from '../domain/model.js';
import type { Repositorio } from '../domain/ports.js';
import { profissionalSchema, projetoParams } from './schemas.js';

export function criarCatalogoApp(repo: Repositorio) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, multipleOfPrecision: 2 } } });
  app.get('/profissionais', async () => repo.listarProfissionais());
  app.get('/saude', async (_req, reply) => {
    const banco = await repo.saudavel();
    return reply.code(banco ? 200 : 503).send({ banco });
  });
  app.put<{ Params: { id: string }; Body: Omit<ProfissionalDados, 'id'> }>('/profissionais/:id', { schema: { params: projetoParams, body: profissionalSchema } }, async (req, reply) => {
    const p = { ...req.body, id: req.params.id, faixaPreco: req.body.faixaPreco ?? { minimo: req.body.preco, maximo: req.body.preco } };
    try { validarProfissional(p); }
    catch (erro) { if (erro instanceof ErroDominio) return reply.code(422).send({ erro: erro.message }); throw erro; }
    // O mesmo UUID pode ser reenviado se a conexão cair após a primeira gravação:
    // conteúdo igual não gera nova gravação; conteúdo diferente atualiza o cadastro.
    const anterior = (await repo.listarProfissionais()).find(prof => prof.id === p.id);
    if (anterior && isDeepStrictEqual(normalizar(anterior), normalizar(p))) return reply.code(200).send(anterior);
    await repo.salvarProfissional(p, { id: id(), tipo: anterior ? 'PROFISSIONAL_ATUALIZADO' : 'PROFISSIONAL_CADASTRADO', projetoId: '', origem: p.id, data: agora(),
      dados: { profissionalId: p.id }, destinatarios: [], entregues: [] });
    return reply.code(anterior ? 200 : 201).send(p);
  });
  return app;
}
/** Ordena as listas cuja ordem o banco não preserva, para comparar cadastros. */
function normalizar(p: ProfissionalDados): ProfissionalDados {
  return { ...p, competencias: [...p.competencias].sort((a, b) => a.nome.localeCompare(b.nome)),
    avaliacoes: [...p.avaliacoes].sort((a, b) => a.produtorId.localeCompare(b.produtorId)) };
}
