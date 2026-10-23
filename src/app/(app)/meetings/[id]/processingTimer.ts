export function processingStartKey(meetingId: string): string {
  return `meetmate:processing-start:${meetingId}`;
}
