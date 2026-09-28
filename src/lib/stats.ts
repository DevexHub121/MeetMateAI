import { db } from "@/db";
import { meetings, aiUsage, type AiUsage, type Meeting } from "@/db/schema";

/**
 * Org-wide MeetMate analytics. Computes a meeting-centric snapshot of how MeetMate is
 * being used and the manual note-taking it's automating, plus an AI credit-
 * usage view — for the Orbit portal's Analytics dashboard (see /api/stats).
 * Every number is derived from columns MeetMate already stores (meetings +
 * ai_usage); there's no separate event tracking. The portal fetches this over a
 * short-lived service token (see lib/portal.ts verifyServiceToken). The section
 * shapes mirror Candor's so the portal can render both with shared components.
 */

export type StatsPeriod = "7d" | "30d" | "90d" | "all";

export type TrendPoint = { label: string; date: string; value: number };

export type EchoStats = {
  period: StatsPeriod;
  generatedAt: string;
  /** Section 1 — headline KPIs, each with a trend vs the previous window. */
  kpis: {
    totalMeetings: number; // all-time
    newMeetings: { value: number; deltaPct: number | null };
    minutesGenerated: { value: number; deltaPct: number | null };
    completionRate: number; // % of period meetings that reached "completed"
  };
  /** Section 2 — "how MeetMate is helping" impact numbers. */
  impact: {
    meetingsRecorded: number;
    meetingsTranscribed: number;
    minutesGenerated: number;
    actionItemsCaptured: number;
    decisionsLogged: number;
    minutesEmailed: number; // minutes docs emailed to invitees
    hoursTranscribed: number; // audio hours turned into text
    minutesSaved: number; // rough estimate of manual note-taking avoided
  };
  /** Section 3 — meeting pipeline funnel (period meeting counts by stage). */
  funnel: { label: string; value: number }[];
  /** Section 4 — time series (meetings held, minutes generated). */
  trends: {
    meetings: TrendPoint[];
    minutes: TrendPoint[];
  };
  /** Section 5 — meeting mix & averages. */
  breakdown: {
    avgDurationMin: number | null;
    avgActionItems: number | null; // per meeting with minutes
    avgAttendees: number | null;
    byType: { label: string; value: number }[]; // internal vs client
    byStatus: { label: string; value: number }[];
    outcomeMix: { label: string; value: number }[]; // totals across minutes docs
  };
  /** Section 6 — people (host leaderboard + top clients). */
  hosts: {
    leaderboard: { name: string; meetings: number; minutes: number }[];
    topClients: { name: string; value: number }[];
  };
  /** Section 7 — OpenAI credit usage (tokens + estimated USD cost). */
  ai: {
    totalCalls: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    costDeltaPct: number | null;
    byOperation: {
      operation: string;
      calls: number;
      totalTokens: number;
      costUsd: number;
    }[];
    byModel: {
      model: string;
      calls: number;
      totalTokens: number;
      costUsd: number;
    }[];
    costTrend: TrendPoint[];
  };
};

