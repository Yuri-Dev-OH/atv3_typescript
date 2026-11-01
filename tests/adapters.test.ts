import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdaptadorGoogleCloud, AdaptadorLocal, AdaptadorS3, validarIdentificador } from '../src/adapters/armazenamento.js';
import { criarAdaptadores } from '../src/adapters/configuracao.js';
import { AdaptadorPagSeguro, AdaptadorPayPal, AdaptadorStripe } from '../src/adapters/pagamento.js';
import { AdaptadorIndeed, AdaptadorInterno, AdaptadorLinkedIn, inferirPapel, uuidExterno } from '../src/adapters/profissional.js';
import type { EstadoProjeto } from '../src/domain/model.js';
import type { AdaptadorArmazenamento, AdaptadorPagamento } from '../src/domain/ports.js';
import { criarApp } from '../src/http/app.js';
import { GoogleCloudStorageSimulado, S3Simulado } from '../src/infrastructure/externos/armazenamento.js';
import { PagSeguroSimulado, PayPalSimulado, StripeSimulado } from '../src/infrastructure/externos/pagamento.js';
import { IndeedSimulado, LinkedInSimulado } from '../src/infrastructure/externos/profissionais.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

let repo: RepositorioMemoria;
let contexto: ReturnType<typeof criarApp>;
let pasta: string;
beforeEach(async () => {
  repo = new RepositorioMemoria();
  contexto = criarApp(repo, { processarEventos: false });
  for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
  pasta = await mkdtemp(path.join(tmpdir(), 'cinebridge-'));
});
afterEach(async () => {
  await contexto.app.close();
  await rm(pasta, { recursive: true, force: true });
});
async function criarProjeto(): Promise<EstadoProjeto> {
  const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: projetoExemplo() });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
/** Aceita e confirma cada membro até a equipe ficar formada. */
async function formarEquipe(): Promise<EstadoProjeto> {
  let estado = await criarProjeto();
  for (const membro of estado.equipe.membros) {
    estado = (await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/membros/${membro.papel}`, payload: { acao: 'aceitar' } })).json();
    const convite = estado.convites.find(c => c.papel === membro.papel && c.status === 'pendente')!;
    estado = (await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/convites/${convite.id}/responder`, payload: { aceitar: true } })).json();
  }
  expect(estado.equipe.status).toBe('formada');
  return estado;
}
function trocar(armazenamento: AdaptadorArmazenamento, pagamento: AdaptadorPagamento = new AdaptadorStripe()): void {
  contexto.sistema.configurarAdaptadores(armazenamento, pagamento, new AdaptadorInterno(repo));
}

