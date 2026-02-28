"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type UsagePoint = {
  date: string;
  totalTokens: number;
};

export default function UserUsageChart({ data }: { data: UsagePoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#26263d" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="#8686a5"
            tickFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          />
          <YAxis stroke="#8686a5" />
          <Tooltip
            contentStyle={{ backgroundColor: "#11111a", border: "1px solid #26263d" }}
            labelStyle={{ color: "#c7c7d8" }}
          />
          <Area type="monotone" dataKey="totalTokens" stroke="#6c5ce7" fill="#6c5ce7" fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
