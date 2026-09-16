-- 공정 목록·야마즈미 차트에 보여줄 순서(주로 2단계 공정용). 설정 안 하면 null.

alter table public.processes add column if not exists sort_order integer;
