# Verificação da atividade

Verificado em 27/09/2026 no Windows e em contêiner Ubuntu 24.04.5 LTS. A execução Ubuntu foi realizada pelo usuário e confirmada pelo log enviado, iniciado às 18:56:10 UTC, com Node 24.21.0 e PostgreSQL 18.6.

| Requisito | Implementação e evidência |
|---|---|
| API REST e persistência | Fastify, TypeORM, migrações e testes `api`/`postgres` |
| Dados do projeto e dos profissionais | Validações de datas, competências, avaliações, pesos, orçamento e faixa de preço |
| Strategy | Cosseno, colaborativa e orçamento; testes `patterns` |
| Template Method | Fluxo de recomendação em `OrquestradorEquipe`; testes `patterns` |
| Observer | Notificações, auditoria e composição após resposta do convite; testes `events`/`composition` |
| Visitor | Consistência, compatibilidade e relatório; testes `patterns` |
| Aceite, recusa, substituição e reavaliação | Testes `api`, preservação dos demais membros e cancelamento de convites antigos |
| Integração de equipe formada | Publicação HTTP, consumidores demonstrativos e repetição idempotente; testes `http-integrations` e `demo:integracoes` |
| Falha de dependência | Catálogo com processo/banco separados, cache e equipe parcial; servidor desligado em testes HTTP e PostgreSQL |
| Cobertura >80% | 46 testes aprovados; linhas 99,43%, instruções 99,18%, funções 99,18%, ramificações 95,90% |
| 10 mil profissionais / 100 concorrentes / <2s | Ubuntu: 100 sucessos; mediana 1046,846 ms, p95 1604,779 ms, máximo 1610,074 ms |
| Diagrama atualizado | `docs/diagrama.puml`; original preservado |
| Ubuntu 24.04 | Build, migrações, 46 testes, carga e demonstração de integração HTTP aprovados; contêiner de validação encerrado com código 0 |

O teste de carga mede requisições HTTP com catálogo aquecido e banco real; seus números dependem da máquina e da carga concorrente. Os testes de indisponibilidade verificam o comportamento separadamente.

A migração do banco de desenvolvimento foi aplicada preservando os projetos. Na validação Ubuntu, os consumidores HTTP confirmaram os estados `em_producao` e `aguardando_pagamento` para a mesma equipe e valor de R$ 7200. O erro de chave duplicada no log é intencional no teste de rollback. A mensagem `Aborting on container exit` corresponde à opção do Compose que encerra os demais serviços quando a validação termina; o código de saída foi 0.

O orquestrador retorna diretamente os melhores candidatos independentes quando não há conflito de profissionais nem excesso de orçamento. Nesse caso, a busca combinatória não pode melhorar a pontuação. Nos outros casos, a busca foi preservada. Também foram removidos cálculos repetidos de normalização e uma passagem desnecessária pelas avaliações. Com a mesma carga local no Windows, houve 100 sucessos e máximo de 1364,266 ms.

Os consumidores externos são demonstrações, e SMTP depende de configuração para envio real. Não se implementaram interface gráfica, menu CLI nem CRUD genérico adicional: a interação requerida acontece pela API REST.

## Atividade 2 (Prototype, Factory Method e Abstract Factory)

Verificado em 18/10/2026 no Windows 11 (Node 24.21.0, Docker Desktop 29.7.2, PostgreSQL 18) e em contêiner Ubuntu 24.04.5 LTS (Node 24.22.0).

| Requisito do enunciado | Implementação e evidência |
|---|---|
| Prototype com `clonar()` profundo em cada subclasse de `Projeto` | `ProjetoFiccao`, `ProjetoDocumentario`, `ProjetoAnimacao`, `ProjetoPublicitario` e `RegistroPrototipos`; testes `prototype` verificam ausência de referências compartilhadas em papéis, competências, restrições e profissionais |
| `FabricaProjeto` e fábricas de documentário, animação e publicidade | `src/domain/fabricas.ts`; cada fábrica cria projeto, validador, recomendador, notificador e relatório coerentes (animação: recomendador que prioriza modelagem 3D e relatório com métricas de renderização); testes `fabricas` |
| `OrquestradorEquipe` recebe a fábrica no construtor, sem condicionais por tipo | Validador e recomendador obtidos da fábrica; teste estático garante ausência de literais de tipo e `switch` no orquestrador e no serviço |
| `SistemaRecomendacao` identifica o tipo e seleciona a fábrica | `fabricaPara(tipo)`: protótipo registrado + Factory Method `criarFabrica()`; teste confirma a fábrica usada em cada solicitação |
| Testes de integração alternando fábricas | `tests/fabricas.test.ts` (recomendações, validações, notificações e relatórios por tipo, inclusive uma fábrica nova de realidade virtual sem alterar o orquestrador) e `tests/postgres.test.ts` (persistência JSONB e reconstrução de cada tipo) |
| Windows e Ubuntu 24.04 | Windows: build, migrações, seed, 78 testes, demonstrações e API real aprovados. Ubuntu: build e os 9 arquivos de teste aprovados no contêiner de validação |

Cobertura com PostgreSQL real: instruções 99,31%, ramificações 95,19%, funções 99,39%, linhas 99,53%.

