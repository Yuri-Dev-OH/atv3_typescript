import { DECORADORES, PAPEIS, TIPOS_PROJETO } from '../domain/model.js';
import { LIMITES_SERVICOS } from '../domain/servicos.js';

const texto = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
const data = { type: 'string', format: 'date' };
const email = { type: 'string', format: 'email', maxLength: 254 };
const decimal = { type: 'number', minimum: 0, maximum: 100000000, multipleOf: 0.01 };
const unitario = { type: 'number', minimum: 0, maximum: 1 };
const papel = { type: 'string', enum: PAPEIS };
const objeto = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const lista = (items: unknown, minItems = 0, maxItems = 100) => ({ type: 'array', items, minItems, maxItems });
const competencia = objeto({ nome: texto, nivel: unitario });
const parametros = objeto({ pesoTecnico: { ...unitario, default: 0.7 }, pesoHistorico: { ...unitario, default: 0.3 }, notaMinima: { ...unitario, default: 0 } }, []);
export const profissionalSchema = objeto({
  nome: texto, email, papeis: { ...lista(papel, 1, 6), uniqueItems: true },
  competencias: lista(competencia, 1), preco: decimal,
  faixaPreco: objeto({ minimo: decimal, maximo: decimal }),
  disponibilidade: objeto({ inicio: data, fim: data }), localizacao: texto, remoto: { type: 'boolean' },
  historico: { ...lista(objeto({ projetoId: texto, genero: texto, papel })), default: [] },
  avaliacoes: { ...lista(objeto({ produtorId: texto, nota: { type: 'number', minimum: 1, maximum: 5 }, comentario: { type: 'string', maxLength: 2000 }, data })), default: [] },
}, ['nome', 'email', 'papeis', 'competencias', 'preco', 'disponibilidade', 'localizacao', 'remoto']);
const uuid = { type: 'string', format: 'uuid' };
const decoradores = { type: 'array', items: { type: 'string', enum: DECORADORES }, uniqueItems: true, maxItems: DECORADORES.length };
// Composite: um serviço é atômico (folha) ou um pacote que contém outros serviços.
// Profundidade e total de nós são limitados também no domínio (LIMITES_SERVICOS).
const servicoAtomico = objeto({ tipo: { const: 'atomico' }, nome: texto, papel, custo: decimal,
  prazo: { type: 'number', exclusiveMinimum: 0, maximum: 3650, multipleOf: 0.01 },
  peso: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, competencias: lista(competencia, 1, 20) }, ['tipo', 'nome', 'papel', 'custo', 'prazo']);
const pacoteServico = objeto({ tipo: { const: 'pacote' }, nome: texto, paralelo: { type: 'boolean' },
  itens: lista({ $ref: '#/definitions/servico' }, 1, LIMITES_SERVICOS.nos) }, ['tipo', 'nome', 'itens']);
const definicoes = { servico: { oneOf: [servicoAtomico, pacoteServico] } };
const projetoProperties = {
  produtorId: texto, emailProdutor: email, titulo: texto, genero: texto,
  duracao: { type: 'number', exclusiveMinimum: 0, maximum: 10000 }, orcamento: decimal,
  inicio: data, prazo: data, tipoCaptacao: { type: 'string', enum: TIPOS_PROJETO },
  localizacao: texto,
  papeis: lista(objeto({ papel, peso: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, competencias: lista(competencia, 1) }), 1, 6),
  // Sem padrão no schema: papéis, estratégia e parâmetros omitidos vêm do protótipo do tipo.
  estrategia: { type: 'string', enum: ['cosseno', 'colaborativa', 'orcamento'] },
  parametros,
  servicoPrincipal: { $ref: '#/definitions/servico' },
  decoradores,
};
export const projetoSchema = { ...objeto(projetoProperties, ['produtorId', 'emailProdutor', 'titulo', 'genero', 'duracao', 'orcamento', 'inicio', 'prazo', 'tipoCaptacao', 'localizacao']), definitions: definicoes };
const { produtorId: _produtor, emailProdutor: _email, estrategia: _estrategia, parametros: _parametros, ...alteraveis } = projetoProperties;
export const reavaliacaoSchema = { ...objeto({ ...alteraveis,
  estrategia: { type: 'string', enum: ['cosseno', 'colaborativa', 'orcamento'] }, parametros }, []), minProperties: 1, definitions: definicoes };
export const decisaoSchema = objeto({ acao: { type: 'string', enum: ['aceitar', 'rejeitar', 'substituir'] }, profissionalId: { type: 'string', format: 'uuid' } }, ['acao']);
export const respostaSchema = objeto({ aceitar: { type: 'boolean' } });
export const projetoParams = objeto({ id: { type: 'string', format: 'uuid' } });
export const membroParams = objeto({ id: { type: 'string', format: 'uuid' }, papel });
export const conviteParams = objeto({ id: { type: 'string', format: 'uuid' }, conviteId: { type: 'string', format: 'uuid' } });
export const destinatarioQuery = objeto({ destinatarioId: texto }, []);
export const auditoriaQuery = objeto({ projetoId: { type: 'string', format: 'uuid' } }, []);
// Base64 de até 6 MiB de conteúdo; a rota de upload eleva o limite do corpo para esse caso.
export const ARQUIVO_MAXIMO_BYTES = 6 * 1024 * 1024;
export const arquivoSchema = objeto({
  nome: texto, tipoConteudo: { type: 'string', maxLength: 100, pattern: '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$' },
  conteudoBase64: { type: 'string', minLength: 4, maxLength: Math.ceil(ARQUIVO_MAXIMO_BYTES / 3) * 4, pattern: '^[A-Za-z0-9+/]+={0,2}$' },
});
export const arquivoParams = objeto({ id: uuid, arquivo: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' } });
export const pagamentoParams = objeto({ id: uuid, pagamentoId: uuid });
export const avaliacaoSchema = objeto({ produtorId: texto, nota: { type: 'number', minimum: 1, maximum: 5 }, comentario: { type: 'string', maxLength: 2000, default: '' } }, ['produtorId', 'nota']);
export const criteriosSchema = objeto({ papel, localizacao: texto, remoto: { type: 'boolean' } }, []);
export const politicaSchema = objeto({ decoradores });
