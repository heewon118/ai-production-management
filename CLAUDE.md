@AGENTS.md

# 프로젝트 규칙 (CLAUDE.md) — 초안

이 문서는 이 프로젝트(my-app)에서 코드를 작성/수정할 때 지켜야 할 규칙을 정리한 문서입니다.
자세한 기획 내용은 [PRD.md](./PRD.md)를 참고하세요. PRD와 이 문서가 어긋나면 PRD를 기준으로 삼고, 이 문서를 최신 상태로 고쳐주세요.

## 1. 프로젝트 개요

- **이름:** 생산기술1팀 (화면 제목·헤더 표시명. 기존 명칭 "AI 생산관리")
- **한 마디로:** 생산기술1팀이 생산효율을 검토·관리하기 위한 앱
- **핵심 기능 2가지 (Must)**
  1. 표준ST 대비 생산실적 비교 (야마즈미 차트로 표시)
  2. 자동화 설비별 ROI(투자비 회수) 계산
- 자세한 배경·목표·범위는 [PRD.md](./PRD.md)의 1~6번 항목을 따른다.

## 2. 기술 스택

- **Next.js** (App Router, `src/` 디렉토리 구조) — 화면과 서버 쪽 코드(API)를 한 프로젝트에서 처리
- **TypeScript** — 모든 코드는 `.ts` / `.tsx`로 작성한다 (`.js` 파일 새로 만들지 않기)
- **Tailwind CSS** — 스타일링은 Tailwind 유틸리티 클래스를 우선 사용한다
- **ESLint** — `npm run lint` 통과를 기본으로 한다
- 이 스택은 PRD 8번에 따라 고정이며, 다른 프레임워크·언어를 임의로 추가하지 않는다 (필요하면 먼저 사용자에게 확인)
- **기술 스택은 절대 바꾸지 않는다:** Next.js로 고정이며, 다른 프레임워크로 바꾸거나 마이그레이션을 제안하지 않는다.
- **배포는 Vercel을 사용한다.**

## 3. 폴더 구조 규칙

```
src/app/           화면(페이지)과 API 라우트 (App Router 규칙을 따른다)
  page.tsx           대시보드 (야마즈미 차트 + 공정별 비교표 + 설비 ROI)
  production/        생산실적 입력·이력
  processes/         공정·표준ST 관리
  equipments/        자동화 설비·계산식 관리
  login/             (지금은 안 씀) Microsoft 계정 로그인 화면 — 8번 참고
  auth/callback/     (지금은 안 씀) Microsoft 로그인 후 돌아오는 콜백 — 8번 참고
  api/               Route Handler (data, teams, auth, processes, equipments, records, export)
src/components/    화면에서 공통으로 쓰는 컴포넌트 (Header, Card, YamazumiChart, DateField)
src/lib/           계산·저장 등 재사용 로직
  worktime.ts        휴게시간 차감 계산
  formula.ts         사용자 계산식 파서 (eval 사용 금지)
  roi.ts             회수액 계산 / 계산식 검증
  stats.ts           기간 평균·야마즈미·ROI 집계
  storage.ts         Supabase(teams/processes/equipments/records 테이블) 읽기·쓰기
  supabaseAdmin.ts   서버 전용 Supabase 클라이언트 (secret key, RLS 우회) — 절대 클라이언트 코드에서 import 금지
  auth.ts            편집 비밀번호 확인 (isEditor)
  supabase/          (지금은 안 씀) Microsoft 365 로그인용 Supabase 클라이언트 — 8번 참고 (supabaseAdmin.ts와는 다른 용도)
data/              (지금은 참고용 백업만) 예전에 쓰던 파일 저장 방식의 흔적. 실제 데이터는 Supabase에 있다. git에 올리지 않음
supabase/migrations/  Supabase 테이블 스키마(SQL)
scripts/           1회성 스크립트 (예: migrate-to-supabase.mjs — 로컬 데이터를 Supabase로 이관)
public/            이미지 등 정적 파일
PRD.md             기획서 (기능/범위의 기준 문서)
```

- 새 화면을 만들 때는 `src/app` 하위에 기능 단위 폴더로 만든다.
- 공통으로 재사용하는 로직(계산 함수 등)은 `src/lib`에 모은다.
- `src/lib` 안에서 화면(클라이언트)이 쓰는 파일은 `next/headers` 같은 서버 전용 코드를 import하지 않는다.
  (검증 함수를 `validate.ts`로 따로 둔 이유다)

## 4. 이 프로젝트만의 계산 규칙 (반드시 지킬 것)

