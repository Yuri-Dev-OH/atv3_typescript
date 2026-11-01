/**
 * Simulações de fontes externas de cadastro de profissionais. Cada uma usa o
 * próprio formato de perfil, filtros e escala de notas.
 */

/** Erro no formato da fonte, com o código HTTP que a API real devolveria. */
export class ErroApiProfissional extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Interface comum das fontes simuladas (classe adaptada). */
export abstract class ApiProfissionalExterna {
  abstract buscarProfissionais(filtros: Record<string, unknown>): Promise<unknown[]>;
  abstract obterPerfil(id: string): Promise<unknown>;
  /** @param nota Nota na escala da própria fonte. */
  abstract avaliarProfissional(id: string, nota: number): Promise<void>;
}

/** Perfil no formato da rede social profissional. */
export interface PerfilLinkedIn {
  id: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  headline: string;
  location: { city: string };
  openToRemote: boolean;
  skills: { name: string; endorsements: number }[];
  rate: { amount: number; minimum: number; maximum: number; currency: 'BRL' };
  availability: { from: string; to: string };
  recommendations: { author: string; rating: number; text: string; date: string }[];
}
/** Imita a API de pessoas do LinkedIn: filtros title/city/remote e notas de 1 a 5. */
export class LinkedInSimulado extends ApiProfissionalExterna {
  private readonly perfis: PerfilLinkedIn[];
  constructor(perfis: PerfilLinkedIn[] = perfisLinkedIn()) { super(); this.perfis = structuredClone(perfis); }
  async buscarProfissionais(filtros: { title?: string; city?: string; remote?: boolean }): Promise<PerfilLinkedIn[]> {
    return structuredClone(this.perfis.filter(p => (!filtros.title || p.headline.toLowerCase().includes(filtros.title.toLowerCase()))
      && (!filtros.city || p.location.city.toLowerCase() === filtros.city.toLowerCase())
      && (filtros.remote === undefined || p.openToRemote === filtros.remote)));
  }
  async obterPerfil(id: string): Promise<PerfilLinkedIn> {
    const perfil = this.perfis.find(p => p.id === id);
    if (!perfil) throw new ErroApiProfissional(`Member ${id} not found.`, 404);
    return structuredClone(perfil);
  }
  async avaliarProfissional(id: string, nota: number): Promise<void> {
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new ErroApiProfissional('Rating must be an integer from 1 to 5.', 400);
    const perfil = this.perfis.find(p => p.id === id);
    if (!perfil) throw new ErroApiProfissional(`Member ${id} not found.`, 404);
    perfil.recommendations = [...perfil.recommendations.filter(r => r.author !== 'cinebridge'),
      { author: 'cinebridge', rating: nota, text: 'Avaliação enviada pela Cinebridge.', date: new Date().toISOString().slice(0, 10) }];
  }
}

/** Currículo no formato do portal de empregos. */
export interface CurriculoIndeed {
  candidato_id: string;
  nome_completo: string;
  email: string;
  cargo: string;
  cidade: string;
  aceita_remoto: boolean;
  habilidades: string[];
  pretensao: number;
  disponivel_de: string;
  disponivel_ate: string;
  /** Média de 0 a 10. */
  nota_media: number;
  total_avaliacoes: number;
  atualizado_em: string;
}
/** Imita o portal Indeed: filtros cargo/cidade/remoto e notas de 0 a 10. */
export class IndeedSimulado extends ApiProfissionalExterna {
  private readonly curriculos: CurriculoIndeed[];
  constructor(curriculos: CurriculoIndeed[] = curriculosIndeed()) { super(); this.curriculos = structuredClone(curriculos); }
  async buscarProfissionais(filtros: { cargo?: string; cidade?: string; remoto?: boolean }): Promise<CurriculoIndeed[]> {
    return structuredClone(this.curriculos.filter(c => (!filtros.cargo || c.cargo.toLowerCase().includes(filtros.cargo.toLowerCase()))
      && (!filtros.cidade || c.cidade.toLowerCase() === filtros.cidade.toLowerCase())
      && (filtros.remoto === undefined || c.aceita_remoto === filtros.remoto)));
  }
  async obterPerfil(id: string): Promise<CurriculoIndeed> {
    const curriculo = this.curriculos.find(c => c.candidato_id === id);
    if (!curriculo) throw new ErroApiProfissional(`Candidato ${id} não encontrado.`, 404);
    return structuredClone(curriculo);
  }
  async avaliarProfissional(id: string, nota: number): Promise<void> {
    if (!(nota >= 0 && nota <= 10)) throw new ErroApiProfissional('A nota vai de 0 a 10.', 400);
    const curriculo = this.curriculos.find(c => c.candidato_id === id);
    if (!curriculo) throw new ErroApiProfissional(`Candidato ${id} não encontrado.`, 404);
    curriculo.nota_media = (curriculo.nota_media * curriculo.total_avaliacoes + nota) / (curriculo.total_avaliacoes + 1);
    curriculo.total_avaliacoes++;
  }
}

