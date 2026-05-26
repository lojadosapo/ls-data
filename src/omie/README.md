# Integração Omie

Esta pasta contém os scripts para integração com a API do Omie (https://app.omie.com.br/developer/).

## Módulos

### omie-auth.js
Módulo de autenticação que encapsula as chamadas à API do Omie utilizando `OMIE_APP_KEY` e `OMIE_APP_SECRET`.

### omie-vendas-nfe.js
Sincroniza dados de **Vendas e NF-e** (produtos e acessórios).

**API utilizada:** `/produtos/pedido/` - `ListarPedidos`

**Tabela Supabase:** `raw_omie_vendas_nfe`

**Campos mapeados:**
- `data_emissao` - Data de Emissão completa
- `pedido_numero` - Número do pedido/venda
- `vendedor` - Nome do colaborador responsável
- `cliente_razao_social` - Razão Social do cliente
- `total_nota_fiscal` - Valor total da nota fiscal
- `tipo_produto_servico` - "Produto"
- `minha_empresa` - Nome Fantasia da filial/unidade
- `nota_fiscal_numero` - Número da NF

### omie-servicos-nfse.js
Sincroniza dados de **Serviços e NFS-e** (ordens de serviço).

**API utilizada:** `/servicos/os/` - `ListarOS`

**Tabela Supabase:** `raw_omie_servicos_nfse`

**Campos mapeados:**
- `data_emissao` - Data de Emissão completa
- `pedido_numero` - Número da ordem de serviço
- `vendedor` - Nome do colaborador responsável
- `cliente_razao_social` - Razão Social do cliente
- `total_nota_fiscal` - Valor total da ordem de serviço
- `tipo_produto_servico` - "Serviço"
- `minha_empresa` - Nome Fantasia da filial/unidade
- `nota_fiscal_numero` - Número da NF

### omie-financas.js
Sincroniza dados de **Finanças** (Contas a Receber).

**API utilizada:** `/financas/contareceber/` - `ListarContasReceber`

**Tabela Supabase:** `raw_omie_financas`

**Campos mapeados:**
- `data_emissao` - Data de Emissão
- `pedido_numero` - Número do pedido/documento
- `vendedor` - Nome do vendedor
- `cliente_razao_social` - Razão Social do cliente
- `total_nota_fiscal` - Valor do documento
- `tipo_produto_servico` - Tipo do documento ou "Financeiro"
- `minha_empresa` - Nome da empresa
- `nota_fiscal_numero` - Número da nota fiscal

## Configuração

Adicione as seguintes variáveis de ambiente no arquivo `.env`:

```env
OMIE_APP_KEY=sua_app_key
OMIE_APP_SECRET=seu_app_secret
OMIE_VENDAS_DAYS=30
OMIE_SERVICOS_DAYS=30
OMIE_FINANCAS_DAYS=30
```

## Execução Local

```bash
# Executar todas as integrações Omie
node run-local.js omie-vendas-nfe omie-servicos-nfse omie-financas

# Executar apenas vendas
node run-local.js omie-vendas-nfe

# Executar apenas serviços
node run-local.js omie-servicos-nfse

# Executar apenas finanças
node run-local.js omie-financas
```

## GitHub Actions

Os workflows estão configurados em `.github/workflows/` com os schedules **comentados** por padrão:
- `omie-vendas-nfe.yml` - Diariamente às 7:30 UTC (comentado)
- `omie-servicos-nfse.yml` - Diariamente às 7:45 UTC (comentado)
- `omie-financas.yml` - Diariamente às 8:00 UTC (comentado)

Para ativar, descomente as linhas `schedule:` e `- cron:` nos arquivos YAML.

Todos os workflows podem ser executados manualmente via `workflow_dispatch`.

## Estrutura dos Dados

Cada registro é armazenado no Supabase com a seguinte estrutura:
- `external_id` - ID único do registro (usado para upsert)
- `payload` - Objeto completo retornado pela API do Omie
- `payload._mapped` - Campos mapeados para facilitar queries

## Tabelas Supabase Necessárias

As seguintes tabelas precisam existir no Supabase:
- `raw_omie_vendas_nfe`
- `raw_omie_servicos_nfse`
- `raw_omie_financas`

Todas devem ter:
- `external_id` (text, primary key)
- `payload` (jsonb)
- `created_at` (timestamp, default now())
- `updated_at` (timestamp, default now())
