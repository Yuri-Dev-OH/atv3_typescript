# Cinebridge

API para recomendar e formar equipes audiovisuais. Node.js, TypeScript estrito, Fastify, PostgreSQL e TypeORM. Não há interface gráfica.

## Executar

Com o Docker Desktop aberto, execute no PowerShell, nesta pasta:

```powershell
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build --wait
npm run db:migrate
npm run db:seed
npm run build
npm run dev
```

O banco usa a porta **5433** para evitar conflito com instalações locais de PostgreSQL. A API fica em **http://127.0.0.1:3000**. O cadastro inicial tem 18 profissionais. Rodar o seed novamente não duplica os exemplos. Não sobrescreva seu `.env` se já tiver feito configurações próprias.

O Compose também inicia o catálogo na porta 3004, com banco próprio. Em instalações anteriores, acrescente `CATALOGO_URL=http://127.0.0.1:3004` ao `.env` depois de subir os novos serviços e execute o seed novamente. Os projetos existentes continuam preservados; o catálogo separado recebe os exemplos. Sem essa variável, o modo local usa a tabela de profissionais no mesmo banco da API.

Em outro terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/saude
npm run demo
```

A demonstração cria um projeto, recomenda seis profissionais, troca para a estratégia de orçamento, substitui o editor, envia convites, confirma todos os integrantes e imprime o relatório. Ela exige o seed e a API em execução. Cada execução cria um novo projeto.

Para a atividade 3, com a API em execução:

```powershell
npm run demo:padroes
```

A demonstração:
- **Composite:** cria um projeto a partir de uma hierarquia de serviços e imprime a árvore com custos e prazos.
- **Decorator:** cria projetos semelhantes e mostra as métricas de cache, auditoria e compressão.
- **Adapter:** salva e lê um arquivo, forma a equipe, paga os membros e importa profissionais pelos provedores configurados.

Para ver o mesmo código com outros provedores, pare a API e inicie-a com outras variáveis:

```powershell
$env:ARMAZENAMENTO_PROVEDOR='gcs'; $env:PAGAMENTO_PROVEDOR='pagseguro'; $env:PROFISSIONAIS_PROVEDOR='linkedin'; npm start
```

No Ubuntu: `ARMAZENAMENTO_PROVEDOR=gcs PAGAMENTO_PROVEDOR=pagseguro PROFISSIONAIS_PROVEDOR=linkedin npm start`. Variáveis definidas no terminal têm prioridade sobre o `.env`.

Para executar a versão compilada, pare o modo de desenvolvimento com Ctrl+C e use `npm start`. No Ubuntu, substitua a linha de cópia do `.env` por `test -f .env || cp .env.example .env`. É necessário Node.js 24 ou superior e Docker com Compose.

## Testes

```powershell
npm test
npm run test:coverage
npm run test:postgres
npm run evaluate
npm run test:load
npm run demo:integracoes
```

- `npm test`: testes dos padrões, regras de negócio e API. Os testes da atividade 3 estão em `tests/adapters.test.ts`, `tests/composite.test.ts` e `tests/decorators.test.ts`; para rodar só um: `npx vitest run tests/composite.test.ts`. Com `TEST_DATABASE_URL` no `.env`, também executa os testes de PostgreSQL.
- `npm run test:coverage`: relatório de cobertura no terminal e em `coverage/index.html`. Exige mais de 80% em linhas, funções, instruções e ramificações. Para medir a persistência também, o banco de teste deve estar disponível.
- `npm run test:postgres`: somente os testes de integração com PostgreSQL real. Sem `TEST_DATABASE_URL`, essa suíte é pulada; isso não valida a persistência.
- `npm run evaluate`: precisão@1 para cada estratégia, em um conjunto sintético com avaliações separadas das usadas no cálculo. Serve para demonstrar a medição; não representa a qualidade com usuários reais.
- `npm run test:load`: compila o código, cadastra 10 mil profissionais no banco de teste e envia 100 requisições HTTP simultâneas a um servidor temporário. Exibe mediana, p95 e máximo e falha se alguma resposta ultrapassar dois segundos ou for inválida. O catálogo é aquecido antes da medição. Não é necessário iniciar `npm run dev` para esse teste.

Os testes de PostgreSQL e de carga **limpam apenas o banco indicado em `TEST_DATABASE_URL`**, cujo nome deve terminar em `_test`. Não execute essas duas suítes ao mesmo tempo. O Compose cria `cinebridge_test` na primeira inicialização do volume. Se você estiver reutilizando um volume anterior que não tem esse banco:

```powershell
docker compose exec postgres createdb -U cinebridge cinebridge_test
```

Para repetir a compilação, cobertura, carga e integração HTTP no **Ubuntu 24.04**, em ambiente isolado dos bancos de desenvolvimento:

```powershell
docker compose -p cinebridge-validacao -f compose.validation.yaml up --build --abort-on-container-exit --exit-code-from validacao
```

A imagem imprime a versão do sistema e do Node. A validação só está concluída quando o contêiner `validacao` termina com código 0. O banco desse ambiente é temporário. A preparação do Dockerfile não equivale a comprovar a execução; consulte `docs/verificacao.md` para o estado das verificações.

## API

| Método | Rota | Ação |
|---|---|---|
| GET | `/saude` | Testa conexão com o banco |
| POST | `/profissionais` | Cadastra perfil, competências, histórico e avaliações |
| GET | `/profissionais` | Lista profissionais |
| POST | `/projetos` | Cria projeto e recomenda equipe |
| GET | `/projetos/:id` | Consulta equipe, ranking e convites |
| POST | `/projetos/:id/reavaliar` | Altera características e refaz a equipe |
| POST | `/projetos/:id/membros/:papel` | Aceita, rejeita ou substitui um membro |
| POST | `/projetos/:id/convites/:conviteId/responder` | Registra aceite ou recusa do profissional |
| GET | `/projetos/:id/relatorio` | Relatório, compatibilidade e pendências |
| GET | `/notificacoes?destinatarioId=...` | Notificações internas e e-mails |
| GET | `/auditoria?projetoId=...` | Ações registradas |
| GET | `/eventos` | Eventos e observadores que receberam cada um |
| GET | `/integracoes` | Eventos destinados a projetos e financeiro |
| GET | `/projetos/:id/servicos` | Hierarquia de serviços com custo, prazo e cobertura de cada nó |
| POST | `/recomendacoes/simulacoes` | Monta a equipe de um projeto sem gravá-lo |
| POST | `/projetos/:id/arquivos` | Salva arquivo de mídia (`nome`, `tipoConteudo`, `conteudoBase64`; até 6 MiB) |
| GET | `/projetos/:id/arquivos` | Lista os arquivos do projeto |
| GET | `/projetos/:id/arquivos/:arquivo` | Baixa um arquivo |
| POST | `/projetos/:id/pagamentos` | Paga os membros da equipe formada, sem pagar duas vezes |
| GET | `/projetos/:id/pagamentos` | Pagamentos, com status consultado no provedor |
| POST | `/projetos/:id/pagamentos/:pagamentoId/cancelamento` | Estorna um pagamento |
| POST | `/profissionais/importacoes` | Importa profissionais da fonte configurada (`papel`, `localizacao` e `remoto` opcionais) |
| GET | `/profissionais/:id` | Detalha um profissional na fonte configurada |
| POST | `/profissionais/:id/avaliacoes` | Registra avaliação (`produtorId`, `nota` de 1 a 5, `comentario`) |
| GET | `/recomendador` | Política de decoradores e métricas de cache, auditoria e compressão |
| PUT | `/recomendador/decoradores` | Troca a política em tempo de execução, por exemplo `{"decoradores":["cache","auditoria","compressao"]}` |

Os exemplos completos de dados estão em `scripts/fixtures.ts`. Para criar um projeto manualmente no PowerShell:

```powershell
$projeto = @{
  produtorId = 'produtor-demo'
  emailProdutor = 'produtor@example.com'
  titulo = 'Meu curta'
  genero = 'drama'
  duracao = 20
  orcamento = 2000
  inicio = '2027-02-01'
  prazo = '2027-03-01'
  tipoCaptacao = 'ficcao'
  localizacao = 'São Paulo'
  estrategia = 'cosseno'
  papeis = @(@{
    papel = 'DIRETOR'
    peso = 1
    competencias = @(@{ nome = 'diretor'; nivel = 1 })
  })
} | ConvertTo-Json -Depth 10
$resultado = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/projetos -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($projeto))
$resultado.equipe
$projetoId = $resultado.projeto.id
```

Aceitar o diretor e confirmar o convite:

```powershell
$resultado = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/projetos/$projetoId/membros/DIRETOR" -ContentType 'application/json' -Body '{"acao":"aceitar"}'
$conviteId = ($resultado.convites | Where-Object status -eq 'pendente')[0].id
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/projetos/$projetoId/convites/$conviteId/responder" -ContentType 'application/json' -Body '{"aceitar":true}'
Invoke-RestMethod "http://127.0.0.1:3000/projetos/$projetoId/relatorio"
```

Outros corpos de requisição:

```json
{ "acao": "rejeitar" }
```

```json
{ "acao": "substituir", "profissionalId": "UUID-DO-NOVO-PROFISSIONAL" }
```

Sem `profissionalId`, a substituição escolhe automaticamente outro candidato. Para recusar um convite, envie `{"aceitar":false}`. Para reavaliar, envie, por exemplo, `{"estrategia":"orcamento","orcamento":4000}` à rota de reavaliação.

Entradas inválidas retornam 400, regras de negócio retornam 422, recursos ausentes retornam 404 e alterações concorrentes do mesmo projeto retornam 409. Falhas de persistência retornam 503, sem fingir que o projeto foi salvo.

## Organização e padrões

```text
src/
  domain/          entidades, contratos, visitantes e serviços (Composite)
  adapters/        adaptadores de armazenamento, pagamento e profissionais
  recommendation/ estratégias, decoradores e orquestrador
  application/     casos de uso e cache do catálogo
  events/          observadores e EventEmitter
  infrastructure/  TypeORM, migração, repositórios e sistemas externos simulados
  http/            rotas e validação JSON Schema