describe('Adapter: armazenamento', () => {
  it('troca S3, Google Cloud e disco local sem mudar a regra de negócio', async () => {
    const { projeto } = await criarProjeto();
    const s3 = new S3Simulado(), gcs = new GoogleCloudStorageSimulado();
    const provedores: AdaptadorArmazenamento[] = [new AdaptadorS3(s3), new AdaptadorGoogleCloud(gcs), new AdaptadorLocal(pasta)];
    for (const adaptador of provedores) {
      trocar(adaptador);
      const conteudo = Buffer.from(`roteiro salvo via ${adaptador.provedor}`);
      const envio = await contexto.app.inject({ method: 'POST', url: `/projetos/${projeto.id}/arquivos`,
        payload: { nome: 'Roteiro Final (v2).pdf', tipoConteudo: 'application/pdf', conteudoBase64: conteudo.toString('base64') } });
      expect(envio.statusCode, envio.body).toBe(201);
      const { id, arquivo } = envio.json();
      // Mesmo formato de identificador em qualquer provedor: o núcleo não vê URIs nativas.
      expect(id).toMatch(new RegExp(`^projetos/${projeto.id}/[0-9a-f-]{36}-Roteiro_Final_v2_.pdf$`));
      const lista = await contexto.app.inject(`/projetos/${projeto.id}/arquivos`);
      expect(lista.json()).toEqual([{ id, arquivo }]);
      const download = await contexto.app.inject(`/projetos/${projeto.id}/arquivos/${arquivo}`);
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(conteudo)).toBe(true);
      expect(download.headers['content-disposition']).toContain(arquivo);
      expect((await contexto.app.inject(`/projetos/${projeto.id}/arquivos/inexistente.pdf`)).statusCode).toBe(404);
    }
    // Cada provedor recebeu a chamada no seu próprio formato.
    expect((await s3.listar('projetos/'))[0]).toMatch(/^s3:\/\/cinebridge-midia\/projetos\//);
    expect((await gcs.listar('projetos/'))[0]).toMatch(/^projetos\//);
  });
  it('isola os arquivos de cada projeto e rejeita identificadores perigosos', async () => {
    trocar(new AdaptadorLocal(pasta));
    const a = (await criarProjeto()).projeto.id, b = (await criarProjeto()).projeto.id;
    const envio = await contexto.app.inject({ method: 'POST', url: `/projetos/${a}/arquivos`, payload: { nome: 'a.txt', tipoConteudo: 'text/plain', conteudoBase64: 'b2xhIQ==' } });
    const { arquivo } = envio.json();
    expect((await contexto.app.inject(`/projetos/${b}/arquivos/${arquivo}`)).statusCode).toBe(404);
    expect((await contexto.app.inject(`/projetos/${b}/arquivos`)).json()).toEqual([]);
    expect((await contexto.app.inject(`/projetos/${a}/arquivos/..%2F..%2Fsegredo`)).statusCode).toBe(400);
    expect(() => validarIdentificador('projetos/../segredo')).toThrow('inválido');
    expect(() => validarIdentificador('/raiz')).toThrow('inválido');
    await expect(new AdaptadorLocal(pasta).recuperarArquivo('projetos\\..\\x')).rejects.toThrow('inválido');
    expect(await new AdaptadorLocal(path.join(pasta, 'vazio')).listarArquivos('projetos/')).toEqual([]);
    const semProjeto = await contexto.app.inject({ method: 'POST', url: '/projetos/00000000-0000-4000-8000-000000000000/arquivos', payload: { nome: 'a.txt', tipoConteudo: 'text/plain', conteudoBase64: 'b2xh' } });
    expect(semProjeto.statusCode).toBe(404);
  });
});

describe('Adapter: pagamento', () => {
  it('troca Stripe, PagSeguro e PayPal sem mudar a regra de negócio', async () => {
    const estado = await formarEquipe();
    const casos: [AdaptadorPagamento, RegExp][] = [
      [new AdaptadorStripe(new StripeSimulado()), /^pi_[0-9a-f]{24}$/],
      [new AdaptadorPagSeguro(new PagSeguroSimulado()), /^ORDE_[0-9A-F-]{36}$/],
      [new AdaptadorPayPal(new PayPalSimulado()), /^[0-9A-F]{17}$/],
    ];
    for (const [gateway, formato] of casos) {
      trocar(new AdaptadorS3(), gateway);
      // O mesmo fluxo de negócio, provedor diferente: pagar, consultar e estornar.
      const pago = await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos` });
      expect(pago.statusCode, pago.body).toBe(200);
      const { efetuados } = pago.json();
      expect(efetuados).toHaveLength(estado.equipe.membros.length);
      expect(efetuados.every((p: { status: string; provedor: string; transacaoId: string }) => p.status === 'aprovado' && p.provedor === gateway.provedor && formato.test(p.transacaoId))).toBe(true);
      const total = efetuados.reduce((s: number, p: { valor: number }) => s + p.valor, 0);
      expect(total).toBe(estado.equipe.custo);
      // Repetir não gera cobrança dupla.
      expect((await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos` })).json().efetuados).toEqual([]);
      for (const p of efetuados) {
        const cancelado = await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos/${p.id}/cancelamento` });
        expect(cancelado.json().status).toBe('cancelado');
      }
      const lista = (await contexto.app.inject(`/projetos/${estado.projeto.id}/pagamentos`)).json();
      expect(lista.filter((p: { provedor: string; status: string }) => p.provedor === gateway.provedor).every((p: { status: string }) => p.status === 'cancelado')).toBe(true);
    }
    const auditoria = (await contexto.app.inject(`/projetos/${estado.projeto.id}`)).json();
    expect(auditoria.pagamentos).toHaveLength(estado.equipe.membros.length * 3);
  });
  it('grava os pagamentos concluídos antes de uma falha do gateway e exige equipe formada', async () => {
    const naoFormado = await criarProjeto();
    expect((await contexto.app.inject({ method: 'POST', url: `/projetos/${naoFormado.projeto.id}/pagamentos` })).statusCode).toBe(409);
    const estado = await formarEquipe();
    class StripeInstavel extends StripeSimulado {
      chamadas = 0;
      override async processarPagamento(valor: number, dados: Record<string, unknown>) {
        if (++this.chamadas === 3) this.simularIndisponibilidade();
        return super.processarPagamento(valor, dados);
      }
    }
    const instavel = new StripeInstavel();
    trocar(new AdaptadorS3(), new AdaptadorStripe(instavel));
    expect((await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos` })).statusCode).toBe(503);
    expect((await contexto.app.inject(`/projetos/${estado.projeto.id}/pagamentos`)).json()).toHaveLength(2);
    instavel.simularIndisponibilidade(false);
    const retomado = (await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos` })).json();
    expect(retomado.efetuados).toHaveLength(estado.equipe.membros.length - 2);
    expect(retomado.pagamentos).toHaveLength(estado.equipe.membros.length);
    // Com outro provedor configurado, o pagamento antigo mantém o status gravado e não pode ser cancelado por ele.
    trocar(new AdaptadorS3(), new AdaptadorPayPal());
    expect((await contexto.app.inject(`/projetos/${estado.projeto.id}/pagamentos`)).json()[0].status).toBe('aprovado');
    expect((await contexto.app.inject({ method: 'POST', url: `/projetos/${estado.projeto.id}/pagamentos/${retomado.pagamentos[0].id}/cancelamento` })).statusCode).toBe(409);
  });
  it('valida valores e traduz erros do gateway', async () => {
    const stripe = new AdaptadorStripe(), pagseguro = new AdaptadorPagSeguro(), paypal = new AdaptadorPayPal();
    for (const gateway of [stripe, pagseguro, paypal]) {
      await expect(gateway.efetuarPagamento(0, 'a', 'b')).rejects.toThrow('Valor de pagamento inválido');
      await expect(gateway.efetuarPagamento(10.001, 'a', 'b')).rejects.toThrow('Valor de pagamento inválido');
      await expect(gateway.efetuarPagamento(10, ' ', 'b')).rejects.toThrow('origem e o destino');
      await expect(gateway.verificarPagamento('inexistente')).rejects.toMatchObject({ statusCode: 404 });
      await expect(gateway.cancelarPagamento('inexistente')).rejects.toMatchObject({ statusCode: 404 });
      const transacao = await gateway.efetuarPagamento(1234.56, 'produtor', 'profissional');
      expect(await gateway.cancelarPagamento(transacao)).toBe(true);
      expect(await gateway.cancelarPagamento(transacao)).toBe(false);
    }
    // O Stripe recebeu centavos inteiros; o PagSeguro, reais.
    const stripeBruto = new StripeSimulado();
    const id = await new AdaptadorStripe(stripeBruto).efetuarPagamento(19.9, 'p', 'q');
    expect(await stripeBruto.consultarStatus(id)).toBe('succeeded');
    await expect(stripeBruto.processarPagamento(19.9, { currency: 'brl', customer: 'p' })).rejects.toMatchObject({ codigo: 'amount_invalid' });
    await expect(new PagSeguroSimulado().processarPagamento(1990, {})).rejects.toMatchObject({ codigo: '40001' });
    await expect(new PayPalSimulado().processarPagamento(10, { intent: 'AUTHORIZE' })).rejects.toMatchObject({ codigo: 'INVALID_REQUEST' });
    const indisponivel = new StripeSimulado();
    indisponivel.simularIndisponibilidade();
    await expect(new AdaptadorStripe(indisponivel).efetuarPagamento(10, 'a', 'b')).rejects.toThrow('indisponível');
  });
});

describe('Adapter: fontes de profissionais', () => {
  it('importa do LinkedIn e do Indeed para o cadastro interno, sem duplicar', async () => {
    const linkedin = new LinkedInSimulado(), indeed = new IndeedSimulado();
    contexto.sistema.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), new AdaptadorLinkedIn(linkedin));
    const primeira = (await contexto.app.inject({ method: 'POST', url: '/profissionais/importacoes', payload: {} })).json();
    // O perfil de marketing não tem papel técnico e é descartado.
    expect(primeira).toMatchObject({ provedor: 'linkedin', importados: 4, atualizados: 0, inalterados: 0 });
    expect((await contexto.app.inject({ method: 'POST', url: '/profissionais/importacoes', payload: {} })).json()).toMatchObject({ importados: 0, inalterados: 4 });
    const detalhe = (await contexto.app.inject(`/profissionais/${uuidExterno('linkedin', 'li-1003')}`)).json();
    expect(detalhe).toMatchObject({ nome: 'Beatriz Alves', papeis: ['EFEITOS_VISUAIS'], remoto: true, faixaPreco: { minimo: 880, maximo: 1320 } });
    expect(detalhe.competencias).toContainEqual({ nome: 'modelagem 3d', nivel: 1 });
    const avaliacao = await contexto.app.inject({ method: 'POST', url: `/profissionais/${detalhe.id}/avaliacoes`, payload: { produtorId: 'produtor-demo', nota: 4, comentario: 'Ótimo.' } });
    expect(avaliacao.statusCode).toBe(204);
    expect((await linkedin.obterPerfil('li-1003')).recommendations).toContainEqual(expect.objectContaining({ author: 'cinebridge', rating: 4 }));
    // A reimportação traz a avaliação nova para o cadastro interno.
    expect((await contexto.app.inject({ method: 'POST', url: '/profissionais/importacoes', payload: {} })).json()).toMatchObject({ atualizados: 1, inalterados: 3 });

    contexto.sistema.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), new AdaptadorIndeed(indeed));
    const doIndeed = (await contexto.app.inject({ method: 'POST', url: '/profissionais/importacoes', payload: { localizacao: 'São Paulo' } })).json();
    expect(doIndeed).toMatchObject({ provedor: 'indeed', importados: 2 });
    const pedro = (await contexto.app.inject(`/profissionais/${uuidExterno('indeed', 'in-202')}`)).json();
    expect(pedro).toMatchObject({ papeis: ['DIRETOR'], avaliacoes: [expect.objectContaining({ produtorId: 'indeed', nota: 4 })] });
    await contexto.app.inject({ method: 'POST', url: `/profissionais/${pedro.id}/avaliacoes`, payload: { produtorId: 'p', nota: 5 } });
    expect((await indeed.obterPerfil('in-202')).total_avaliacoes).toBe(5);
    const nomes = (await contexto.app.inject('/profissionais')).json().map((p: { nome: string }) => p.nome);
    expect(nomes).toEqual(expect.arrayContaining(['Marina Souza', 'Juliana Rocha', 'Pedro Henrique Dias']));
    expect(nomes).not.toContain('Rodrigo Teixeira');
    expect((await contexto.app.inject(`/profissionais/${uuidExterno('indeed', 'nao-existe')}`)).statusCode).toBe(404);
  });
  it('profissionais importados entram nas recomendações', async () => {
    contexto.sistema.configurarAdaptadores(new AdaptadorS3(), new AdaptadorStripe(), new AdaptadorLinkedIn());
    await contexto.sistema.importarProfissionais({ papel: 'EFEITOS_VISUAIS' });
    const projeto = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), tipoCaptacao: 'animacao', papeis: undefined, duracao: 5, orcamento: 20000 } });
    expect(projeto.statusCode, projeto.body).toBe(201);
    const ranking = projeto.json().recomendacao.ranking.EFEITOS_VISUAIS.map((c: { nome: string }) => c.nome);
    expect(ranking).toContain('Beatriz Alves');
  });
  it('avalia pelo cadastro interno, substituindo a nota anterior do mesmo produtor', async () => {
    const [primeiro] = await repo.listarProfissionais();
    const url = `/profissionais/${primeiro!.id}/avaliacoes`;
    await contexto.app.inject({ method: 'POST', url, payload: { produtorId: 'produtor-demo', nota: 2, comentario: 'Atrasou.' } });
    const detalhe = (await contexto.app.inject(`/profissionais/${primeiro!.id}`)).json();
    expect(detalhe.avaliacoes.filter((a: { produtorId: string }) => a.produtorId === 'produtor-demo')).toEqual([expect.objectContaining({ nota: 2, comentario: 'Atrasou.' })]);
    expect((await contexto.app.inject({ method: 'POST', url, payload: { produtorId: 'x', nota: 6 } })).statusCode).toBe(400);
    expect((await contexto.app.inject('/profissionais/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect(await new AdaptadorInterno(repo).listarProfissionais({ papel: 'EDITOR', localizacao: ' são paulo ', remoto: false })).toHaveLength(3);
  });
  it('infere papéis, gera UUIDs estáveis e filtra por critérios nas fontes', async () => {
    expect(inferirPapel('Diretora de Fotografia')).toBe('DIRETOR_FOTOGRAFIA');
    expect(inferirPapel('Diretor de cinema')).toBe('DIRETOR');
    expect(inferirPapel('Técnico de áudio')).toBe('SONOPLASTA');
    expect(inferirPapel('Motorista')).toBeUndefined();
    expect(uuidExterno('linkedin', 'li-1')).toBe(uuidExterno('linkedin', 'li-1'));
    expect(uuidExterno('linkedin', 'li-1')).not.toBe(uuidExterno('indeed', 'li-1'));
    expect(uuidExterno('linkedin', 'li-1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await new AdaptadorLinkedIn().listarProfissionais({ remoto: true })).map(p => p.dados.nome)).toEqual(['Rafael Lima', 'Beatriz Alves']);
    expect(await new AdaptadorIndeed().listarProfissionais({ papel: 'ROTEIRISTA' })).toHaveLength(1);
    await expect(new AdaptadorLinkedIn().registrarAvaliacao(uuidExterno('linkedin', 'li-1001'), { produtorId: 'p', nota: 4.6, comentario: '' })).resolves.toBeUndefined();
  });
});

describe('Configuração dos provedores', () => {
  it('escolhe provedores por nome e rejeita nomes desconhecidos', () => {
    const repoVazio = new RepositorioMemoria();
    const padrao = criarAdaptadores({}, repoVazio);
    expect([padrao.armazenamento.provedor, padrao.pagamento.provedor, padrao.profissional.provedor]).toEqual(['s3', 'stripe', 'interno']);
    const outros = criarAdaptadores({ armazenamento: 'local', diretorioLocal: pasta, pagamento: 'paypal', profissional: 'indeed' }, repoVazio);
    expect([outros.armazenamento.provedor, outros.pagamento.provedor, outros.profissional.provedor]).toEqual(['local', 'paypal', 'indeed']);
    expect(criarAdaptadores({ armazenamento: 'gcs', pagamento: 'pagseguro', profissional: 'linkedin' }, repoVazio).armazenamento.provedor).toBe('gcs');
    expect(() => criarAdaptadores({ pagamento: 'boleto' }, repoVazio)).toThrow('Opções: stripe, pagseguro, paypal');
    expect(() => criarAdaptadores({ armazenamento: 'toString' }, repoVazio)).toThrow('desconhecido');
  });
  it('responde 503 quando a operação depende de um adaptador ausente', async () => {
    const { SistemaRecomendacao } = await import('../src/application/service.js');
    const sistema = new SistemaRecomendacao(new RepositorioMemoria(), { async processar() {} });
    await expect(sistema.importarProfissionais()).rejects.toMatchObject({ statusCode: 503 });
    await expect(sistema.pagarEquipe('x')).rejects.toMatchObject({ statusCode: 503 });
    expect(sistema.provedores()).toEqual({ armazenamento: undefined, pagamento: undefined, profissional: undefined });
    const saude = (await contexto.app.inject('/saude')).json();
    expect(saude.provedores).toEqual({ armazenamento: 's3', pagamento: 'stripe', profissional: 'interno' });
  });
});
