import { requireOrgAdmin } from "@/lib/auth";
import { BOT_NAME_MAX, getBotName } from "@/lib/settings";
import { notetakerVideoOutput } from "@/lib/notetakerTile";
import { NotetakerSettings } from "./NotetakerSettings";

// Org settings — an org admin (or platform owner) only. The server action
// re-checks, since rendering the page is not what grants permission.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireOrgAdmin();
  const botName = await getBotName(user.org?.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Applies to everyone in your workspace.
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
