/**
 * 차트 색 배정
 *
 * 규칙: 색은 "공정"이라는 대상에 고정된다. 기간을 바꿔 공정 수가 달라져도 색이 바뀌지 않도록,
 * 공정이 등록된 순서를 기준으로 색을 배정한다.
 * 9개째부터는 색을 돌려쓰지 않고 회색(기타)으로 묶는다.
 */

const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

const OTHER_COLOR = "var(--series-other)";

/** 공정 순서대로 색을 배정한 맵을 만든다. */
export function buildColorMap(processIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  processIds.forEach((id, index) => {
    map.set(id, index < SERIES_COLORS.length ? SERIES_COLORS[index] : OTHER_COLOR);
  });
  return map;
}

/** 배정된 색이 없으면 회색을 돌려준다. */
export function colorFrom(map: Map<string, string>, processId: string): string {
  return map.get(processId) ?? OTHER_COLOR;
}
