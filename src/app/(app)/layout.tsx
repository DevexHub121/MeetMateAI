import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { HeaderNav } from "@/components/HeaderNav";
import Image from "next/image";
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
    /*
     * app-light carries the dashboard's paper theme. Scoped to this wrapper
     * rather than :root so the marketing site and the dark screens that have
     * not been redesigned yet are both left alone.
     */
    <div className="app-light flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-30"
        style={{
          background: "rgba(244,244,242,.85)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--d-border)",
        }}
      >
        <div className="relative mx-auto flex max-w-[1152px] items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/meetings" className="group flex items-center gap-2.5">
            <Image src="/brand/meetmate-mark.png" alt="" width={39} height={30} className="h-[30px] w-auto" priority />
            <Image src="/brand/meetmate-wordmark.png" alt="MeetMate" width={106} height={17} className="h-[17px] w-auto" priority />
            {user.org && (
              <span
                className="hidden pl-2.5 text-xs font-medium text-[var(--d-muted)] sm:inline"
                style={{ borderLeft: "1px solid var(--d-border)" }}
              >
                {user.org.name}
              </span>
            )}
          </Link>
          <HeaderNav user={user} initials={initials} logoutUrl="/logout" />
        </div>
      </header>
      {/* Inside the layout, so it survives every navigation the layout survives —
          which is what lets a recording keep running while you read another
          meeting's notes. */}
      <RecordingSessionProvider>
        <main className="mx-auto w-full max-w-[1152px] flex-1 px-6 pt-10 pb-16">
          <div className="animate-fade-in-up">{children}</div>
        </main>
      </RecordingSessionProvider>
      <VoiceTrainingPrompt hasProfile={enrolled} />
    </div>
  );
}
