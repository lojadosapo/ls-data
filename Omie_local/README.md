# Exportacao local Omie

Este fluxo substitui o download manual dos 3 arquivos do Omie para o formato usado pela base de faturamento.

## Rodar o dia anterior

Na raiz do projeto:

```powershell
python -m pip install -r .\Omie_local\requirements.txt
```

```powershell
python .\Omie_local\omie_local_export.py
```

## Sincronizar direto no Google Sheets

O fluxo automatizado principal fica em Node:

```powershell
node run-local.js omie-sheets-sync
```

Por padrao ele reprocessa os ultimos 7 dias fechados, terminando em ontem no horario de Sao Paulo. Para testar sem alterar a planilha:

```powershell
$env:OMIE_SHEETS_DRY_RUN="true"
node run-local.js omie-sheets-sync
```

Regra usada para evitar duplicados: o script le as abas `Vendedor` e `Produtos e Servicos`, remove somente as linhas da janela reprocessada para as empresas Omie configuradas, e depois insere novamente os dados calculados pela API.

## Rodar uma data especifica

```powershell
python .\Omie_local\omie_local_export.py --date 16/06/2026 --run-date 17/06/2026
```

## Saidas

Os arquivos ficam em:

```text
Omie_local/output/AAAA-MM-DD/
  Base exportada/
    pivot.xlsx
    pivot (1).xlsx
    pivot (2).xlsx
  Base tratada/
    Produto_LS_DD_MM_AAAA.xlsx
    Vendedor_LS_DD_MM_AAAA.xlsx
  Sheets/
    Base_Faturamento_OMIE_DD_MM_AAAA.xlsx
  manifest.json
```

Por padrao, a planilha final remove do template apenas as linhas da mesma data e das empresas exportadas antes de inserir as novas linhas. Para apenas acrescentar sem remover nada:

```powershell
python .\Omie_local\omie_local_export.py --append-only
```

## Multiplas lojas Omie

O export manual consolida varios aplicativos/lojas. O formato preferido no `.env` e:

```env
OMIE_CREDENTIALS={"Sede":{"appKey":"...","appSecret":"..."},"DEL_REY":{"appKey":"...","appSecret":"..."}}
```

Tambem e aceito cadastrar chaves numeradas:

```env
OMIE_APP_KEY_1=...
OMIE_APP_SECRET_1=...
OMIE_ACCOUNT_NAME_1=LOJA DO SAPO DEL REY

OMIE_APP_KEY_2=...
OMIE_APP_SECRET_2=...
OMIE_ACCOUNT_NAME_2=LOJA DO SAPO BOULEVARD
```

Outra opcao e `OMIE_ACCOUNTS_JSON` com uma lista de objetos `name`, `app_key` e `app_secret`.
