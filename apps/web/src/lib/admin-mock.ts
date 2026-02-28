export type RevenuePoint = {
  periodStart: string;
  label: string;
  revenue: number;
  cost: number;
};

export type ModelMarginPoint = {
  model: string;
  revenue: number;
  cost: number;
};

export type TenantBillingPoint = {
  tenantId: string;
  tenantName: string;
  spending: number;
  creditsGranted: number;
  refunds: number;
  currentBalance: number;
};

export type BillingAlert = {
  id: string;
  tenantId: string;
  tenantName: string;
  date: string;
  amount: number;
  average: number;
  ratio: number;
};

export type BillingPayload = {
  source: "database" | "mock";
  revenue: {
    daily: RevenuePoint[];
    weekly: RevenuePoint[];
    monthly: RevenuePoint[];
  };
  marginByModel: ModelMarginPoint[];
  tenantBreakdown: TenantBillingPoint[];
  alerts: BillingAlert[];
  generatedAt: string;
};

export type InfraStatus = "running" | "stopped" | "error";

export type InfraContainer = {
  id: string;
  tenantName: string;
  status: InfraStatus;
  cpuPct: number;
  ramMb: number;
  diskMb: number;
  updatedAt: string;
};

export type InfraAlert = {
  id: string;
  level: "warning" | "critical";
  type: "cpu" | "ram" | "crash";
  containerId: string;
  tenantName: string;
  message: string;
  at: string;
};

export type ProvisioningLogEntry = {
  id: string;
  action: "create" | "destroy" | "restart" | "stop";
  tenantName: string;
  containerId: string;
  at: string;
};

export type InfraPayload = {
  source: "mock";
  containers: InfraContainer[];
  alerts: InfraAlert[];
  provisioningLog: ProvisioningLogEntry[];
  generatedAt: string;
};

type InfraState = {
  containers: InfraContainer[];
  crashEvents: InfraAlert[];
  provisioningLog: ProvisioningLogEntry[];
};

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const startText = weekStart.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  const endText = end.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  return `${startText} - ${endText}`;
}

