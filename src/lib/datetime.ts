// Server components render in the host's timezone (UTC on DigitalOcean), which
// made recording timestamps look wrong. Force IST (Asia/Kolkata) everywhere so
// dates/times match what the team expects, regardless of server TZ.

export function formatIST(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function formatISTDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
}
