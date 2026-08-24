import { requireSuperadmin } from "@/lib/auth";
import { BOT_NAME_MAX, getBotName } from "@/lib/settings";
import { notetakerVideoOutput } from "@/lib/notetakerTile";
import { NotetakerSettings } from "./NotetakerSettings";

// Instance-wide settings, so superadmin only. requireSuperadmin() sends anyone
// else home; the server action re-checks, since rendering the page is not what
// grants permission.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSuperadmin();
  const botName = await getBotName();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Applies to everyone using Echo.
        </p>
      </div>

      <div className="card p-6">
        <NotetakerSettings
          initialName={botName}
          max={BOT_NAME_MAX}
          tileAvailable={notetakerVideoOutput() !== null}
        />
      </div>
    </div>
  );
}
