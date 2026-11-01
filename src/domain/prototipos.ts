import { estadoInicial, exigir, PAPEIS, type AjustesProjeto, type Competencia, type EstadoProjeto, type Papel, type PapelExigido, type Profissional, type Projeto, type ProjetoDados, type TipoProjeto } from './model.js';
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoFiccao, ProjetoPublicitario } from './projetos.js';
import { servicosDePapeis } from './servicos.js';

export { estadoInicial } from './model.js';

/**
 * Catálogo de protótipos de projeto (Prototype Registry).
 *
 * Os protótipos nunca saem do registro: toda consulta devolve um clone, de modo
 * que ajustes em uma instância não contaminam as próximas.
 */
export class RegistroPrototipos {
  private readonly prototipos = new Map<TipoProjeto, Projeto>();

  /**
   * Registra (ou substitui) o protótipo do tipo informado pelo próprio projeto.
   *
   * @param prototipo Modelo pré-configurado; uma cópia é armazenada.
   * @returns O próprio registro, para encadeamento.
   */
  registrar(prototipo: Projeto): this {
    this.prototipos.set(prototipo.tipo, prototipo.clonar());
    return this;
  }
  tipos(): TipoProjeto[] { return [...this.prototipos.keys()]; }
  /**
   * @param tipo Tipo de projeto registrado.
   * @returns Clone profundo do protótipo.
   * @throws ErroDominio Quando o tipo não foi registrado.
   */
  obter(tipo: TipoProjeto): Projeto {
    const prototipo = this.prototipos.get(tipo);
    exigir(prototipo, `Tipo de projeto não suportado: ${tipo}.`);
    return prototipo.clonar();
  }
  /**
   * Cria um novo projeto a partir do protótipo, com identidade própria e estado inicial.
   *
   * @param tipo Tipo de projeto registrado.
   * @param ajustes Dados que sobrescrevem os valores do modelo.
   * @returns Projeto sem equipe, versão 0, pronto para a primeira recomendação.
   */
  criar(tipo: TipoProjeto, ajustes: AjustesProjeto): Projeto {
    return this.obter(tipo).instanciar(ajustes);
  }
  /**
   * Reconstrói a instância rica a partir de um estado persistido.
   *
   * @param estado Estado obtido do repositório; é vinculado por referência.
   * @param profissionais Profissionais visitados junto com o projeto.
   */
  hidratar(estado: EstadoProjeto, profissionais: Profissional[] = []): Projeto {
    return this.obter(estado.projeto.tipoCaptacao).comEstado(estado, profissionais);
  }
  /** Registro com os modelos de documentário, ficção, animação e publicidade. */
  static padrao(): RegistroPrototipos {
    return new RegistroPrototipos()
      .registrar(new ProjetoFiccao(estadoInicial(modelo('ficcao', 'drama', 20, PAPEIS.map(p => papel(p, p === 'DIRETOR' ? 2 : 1))))))
      .registrar(new ProjetoDocumentario(estadoInicial(modelo('documentario', 'documentario', 52, [
        papel('DIRETOR', 2), papel('DIRETOR_FOTOGRAFIA', 1.5, { nome: 'captacao em campo', nivel: 1 }),
        papel('SONOPLASTA', 1.5), papel('EDITOR', 1), papel('ROTEIRISTA', 1),
      ]))))
      .registrar(new ProjetoAnimacao(estadoInicial(modelo('animacao', 'animacao', 15, [
        papel('DIRETOR', 2), papel('EFEITOS_VISUAIS', 2, { nome: 'modelagem 3d', nivel: 1 }),
        papel('EDITOR', 1), papel('SONOPLASTA', 1), papel('ROTEIRISTA', 1),
      ], { pesoTecnico: 0.8, pesoHistorico: 0.2, notaMinima: 0 }))))
      .registrar(new ProjetoPublicitario(estadoInicial(modelo('publicitario', 'publicidade', 1, [
        papel('DIRETOR', 2), papel('DIRETOR_FOTOGRAFIA', 1.5), papel('EDITOR', 1.5), papel('SONOPLASTA', 1),
      ], { pesoTecnico: 0.6, pesoHistorico: 0.4, notaMinima: 0 }, 'orcamento'))));
  }
}

function papel(nome: Papel, peso: number, ...extras: Competencia[]): PapelExigido {
  return { papel: nome, peso, competencias: [{ nome: nome.toLowerCase(), nivel: 1 }, ...extras] };
}
// Campos de identificação ficam vazios no modelo; a criação exige que o produtor os informe.
// O serviço principal do modelo é provisório: a fábrica o recalcula com orçamento e datas reais.
function modelo(tipoCaptacao: TipoProjeto, genero: string, duracao: number, papeis: PapelExigido[],
  parametros = { pesoTecnico: 0.7, pesoHistorico: 0.3, notaMinima: 0 }, estrategia: ProjetoDados['estrategia'] = 'cosseno'): ProjetoDados {
  return { id: '', produtorId: '', emailProdutor: '', titulo: '', genero, duracao, orcamento: 0, inicio: '', prazo: '',
    tipoCaptacao, localizacao: '', papeis, estrategia, parametros,
    servicoPrincipal: servicosDePapeis({ papeis, orcamento: 0, inicio: '', prazo: '' }).paraDados() };
}