tests/             testes unitários e de integração
scripts/           migração, exemplos, avaliação e carga
```

| Padrão | Implementação | Demonstração |
|---|---|---|
| Strategy | `SimilaridadeCosseno`, `FiltragemColaborativa`, `RegrasOrcamento` | Troca de estratégia altera a equipe e o custo |
| Template Method | `OrquestradorEquipe` e `OrquestradorPadrao` | Validar → normalizar → recomendar → pós-processar; método principal não gravável |
| Observer | `EventosEmMemoria`, notificadores, auditoria e integração | Observadores independentes, entregas com repetição em caso de falha |
| Visitor | `ValidadorConsistencia`, `CalculadorCompatibilidade`, `GeradorRelatorio` | Operações diferentes sobre projeto e profissional sem modificar seu estado |
| Prototype | `Projeto` (abstrato), `ProjetoFiccao`, `ProjetoDocumentario`, `ProjetoAnimacao`, `ProjetoPublicitario`, `RegistroPrototipos` | `clonar()` devolve cópia profunda (papéis, competências, restrições e profissionais); novos projetos nascem do clone do modelo do tipo |
| Factory Method | `Projeto.criarFabrica()` em cada subclasse; `criarValidador()` e `criarNotificador()` em cada fábrica | Cada tipo de projeto define a fábrica e os componentes que coopera com ele |
| Abstract Factory | `FabricaProjeto`, `FabricaFiccao`, `FabricaDocumentario`, `FabricaAnimacao`, `FabricaPublicitario` | Trocar a fábrica troca projeto, validador, recomendador e notificador; `OrquestradorEquipe` recebe a fábrica no construtor e não tem condicionais por tipo |
| Adapter | `AdaptadorArmazenamento` (`AdaptadorS3`, `AdaptadorGoogleCloud`, `AdaptadorLocal`), `AdaptadorPagamento` (`AdaptadorStripe`, `AdaptadorPagSeguro`, `AdaptadorPayPal`), `AdaptadorProfissional` (`AdaptadorLinkedIn`, `AdaptadorIndeed`, `AdaptadorInterno`) | Sistemas externos simulados com formatos próprios; `configurarAdaptadores()` troca o provedor sem alterar a regra de negócio |
| Composite | `ServicoProjeto`, `ServicoAtomico`, `PacoteServico`; `Projeto.servicoPrincipal` | Custo, prazo, validação e cobertura recursivos em árvores de qualquer profundidade |
| Decorator | `CacheDecorator`, `AuditoriaDecorator` e `CompressaoDecorator` sobre `RecomendadorBase`; `MontadorPilhaRecomendacao` | Pilha montada em tempo de execução, em qualquer ordem, por política do sistema ou preferência do produtor |

### Tipos de projeto (Prototype)

`tipoCaptacao` aceita `ficcao`, `documentario`, `animacao` e `publicitario`. Cada tipo tem um protótipo em `RegistroPrototipos.padrao()` com papéis, estratégia, parâmetros e restrições próprias. Em `POST /projetos`, `papeis`, `estrategia` e `parametros` são opcionais: o que não for enviado vem do modelo do tipo (ficção mantém os padrões da atividade 1: cosseno, 0,7/0,3/0). As restrições são definidas apenas no servidor e retornadas em `GET /projetos/:id/relatorio`. O estado continua persistido como dados puros em JSONB; a subclasse é reconstruída pelo registro a partir de `tipoCaptacao`.

### Fábricas por tipo (Factory Method e Abstract Factory)

A cada solicitação, `SistemaRecomendacao.fabricaPara(tipo)` obtém o protótipo do tipo e chama seu Factory Method `criarFabrica()`. A fábrica cria o projeto (por clonagem), e o orquestrador usa o validador e o recomendador dela; o serviço usa o notificador e a rota de relatório usa o gerador de relatório da fábrica (em animação, com métricas de eficiência de renderização: horas estimadas, ocupação da janela e custo por minuto de obra). Adicionar um tipo (por exemplo, realidade virtual) exige uma subclasse de `Projeto`, uma fábrica e o registro do protótipo, sem alterar `OrquestradorEquipe`.

| Tipo | Validador | Recomendador | Notificação |
|---|---|---|---|
| `ficcao` | exige diretor | estratégia pura da atividade 1 | formato da atividade 1 |
| `documentario` | diretor, fotografia, som e edição; ao menos 14 dias de captação | prioriza captação em campo | título, local e termo de direito de imagem |
| `animacao` | diretor, efeitos visuais e edição; horas de render cabem na janela | prioriza modelagem 3D | pipeline e horas estimadas de render |
| `publicitario` | diretor, fotografia e edição; até 3 min e 30 dias | prioriza publicidade | prazo e aprovação do cliente |

As violações retornam 422 na criação e aparecem em `pendencias` no relatório. Testes: `tests/prototype.test.ts` e `tests/fabricas.test.ts`.

As dependências são fornecidas por construtor. O servidor usa PostgreSQL; o repositório em memória é usado exclusivamente nos testes. Competências, avaliações, convites e recomendações têm tabelas próprias. O projeto conserva em JSONB o estado completo da equipe, permitindo atualização atômica com controle de versão. O histórico de recomendações é preservado.

### Atividade 3: Adapter, Composite e Decorator

**Adapter.** O núcleo depende de três interfaces, definidas em `src/domain/ports.ts`.

Os sistemas externos simulados ficam em `src/infrastructure/externos/` e imitam as convenções das APIs reais:

| Família | Provedor simulado | Convenções imitadas |
|---|---|---|
| Armazenamento | S3 | URIs `s3://` e erro `NoSuchKey` |
| Armazenamento | Google Cloud Storage | Geração no identificador (`gs://…#n`) |
| Pagamento | Stripe | Centavos inteiros; status `succeeded` |
| Pagamento | PagSeguro | Reais; status `PAID` |
| Pagamento | PayPal | `intent: CAPTURE`; status `COMPLETED` |
| Profissionais | LinkedIn | Endossos e notas de 1 a 5 |
| Profissionais | Indeed | Habilidades e notas de 0 a 10 |

