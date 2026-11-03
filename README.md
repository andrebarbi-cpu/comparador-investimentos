# Comparador de Investimentos

Ferramenta do André e de um amigo para achar oportunidades em ações da B3 e nos ETFs
IVVB11 e WRLD11, com histórico guardado e atualização diária automática.

## Decisões (29/10/2026)

- **Universo:** todas as ações da B3, mais os ETFs IVVB11 e WRLD11 (ambos negociados na B3).
- **Sem perfil de investidor.** O app classifica pela oportunidade: empresa boa (qualidade +
  saúde financeira) que está barata em relação ao próprio histórico e ao setor. Notas de 0 a 100
  em quatro pilares (qualidade, preço, saúde, crescimento) e os filtros clássicos (Graham,
  Bazin, Fórmula Mágica) como selos.
- **Bancos e seguradoras** ficam num ranking separado, com indicadores próprios.
- **Régua de renda fixa:** CDI, Selic, IPCA e Tesouro IPCA+ para comparar com o rendimento
  das ações e dos índices.
- **Acesso:** o amigo não tem conta no Claude, então a página vai para o GitHub Pages, aberta por
  link. Quem roda a coleta é o GitHub Actions, todo dia, sem depender do PC ligado.
- O app aponta candidatas. A decisão de compra é de cada um.

## Fontes (todas gratuitas e oficiais)

| Dado | Fonte |
|---|---|
| Balanços trimestrais e anuais, quantidade de ações | CVM – Dados Abertos (ITR e DFP) |
| Cadastro, setor, tickers, segmento de listagem | CVM – cadastro e FCA |
| Cotações diárias (ações e ETFs) | B3 – arquivo COTAHIST |
| CDI, Selic, IPCA, dólar | Banco Central – SGS |
| Taxas do Tesouro Direto | Tesouro Transparente |

## Como rodar

Precisa só do Node 24 ou mais novo, sem nenhum pacote instalado.

```
npm run carga-inicial   # uma vez: baixa o histórico desde 2016 (~1,5 GB de download)
npm run atualizar       # diária: só o que mudou, e recalcula tudo no fim
npm run intraday        # preços durante o pregão (parciais), sem mexer no resto
npm run calcular        # só recalcula indicadores e notas (2 segundos)
npm run resumo          # confere o que tem no banco
npm run ver             # abre a página em http://localhost:8123
```

O banco fica em `dados/comparador.db` (SQLite). Os arquivos baixados ficam em `_brutos/` e
podem ser apagados quando quiser.

## Cuidados conhecidos

- **Quantidade de ações:** algumas empresas informam à CVM em milhares, outras em unidades,
  e o arquivo não diz qual. A etapa de cálculo corrige isso comparando com o valor de mercado.
- **Desdobramentos e grupamentos:** a cotação da B3 não é ajustada. Entre dois balanços o evento
  é localizado pelo salto de preço; depois do último balanço ele só gera alerta, e os múltiplos
  ficam distorcidos até o balanço seguinte.
- **Histórico de múltiplos começa em 2020:** antes disso a CVM não publica a quantidade de ações.
- **26/10/2026:** o Ibovespa caiu ~14% num dia (circuit breaker após o 2º turno). O P/L de hoje
  ainda usa lucros de antes do choque, então "barato contra o histórico" pode ser só o mercado
  antecipando lucros menores.
- **Lucro não recorrente:** quando o lucro de 12 meses passa do resultado operacional, ou fica
  mais de 3 vezes acima da média dos 3 anos anteriores, a empresa recebe alerta e sai das
  oportunidades. Crescimento forte e legítimo também cai nessa regra; o alerta pede conferência.
- **Preços do pregão:** às 12h30 e 16h (Brasília) entram preços do Yahoo Finanças com 15 min de
  atraso, marcados como parciais (`cotacoes.parcial = 1`). Fonte não oficial, usada só para preço.
  À noite o arquivo oficial da B3 substitui esses preços e as linhas parciais são apagadas.
- Linhas do balanço abaixo do 2º nível não são padronizadas. Capex e dividendos pagos são
  identificados pela descrição da conta, então são aproximações.

## Como o cálculo funciona (`src/calcular.js`)

- **12 meses:** resultados e fluxos de caixa somam os últimos quatro trimestres
  (acumulado do ano + ano anterior − mesmo período do ano anterior).
