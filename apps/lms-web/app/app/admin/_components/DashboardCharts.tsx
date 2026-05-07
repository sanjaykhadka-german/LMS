"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#10b981", "#ef4444", "#f59e0b", "#94a3b8"];
const PASSED_COLOR = "#10b981";
const FAILED_COLOR = "#ef4444";
const BAR_COLOR = "#3b82f6";

type Timeseries = Array<{ date: string; passed: number; failed: number }>;
type StatusBuckets = {
  completed: number;
  overdue: number;
  dueSoon: number;
  open: number;
};
type RateRow = { name: string; attempts: number; passRate: number };

export function DashboardCharts({
  timeseries,
  assignmentStatus,
  passRateByModule,
  passRateByDept,
}: {
  timeseries: Timeseries;
  assignmentStatus: StatusBuckets;
  passRateByModule: Array<{ title: string; attempts: number; passRate: number }>;
  passRateByDept: Array<{ name: string; attempts: number; passRate: number }>;
}) {
  const moduleData: RateRow[] = passRateByModule.map((m) => ({
    name: truncate(m.title, 24),
    attempts: m.attempts,
    passRate: Math.round(m.passRate * 100),
  }));
  const deptData: RateRow[] = passRateByDept.map((d) => ({
    name: truncate(d.name, 18),
    attempts: d.attempts,
    passRate: Math.round(d.passRate * 100),
  }));
  const pieData = [
    { name: "Completed", value: assignmentStatus.completed },
    { name: "Overdue", value: assignmentStatus.overdue },
    { name: "Due soon", value: assignmentStatus.dueSoon },
    { name: "Open", value: assignmentStatus.open },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Attempts (passed vs failed)">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={timeseries}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="passed"
              stroke={PASSED_COLOR}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="failed"
              stroke={FAILED_COLOR}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Assignment status">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              outerRadius={90}
              label={(entry: { name: string; value: number }) =>
                `${entry.name}: ${entry.value}`
              }
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Pass rate by module (worst first)">
        <ResponsiveContainer width="100%" height={Math.max(260, moduleData.length * 28)}>
          <BarChart data={moduleData} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={140}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: number) => `${v}%`}
              labelFormatter={(l) => `Module: ${l}`}
            />
            <Bar dataKey="passRate" fill={BAR_COLOR} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Pass rate by department (best first)">
        <ResponsiveContainer width="100%" height={Math.max(260, deptData.length * 32)}>
          <BarChart data={deptData} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: number) => `${v}%`}
              labelFormatter={(l) => `Department: ${l}`}
            />
            <Bar dataKey="passRate" fill={PASSED_COLOR} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
