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

## 📋 Campos Mapeados

Todos os três módulos mapeiam os seguintes campos conforme solicitado:
1. **Data de Emissão** (completa)
2. **Pedido** (Número do pedido/venda)
3. **Vendedor** (Nome do colaborador responsável)
4. **Cliente** (Razão Social)
5. **Total da Nota Fiscal / Valor**
6. **Tipo do Produto / Serviço** (Produto, Serviço ou Financeiro)
7. **Minha Empresa** (Nome Fantasia)
8. **Nota Fiscal** (Número da NF)

Os campos mapeados são salvos em `payload._mapped` de cada registro.

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

Os dados coletados alimentam uma planilha de faturamento. Cada registro em `payload._mapped` contém os campos necessários:

```javascript
{
  data_emissao: "15/05/2024",
  pedido_numero: "12345",
  vendedor: "João Silva",
  cliente_razao_social: "Empresa XYZ Ltda",
  total_nota_fiscal: 1500.00,
  tipo_produto_servico: "Produto",
  minha_empresa: "Loja do Sapo - Matriz",
  nota_fiscal_numero: "000123"
}
```

Esses campos podem ser consultados via SQL no Supabase:
```sql
SELECT 
  payload->>'_mapped'->>'data_emissao' as data_emissao,
  payload->>'_mapped'->>'pedido_numero' as pedido,
  payload->>'_mapped'->>'cliente_razao_social' as cliente,
  payload->>'_mapped'->>'total_nota_fiscal' as valor
FROM raw_omie_vendas_nfe
ORDER BY created_at DESC;
```
