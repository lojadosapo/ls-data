-- Loja do Sapo: tabelas brutas da integração Omie.
-- Execute este arquivo no SQL Editor do projeto Supabase da Loja do Sapo.

create table if not exists public.raw_omie_vendas_nfe (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_omie_servicos_nfse (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_omie_financas (
  external_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.raw_omie_vendas_nfe to service_role;
grant all on public.raw_omie_servicos_nfse to service_role;
grant all on public.raw_omie_financas to service_role;

create index if not exists raw_omie_vendas_nfe_created_at_idx
  on public.raw_omie_vendas_nfe (created_at);
create index if not exists raw_omie_vendas_nfe_payload_idx
  on public.raw_omie_vendas_nfe using gin (payload);

create index if not exists raw_omie_servicos_nfse_created_at_idx
  on public.raw_omie_servicos_nfse (created_at);
create index if not exists raw_omie_servicos_nfse_payload_idx
  on public.raw_omie_servicos_nfse using gin (payload);

create index if not exists raw_omie_financas_created_at_idx
  on public.raw_omie_financas (created_at);
create index if not exists raw_omie_financas_payload_idx
  on public.raw_omie_financas using gin (payload);