PRD에서 정한 아래 규칙은 코드로 구현할 때 절대 놓치면 안 되는 부분이다.

- **생산팀 구분(생산1팀/생산2팀/생산3팀 + 자유 추가):** 팀은 고정된 개수가 아니라 데이터(`db.teams`, `src/lib/types.ts`의 `TeamRecord`)로 관리하며, 공정 설정 화면의 팀 탭 옆 + 버튼으로 언제든 새 팀을 추가할 수 있다. 파트(1단계)와 자동화 설비는 모두 소속 팀 id를 가진다. 생산실적입력·공정 설정·자동화 설비 설정·대시보드는 팀 탭으로 전환해서 팀별 데이터를 따로 본다. 지원·연차대응 실적은 같은 팀 안에서는 다른 파트 공정도 고를 수 있지만, 팀을 넘어가지는 않는다. 기존(마이그레이션 이전) 데이터는 모두 `team2`(생산2팀) 소속으로 본다.

- **근무시간 계산:** 근무시간(08:30~17:30) 중 점심시간(11:30~12:30), 휴식시간(10:00~10:10, 14:00~14:10, 15:40~15:50)은 생산시간 계산에서 반드시 자동으로 제외한다. 결과는 분(分) 단위로 저장한다.
- **단위 변환 주의:** 표준ST는 초(秒) 단위(1개 생산당), 생산시간은 분(分) 단위로 저장된다. 두 값을 비교할 때는 반드시 단위를 맞춰서 계산한다.
- **표준ST/공정 목록은 언제든 수정 가능:** 값이 바뀌면 그 이후 계산에는 반드시 최신 값을 사용한다.
- **표준ST가 없는 공정:** 실적은 우선 저장하고, 표준ST가 나중에 등록되면 그때부터 자동으로 비교 계산한다.
- **ROI(효과금액) 계산식도 웹 화면에서 사용자가 직접 설정/수정**하는 값이다 — 코드에 계산식을 하드코딩하지 않는다. 계산식을 바꾸면, 화면(이력 표·대시보드)에 보여줄 때는 과거 실적도 항상 "지금" 계산식 기준으로 다시 계산한다 (저장된 스냅샷을 그대로 쓰지 않는다). 아직 데이터 입력이 덜 끝난 최근 기간은 기간 필터로 제외하고 볼 수 있어야 한다.
- **자동화 설비는 여러 대** — 설비별로 ROI(투자비 회수)를 따로 누적 관리한다.
- **입력값 검증:** 생산수량·시간·금액 등은 음수를 입력할 수 없도록 막는다.
- **누적 데이터는 반드시 유지:** 새로고침·재접속해도 그동안 쌓인 누적 값(ROI, 실적 이력 등)이 사라지면 안 된다. 데이터는 Supabase Postgres(teams/processes/equipments/records 테이블)에 저장한다 — 예전에는 `data/db.json` 파일에 저장했지만, Vercel 서버리스 환경은 파일시스템이 읽기 전용이라 편집이 저장되지 않는 문제가 있어 옮겼다. 편집 권한 검사는 여전히 앱 서버의 `EDIT_PASSWORD`(`requireEditor()`)가 담당하고, 브라우저는 Supabase에 직접 접속하지 않는다 — 모든 테이블에 RLS를 켜고 `anon`/`authenticated` 권한은 회수했으며, 서버는 `src/lib/supabaseAdmin.ts`의 secret key로만 접근한다.

## 5. 이번 범위에서 하지 않는 것 (비범위)

아래 항목은 PRD 6번에서 "이번엔 만들지 않기"로 정한 것들이다. 요청받지 않는 한 먼저 만들지 않는다.

- 회원가입/이메일 로그인 (지금은 편집 시 비밀번호 하나로만 보호, 조회는 누구나 가능. Microsoft 365 로그인은 구현은 끝났지만 회사 Azure 관리자 동의 대기 중이라 잠시 보류 — 8번 참고)
- 복잡한 데이터베이스 구축·다중 테이블 연동 (Supabase의 teams/processes/equipments/records 4개 단순 테이블 수준을 넘어서는 스키마는 만들지 않는다. Vercel 배포 시 파일 시스템에 쓸 수 없어 Supabase로 옮긴 것이며, 자세한 내용은 4번 "누적 데이터는 반드시 유지" 참고)
- 생산조건·근무시간 기반 타임테이블 시각화
- 야마즈미 차트의 작업자/설비별 세분화
- 이상 징후 자동 알림/예측 기능
- 모바일 앱 (웹 화면만)

## 6. 보안·데이터 규칙

