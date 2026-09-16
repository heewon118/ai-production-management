-- 관리자 설정(편집 비밀번호 해시)을 저장하는 테이블.
-- 딱 1행(id='app')만 쓰며, 다른 테이블과 마찬가지로 서버가 secret key로만 접근한다.

create table if not exists public.settings (
  id text primary key,
  password_hash text not null
);

alter table public.settings enable row level security;

revoke all on public.settings from anon, authenticated;
