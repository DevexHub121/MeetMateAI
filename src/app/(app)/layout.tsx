import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { HeaderNav } from "@/components/HeaderNav";
import { NottiMark } from "@/components/NottiMark";
import { VoiceTrainingPrompt } from "@/components/VoiceTrainingPrompt";
import { hasVoiceProfile } from "@/lib/voiceProfiles";
import { RecordingSessionProvider } from "@/components/RecordingSession";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();
  // One indexed boolean — drives the first-run nudge to record a voice profile.
  const enrolled = await hasVoiceProfile(user.id);

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[rgba(24,24,24,0.8)] backdrop-blur-md">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/meetings" className="group flex items-center gap-2.5">
            <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] shadow-sm">
              <NottiMark size={19} />
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[15px] font-semibold tracking-tight text-[var(--color-heading)]">
                Notti
              </span>
              {user.org && (
                <span className="hidden text-xs font-medium text-[var(--color-text-muted)] sm:inline">
                  {user.org.name}
                </span>
              )}
            </span>
          </Link>
          <HeaderNav user={user} initials={initials} logoutUrl="/logout" />
        </div>
      </header>
      {/* Inside the layout, so it survives every navigation the layout survives —
          which is what lets a recording keep running while you read another
          meeting's notes. */}
      <RecordingSessionProvider>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="animate-fade-in-up">{children}</div>
        </main>
      </RecordingSessionProvider>
      <VoiceTrainingPrompt hasProfile={enrolled} />
    </div>
  );
}