function perfisLinkedIn(): PerfilLinkedIn[] {
  const perfil = (id: string, nome: string, sobrenome: string, headline: string, cidade: string, remoto: boolean, skills: [string, number][], valor: number): PerfilLinkedIn => ({
    id, firstName: nome, lastName: sobrenome, emailAddress: `${nome.toLowerCase()}.${sobrenome.toLowerCase()}@linkedin.example`, headline,
    location: { city: cidade }, openToRemote: remoto, skills: skills.map(([name, endorsements]) => ({ name, endorsements })),
    rate: { amount: valor, minimum: valor * 0.8, maximum: valor * 1.2, currency: 'BRL' }, availability: { from: '2026-01-01', to: '2030-12-31' },
    recommendations: [{ author: 'produtora-aurora', rating: 5, text: 'Excelente entrega.', date: '2026-03-10' }],
  });
  return [
    perfil('li-1001', 'Marina', 'Souza', 'Diretora de Fotografia | Cinema independente', 'São Paulo', false, [['Iluminação', 40], ['Captação em campo', 25]], 900),
    perfil('li-1002', 'Rafael', 'Lima', 'Editor e montador de documentários', 'Rio de Janeiro', true, [['Montagem', 60], ['DaVinci Resolve', 30]], 700),
    perfil('li-1003', 'Beatriz', 'Alves', 'Artista de VFX e modelagem 3D', 'Curitiba', true, [['Modelagem 3D', 55], ['Blender', 45]], 1100),
    perfil('li-1004', 'Caio', 'Martins', 'Sound designer e sonoplasta', 'São Paulo', false, [['Mixagem', 35]], 500),
    perfil('li-1005', 'Lucas', 'Pereira', 'Gerente de marketing digital', 'São Paulo', true, [['SEO', 50]], 800),
  ];
}
function curriculosIndeed(): CurriculoIndeed[] {
  const curriculo = (id: string, nome: string, cargo: string, cidade: string, remoto: boolean, habilidades: string[], pretensao: number, nota: number): CurriculoIndeed => ({
    candidato_id: id, nome_completo: nome, email: `${id}@indeed.example`, cargo, cidade, aceita_remoto: remoto, habilidades, pretensao,
    disponivel_de: '2026-01-01', disponivel_ate: '2030-12-31', nota_media: nota, total_avaliacoes: nota ? 4 : 0, atualizado_em: '2026-05-20',
  });
  return [
    curriculo('in-201', 'Juliana Rocha', 'Roteirista', 'São Paulo', true, ['roteiro', 'publicidade'], 650, 9),
    curriculo('in-202', 'Pedro Henrique Dias', 'Diretor de cinema', 'São Paulo', false, ['direção de atores', 'publicidade'], 1500, 8),
    curriculo('in-203', 'Ana Clara Nunes', 'Editora de vídeo', 'Belo Horizonte', true, ['edição', 'colorização'], 550, 0),
    curriculo('in-204', 'Rodrigo Teixeira', 'Motorista', 'São Paulo', false, ['direção defensiva'], 300, 7),
  ];
}
