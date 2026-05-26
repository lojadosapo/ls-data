# Integração Omie - Resumo da Implementação

## ✅ O que foi implementado

### 1. Estrutura de Arquivos
- ✅ `src/omie/omie-auth.js` - Módulo de autenticação
- ✅ `src/omie/omie-vendas-nfe.js` - Sincronização de Vendas e NF-e
- ✅ `src/omie/omie-servicos-nfse.js` - Sincronização de Serviços e NFS-e
- ✅ `src/omie/omie-financas.js` - Sincronização de Finanças
- ✅ `src/omie/README.md` - Documentação detalhada da integração

### 2. GitHub Actions (Workflows comentados)
- ✅ `.github/workflows/omie-vendas-nfe.yml` - Workflow para vendas (schedule comentado)
- ✅ `.github/workflows/omie-servicos-nfse.yml` - Workflow para serviços (schedule comentado)
- ✅ `.github/workflows/omie-financas.yml` - Workflow para finanças (schedule comentado)

### 3. Configurações
- ✅ `run-local.js` atualizado com scripts Omie
- ✅ `.env.example` atualizado com variáveis Omie
- ✅ `supabase/schema.sql` atualizado com tabelas Omie
- ✅ `README.md` atualizado com documentação Omie

## 📋 Dados Retornados

Todos os três módulos retornam o **payload completo e bruto** da API Omie, sem nenhum processamento ou mapeamento adicional. Isso inclui todos os campos disponíveis:

### Vendas e NF-e (omie-vendas-nfe.js)
- Informações completas do pedido
- Dados do cabeçalho (datas, números, status)
- Informações do cliente (razão social, CNPJ, endereço, contatos)
- Dados do vendedor
- Detalhes de todos os produtos/itens
- Valores totais, impostos, descontos
- Informações da nota fiscal
- Dados da empresa/filial
- Informações adicionais e observações

### Serviços e NFS-e (omie-servicos-nfse.js)
- Informações completas da ordem de serviço
- Dados do cabeçalho (datas, números, status)
- Informações do cliente
- Dados do vendedor/responsável
- Detalhes de todos os serviços
- Valores totais, impostos, retenções
- Informações da nota fiscal de serviço
- Dados da empresa/filial
- Informações adicionais

### Finanças (omie-financas.js)
- Informações completas da conta a receber
- Dados do lançamento
- Informações do cliente/pagador
- Dados do vendedor
- Valores, datas de vencimento e pagamento
- Informações de documentos e notas fiscais vinculadas
- Categorias e centros de custo
- Status de pagamento
- Informações bancárias

Os campos foram mencionados na especificação apenas como exemplo para identificar quais endpoints usar, mas o sistema retorna **todos os dados disponíveis** da API Omie para análise posterior.

## 🔧 Próximos Passos

### 1. Configurar Supabase
Execute o SQL no Supabase SQL Editor:
```sql
-- Copie o conteúdo de supabase/schema.sql, seção 3
```

Isso criará as tabelas:
- `raw_omie_vendas_nfe`
- `raw_omie_servicos_nfse`
- `raw_omie_financas`

### 2. Configurar Variáveis de Ambiente Localmente
Copie `.env.example` para `.env` e preencha:
```env
OMIE_APP_KEY=sua_app_key
OMIE_APP_SECRET=seu_app_secret
OMIE_VENDAS_DAYS=30
OMIE_SERVICOS_DAYS=30
OMIE_FINANCAS_DAYS=30
```

### 3. Testar Localmente
```bash
# Testar cada integração individualmente
node run-local.js omie-vendas-nfe
node run-local.js omie-servicos-nfse
node run-local.js omie-financas

# Ou testar todas de uma vez
node run-local.js omie-vendas-nfe omie-servicos-nfse omie-financas
```

### 4. Configurar GitHub Secrets
No repositório GitHub, adicione os secrets:
- `OMIE_APP_KEY`
- `OMIE_APP_SECRET`

### 5. Ativar Workflows (quando estiver pronto)
Edite os arquivos `.github/workflows/omie-*.yml` e descomente as linhas:
```yaml
# schedule:
#   - cron: '...'
```

Remova o `#` para ativar o agendamento automático.

## 📊 APIs Utilizadas

### Vendas e NF-e
- **Endpoint:** `/produtos/pedido/`
- **Método:** `ListarPedidos`
- **Paginação:** Sim (50 registros por página)

### Serviços e NFS-e
- **Endpoint:** `/servicos/os/`
- **Método:** `ListarOS`
- **Paginação:** Sim (50 registros por página)

### Finanças
- **Endpoint:** `/financas/contareceber/`
- **Método:** `ListarContasReceber`
- **Paginação:** Sim (50 registros por página)

## ⚠️ Observações Importantes

1. **Agendamentos Comentados**: Os workflows do GitHub Actions estão configurados mas com os schedules comentados. Isso permite testar manualmente antes de ativar a execução automática.

2. **Tabelas Supabase**: As tabelas precisam ser criadas no Supabase antes de executar os scripts. Use o SQL em `supabase/schema.sql`.

3. **Janela de Dados**: Por padrão, cada script busca os últimos 30 dias. Isso pode ser ajustado via variáveis de ambiente.

4. **Payload Bruto**: O sistema mantém o payload completo da API Omie em `payload`, com campos mapeados adicionais em `payload._mapped`.

5. **Idempotência**: Cada registro usa um `external_id` único que permite reprocessar os mesmos dados sem duplicação.

## 🧪 Validação Realizada

- ✅ Sintaxe JavaScript validada em todos os arquivos
- ✅ Dependências instaladas corretamente
- ✅ Estrutura de pastas criada
- ✅ Workflows configurados
- ✅ Documentação atualizada

## 📚 Documentação Adicional

- Documentação detalhada da integração: `src/omie/README.md`
- Documentação geral do projeto: `README.md`
- Schema do banco: `supabase/schema.sql`
- Exemplo de configuração: `.env.example`

## 🎯 Como os Dados Podem Ser Usados

Os dados coletados são salvos completamente brutos, contendo todos os campos retornados pela API Omie. Você pode consultar e extrair os campos necessários via SQL no Supabase.

Exemplo de consulta para extrair campos específicos de vendas:

```sql
SELECT 
  payload->'cabecalho'->>'data_previsao' as data_emissao,
  payload->'cabecalho'->>'numero_pedido' as pedido,
  payload->'cabecalho'->>'vendedor' as vendedor,
  payload->'cabecalho'->>'nome_cliente' as cliente,
  payload->'total_pedido'->>'valor_total_pedido' as valor,
  payload->'nota_fiscal'->>'numero' as nota_fiscal
FROM raw_omie_vendas_nfe
ORDER BY created_at DESC;
```

O payload completo permite que você:
- Extraia qualquer campo necessário sem limitações
- Crie diferentes visualizações/relatórios conforme necessário
- Reprocesse os dados de maneiras diferentes sem nova coleta
- Acesse campos que podem não ter sido considerados inicialmente
