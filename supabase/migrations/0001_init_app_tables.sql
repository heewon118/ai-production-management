-- AI 생산관리(생산기술1팀) 앱 데이터 테이블
-- 이 앱은 편집 권한 검사를 Next.js 서버(EDIT_PASSWORD)에서 직접 하고,
-- 브라우저는 Supabase에 절대 직접 접속하지 않는다(항상 우리 /api/* 라우트를 거친다).
-- 그래서 RLS를 켜고 anon/authenticated 권한은 전부 회수(deny-all)하며,
-- 실제 읽기/쓰기는 서버가 secret key(RLS 우회)로만 수행한다.

create table if not exists public.teams (
  id text primary key,
  name text not null unique
);

create table if not exists public.equipments (
  id text primary key,
  name text not null,
  team text not null references public.teams(id),
  investment_cost numeric not null default 0,
  initial_recovered numeric not null default 0,
  initial_recovered_until date,
  formula text not null,
  variables jsonb not null default '[]'::jsonb
);

create table if not exists public.processes (
  id text primary key,
  name text not null,
  parent_id text references public.processes(id),
  team text references public.teams(id),
  standard_st numeric,
  daily_target numeric,
  workers text,
  worker text,
  equipment_id text references public.equipments(id)
);

create table if not exists public.records (
  id text primary key,
  date date not null,
  process_id text not null references public.processes(id),
  start_time text not null,
  end_time text not null,
  quantity numeric not null,
  equipment_id text references public.equipments(id),
  worker text,
  assist_type text,
  shift text not null,
  production_minutes numeric not null,
  recovered_amount numeric,
  recovered_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_processes_parent_id on public.processes(parent_id);
create index if not exists idx_processes_team on public.processes(team);
create index if not exists idx_processes_equipment_id on public.processes(equipment_id);
create index if not exists idx_equipments_team on public.equipments(team);
create index if not exists idx_records_process_id on public.records(process_id);
create index if not exists idx_records_equipment_id on public.records(equipment_id);
create index if not exists idx_records_date on public.records(date);

alter table public.teams enable row level security;
alter table public.equipments enable row level security;
alter table public.processes enable row level security;
alter table public.records enable row level security;

revoke all on public.teams from anon, authenticated;
revoke all on public.equipments from anon, authenticated;
revoke all on public.processes from anon, authenticated;
revoke all on public.records from anon, authenticated;