- **Sem olhar o futuro:** em cada data só vale o balanço que já tinha sido entregue à CVM.
- **Valor de mercado:** soma das classes (ON × preço ON + PN × preço PN). Em cada classe vale o
  código mais negociado no dia, o que cobre troca de ticker (ex.: ELET3 → AXIA3).
- **EBITDA** exclui o resultado de coligadas (equivalência patrimonial), que a CVM põe no EBIT.
- **Notas de 0 a 100** são percentis contra as outras empresas elegíveis (liquidez ≥ R$ 1 mi/dia
  e balanço com menos de 200 dias). Bancos e seguradoras têm grupo próprio e não têm nota de saúde.
  - Qualidade: ROE, ROIC, margem líquida (contra o próprio setor), anos com lucro.
  - Preço: lucro/valor de mercado, EBIT/EV, P/VP e quanto está barato contra o próprio histórico.
  - Saúde: dívida líquida/EBITDA, liquidez corrente, dívida líquida/PL.
  - Crescimento: receita e lucro, crescimento anual em 5 anos.
- **Oportunidade:** lucro positivo, qualidade ≥ 60, saúde ≥ 50 e P/L (ou EV/EBIT) mais barato
  que em pelo menos 75% dos meses desde 2020.
- **Selos:** Graham (preço abaixo de √(22,5 × LPA × VPA)), Bazin (dividendo médio de 3 anos ≥ 6%
  do preço atual), Fórmula Mágica (30 melhores somando posição em EBIT/EV e ROIC).
- **Régua:** o lucro sobre o preço é comparado com o Tesouro IPCA+ de ~10 anos.
- **Alertas:** margem líquida caindo mais de 5 pontos em 12 meses, dívida/EBITDA subindo para
  acima de 2, balanço atrasado e salto de preço numa proporção redonda (1:2, 1:10…) depois do
  último balanço, sinal de desdobramento ou grupamento ainda não refletido.

## Carteiras (`config/carteiras.json`)

- A lista de ativos acompanhados fica em `config/carteiras.json`. Para incluir ou trocar um ativo,
  edite o arquivo e faça o push: a próxima atualização já mostra.
- **Quantidades e CDBs nunca vão para o site** (ele é público). Cada pessoa digita no próprio
  aparelho e os números ficam no navegador. O botão "Gerar link com minhas quantidades" cria um
  link `#importar/...` que leva os números no trecho depois do `#`, que o navegador não envia ao
  servidor.
- O CDB é calculado pelo CDI diário do Banco Central, com IR pela tabela regressiva.
- **Concentração por setor:** barra com a fatia de cada setor no saldo. Bancos, seguradoras e
  holdings financeiras contam juntos como Financeiro. Acima de `concentracao.limite_setor` (hoje,
  40%) aparece um alerta.
- **Oportunidades** mostram só o que não está na carteira. Setores em `setores_evitar` (hoje,
  varejo) só aparecem com nota de oportunidade a partir de `nota_minima_excecao` (hoje, 90).
- **Foco** (visão padrão das oportunidades e filtro "Só empresas grandes" do ranking): setores
  perenes de `foco.setores` e valor de mercado mínimo de R$ 5 bi, ou R$ 20 bi para bancos e
  seguradoras, para só aparecerem empresas em que dá para confiar no aporte.
- **Correções do cadastro** ficam em `config/correcoes_cadastro.json`: tickers e nomes que a
  empresa preencheu errado na CVM (ex.: BTG com ticker "000000" e ainda com o nome UBS Pactual).
  Papéis sem cadastro herdam a empresa pelo prefixo.

## Etapas

1. **Coleta** – feita
2. **Cálculo** – feito
3. **Página** – feita (`site/`): oportunidades, ranking, ficha da empresa, comparação lado a lado,
   ETFs e renda fixa. Estática, sem dependências; lê `site/dados.js`, gerado por `src/exportar.js`.
   A comparação vira imagem PNG (botão "Salvar/Compartilhar como imagem"); a biblioteca
   html-to-image é baixada da jsDelivr só no clique.
4. **Automação** – `.github/workflows/atualizar.yml` roda todo dia útil às 20h45, 22h30 e 8h (Brasília),
   guarda o banco como anexo da release `banco` e publica `site/` no GitHub Pages. Para rodar na
   hora: aba Actions → Atualizar dados → Run workflow.
