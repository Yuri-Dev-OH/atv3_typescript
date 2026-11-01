import nodemailer from 'nodemailer';
import { criarApp } from './http/app.js';
import { criarBanco } from './infrastructure/database.js';
import { RepositorioPostgres } from './infrastructure/postgres-repository.js';
import { CatalogoHttp, PublicadorHttp } from './infrastructure/http-clients.js';
import { MontadorPilhaRecomendacao } from './recommendation/decorators.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL no arquivo .env.');
const banco = criarBanco(url);
await banco.initialize();
const transporte = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 1025), secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  connectionTimeout: 3000, socketTimeout: 5000,
}) : undefined;
const { app } = criarApp(new RepositorioPostgres(banco), { logger: true,
  // Provedores externos e pilha de decoradores são escolhidos por configuração, sem mudar código.
  provedores: { armazenamento: process.env.ARMAZENAMENTO_PROVEDOR || undefined, pagamento: process.env.PAGAMENTO_PROVEDOR || undefined,
    profissional: process.env.PROFISSIONAIS_PROVEDOR || undefined, diretorioLocal: process.env.ARMAZENAMENTO_LOCAL_DIR || undefined },
  decoradores: MontadorPilhaRecomendacao.lerPolitica(process.env.RECOMENDACAO_DECORADORES),
  profissionais: process.env.CATALOGO_URL ? new CatalogoHttp(process.env.CATALOGO_URL) : undefined,
  integracao: process.env.PROJETOS_EVENTOS_URL && process.env.FINANCEIRO_EVENTOS_URL ? new PublicadorHttp({
    'gerenciamento-projetos': process.env.PROJETOS_EVENTOS_URL, 'processamento-financeiro': process.env.FINANCEIRO_EVENTOS_URL,
  }) : undefined,
  email: transporte ? { async enviar(to, subject, text) { await transporte.sendMail({ from: process.env.SMTP_FROM ?? 'cinebridge@localhost', to, subject, text }); } } : undefined,
});
let encerrando = false;
const encerrar = async () => {
  if (encerrando) return;
  encerrando = true;
  await app.close();
  await banco.destroy();
};
process.on('SIGINT', () => { void encerrar(); });
process.on('SIGTERM', () => { void encerrar(); });
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' }); }
catch (erro) { app.log.error(erro); await encerrar(); process.exitCode = 1; }