Foi adicionado `.gitattributes` forçando LF em `*.sh` e `Dockerfile*`: com `core.autocrlf=true` no Windows, `scripts/validate-ubuntu.sh` era extraído com CRLF e a validação Ubuntu falhava antes de começar (`set: Illegal option -`).

O teste de carga (10 mil profissionais, 100 requisições simultâneas, limite de 2 s) oscilou nesta máquina entre 1,24 s e 7,3 s de máximo, tanto na atividade 2 quanto no código original da atividade 1 executado nas mesmas condições; no contêiner Ubuntu o máximo foi 2,53 s. A medição isolada de CPU (100 criações com 10 mil profissionais em memória) foi equivalente nas duas versões (cerca de 22 ms por criação), portanto a variação decorre da carga do ambiente, não das fábricas.

## Atividade 3 (Adapter, Composite e Decorator)

Verificado em 01/11/2026 no Windows 11 (Node 24.21.0, PostgreSQL 18 no Docker Desktop) e em contêiner Ubuntu 24.04.5 LTS (Node 24.22.2). O diagrama `diagrama-3.png` (enviado à parte) foi usado como referência para os nomes e assinaturas do Adapter; a parte do Composite e do Decorator está cortada na imagem e seguiu o texto do enunciado.

| Requisito do enunciado | Implementação e evidência |
|---|---|
| Interfaces `AdaptadorArmazenamento`, `AdaptadorPagamento` e `AdaptadorProfissional` | `src/domain/ports.ts`, com as operações do diagrama (`salvarArquivo`, `efetuarPagamento`, `listarProfissionais` etc.) |
| Pelo menos duas implementações por interface | Três por interface: S3, Google Cloud e disco local; Stripe, PagSeguro e PayPal; LinkedIn, Indeed e cadastro interno (`src/adapters/`) |
| Sistemas externos simulados | `ArmazenamentoExterno`, `GatewayPagamento` e `ApiProfissionalExterna`, com subclasses de formatos próprios (`src/infrastructure/externos/`) |
| `SistemaRecomendacao` recebe os adaptadores | Construtor (`DependenciasSistema.adaptadores`) e `configurarAdaptadores()`; `definirEstrategia()` e `executarRecomendacao()` do diagrama |
| `ServicoProjeto` com `calcularCusto`, `listarSubservicos`, `obterPrazo` e `validar`; `ServicoAtomico` e `PacoteServico` | `src/domain/servicos.ts` |
| `Projeto.servicoPrincipal` no lugar da lista de papéis; `calcularCustoTotal` delega; validação recursiva | `src/domain/model.ts`; papéis derivados da árvore; prazos validados contra a janela do projeto |
| `RecomendacaoStrategy` inalterada; `RecomendadorBase`; `CacheDecorator`, `AuditoriaDecorator` e `CompressaoDecorator` | `src/recommendation/strategies.ts` e `decorators.ts` |
| Combinar decoradores em qualquer ordem e definir a pilha em tempo de execução | `MontadorPilhaRecomendacao`; política por `RECOMENDACAO_DECORADORES` e `PUT /recomendador/decoradores`; preferência do produtor em `decoradores` |
| Testes do Adapter: trocar provedor sem alterar a regra de negócio | `tests/adapters.test.ts`: o mesmo fluxo (arquivo; pagamento, consulta e estorno; importação) com cada provedor, trocado por `configurarAdaptadores()` |
| Testes do Composite: custos e prazos em diferentes profundidades | `tests/composite.test.ts`: 1 a 6 níveis, pacotes paralelos e sequenciais, centavos, limites e ciclos, API e reavaliação |
| Testes do Decorator: cache mais rápido, auditoria de todas as chamadas, compressão menor, base inalterada | `tests/decorators.test.ts`: tempo com base lenta, registro de sucessos e falhas, bytes antes e depois, as 6 ordens com o mesmo resultado do recomendador base |
| Windows e Ubuntu 24.04 | Windows: build, migrações, seed, 123 testes, API real e `demo:padroes` com dois conjuntos de provedores. Ubuntu: build, migrações e os 123 testes aprovados no contêiner de validação |

Resultados:
- **Cobertura com PostgreSQL real:** instruções 98,14%, ramificações 91,99%, funções 99,07% e linhas 99,52%, com 123 testes em 12 arquivos.
- **API real:** a mesma versão compilada rodou com local, Stripe e interno e, alterando só variáveis de ambiente, com GCS, PagSeguro e LinkedIn. A reimportação do LinkedIn pelo catálogo HTTP não duplicou cadastros (4 importados e depois 4 inalterados).

Teste de carga (10 mil profissionais, 100 requisições simultâneas, limite de 2 s):
- **Windows:** passou duas vezes, com máximo de 1,58 s e 1,68 s.
- **Contêiner Ubuntu desta máquina:** 100 respostas válidas, mas máximos de 2,25 s e 2,35 s, então o script de validação termina com código 1 nessa etapa. Na atividade 2, o mesmo ambiente marcou 2,53 s.
- **Custo da atividade 3:** a medição em processo mostrou que os decoradores acrescentavam cerca de 2,5 ms por criação quando o cache não acerta. Isso foi reduzido para cerca de 1 ms com uma impressão digital compacta da lista de candidatos e candidatos imutáveis no cache.
- **Causa do estouro:** o tempo restante vem de HTTP, TypeORM e PostgreSQL, que dividem a CPU da VM do WSL2. É o mesmo comportamento das atividades anteriores neste ambiente.
