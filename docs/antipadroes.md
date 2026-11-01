# Anti-padrões identificados e refatorações (atividade 3)

A introdução da atividade pede a análise do código da plataforma para encontrar anti-padrões introduzidos sem intenção e corrigi-los com padrões bem fundamentados. Abaixo estão os que encontramos no código da atividade 2, o sintoma concreto e a refatoração aplicada.

| # | Anti-padrão | Onde estava | Sintoma | Refatoração |
|---|---|---|---|---|
| 1 | Lista longa de parâmetros (construtor telescópico) | `SistemaRecomendacao` (`service.ts`) | 5 parâmetros posicionais, 3 opcionais; com os três adaptadores seriam 8, e quem só quisesse trocar os protótipos precisaria passar `undefined` nos anteriores | Objeto de parâmetros `DependenciasSistema` e o método `configurarAdaptadores(armazenamento, pagamento, profissional)` do diagrama |
| 2 | Lógica de domínio no controlador ("Smart UI") | Rota `GET /projetos/:id/relatorio` (`app.ts`) | A rota hidratava o projeto, escolhia a fábrica e combinava visitantes e validador | `SistemaRecomendacao.gerarRelatorio()`; a rota só delega |
| 3 | Obsessão por primitivos | `ProjetoDados.papeis` | Uma lista plana de papéis não representa pacotes, subserviços, custos ou prazos | Composite: `ServicoProjeto`, `ServicoAtomico`, `PacoteServico` e `Projeto.servicoPrincipal`; a lista de papéis passou a ser derivada da árvore |
| 4 | Explosão de subclasses (risco iminente) | Recomendadores | Cache, auditoria e compressão sobre 3 estratégias e 4 tipos exigiriam classes como `CacheAuditoriaCosseno`; `RecomendadorPriorizado` já era um decorador sem esse nome | Decorator: `DecoradorRecomendacao` (base), `CacheDecorator`, `AuditoriaDecorator`, `CompressaoDecorator` e `MontadorPilhaRecomendacao`; `RecomendadorPriorizado` agora estende a base |
| 5 | Estado global disfarçado (Singleton) | `estrategias` em `strategies.ts` | Instâncias únicas compartilhadas por todo o processo; inofensivas porque não guardam estado, mas um cache colocado nelas vazaria entre testes, aplicações e projetos | O cache vive em `ArmazemCacheRecomendacao`, criado por aplicação e injetado na pilha; as estratégias continuam sem estado |
| 6 | Dependência de fornecedor (vendor lock-in) | Integrações novas | Chamar S3, Stripe ou LinkedIn diretamente espalharia formatos de URI, centavos, códigos de erro e escalas de nota pela regra de negócio | Adapter: `AdaptadorArmazenamento`, `AdaptadorPagamento` e `AdaptadorProfissional`; o núcleo só vê identificadores lógicos, reais e `StatusPagamento` |
| 7 | Cadeia de condicionais por provedor | Seleção de provedor | A forma ingênua seria `if (provedor === 's3') ... else if ...` | Registros por nome em `src/adapters/configuracao.ts`: novo provedor é uma entrada nova |
| 8 | Programação por copiar e colar | Adaptadores | Três gateways e duas fontes externas repetiriam validação de valor, tradução de status e de "não encontrado" | Bases `AdaptadorGateway` e `AdaptadorFonteExterna`; cada subclasse só define o formato da chamada |
| 9 | Hierarquia de fábricas incontrolável (alerta do enunciado sobre Factory Method) | Fábricas × funcionalidades transversais | Criar `FabricaDocumentarioComCache` e afins multiplicaria as fábricas | Decoradores ortogonais às fábricas: 4 fábricas + 3 decoradores, combinados em tempo de execução |

## Riscos que permanecem

- `SistemaRecomendacao` cresceu: além da recomendação, orquestra arquivos, pagamentos e importação de profissionais. O enunciado exige que ele receba os adaptadores, e cada método é curto e delega a uma interface, mas a classe tende ao "Objeto Deus". A próxima refatoração seria extrair `GestaoArquivos` e `GestaoPagamentos` (Extract Class), mantendo `SistemaRecomendacao` como fachada.
- `ProjetoDados.papeis` duplica informação da árvore de serviços. A duplicação existe porque o contrato de `RecomendacaoStrategy` não pode mudar; o único ponto de escrita é `Projeto.definirServicoPrincipal()`, e quem alterar `papeis` diretamente quebra a coerência.
- `Projeto` continua carregando o estado da equipe por causa do Visitor da atividade 1, o que concentra responsabilidades na entidade.
- O cache identifica a lista de candidatos pela identidade dos objetos do catálogo. É barato com 10 mil profissionais e correto enquanto os objetos do catálogo não são alterados no lugar, o que vale para o código atual (cada recarga cria objetos novos).
