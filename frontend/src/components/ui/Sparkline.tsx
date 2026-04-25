import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: { x: string | number; y: number }[];
  /** Accent color for the line — defaults to violet. */
  stroke?: string;
  height?: number;
  /** When true, fills the area under the line with a soft gradient. */
  filled?: boolean;
}

/**
 * Tiny inline trend chart. No axes, no tooltips, just the shape.
 * Used in NetWorthCard, MonthlyBurnCard, and per-card drilldowns.
 */
export function Sparkline({ data, stroke = "rgb(167,139,250)", height = 48, filled = false }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div style={{ height }} className="text-xs text-zinc-600 flex items-center">no trend yet</div>;
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={["auto", "auto"]} />
          {filled && (
            <defs>
              <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={stroke} stopOpacity={0.4} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0}   />
              </linearGradient>
            </defs>
          )}
          <Line
            type="monotone"
            dataKey="y"
            stroke={stroke}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
            fill={filled ? "url(#sparkfill)" : undefined}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
