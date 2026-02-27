"use client";

import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

type UsagePoint = {
  day: string;
  costCents: number;
};

type TenantUsageChartProps = {
  data: UsagePoint[];
};

export default function TenantUsageChart({ data }: TenantUsageChartProps) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7c6cf5" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#7c6cf5" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#2a2a3b" strokeDasharray="3 3" />
          <XAxis dataKey="day" stroke="#8b8ba5" tick={{ fontSize: 12 }} />
          <YAxis
            stroke="#8b8ba5"
            tick={{ fontSize: 12 }}
            tickFormatter={(value: number) => `$${(value / 100).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#121222",
              border: "1px solid #2f2f44",
              borderRadius: "8px",
              color: "#e5e7eb",
            }}
          />
          <Area type="monotone" dataKey="costCents" stroke="#7c6cf5" fill="url(#usageFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