- **Tradução:** os adaptadores em `src/adapters/` convertem tudo para identificadores lógicos, valores em reais e `StatusPagamento`.
- **Disco local:** `AdaptadorLocal` grava de verdade em disco (`node:fs`) e valida os identificadores contra *path traversal*. Funciona igual no Windows e no Linux.
- **Escolha do provedor:** pelas variáveis `ARMAZENAMENTO_PROVEDOR`, `PAGAMENTO_PROVEDOR` e `PROFISSIONAIS_PROVEDOR`. Só `src/adapters/configuracao.ts` conhece as classes concretas.
- **Limitação:** os provedores simulados guardam dados em memória e os perdem ao reiniciar.

Profissionais de fontes externas são importados para o cadastro interno:
- **Sem duplicar:** cada um recebe um UUID estável, derivado da fonte e do ID externo, então reimportar atualiza o cadastro. Isso é necessário porque os convites apontam para o cadastro interno por chave estrangeira.
- **Avaliações:** vão para a fonte configurada. Com uma fonte externa, chegam ao cadastro interno na próxima importação.

O pagamento:
- exige equipe formada;
- é feito membro a membro e ignora quem já foi pago;
- grava os pagamentos concluídos mesmo que o gateway falhe no meio.

**Composite.** `Projeto.servicoPrincipal` é a fonte da verdade:
- `calcularCustoTotal()` e `obterPrazoTotal()` delegam à árvore, e `validarEstrutura()` é recursiva.
- Pacotes em sequência somam os prazos; pacotes com `paralelo: true` usam o maior.
- O prazo é contado em dias corridos, incluindo o dia de início.

