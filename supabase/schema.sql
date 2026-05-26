-- Migrations das tabelas raw_ do projeto icaiu-data
-- Execute no SQL Editor do Supabase (Database > SQL Editor)

-- 1. Adiciona constraint UNIQUE em external_id (necessário para upsert ON CONFLICT)
--    Já executado. Mantido aqui apenas para referência histórica.
-- alter table raw_contact_hablla           add constraint raw_contact_hablla_external_id_key           unique (external_id);
-- alter table raw_events_hablla            add constraint raw_events_hablla_external_id_key            unique (external_id);
-- alter table raw_cs_avaliacao_atendimento add constraint raw_cs_avaliacao_atendimento_external_id_key unique (external_id);
-- alter table raw_contact_telefonia        add constraint raw_contact_telefonia_external_id_key        unique (external_id);
-- alter table raw_events_faturado          add constraint raw_events_faturado_external_id_key          unique (external_id);
-- alter table raw_contact_site             add constraint raw_contact_site_external_id_key             unique (external_id);
-- alter table raw_events_agendamento       add constraint raw_events_agendamento_external_id_key       unique (external_id);

-- 2. Concede permissão de leitura e escrita ao service_role
--    Necessário quando tabelas são criadas via SQL Editor (o grant não é aplicado automaticamente).
grant all on raw_contact_hablla          to service_role;
grant all on raw_events_hablla           to service_role;
grant all on raw_cs_avaliacao_atendimento to service_role;
grant all on raw_contact_telefonia       to service_role;
grant all on raw_events_faturado         to service_role;
grant all on raw_contact_site            to service_role;
grant all on raw_events_agendamento      to service_role;

-- 3. Tabelas para integração Omie
-- Criar as tabelas raw para dados do Omie

-- Tabela para Vendas e NF-e (Produtos)
create table if not exists raw_omie_vendas_nfe (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

grant all on raw_omie_vendas_nfe to service_role;

-- Tabela para Serviços e NFS-e
create table if not exists raw_omie_servicos_nfse (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

grant all on raw_omie_servicos_nfse to service_role;

-- Tabela para Finanças (Contas a Receber)
create table if not exists raw_omie_financas (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

grant all on raw_omie_financas to service_role;

-- Criar índices para melhorar performance de queries
create index if not exists raw_omie_vendas_nfe_created_at_idx on raw_omie_vendas_nfe(created_at);
create index if not exists raw_omie_vendas_nfe_payload_idx on raw_omie_vendas_nfe using gin(payload);

create index if not exists raw_omie_servicos_nfse_created_at_idx on raw_omie_servicos_nfse(created_at);
create index if not exists raw_omie_servicos_nfse_payload_idx on raw_omie_servicos_nfse using gin(payload);

create index if not exists raw_omie_financas_created_at_idx on raw_omie_financas(created_at);
create index if not exists raw_omie_financas_payload_idx on raw_omie_financas using gin(payload);