- API 키(OpenAI 등 외부 서비스 키)는 코드에 직접 적지 않고 `.env`의 환경변수로만 관리한다. `.env`는 git에 커밋하지 않는다 (`.gitignore`에 이미 포함되어 있음. 지우지 말 것).
- `.env` 등 비밀 정보 파일과 `node_modules` 폴더는 반드시 `.gitignore`에 등록해두고 절대 커밋하지 않는다.
- 배포 시 필요한 키는 Vercel의 환경변수 설정에 별도로 등록한다.
- 이 프로젝트는 개인정보를 다루지 않는다 (생산실적·표준ST·설비 데이터 등 업무 데이터만 사용). 개인정보로 보일 수 있는 값(이름, 연락처 등)을 새로 추가하려면 먼저 사용자에게 확인한다.
- 이 앱은 팀 내부 공유 자료다 — 배포 링크를 아는 사람은 로그인 없이 조회 가능하다는 점을 코드/문구에서 명확히 한다.
- **외부 서비스 인증이 필요할 때:** 토큰 값을 사용자에게 묻거나 채팅에 출력하지 않고, `.env`에 있는 값을 읽어서 사용한다.
  - 예: Supabase를 써야 하는 상황이 생기면 Supabase CLI를 설치해 `.env`의 `SUPABASE_ACCESS_TOKEN`으로 작업한다.
  - 예: Vercel 작업(배포 등)이 필요하면 Vercel CLI를 설치해 `.env`의 `VERCEL_TOKEN`으로 인증해 작업한다.

## 8. Microsoft 365 로그인 (구현 완료, 잠시 보류)

회사 Microsoft 365(Azure AD) 계정으로 로그인하는 기능(Supabase Auth + Azure OAuth)은 코드까지 다 만들어뒀지만, 회사 Azure 관리자 동의가 아직 안 나서 지금은 꺼둔 상태다. 그래서 5·6번에 적힌 "비밀번호 하나로 편집만 보호" 방식이 지금 실제로 쓰이는 방식이다.

- 동의를 받으면 이렇게 되돌리면 된다:
  1. `trash-can/proxy.ts`를 `src/proxy.ts`로 다시 옮긴다 (Next.js가 이 정확한 위치/이름만 인식한다)
  2. `src/lib/auth.ts`(`isAuthenticated`/`signOut`), `src/lib/api.ts`(`requireAuth`), `src/components/Header.tsx`(이메일 표시+로그아웃), `src/app/api/auth/route.ts`(GET/DELETE만), `src/lib/client.ts`(`authenticated: boolean`)를 Microsoft 로그인 버전으로 되돌린다
  3. `production`/`processes`/`equipments` 3개 페이지의 `editor` 변수를 `authenticated`로 다시 바꾸고, "지금은 조회만 가능합니다..." 안내문을 로그인 세션 만료 안내로 바꾼다
  4. `src/app/api/data|export|equipments|processes|records/route.ts`의 GET 핸들러에 `requireAuth()` 가드를 다시 넣는다
  5. `.env`의 `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`는 이미 준비돼 있고, Supabase 프로젝트의 Azure Provider도 이미 설정 완료 상태다
- 관련 파일(그대로 남아있고 지금은 안 쓰임): `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

## 7. 작업 방식

- 큰 기능을 추가하기 전에는 PRD.md의 범위(6번)와 어긋나지 않는지 먼저 확인한다.
- PRD에 없는 새로운 기능이나 화면을 임의로 만들지 않는다 — 필요하다고 판단되면 먼저 사용자에게 제안하고 확인받는다.
- 애매한 요구사항은 추측해서 진행하지 말고, 사용자에게 선택지를 붙여 질문한다.
- 기능 단위가 끝나면 PRD.md와 실제 구현이 어긋나지 않는지 점검한다.
- 모든 설명과 코드 주석은 한국어로 작성한다.
- 새 파일은 반드시 `my-app` 폴더 안에만 만든다 (상위 폴더나 프로젝트 밖에 파일을 만들지 않는다).
- 코드를 변경하면 무엇을 왜 바꿨는지 한 줄로 알려준다.
- 파일을 지워야 할 때는 바로 삭제하지 않는다. `trash-can` 폴더를 만들어 그 안으로 옮겨만 두고, 실제 삭제는 사용자가 직접 확인한 뒤 진행한다.
- 이미 설치된 서브에이전트는 필요할 때마다 적극 활용한다.

---
*이 문서는 초안입니다. 실제 개발을 진행하면서 빠지거나 바뀌어야 할 규칙이 보이면 계속 업데이트해주세요.*