Em `POST /projetos`, há três formas de definir os serviços:
- enviar `servicoPrincipal`;
- enviar a lista legada `papeis`, convertida em um pacote paralelo com o orçamento rateado;
- não enviar nenhum dos dois: a fábrica do tipo cria o pacote padrão em etapas (no documentário, pesquisa, captação e pós-produção).

Regras de validação:
- Enviar `servicoPrincipal` e `papeis` juntos retorna 422.
- Serviços que não cabem na janela do projeto retornam 422.
- Custo estimado acima do orçamento gera aviso, não erro.
- A árvore aceita até 6 níveis e 200 serviços.

`papeis` continua no JSON como projeção derivada, porque o contrato de `RecomendacaoStrategy` não muda. Na reavaliação, os pacotes gerados automaticamente são recalculados quando datas, orçamento ou tipo mudam; os personalizados são preservados.

Exemplo de `servicoPrincipal`:

```json
{ "tipo": "pacote", "nome": "Pós-produção", "itens": [
  { "tipo": "atomico", "nome": "Edição de vídeo", "papel": "EDITOR", "custo": 1500, "prazo": 10 },
  { "tipo": "pacote", "nome": "Finalização", "paralelo": true, "itens": [
    { "tipo": "atomico", "nome": "Coloração", "papel": "EDITOR", "custo": 800, "prazo": 4 },
    { "tipo": "atomico", "nome": "Efeitos visuais", "papel": "EFEITOS_VISUAIS", "custo": 2500, "prazo": 7 } ] } ] }
```

