"use client";

/**
 * 야마즈미 차트
 *
 * 최상위(assy) 공정별로 막대를 하나 만들고, 그 안에 하위 공정들의 실제ST(개당 초)를 쌓아 올린다.
 * 점선은 같은 공정들의 표준ST 합계(목표선)다.
 */

import { useRef, useState } from "react";
import type { YamazumiGroup } from "@/lib/stats";

type Props = {
  groups: YamazumiGroup[];
  /** 공정 id로 색을 정한다. 색은 공정마다 고정된다. */
  colorOf: (processId: string) => string;
  /**
   * 여유율(%). 표준ST는 실제로 걸리는 시간(리얼타임)이므로,
   * 여기에 여유율을 더한 값을 목표선으로 함께 보여준다. (버퍼)
   */
  bufferPercent: number;
};

/** 세로축 최대값을 보기 좋은 숫자로 올림한다. */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

/** 위쪽 모서리만 둥근 사각형 경로 (막대의 끝부분만 둥글게) */
function roundedTopPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, height, width / 2);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    "Z",
  ].join(" ");
}

type HoverInfo = {
  x: number;
  y: number;
  groupName: string;
  segmentName: string;
  value: number;
};

// 차트 크기 (viewBox 기준)
const PAD_LEFT = 52;
const PAD_RIGHT = 16;
const PAD_TOP = 20;
const PAD_BOTTOM = 48;
const SLOT_WIDTH = 104;
const BAR_WIDTH = 64;
const PLOT_HEIGHT = 240;
/** 쌓인 막대 사이에 두는 틈 (배경색이 비쳐 경계가 보이도록) */
const SEGMENT_GAP = 2;

