import { centavos, type Profissional, type Projeto, type VisitanteProjeto } from './model.js';
import type { RestricoesAnimacao } from './projetos.js';
import { diasEntre, horasRender } from './validadores.js';
import { mediaAvaliacoes } from '../recommendation/strategies.js';

export class ValidadorConsistencia implements VisitanteProjeto<string[]> {
  visitarProjeto({ estado: { projeto: p, equipe }, profissionais }: Projeto): string[] {
    const erros: string[] = [];
    if (equipe.membros.reduce((s, m) => s + centavos(m.preco), 0) > centavos(p.orcamento)) erros.push('Orçamento excedido.');
    if (p.papeis.some(papel => !equipe.membros.some(m => m.papel === papel.papel))) erros.push('Há papéis sem profissional.');
    if (new Set(equipe.membros.map(m => m.profissionalId)).size !== equipe.membros.length) erros.push('Profissional repetido na equipe.');
    if (equipe.membros.some(m => !m.confirmado || !m.aceitoProdutor)) erros.push('Há membros sem confirmação de ambas as partes.');
    for (const profissional of profissionais) {
      erros.push(...profissional.aceitar(this).map(erro => `${profissional.dados.nome}: ${erro}`));
      const d = profissional.dados;
      if (d.disponibilidade.inicio > p.inicio || d.disponibilidade.fim < p.prazo) erros.push(`${d.nome}: não cobre o período do projeto.`);
    }
    return erros;
  }
  visitarProfissional({ dados: p }: Profissional): string[] {
    return p.disponibilidade.inicio > p.disponibilidade.fim ? ['Disponibilidade inválida.'] : [];
  }
}
export class CalculadorCompatibilidade implements VisitanteProjeto<number> {
  visitarProjeto({ estado: { projeto, equipe }, profissionais }: Projeto): number {
    const total = projeto.papeis.reduce((s, p) => s + p.peso, 0);
    return projeto.papeis.reduce((s, p) => {
      const membro = equipe.membros.find(m => m.papel === p.papel);
      const profissional = profissionais.find(prof => prof.dados.id === membro?.profissionalId);
      const score = membro?.pontuacao ?? 0;
      return s + p.peso * (profissional ? score * 0.8 + profissional.aceitar(this) * 0.2 : score);
    }, 0) / total;
  }
  visitarProfissional(p: Profissional): number { return mediaAvaliacoes(p.dados); }
}
export class GeradorRelatorio implements VisitanteProjeto<string> {
  visitarProjeto(p: Projeto): string {
    const { projeto, equipe } = p.estado;
    return [`Projeto: ${projeto.titulo}`, `Estratégia: ${projeto.estrategia}`, `Equipe: ${equipe.status}`,
      `Custo: R$ ${equipe.custo.toFixed(2)} / R$ ${projeto.orcamento.toFixed(2)}`,
      `Serviços: R$ ${p.calcularCustoTotal().toFixed(2)} em ${p.obterPrazoTotal()} dias`,
      ...equipe.membros.map(m => `${m.papel}: ${m.nome} (${m.confirmado ? 'confirmado' : 'aguardando'})`),
      ...p.profissionais.map(prof => prof.aceitar(this)),
      `Compatibilidade: ${(p.aceitar(new CalculadorCompatibilidade()) * 100).toFixed(1)}%`,
      ...p.aceitar(new ValidadorConsistencia())].join('\n');
  }
  visitarProfissional({ dados: p }: Profissional): string {
    return `${p.nome} | ${p.papeis.join(', ')} | R$ ${p.preco.toFixed(2)} | avaliação: ${(mediaAvaliacoes(p) * 5).toFixed(1)}`;
  }
}
/** Relatório da fábrica de animação: acrescenta métricas de eficiência de renderização. */
export class GeradorRelatorioAnimacao extends GeradorRelatorio {
  constructor(private readonly restricoes: RestricoesAnimacao) { super(); }
  override visitarProjeto(p: Projeto): string {
    const { projeto } = p.estado;
    const necessarias = horasRender(projeto.duracao, this.restricoes), janela = diasEntre(projeto.inicio, projeto.prazo) * 24;
    return [super.visitarProjeto(p),
      `Render estimado: ${necessarias} h (${this.restricoes.minutosRenderPorMinuto} min de máquina por minuto de obra; ${this.restricoes.softwares3D.join('/')})`,
      `Ocupação da janela de render: ${(janela ? necessarias / janela * 100 : 100).toFixed(1)}% de ${janela} h`,
      `Custo por minuto de obra: R$ ${(p.estado.equipe.custo / projeto.duracao).toFixed(2)}`].join('\n');
  }
}