**Decorator.** `RecomendacaoStrategy` não mudou. `RecomendadorBase` concentra a lógica da atividade 1, e as três estratégias só definem a pontuação. Cada decorador recebe no construtor o recomendador que envolve.

A ordem da pilha é a ordem de aplicação, de dentro para fora:
- Em `cache,auditoria` (padrão), a auditoria registra todas as chamadas, inclusive as respondidas pelo cache.
- Em `auditoria,cache`, registra só as que chegam ao recomendador.

A pilha pode ser definida de três formas:
- pela variável `RECOMENDACAO_DECORADORES`;
- em tempo de execução, por `PUT /recomendador/decoradores`;
- pelo produtor, no campo `decoradores` do projeto.

Comportamento de cada decorador:
- **Cache:** considera os requisitos do projeto e o catálogo; um cadastro novo invalida as entradas.
- **Compressão:** aplica gzip ao ranking serializado e devolve o conteúdo descomprimido. O ganho é real quando a carga atravessa a rede; dentro do processo, só custa CPU. Por isso fica fora da política padrão.

A análise de anti-padrões pedida na introdução está em `docs/antipadroes.md`.

## Regras adotadas

- `faixaPreco: { minimo, maximo }` registra a faixa cobrada pelo profissional. `preco` é o valor proposto para o projeto e deve pertencer à faixa. Cadastros antigos sem faixa são tratados como preço fixo (mínimo = máximo = preço). A migração preserva os dados existentes. As somas do orçamento usam centavos inteiros. Duração da obra é informada em minutos.
- Datas usam `AAAA-MM-DD`. O profissional precisa cobrir todo o intervalo entre início e prazo. A localização deve coincidir, salvo quando ele aceita trabalho remoto.
- Competências têm níveis entre 0 e 1; avaliações, notas entre 1 e 5. Há uma avaliação por produtor em cada perfil. Um profissional ocupa no máximo um papel na equipe.
- O peso do papel influencia a escolha da composição. `pesoTecnico`, `pesoHistorico` e `notaMinima` parametrizam o algoritmo. Os padrões são 0,7, 0,3 e 0.
- Similaridade de cosseno combina competências, avaliações e experiência no gênero. Filtragem colaborativa utiliza avaliações de produtores com histórico em comum e recorre à média quando não há dados suficientes. Regras de orçamento priorizam economia, considerando também qualidade.
- A composição combina um matching de custo mínimo (até 64 estados para seis papéis) com uma busca de maior qualidade limitada a 64 alternativas por etapa. O matching encontra uma equipe completa quando há uma composição viável entre os candidatos elegíveis. A busca de qualidade não garante o máximo global de pontuação. Se não houver composição completa dentro das restrições, a resposta explicita os papéis faltantes.
- A substituição ou recusa preserva os outros membros. O substituto exige novo aceite. A reavaliação completa cancela os convites anteriores e permite recalcular toda a equipe.
- A equipe só fica `formada` depois que todos os membros forem aceitos pelo produtor e confirmarem seus convites.
- O catálogo fica em cache por cinco segundos. Em falha de leitura, pode usar uma cópia de até cinco minutos; sem ela, retorna equipe parcial. A resposta indica o modo degradado. Uma substituição manual não é confirmada com catálogo degradado.
- A API mantém até 16 operações de gravação ativas; as demais aguardam em ordem de chegada. Isso permite receber 100 solicitações simultâneas sem disputar todas as 20 conexões do banco com os observadores. O teste de carga mede também essa espera, mantendo o limite de dois segundos.