export default function YamazumiChart({ groups, colorOf, bufferPercent }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  if (groups.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-ink-muted">
        선택한 기간에 표시할 생산실적이 없습니다.
      </p>
    );
  }

  /** 표준ST(리얼타임)에 여유율을 더한 값 */
  const withBuffer = (target: number) => target * (1 + bufferPercent / 100);

  const rawMax = Math.max(
    ...groups.map((group) =>
      Math.max(group.total, group.target === null ? 0 : withBuffer(group.target)),
    ),
  );
  const maxValue = niceMax(rawMax * 1.15);

  const width = PAD_LEFT + groups.length * SLOT_WIDTH + PAD_RIGHT;
  const height = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM;
  const baseline = PAD_TOP + PLOT_HEIGHT;

  /** 값(초)을 y좌표로 바꾼다. */
  const toY = (value: number) => baseline - (value / maxValue) * PLOT_HEIGHT;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);

  function showTooltip(event: React.MouseEvent, info: Omit<HoverInfo, "x" | "y">) {
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setHover({
      ...info,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  }

  return (
    <div ref={wrapperRef} className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[520px]"
        role="img"
        aria-label="공정별 실제ST 야마즈미 차트"
        onMouseLeave={() => setHover(null)}
      >
        {/* 가로 눈금선 (배경으로 물러나 보이도록 얇게) */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              y1={toY(tick)}
              x2={width - PAD_RIGHT}
              y2={toY(tick)}
              stroke="var(--line-grid)"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 8}
              y={toY(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {Math.round(tick)}
            </text>
          </g>
        ))}

        {/* 세로축 단위 */}
        <text x={4} y={PAD_TOP - 6} fontSize={11} fill="var(--text-muted)">
          초/개
        </text>

        {groups.map((group, groupIndex) => {
          const slotX = PAD_LEFT + groupIndex * SLOT_WIDTH;
          const barX = slotX + (SLOT_WIDTH - BAR_WIDTH) / 2;

          // 아래에서부터 위로 쌓아 올린다.
          let cursor = 0;

          return (
            <g key={group.topProcessId}>
              {group.segments.map((segment, segmentIndex) => {
                const bottom = toY(cursor);
                cursor += segment.value;
                const top = toY(cursor);

                const isTop = segmentIndex === group.segments.length - 1;
                const rawHeight = bottom - top;
                // 세그먼트 사이 틈을 주되, 막대가 사라지지 않도록 최소 높이를 지킨다.
                const segmentHeight = Math.max(rawHeight - (isTop ? 0 : SEGMENT_GAP), 1);
                const color = colorOf(segment.processId);

                return (
                  <g key={segment.processId}>
                    {isTop ? (
                      <path
                        d={roundedTopPath(barX, top, BAR_WIDTH, segmentHeight, 4)}
                        fill={color}
                        onMouseMove={(event) =>
                          showTooltip(event, {
                            groupName: group.topProcessName,
                            segmentName: segment.name,
                            value: segment.value,
                          })
                        }
                      />
                    ) : (
                      <rect
                        x={barX}
                        y={top}
                        width={BAR_WIDTH}
                        height={segmentHeight}
                        fill={color}
                        onMouseMove={(event) =>
                          showTooltip(event, {
                            groupName: group.topProcessName,
                            segmentName: segment.name,
                            value: segment.value,
                          })
                        }
                      />
                    )}

                    {/* 칸이 충분히 클 때만 값을 직접 적는다 (모든 칸에 숫자를 넣지 않는다) */}
                    {segmentHeight >= 22 ? (
                      <text
                        x={barX + BAR_WIDTH / 2}
                        y={top + segmentHeight / 2 + 4}
                        textAnchor="middle"
                        fontSize={11}
                        fill="#ffffff"
                        pointerEvents="none"
                      >
                        {segment.value.toFixed(1)}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {/* 표준ST(리얼타임) 선과, 여유율을 더한 목표선 사이를 버퍼 구간으로 표시한다 */}
              {group.target !== null ? (
                <g pointerEvents="none">
                  {bufferPercent > 0 ? (
                    <>
                      <rect
                        x={barX - 10}
                        y={toY(withBuffer(group.target))}
                        width={BAR_WIDTH + 20}
                        height={Math.max(toY(group.target) - toY(withBuffer(group.target)), 0)}
                        fill="var(--text-primary)"
                        opacity={0.08}
                      />
                      <line
                        x1={barX - 10}
                        y1={toY(withBuffer(group.target))}
                        x2={barX + BAR_WIDTH + 10}
                        y2={toY(withBuffer(group.target))}
                        stroke="var(--status-warning)"
                        strokeWidth={2}
                      />
                      <text
                        x={barX + BAR_WIDTH + 12}
                        y={toY(withBuffer(group.target)) - 4}
                        fontSize={10}
                        fill="var(--text-secondary)"
                      >
                        여유포함 {withBuffer(group.target).toFixed(1)}
                      </text>
                    </>
                  ) : null}

                  <line
                    x1={barX - 10}
                    y1={toY(group.target)}
                    x2={barX + BAR_WIDTH + 10}
                    y2={toY(group.target)}
                    stroke="var(--text-primary)"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                  <text
                    x={barX + BAR_WIDTH + 12}
                    y={toY(group.target) + 12}
                    fontSize={10}
                    fill="var(--text-secondary)"
                  >
                    표준 {group.target.toFixed(1)}
                  </text>
                </g>
              ) : null}

              {/* 막대 위: 3단계 공정 합산 = 2단계 공정의 실제ST */}
              {group.total > 0 ? (
                <text
                  x={barX + BAR_WIDTH / 2}
                  y={toY(group.total) - 8}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--text-primary)"
                  pointerEvents="none"
                >
                  {group.total.toFixed(1)}초
                </text>
              ) : null}

              {/* 막대 아래 공정 이름 + 여유율 대비 결과 */}
              <text
                x={slotX + SLOT_WIDTH / 2}
                y={baseline + 18}
                textAnchor="middle"
                fontSize={12}
                fill="var(--text-primary)"
              >
                {group.topProcessName}
              </text>
              {group.target !== null && group.total > 0 ? (
                <text
                  x={slotX + SLOT_WIDTH / 2}
                  y={baseline + 34}
                  textAnchor="middle"
                  fontSize={11}
                  fill={
                    group.total > withBuffer(group.target)
                      ? "var(--status-critical)"
                      : "var(--status-good)"
                  }
                >
                  {group.total > withBuffer(group.target) ? "여유 초과" : "여유 내"} (
                  {(group.total - withBuffer(group.target) >= 0 ? "+" : "") +
                    (group.total - withBuffer(group.target)).toFixed(1)}
                  )
                </text>
              ) : (
                <text
                  x={slotX + SLOT_WIDTH / 2}
                  y={baseline + 34}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {group.total > 0 ? `실제 ${group.total.toFixed(1)}초` : "실적 없음"}
                </text>
              )}
            </g>
          );
        })}

        {/* 기준선 */}
        <line
          x1={PAD_LEFT}
          y1={baseline}
          x2={width - PAD_RIGHT}
          y2={baseline}
          stroke="var(--line-axis)"
          strokeWidth={1}
        />
      </svg>

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-card px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.max(hover.x + 12, 8),
            top: Math.max(hover.y - 12, 8),
          }}
        >
          <p className="font-medium text-ink">{hover.segmentName}</p>
          <p className="text-ink-muted">{hover.groupName}</p>
          <p className="tabular mt-1 text-ink-soft">실제 {hover.value.toFixed(1)}초/개</p>
        </div>
      ) : null}
    </div>
  );
}
