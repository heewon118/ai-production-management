/**
 * 프로젝트 전역에서 쓰는 데이터 타입 정의
 * (PRD.md 5번 "주요 기능" 기준)
 */

/**
 * 생산팀. 파트(1단계)·자동화 설비가 어느 생산팀 소속인지 표시한다.
 * 팀은 화면(공정 설정 등)에서 + 버튼으로 자유롭게 추가할 수 있다 (고정된 개수가 아니다).
 */
export type TeamRecord = {
  id: string;
  name: string;
};

/**
 * 공정
 * 계층 구조: 1단계(assy 단위) → 2단계 → 3단계까지 가질 수 있다.
 * parentId가 null이면 최상위(assy) 공정, 즉 "파트"다.
 */
export type Process = {
  id: string;
  name: string;
  parentId: string | null;
  /** [1단계(파트) 전용] 이 파트가 속한 생산팀 id (TeamRecord.id 참조). */
  team?: string;
  /** 표준ST = 1개 생산에 필요한 시간(초). 아직 등록하지 않았으면 null */
  standardST: number | null;
  /**
   * 일일 목표수량 (개). 2단계 공정에 설정해서 대시보드의 목표 달성 현황에 쓴다.
   * 설정하지 않았으면 null.
   */
  dailyTarget?: number | null;
  /**
   * [1단계(파트) 전용] 이 파트에 소속된 담당자 이름들.
   * 콤마로 구분한 텍스트 그대로 저장한다 (예: "김철수, 이영희, 박민수").
   * 별도의 담당자 목록 화면 없이, 여기서 자유롭게 이름을 관리한다.
   */
  workers?: string;
  /**
   * [2단계 공정 전용] 이 공정을 전담하는 담당자 이름 (소속 파트의 담당자 중 한 명).
   * 생산실적 입력 시 이 공정을 고르면 자동으로 선택된다.
   */
  worker?: string | null;
  /**
   * 이 공정이 자동화 공정일 때 연결된 자동화 설비.
   * 연결해두면 생산실적을 입력할 때 그 설비가 자동으로 선택된다.
   */
  equipmentId?: string | null;
  /**
   * [2단계 공정 전용] 공정 목록·야마즈미 차트에 보여줄 순서. 작을수록 앞에 나온다.
   * 설정하지 않았으면(null) 등록된 순서를 그대로 쓴다.
   */
  order?: number | null;
};

/** ROI 계산식에서 사용하는 사용자 정의 값 (예: 시간당인건비 = 20000) */
export type FormulaVariable = {
  name: string;
  value: number;
};

/**
 * 자동화 설비
 * 설비마다 투자비용과 회수액 계산식을 따로 관리한다.
 */
export type Equipment = {
  id: string;
  name: string;
  /** 이 설비가 속한 생산팀 id (설비도 팀별로 따로 관리한다. TeamRecord.id 참조) */
  team: string;
  /** 설비 도입비용 (이 금액만큼 회수하면 본전) */
  investmentCost: number;
  /** 시작 시점에 이미 회수했던 누적 금액 (초기값) */
  initialRecovered: number;
  /**
   * 위 누적 금액이 반영된 기준일(YYYY-MM-DD). 아직 실적 입력이 다 끝나지 않아
   * 정확한 자동 계산이 어려운 기간을, 이 날짜까지는 직접 입력한 누적 금액으로 대신 보고
   * 그 다음 날부터의 생산실적만 자동으로 계산해서 더한다. 설정하지 않았으면(null)
   * 모든 실적을 계산해서 더한다.
   */
  initialRecoveredUntil?: string | null;
  /** 회수액 계산식 — 사용자가 웹 화면에서 직접 입력한다 (코드에 하드코딩하지 않음) */
  formula: string;
  /** 계산식 안에서 쓰는 사용자 정의 값들 */
  variables: FormulaVariable[];
};

/**
 * 이 실적이 평소(본인 정규) 실적이 아니라 특별한 사정으로 채운 것인지 표시한다.
 * - "support": 다른 사람이 그냥 생산지원을 한 경우 → 목표 달성 판정에서 경고(노랑)로 본다.
 * - "leave": 담당자 연차로 다른 사람이 대신 채운 경우(연차대응) → 정상 달성(초록)으로 본다.
 * - null: 평소처럼 정상 실적.
 */
export type AssistType = "support" | "leave" | null;

/** 생산실적 1건 */
export type ProductionRecord = {
  id: string;
  /** 작업 일자 (YYYY-MM-DD) */
  date: string;
  processId: string;
  /** 시작시간 (HH:MM) */
  startTime: string;
  /** 종료시간 (HH:MM) */
  endTime: string;
  /** 생산수량 (개) */
  quantity: number;
  /** 사용한 자동화 설비. 사용하지 않았으면 null */
  equipmentId: string | null;
  /** 이 실적을 입력한 담당자 이름. 고르지 않았으면 null */
  worker: string | null;
  /** 생산지원/연차대응 여부. 평소 실적이면 null */
  assistType: AssistType;
  /** 주간(day)/야간(night) 실적 구분. 시작시간이 17:30 이후면 야간이다. */
  shift: "day" | "night";
  /** 점심·휴식·정비시간을 제외한 실제 생산시간(분) */
  productionMinutes: number;
  /**
   * 저장 시점에 계산된 회수액(효과금액) — 참고용 스냅샷.
   * 화면에는 이 값을 쓰지 않고 항상 지금 계산식으로 다시 계산해서 보여준다.
   */
  recoveredAmount: number | null;
  /** 회수액을 계산하지 못한 경우 그 이유 (표준ST 미등록 등) */
  recoveredNote: string | null;
  createdAt: string;
};

/** JSON 파일에 저장되는 전체 데이터 구조 */
export type Database = {
  teams: TeamRecord[];
  processes: Process[];
  equipments: Equipment[];
  records: ProductionRecord[];
};

/** 빈 데이터 (파일이 없을 때 사용) */
export const EMPTY_DB: Database = {
  teams: [],
  processes: [],
  equipments: [],
  records: [],
};