## Notificações e eventos

Os eventos são persistidos na mesma transação do projeto e entregues via `EventEmitter`. O servidor verifica a fila a cada segundo. Falhas de e-mail não impedem notificações internas ou auditoria. As entregas locais usam identificadores únicos para evitar duplicação.

Ao aguardar `eventos.processar()`, o chamador espera a entrega dos eventos que entraram durante o processamento. Uma entrega que falhar fica para o próximo ciclo, evitando repetição infinita quando uma dependência está indisponível.

O produtor e todos os profissionais apresentados na equipe ou nas alternativas do ranking recebem a notificação da recomendação. O aceite ou a recusa de um convite notifica o produtor.

`ObservadorComposicao` recebe `CONVITE_ACEITO` ou `CONVITE_RECUSADO` e aplica a confirmação ou recalcula o papel recusado, preservando os demais. A resposta HTTP aguarda o ciclo de eventos. A marca `respostaProcessada` e o controle de versão impedem aplicar duas vezes a mesma resposta. Uma falha mantém o evento pendente para nova tentativa.

As consultas de eventos, auditoria, notificações e integrações retornam até 500 registros por chamada. Os registros permanecem no banco; esse limite não descarta histórico.

Sem SMTP configurado, os e-mails ficam registrados na rota `/notificacoes` com status `registrada`; nenhum e-mail é enviado de verdade. Para envio real, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` e, se necessário, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_SECURE=true` no `.env`.

Após formar a equipe, `PublicadorHttp` envia o evento aos endpoints configurados em `PROJETOS_EVENTOS_URL` e `FINANCEIRO_EVENTOS_URL` (configure ambos). As entregas usam `idempotency-key` e repetem em caso de falha; os consumidores devem deduplicar pelo ID do evento. Sem esses endpoints, `/integracoes` registra os destinos, sem envio externo.

`npm run demo:integracoes` abre dois consumidores HTTP temporários, forma uma equipe no banco configurado e verifica os estados `em_producao` e `aguardando_pagamento`. Não exige a API principal aberta. São consumidores de demonstração em memória, sem pagamentos reais; o transporte HTTP é real e testado. Cada execução cria um projeto. O diagrama atualizado está em `docs/diagrama.puml`; o diagrama original foi preservado.

Com `CATALOGO_URL`, uma queda do catálogo ou de seu banco não interrompe o banco dos projetos. Os testes desligam o servidor HTTP do catálogo e verificam a persistência de equipe parcial no PostgreSQL. Se o próprio banco de projetos cair, a API retorna erro de persistência. O cadastro remoto e a auditoria local não constituem uma transação distribuída.

A aplicação é local e não implementa autenticação, que não foi solicitada no exercício. As rotas de convites representam a ação do profissional. O processamento da fila pressupõe uma instância do serviço. SMTP tem entrega pelo menos uma vez: uma interrupção depois do envio e antes da confirmação no banco pode repetir um e-mail.

## Referências técnicas

- [Validação no Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [DataSource do TypeORM](https://typeorm.io/docs/data-source/data-source/)
- [Migrações do TypeORM](https://typeorm.io/docs/migrations/setup/)