function aggregateByWeek(points: RevenuePoint[]): RevenuePoint[] {
  const grouped = new Map<string, RevenuePoint>();

  for (const point of points) {
    const day = new Date(`${point.periodStart}T00:00:00.000Z`);
    const dayOfWeek = day.getUTCDay();
    const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    day.setUTCDate(day.getUTCDate() - offset);
    const key = formatUtcDate(day);

    const existing = grouped.get(key);
    if (existing) {
      existing.revenue += point.revenue;
      existing.cost += point.cost;
    } else {
      grouped.set(key, {
        periodStart: key,
        label: weekLabel(day),
        revenue: point.revenue,
        cost: point.cost,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

function aggregateByMonth(points: RevenuePoint[]): RevenuePoint[] {
  const grouped = new Map<string, RevenuePoint>();

  for (const point of points) {
    const day = new Date(`${point.periodStart}T00:00:00.000Z`);
    day.setUTCDate(1);
    const key = formatUtcDate(day);

    const existing = grouped.get(key);
    if (existing) {
      existing.revenue += point.revenue;
      existing.cost += point.cost;
    } else {
      grouped.set(key, {
        periodStart: key,
        label: monthLabel(day),
        revenue: point.revenue,
        cost: point.cost,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

function buildSpikeAlerts(
  tenants: TenantBillingPoint[],
  recentDaily: Array<{ tenantId: string; date: string; amount: number }>
): BillingAlert[] {
  const names = new Map(tenants.map((tenant) => [tenant.tenantId, tenant.tenantName]));
  const grouped = new Map<string, Array<{ date: string; amount: number }>>();

  for (const item of recentDaily) {
    const existing = grouped.get(item.tenantId) ?? [];
    existing.push({ date: item.date, amount: item.amount });
    grouped.set(item.tenantId, existing);
  }

  const alerts: BillingAlert[] = [];
  for (const [tenantId, points] of Array.from(grouped.entries())) {
    if (points.length === 0) continue;
    const average =
      points.reduce((sum: number, item: { date: string; amount: number }) => sum + item.amount, 0) /
      points.length;
    if (average <= 0) continue;

    for (const point of points) {
      const ratio = point.amount / average;
      if (ratio > 3) {
        alerts.push({
          id: `${tenantId}-${point.date}`,
          tenantId,
          tenantName: names.get(tenantId) ?? "Unknown tenant",
          date: point.date,
          amount: point.amount,
          average,
          ratio,
        });
      }
    }
  }

  alerts.sort((a, b) => b.ratio - a.ratio);
  return alerts.slice(0, 10);
}

export function buildMockBillingData(): BillingPayload {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const daily: RevenuePoint[] = [];
  const recentDailyByTenant: Array<{ tenantId: string; date: string; amount: number }> = [];

  for (let index = 29; index >= 0; index -= 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - index);

    const weekday = day.getUTCDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.78 : 1;
    const trendFactor = 1 + (29 - index) * 0.018;
    const baseline = 380 * weekendFactor * trendFactor;
    const spikeFactor = index === 4 ? 3.35 : 1;

    const revenue = Number((baseline * spikeFactor).toFixed(2));
    const cost = Number((revenue * 0.69).toFixed(2));

    daily.push({
      periodStart: formatUtcDate(day),
      label: day.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }),
      revenue,
      cost,
    });

    const parts = [0.35, 0.28, 0.16, 0.12, 0.09];
    for (let tenantIndex = 0; tenantIndex < parts.length; tenantIndex += 1) {
      recentDailyByTenant.push({
        tenantId: `tenant-${tenantIndex + 1}`,
        date: formatUtcDate(day),
        amount: Number((revenue * parts[tenantIndex]).toFixed(2)),
      });
    }
  }

  const monthly = aggregateByMonth(daily);
  const weekly = aggregateByWeek(daily);

  const marginByModel: ModelMarginPoint[] = [
    { model: "GPT-4.1", revenue: 4620, cost: 3220 },
    { model: "Claude 3.7 Sonnet", revenue: 3160, cost: 2195 },
    { model: "Gemini 2.0 Flash", revenue: 1890, cost: 1335 },
    { model: "Llama 3.3 70B", revenue: 1210, cost: 905 },
  ];

  const tenantBreakdown: TenantBillingPoint[] = [
    { tenantId: "tenant-1", tenantName: "acme.ai", spending: 2920.2, creditsGranted: 3610.2, refunds: 120, currentBalance: 570 },
    { tenantId: "tenant-2", tenantName: "northwind.io", spending: 2218.4, creditsGranted: 2528.4, refunds: 40, currentBalance: 270 },
    { tenantId: "tenant-3", tenantName: "globex.cloud", spending: 1312.7, creditsGranted: 1572.7, refunds: 0, currentBalance: 260 },
    { tenantId: "tenant-4", tenantName: "initech.dev", spending: 1087.2, creditsGranted: 1337.2, refunds: 0, currentBalance: 250 },
    { tenantId: "tenant-5", tenantName: "starkops.net", spending: 845.6, creditsGranted: 1045.6, refunds: 10, currentBalance: 190 },
  ];

  const alerts = buildSpikeAlerts(tenantBreakdown, recentDailyByTenant);

  return {
    source: "mock",
    revenue: {
      daily,
      weekly,
      monthly,
    },
    marginByModel,
    tenantBreakdown,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function createInitialInfraState(): InfraState {
  const now = new Date();
  const timestamp = now.toISOString();

  const containers: InfraContainer[] = [
    { id: "ctr_acme_01", tenantName: "acme.ai", status: "running", cpuPct: 68, ramMb: 1910, diskMb: 11240, updatedAt: timestamp },
    { id: "ctr_northwind_01", tenantName: "northwind.io", status: "running", cpuPct: 52, ramMb: 1490, diskMb: 8950, updatedAt: timestamp },
    { id: "ctr_globex_01", tenantName: "globex.cloud", status: "running", cpuPct: 84, ramMb: 2140, diskMb: 12450, updatedAt: timestamp },
    { id: "ctr_initech_01", tenantName: "initech.dev", status: "running", cpuPct: 41, ramMb: 980, diskMb: 6015, updatedAt: timestamp },
    { id: "ctr_starkops_01", tenantName: "starkops.net", status: "error", cpuPct: 0, ramMb: 0, diskMb: 7230, updatedAt: timestamp },
    { id: "ctr_hooli_01", tenantName: "hooli.app", status: "stopped", cpuPct: 0, ramMb: 0, diskMb: 5220, updatedAt: timestamp },
  ];

  const crashEvents: InfraAlert[] = [
    {
      id: "crash-1",
      level: "critical",
      type: "crash",
      containerId: "ctr_starkops_01",
      tenantName: "starkops.net",
      message: "Container entered error state after repeated health-check failures.",
      at: new Date(now.getTime() - 4 * 60 * 1000).toISOString(),
    },
  ];

  const provisioningLog: ProvisioningLogEntry[] = [
    {
      id: "log-1",
      action: "create",
      tenantName: "acme.ai",
      containerId: "ctr_acme_01",
      at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "log-2",
      action: "create",
      tenantName: "globex.cloud",
      containerId: "ctr_globex_01",
      at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "log-3",
      action: "destroy",
      tenantName: "old-tenant.example",
      containerId: "ctr_old_91",
      at: new Date(now.getTime() - 95 * 60 * 1000).toISOString(),
    },
  ];

  return { containers, crashEvents, provisioningLog };
}

let infraState: InfraState | null = null;

function getInfraState(): InfraState {
  if (!infraState) {
    infraState = createInitialInfraState();
  }
  return infraState;
}

function refreshInfraMetrics(): void {
  const state = getInfraState();
  const now = new Date().toISOString();

  state.containers = state.containers.map((container) => {
    if (container.status !== "running") {
      return { ...container, updatedAt: now };
    }

    const cpuDelta = (Math.random() - 0.5) * 16;
    const ramDelta = (Math.random() - 0.5) * 180;
    const diskDelta = Math.random() * 12;

    return {
      ...container,
      cpuPct: round(clamp(container.cpuPct + cpuDelta, 10, 98)),
      ramMb: round(clamp(container.ramMb + ramDelta, 400, 3200)),
      diskMb: round(clamp(container.diskMb + diskDelta, 2000, 25000)),
      updatedAt: now,
    };
  });
}

function buildInfraAlerts(state: InfraState): InfraAlert[] {
  const usageAlerts: InfraAlert[] = [];

  for (const container of state.containers) {
    if (container.status !== "running") {
      continue;
    }

    if (container.cpuPct > 80) {
      usageAlerts.push({
        id: `cpu-${container.id}-${container.updatedAt}`,
        level: container.cpuPct > 90 ? "critical" : "warning",
        type: "cpu",
        containerId: container.id,
        tenantName: container.tenantName,
        message: `High CPU usage at ${container.cpuPct.toFixed(1)}%.`,
        at: container.updatedAt,
      });
    }

    if (container.ramMb > 2400) {
      usageAlerts.push({
        id: `ram-${container.id}-${container.updatedAt}`,
        level: container.ramMb > 2800 ? "critical" : "warning",
        type: "ram",
        containerId: container.id,
        tenantName: container.tenantName,
        message: `High RAM usage at ${container.ramMb.toFixed(0)} MB.`,
        at: container.updatedAt,
      });
    }
  }

  return [...state.crashEvents.slice(-10), ...usageAlerts].sort((a, b) => b.at.localeCompare(a.at));
}

export function getMockInfraPayload(): InfraPayload {
  const state = getInfraState();
  refreshInfraMetrics();

  return {
    source: "mock",
    containers: state.containers,
    alerts: buildInfraAlerts(state),
    provisioningLog: [...state.provisioningLog].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
    generatedAt: new Date().toISOString(),
  };
}

export function applyMockInfraAction(action: "restart" | "stop", containerId: string): InfraContainer | null {
  const state = getInfraState();
  const target = state.containers.find((container) => container.id === containerId);
  if (!target) {
    return null;
  }

  const now = new Date().toISOString();
  if (action === "stop") {
    target.status = "stopped";
    target.cpuPct = 0;
    target.ramMb = 0;
    target.updatedAt = now;
  } else if (action === "restart") {
    target.status = "running";
    target.cpuPct = 20 + Math.random() * 35;
    target.ramMb = 700 + Math.random() * 1200;
    target.updatedAt = now;
  }

  state.provisioningLog.push({
    id: `log-${Date.now()}`,
    action,
    tenantName: target.tenantName,
    containerId: target.id,
    at: now,
  });

  if (state.provisioningLog.length > 40) {
    state.provisioningLog = state.provisioningLog.slice(-40);
  }

  return target;
}
