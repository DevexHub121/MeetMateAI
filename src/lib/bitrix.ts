import "server-only";

// Minimal Bitrix24 client for pulling the employee directory via the inbound
// webhook's user.get method. Configured with:
//   BITRIX_WEBHOOK_URL — webhook base, e.g. https://x.bitrix24.in/rest/1/<token>/

export type BitrixEmployee = {
  bitrixId: string;
  name: string;
  email: string | null;
  position: string | null;
};

type BitrixUser = {
  ID?: string;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
  WORK_POSITION?: string;
  ACTIVE?: boolean;
};

type UserGetResponse = {
  result?: BitrixUser[];
  next?: number;
  total?: number;
  error?: string;
  error_description?: string;
};

function base(): string {
  const url = process.env.BITRIX_WEBHOOK_URL;
  if (!url) throw new Error("BITRIX_WEBHOOK_URL is not set");
  return url.endsWith("/") ? url : `${url}/`;
}

function toEmployee(u: BitrixUser): BitrixEmployee | null {
  if (!u.ID) return null;
  const name = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
  return {
    bitrixId: String(u.ID),
    name: name || u.EMAIL || `User ${u.ID}`,
    email: u.EMAIL?.trim() || null,
    position: u.WORK_POSITION?.trim() || null,
  };
}

// Fetch all active employees, following Bitrix's `next` offset pagination
// (50 per page). Returns a de-duplicated list keyed by Bitrix ID.
export async function fetchBitrixEmployees(): Promise<BitrixEmployee[]> {
  const employees = new Map<string, BitrixEmployee>();
  let start = 0;

  // Guard against a runaway loop; 40 pages * 50 = 2000 users is plenty.
  for (let page = 0; page < 40; page++) {
    const url = `${base()}user.get.json?ACTIVE=1&start=${start}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Bitrix user.get failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as UserGetResponse;
    if (data.error) {
      throw new Error(
        `Bitrix error: ${data.error} ${data.error_description ?? ""}`.trim(),
      );
    }

    for (const u of data.result ?? []) {
      const e = toEmployee(u);
      if (e) employees.set(e.bitrixId, e);
    }

    // `next` is the offset of the following page; absent when we're done.
    if (typeof data.next === "number") {
      start = data.next;
    } else {
      break;
    }
  }

  return Array.from(employees.values());
}
