# 생산기술1팀 (구 AI 생산관리)

생산기술1팀이 생산효율을 검토·관리하기 위한 사내 생산관리 웹 앱입니다.
표준ST 대비 생산실적을 야마즈미 차트로 비교하고, 자동화 설비별 ROI(투자비 회수)를 추적합니다.

## 핵심 기능

- **표준ST 대비 생산실적 비교** — 공정별 표준ST(1개 생산에 필요한 시간)와 실제 생산시간을 비교해 야마즈미 차트로 보여줍니다.
- **자동화 설비 ROI(투자비 회수) 계산** — 설비별 투자비용 대비 누적 회수액을 계산식을 직접 설정해 관리합니다.
- **생산실적 입력** — 담당자 → 파트 → 공정 순으로 골라 실적을 입력하며, 점심·휴식시간은 자동으로 제외해 실제 생산시간을 계산합니다.
- **팀별 데이터 분리** — 생산1~3팀(필요하면 화면에서 추가 가능)마다 파트·설비·실적을 따로 관리하고, 화면 상단 팀 탭으로 전환해서 봅니다.
- **일일 목표 달성 현황** — 2단계 공정별 목표수량 대비 달성 여부(정상/지원·연차대응/미달성)를 확인합니다.

## 기술 스택

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- 데이터 저장: [Supabase](https://supabase.com) Postgres (teams/processes/equipments/records 4개 테이블)
- 배포: [Vercel](https://vercel.com)

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 에서 확인할 수 있습니다.

### 환경 변수

`.env.example`을 참고해 `.env`를 만드세요.
- `EDIT_PASSWORD` — 편집(입력/수정) 비밀번호. 설정하지 않으면 기본값 `1234`가 쓰이므로, 배포 시에는 반드시 별도로 설정해야 합니다.
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY` — 데이터를 저장하는 Supabase 프로젝트 접속 정보. `SUPABASE_SECRET_KEY`는 RLS를 우회하는 서버 전용 키이므로 절대 브라우저 코드나 `NEXT_PUBLIC_` 변수로 두지 않습니다.

## 알아두어야 할 점

- 이 앱은 로그인 없이 조회가 가능한 팀 내부 공유 도구입니다. 편집(입력/수정)만 비밀번호로 보호됩니다.
- 데이터는 Supabase Postgres에 저장됩니다. 편집 권한 검사는 앱 서버(`EDIT_PASSWORD`)가 직접 하며, 브라우저는 Supabase에 절대 직접 접속하지 않고 항상 우리 `/api/*` 라우트를 거칩니다. 모든 테이블은 RLS를 켜두고 익명 접근 권한을 회수해뒀습니다.
- Supabase **무료 요금제**를 쓰는 경우, 7일 동안 접속이 없으면 프로젝트가 자동으로 일시정지됩니다. 오래 쓰지 않다가 접속했는데 데이터가 안 보이면 [Supabase 대시보드](https://supabase.com/dashboard)에서 프로젝트를 깨워주세요.
- Microsoft 365(Azure AD) 계정 로그인 기능은 구현은 되어 있으나 회사 Azure 관리자 동의 대기로 잠시 꺼둔 상태입니다. 자세한 내용은 `CLAUDE.md`를 참고하세요.

## 문서

- [PRD.md](./PRD.md) — 기획서(배경, 목표, 범위)
- [CLAUDE.md](./CLAUDE.md) — 개발 규칙 및 프로젝트 구조