/** Window length in days, or null for "all time". */
function periodDays(period: StatsPeriod): number | null {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return null;
  }
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Meetings store durationSeconds as text; parse to a safe number of seconds. */
function durationSeconds(m: Meeting): number {
  if (!m.durationSeconds) return 0;
  const n = Number(m.durationSeconds);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Best-effort attendee count for a meeting (invitees, else minutes attendees). */
function attendeeCount(m: Meeting): number {
  if (m.invitees && m.invitees.length) return m.invitees.length;
  if (m.minutes && m.minutes.attendees) return m.minutes.attendees.length;
  return 0;
}

/** Bucket a set of dates into evenly spaced labeled points (counts). */
function buildTrend(
  dates: Date[],
  from: Date,
  to: Date,
  buckets: number,
): TrendPoint[] {
  const span = to.getTime() - from.getTime();
  const step = span / buckets || 1;
  const counts = new Array(buckets).fill(0);
  for (const d of dates) {
    const t = d.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    let idx = Math.floor((t - from.getTime()) / step);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  return counts.map((value, i) => {
    const start = new Date(from.getTime() + step * i);
    return {
      label: start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      date: start.toISOString(),
      value,
    };
  });
}

/** Like buildTrend, but sums a numeric value per bucket instead of counting. */
function buildValueTrend(
  points: { date: Date; value: number }[],
  from: Date,
  to: Date,
  buckets: number,
): TrendPoint[] {
  const span = to.getTime() - from.getTime();
  const step = span / buckets || 1;
  const sums = new Array(buckets).fill(0);
  for (const p of points) {
    const t = p.date.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    let idx = Math.floor((t - from.getTime()) / step);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    sums[idx] += p.value;
  }
  return sums.map((value, i) => {
    const start = new Date(from.getTime() + step * i);
    return {
      label: start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      date: start.toISOString(),
      value: Math.round(value * 100) / 100,
    };
  });
}

// Human-facing labels for the meeting status pipeline.
const STATUS_LABEL: Record<Meeting["status"], string> = {
  scheduled: "Scheduled",
  ready: "Ready",
  recorded: "Recorded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  analyzing: "Analyzing",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_ORDER: Meeting["status"][] = [
  "scheduled",
  "ready",
  "recorded",
  "transcribing",
  "transcribed",
  "analyzing",
  "completed",
  "failed",
];

export async function computeStats(
  period: StatsPeriod = "30d",
): Promise<EchoStats> {
  const [allMeetings, allAiUsage] = await Promise.all([
    db.select().from(meetings),
    db.select().from(aiUsage),
  ]);

  const now = new Date();
  const days = periodDays(period);
  const from = days ? new Date(now.getTime() - days * 86400000) : null;
  const prevFrom = days ? new Date(now.getTime() - days * 2 * 86400000) : null;

  const inPeriod = (d: Date | null) =>
    d != null && (!from || d >= from) && d <= now;
  const inPrevPeriod = (d: Date | null) =>
    d != null && prevFrom != null && from != null && d >= prevFrom && d < from;

  // A meeting's "when" is its creation date (meetingDate is future-scheduling).
  const periodMeetings = allMeetings.filter((m) => inPeriod(m.createdAt));
  const prevMeetings = allMeetings.filter((m) => inPrevPeriod(m.createdAt));

  const hasMinutes = (m: Meeting) => m.minutes != null;

  // ── Section 1: KPIs ──
  const minutesInPeriod = periodMeetings.filter(hasMinutes).length;
  const minutesInPrev = prevMeetings.filter(hasMinutes).length;
  const completedInPeriod = periodMeetings.filter(
    (m) => m.status === "completed",
  ).length;
  const kpis: EchoStats["kpis"] = {
    totalMeetings: allMeetings.length,
    newMeetings: {
      value: periodMeetings.length,
      deltaPct: days
        ? pctDelta(periodMeetings.length, prevMeetings.length)
        : null,
    },
    minutesGenerated: {
      value: minutesInPeriod,
      deltaPct: days ? pctDelta(minutesInPeriod, minutesInPrev) : null,
    },
    completionRate: periodMeetings.length
      ? Math.round((completedInPeriod / periodMeetings.length) * 100)
      : 0,
  };

  // ── Section 2: Impact ──
  const recorded = periodMeetings.filter((m) => m.recordingPath != null).length;
  const transcribed = periodMeetings.filter((m) => m.transcript != null).length;
  const minutesEmailed = periodMeetings.filter(
    (m) => m.emailedAt != null,
  ).length;
  let actionItemsCaptured = 0;
  let decisionsLogged = 0;
  for (const m of periodMeetings) {
    if (!m.minutes) continue;
    actionItemsCaptured += m.minutes.actionItems?.length ?? 0;
    decisionsLogged += m.minutes.decisions?.length ?? 0;
  }
  const hoursTranscribed =
    Math.round(
      (periodMeetings
        .filter((m) => m.transcript != null)
        .reduce((a, m) => a + durationSeconds(m), 0) /
        3600) *
        10,
    ) / 10;
  // Rough time saved: ~20 min of manual minute-writing avoided per generated
  // minutes doc, ~5 min per emailed distribution, ~2 min per captured task.
  const minutesSaved =
    minutesInPeriod * 20 + minutesEmailed * 5 + actionItemsCaptured * 2;

  const impact: EchoStats["impact"] = {
    meetingsRecorded: recorded,
    meetingsTranscribed: transcribed,
    minutesGenerated: minutesInPeriod,
    actionItemsCaptured,
    decisionsLogged,
    minutesEmailed,
    hoursTranscribed,
    minutesSaved,
  };

  // ── Section 3: Funnel (meeting lifecycle) ──
  const funnel: EchoStats["funnel"] = [
    { label: "Created", value: periodMeetings.length },
    { label: "Recorded", value: recorded },
    { label: "Transcribed", value: transcribed },
    { label: "Minutes generated", value: minutesInPeriod },
    { label: "Delivered", value: minutesEmailed },
  ];

  // ── Section 4: Trends ──
  const buckets = days && days <= 7 ? 7 : days && days <= 30 ? 10 : 12;
  const trendFrom =
    from ??
    (allMeetings.length
      ? new Date(Math.min(...allMeetings.map((m) => m.createdAt.getTime())))
      : new Date(now.getTime() - 30 * 86400000));
  const trends: EchoStats["trends"] = {
    meetings: buildTrend(
      periodMeetings.map((m) => m.createdAt),
      trendFrom,
      now,
      buckets,
    ),
    minutes: buildTrend(
      periodMeetings.filter(hasMinutes).map((m) => m.createdAt),
      trendFrom,
      now,
      buckets,
    ),
  };

  // ── Section 5: Breakdown / mix ──
  const durationsMin = periodMeetings
    .map((m) => durationSeconds(m))
    .filter((s) => s > 0)
    .map((s) => s / 60);
  const avgDurationMin = durationsMin.length
    ? Math.round(
        (durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length) * 10,
      ) / 10
    : null;

  const minutesMeetings = periodMeetings.filter(hasMinutes);
  const avgActionItems = minutesMeetings.length
    ? Math.round(
        (minutesMeetings.reduce(
          (a, m) => a + (m.minutes?.actionItems?.length ?? 0),
          0,
        ) /
          minutesMeetings.length) *
          10,
      ) / 10
    : null;

  const attendeeCounts = periodMeetings
    .map(attendeeCount)
    .filter((n) => n > 0);
  const avgAttendees = attendeeCounts.length
    ? Math.round(
        (attendeeCounts.reduce((a, b) => a + b, 0) / attendeeCounts.length) *
          10,
      ) / 10
    : null;

  const byType: EchoStats["breakdown"]["byType"] = [
    {
      label: "Internal",
      value: periodMeetings.filter((m) => m.type === "internal").length,
    },
    {
      label: "Client",
      value: periodMeetings.filter((m) => m.type === "client").length,
    },
  ];

  const statusCounts = new Map<Meeting["status"], number>();
  for (const m of periodMeetings) {
    statusCounts.set(m.status, (statusCounts.get(m.status) ?? 0) + 1);
  }
  const byStatus: EchoStats["breakdown"]["byStatus"] = STATUS_ORDER.filter(
    (s) => (statusCounts.get(s) ?? 0) > 0,
  ).map((s) => ({ label: STATUS_LABEL[s], value: statusCounts.get(s) ?? 0 }));

  let keyPointsTotal = 0;
  let risksTotal = 0;
  let nextStepsTotal = 0;
  for (const m of minutesMeetings) {
    keyPointsTotal += m.minutes?.keyPoints?.length ?? 0;
    risksTotal += m.minutes?.risks?.length ?? 0;
    nextStepsTotal += m.minutes?.nextSteps?.length ?? 0;
  }
  const outcomeMix: EchoStats["breakdown"]["outcomeMix"] = [
    { label: "Decisions", value: decisionsLogged },
    { label: "Actions", value: actionItemsCaptured },
    { label: "Key points", value: keyPointsTotal },
    { label: "Risks", value: risksTotal },
    { label: "Next steps", value: nextStepsTotal },
  ];

  const breakdown: EchoStats["breakdown"] = {
    avgDurationMin,
    avgActionItems,
    avgAttendees,
    byType,
    byStatus,
    outcomeMix,
  };

  // ── Section 6: Hosts (people leaderboard + top clients) ──
  const hostMap = new Map<
    string,
    { name: string; meetings: number; minutes: number }
  >();
  for (const m of periodMeetings) {
    const name = m.hostName?.trim() || "Unattributed";
    const row = hostMap.get(name) ?? { name, meetings: 0, minutes: 0 };
    row.meetings += 1;
    if (m.minutes != null) row.minutes += 1;
    hostMap.set(name, row);
  }
  const leaderboard = [...hostMap.values()]
    .sort((a, b) => b.meetings - a.meetings)
    .slice(0, 8);

  const clientMap = new Map<string, number>();
  for (const m of periodMeetings) {
    const c = m.clientName?.trim();
    if (!c) continue;
    clientMap.set(c, (clientMap.get(c) ?? 0) + 1);
  }
  const topClients = [...clientMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const hosts: EchoStats["hosts"] = { leaderboard, topClients };

  // ── Section 7: AI usage (OpenAI credits) ──
  const periodUsage = allAiUsage.filter((u) => inPeriod(u.createdAt));
  const prevUsage = allAiUsage.filter((u) => inPrevPeriod(u.createdAt));

  const sumCost = (rows: AiUsage[]) =>
    rows.reduce((a, u) => a + (u.costUsd ?? 0), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const opMap = new Map<
    string,
    { operation: string; calls: number; totalTokens: number; costUsd: number }
  >();
  const modelMap = new Map<
    string,
    { model: string; calls: number; totalTokens: number; costUsd: number }
  >();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const u of periodUsage) {
    promptTokens += u.promptTokens ?? 0;
    completionTokens += u.completionTokens ?? 0;
    totalTokens += u.totalTokens ?? 0;

    const op = opMap.get(u.operation) ?? {
      operation: u.operation,
      calls: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    op.calls += 1;
    op.totalTokens += u.totalTokens ?? 0;
    op.costUsd += u.costUsd ?? 0;
    opMap.set(u.operation, op);

    const md = modelMap.get(u.model) ?? {
      model: u.model,
      calls: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    md.calls += 1;
    md.totalTokens += u.totalTokens ?? 0;
    md.costUsd += u.costUsd ?? 0;
    modelMap.set(u.model, md);
  }

  const periodCost = sumCost(periodUsage);
  const ai: EchoStats["ai"] = {
    totalCalls: periodUsage.length,
    totalTokens,
    promptTokens,
    completionTokens,
    costUsd: round2(periodCost),
    costDeltaPct: days ? pctDelta(periodCost, sumCost(prevUsage)) : null,
    byOperation: [...opMap.values()]
      .map((o) => ({ ...o, costUsd: round2(o.costUsd) }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...modelMap.values()]
      .map((m) => ({ ...m, costUsd: round2(m.costUsd) }))
      .sort((a, b) => b.costUsd - a.costUsd),
    costTrend: buildValueTrend(
      periodUsage.map((u) => ({ date: u.createdAt, value: u.costUsd ?? 0 })),
      trendFrom,
      now,
      buckets,
    ),
  };

  return {
    period,
    generatedAt: now.toISOString(),
    kpis,
    impact,
    funnel,
    trends,
    breakdown,
    hosts,
    ai,
  };
}
