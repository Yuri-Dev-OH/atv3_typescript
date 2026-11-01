import type { DataSource } from 'typeorm';
import { ErroDominio, type EstadoProjeto, type EventoRecomendacao, type Notificacao, type ProfissionalDados } from '../domain/model.js';
import { OBSERVADORES, type Repositorio } from '../domain/ports.js';
import { AuditoriaSchema, AvaliacaoSchema, CompetenciaSchema, EventoSchema, IntegracaoSchema, NotificacaoSchema, ProfissionalSchema, ProjetoSchema } from './database.js';

export class RepositorioPostgres implements Repositorio {
  constructor(readonly banco: DataSource) {}
  async listarProfissionais(): Promise<ProfissionalDados[]> {
    const [profissionais, competencias, avaliacoes] = await Promise.all([
      this.banco.getRepository(ProfissionalSchema).find(), this.banco.getRepository(CompetenciaSchema).find(), this.banco.getRepository(AvaliacaoSchema).find(),
    ]);
    const mapa = new Map(profissionais.map(p => [p.id, { ...p.dados, faixaPreco: p.dados.faixaPreco ?? { minimo: p.dados.preco, maximo: p.dados.preco }, id: p.id, competencias: [], avaliacoes: [] } as ProfissionalDados]));
    for (const { profissionalId, ...c } of competencias) mapa.get(profissionalId)?.competencias.push(c);
    for (const { profissionalId, ...a } of avaliacoes) mapa.get(profissionalId)?.avaliacoes.push(a);
    return [...mapa.values()];
  }
  async salvarProfissional(p: ProfissionalDados, evento: EventoRecomendacao): Promise<void> {
    await this.banco.transaction(async m => {
      const { competencias, avaliacoes, ...dados } = p;
      // Upsert: reimportações e novas avaliações substituem o cadastro e as tabelas filhas.
      await m.query('INSERT INTO profissional(id, dados) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET dados=EXCLUDED.dados', [p.id, JSON.stringify(dados)]);
      await m.delete(CompetenciaSchema, { profissionalId: p.id });
      await m.delete(AvaliacaoSchema, { profissionalId: p.id });
      if (competencias.length) await m.insert(CompetenciaSchema, competencias.map(c => ({ ...c, profissionalId: p.id })));
      if (avaliacoes.length) await m.insert(AvaliacaoSchema, avaliacoes.map(a => ({ ...a, profissionalId: p.id })));
      await m.query('INSERT INTO evento(id, dados) VALUES($1,$2)', [evento.id, JSON.stringify(evento)]);
    });
  }
  async obterProjeto(id: string): Promise<EstadoProjeto | undefined> {
    return (await this.banco.getRepository(ProjetoSchema).findOneBy({ id }))?.estado;
  }
  async salvarProjeto(estado: EstadoProjeto, versao: number, eventos: EventoRecomendacao[]): Promise<void> {
    await this.banco.transaction(async m => {
      if (versao === 0) await m.insert(ProjetoSchema, { id: estado.projeto.id, versao: estado.versao, estado });
      else {
        const result = await m.update(ProjetoSchema, { id: estado.projeto.id, versao }, { versao: estado.versao, estado });
        if (!result.affected) throw new ErroDominio('Projeto alterado por outra solicitação. Consulte novamente e tente outra vez.', 409);
      }
      await m.query('INSERT INTO recomendacao(id, projeto_id, dados) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [estado.recomendacao.id, estado.projeto.id, JSON.stringify(estado.recomendacao)]);
      for (const convite of estado.convites) await m.query(`INSERT INTO convite(id, projeto_id, profissional_id, papel, status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status`, [convite.id, estado.projeto.id, convite.profissionalId, convite.papel, convite.status]);
      for (const e of eventos) await m.query('INSERT INTO evento(id, dados) VALUES($1,$2)', [e.id, JSON.stringify(e)]);
    });
  }
  async salvarEventos(eventos: EventoRecomendacao[]): Promise<void> {
    await this.banco.transaction(async m => {
      for (const e of eventos) await m.query('INSERT INTO evento(id, dados) VALUES($1,$2)', [e.id, JSON.stringify(e)]);
    });
  }
  async eventos(pendentes = false, observadores = OBSERVADORES): Promise<EventoRecomendacao[]> {
    const query = this.banco.getRepository(EventoSchema).createQueryBuilder('e').orderBy("e.dados->>'data'", 'ASC');
    if (pendentes) query.where('NOT (e.entregues @> CAST(:observadores AS text[]))', { observadores });
    const rows = await query.take(500).getMany();
    return rows.map(r => ({ ...r.dados, entregues: r.entregues }));
  }
  async confirmarEntrega(eventoId: string, observador: string): Promise<void> {
    await this.banco.query('UPDATE evento SET entregues = array_append(entregues, $2) WHERE id=$1 AND NOT ($2 = ANY(entregues))', [eventoId, observador]);
  }
  async registrarAuditoria(evento: EventoRecomendacao): Promise<void> {
    await this.banco.query('INSERT INTO auditoria(id, projeto_id, dados) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET dados=EXCLUDED.dados', [evento.id, evento.projetoId, JSON.stringify(evento)]);
  }
  async auditoria(projetoId?: string): Promise<EventoRecomendacao[]> {
    const rows = await this.banco.getRepository(AuditoriaSchema).find({ where: projetoId ? { projetoId } : {}, take: 500 });
    return rows.map(r => r.dados);
  }
  async salvarNotificacao(n: Notificacao): Promise<void> {
    await this.banco.getRepository(NotificacaoSchema).upsert({ id: n.id, destinatarioId: n.destinatarioId, dados: n }, ['id']);
  }
  async notificacoes(destinatarioId?: string): Promise<Notificacao[]> {
    const rows = await this.banco.getRepository(NotificacaoSchema).find({ where: destinatarioId ? { destinatarioId } : {}, take: 500 });
    return rows.map(r => r.dados);
  }
  async registrarIntegracao(e: EventoRecomendacao, destino: string): Promise<void> {
    await this.banco.query('INSERT INTO integracao(id, evento_id, destino, dados) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET dados=EXCLUDED.dados', [`${e.id}:${destino}`, e.id, destino, JSON.stringify(e.dados)]);
  }
  async integracoes(): Promise<{ eventoId: string; destino: string; dados: Record<string, unknown> }[]> {
    return this.banco.getRepository(IntegracaoSchema).find({ take: 500 });
  }
  async saudavel(): Promise<boolean> {
    try { await this.banco.query('SELECT 1'); return true; } catch { return false; }
  }
}
