-- 실적을 설비 효과금액 계산에는 반영하되, 공정의 실제ST 평균 계산에서는 빼는 플래그.
-- 자동화 설비의 생산수량만 기록하고 싶을 때(시간이 실제 작업 페이스를 대표하지 않을 때) 켠다.

alter table public.records add column if not exists excluded_from_stats boolean not null default false;
