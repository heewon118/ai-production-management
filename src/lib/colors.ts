/**
 * 차트 색 배정
 *
 * 규칙: 색은 "공정"이라는 대상에 고정된다. 기간을 바꿔 공정 수가 달라져도 색이 바뀌지 않도록,
 * 공정이 등록된 순서를 기준으로 색을 배정한다.
 * 13개째부터는 색을 돌려쓰지 않고 회색(기타)으로 묶는다.
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
  "var(--series-9)",
  "var(--series-10)",
  "var(--series-11)",
  "var(--series-12)",
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

/**
 * 야마즈미 차트 전용 색 배정.
 * 지금 화면에 실제로 보이는 막대(그룹)들의 구간만, 나온 순서대로 색을 매긴다.
 * 전체 공정표가 아니라 "지금 보이는 것"만 대상으로 하므로, 기간을 좁히면 그만큼
 * 구분해야 할 색도 줄어 겹칠 일이 적다. 한 막대 안에 쌓인 구간은 물론, 서로 다른
 * 막대끼리도 (합쳐서 팔레트 개수 이내면) 색이 겹치지 않는다.
 */
export function buildYamazumiColorMap(groups: { segments: { processId: string }[] }[]): Map<string, string> {
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const group of groups) {
    for (const segment of group.segments) {
      if (!seen.has(segment.processId)) {
        seen.add(segment.processId);
        orderedIds.push(segment.processId);
      }
    }
  }
  return buildColorMap(orderedIds);
}
