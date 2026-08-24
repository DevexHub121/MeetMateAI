import Link from "next/link";
import { NewMeetingForm } from "./NewMeetingForm";
import { listSavedParticipants } from "@/lib/participants";
import { listEmployees } from "@/lib/employees";
import { recallEnabled } from "@/lib/recall";

export const dynamic = "force-dynamic";

export default async function NewMeetingPage() {
  const [saved, employees] = await Promise.all([
    listSavedParticipants(),
    listEmployees(),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/meetings"
        className="mb-4 inline-block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
      >
        ← Back to meetings
      </Link>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          New meeting
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Add participants, then start recording now or schedule it for later.
        </p>
      </div>
      <NewMeetingForm
        noteTakerEnabled={recallEnabled()}
        saved={saved.map((s) => ({ id: s.id, name: s.name, email: s.email }))}
        employees={employees
          .filter((e) => e.active && e.email)
          .map((e) => ({
            id: e.id,
            name: e.name,
            email: e.email as string,
            position: e.position,
          }))}
      />
    </div>
  );
}
