import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Check, BellRing, Mail, Send } from "lucide-react";
import * as api from "@/modules/subtracker/services/api";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";

/**
 * Email preferences page — fine-grained per-channel opt in/out plus a
 * "send me a sample" button so users can verify the digest looks right
 * before they wait for the cron.
 *
 * Layout mirrors the email design: dark glass cards, gradient hero,
 * primary actions glowing violet.
 *
 * Routed at `/settings/email`. Reachable from the email footer link
 * and from the dashboard avatar menu.
 */
export function EmailSettingsPage() {
  const [prefs, setPrefs]     = useState<api.EmailPrefs | null>(null);
  const [busy, setBusy]       = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.getEmailPrefs().then(setPrefs).catch(() => setPrefs(null));
  }, []);

  async function update(patch: Partial<api.EmailPrefs>) {
    if (!prefs) return;
    setBusy(true);
    setPrefs({ ...prefs, ...patch });
    try {
      const next = await api.updateEmailPrefs(patch);
      setPrefs(next);
      setSavedAt(Date.now());
    } catch (e) {
      alert((e as Error).message);
      // Refresh to recover from drift.
      void api.getEmailPrefs().then(setPrefs).catch(() => {});
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      await api.sendTestReminder();
      setTestMsg("Sent! Check your inbox in a moment.");
    } catch (e) {
      setTestMsg((e as Error).message || "Could not send a test email.");
    } finally { setTesting(false); }
  }

  if (!prefs) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={20} className="text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[640px] h-[640px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute -top-32 -right-24 w-[480px] h-[480px] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <header className="relative sticky top-0 z-20 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60">
        <div className="max-w-[820px] mx-auto px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/")}
                  className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70"
                  title="Back to dashboard">
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-base font-semibold text-zinc-100">Email preferences</h1>
          <span className="ml-auto text-xs text-zinc-500 inline-flex items-center gap-1">
            {busy && <><Loader2 size={11} className="animate-spin" /> saving</>}
            {!busy && savedAt && Date.now() - savedAt < 3000 && <><Check size={11} className="text-emerald-400" /> saved</>}
          </span>
        </div>
      </header>

      <div className="relative max-w-[820px] mx-auto px-6 py-8 flex flex-col gap-5">
        {/* Hero blurb */}
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-violet-500/10 via-zinc-900 to-zinc-950 p-6">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">Email</div>
          <h2 className="text-zinc-100 text-2xl font-semibold tracking-tight">
            Choose what lands in your inbox
          </h2>
          <p className="text-sm text-zinc-400 mt-2 max-w-xl">
            Each channel toggles separately. Unsubscribing in an email footer mutes that one
            channel. You can re-enable any time here without re-signup.
          </p>
        </div>

        {/* Daily reminder digest */}
        <PrefCard
          icon={<BellRing size={16} className="text-violet-300" />}
          title="Daily reminder digest"
          subtitle="A once-a-day email of credit-card statements, subscriptions, EMIs and rent due in your chosen window. Skipped if there's nothing due."
          enabled={prefs.reminders_enabled}
          onToggle={v => update({ reminders_enabled: v })}
          extras={
            <>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Look-ahead window</span>
                <select
                  className="bg-zinc-950 border border-zinc-700/70 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-violet-500/60"
                  value={prefs.reminders_horizon_days}
                  onChange={e => update({ reminders_horizon_days: Number(e.target.value) })}
                  disabled={!prefs.reminders_enabled || busy}
                >
                  {[3, 5, 7, 10, 14, 21, 30].map(d => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={sendTest}
                  disabled={testing || !prefs.reminders_enabled}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    prefs.reminders_enabled
                      ? "bg-violet-500/15 text-violet-200 border border-violet-500/30 hover:bg-violet-500/25"
                      : "bg-zinc-800/40 text-zinc-500 border border-zinc-700",
                  )}
                >
                  {testing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Send a test to my inbox
                </button>
                {testMsg && <span className="text-[11px] text-zinc-400">{testMsg}</span>}
              </div>

              {prefs.reminders_last_sent_at && (
                <div className="text-[11px] text-zinc-500 mt-2">
                  Last sent: <span className="num text-zinc-300">{new Date(prefs.reminders_last_sent_at).toLocaleString()}</span>
                </div>
              )}
            </>
          }
        />

        {/* Tracker invite emails */}
        <PrefCard
          icon={<Mail size={16} className="text-violet-300" />}
          title="Expense Tracker invites"
          subtitle="When a friend adds you to an Expense Tracker, we email a magic-link that opens it without signup. Mute this if invites are noisy or you only join from inside the app."
          enabled={prefs.invite_emails_enabled}
          onToggle={v => update({ invite_emails_enabled: v })}
          extras={!prefs.invite_emails_enabled ? (
            <p className="text-[11px] text-amber-300 mt-2 inline-flex items-center gap-1">
              <Check size={11} /> You'll still see invites inside the app — only the email is muted.
            </p>
          ) : null}
        />

        {/* Account / system mail (always on) */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-zinc-300">Account & security mail</h3>
          <p className="text-[12px] text-zinc-500 mt-1">
            Email confirmations, password resets, and security alerts always go through — they're not
            marketing and can't be muted. Reply to <span className="text-zinc-300">support@subtracker.app</span> if
            you want your account fully deleted.
          </p>
        </div>
      </div>
    </div>
  );
}

function PrefCard({ icon, title, subtitle, enabled, onToggle, extras }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  extras?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 backdrop-blur-sm p-5 transition-colors hover:border-violet-500/30">
      <div className="flex items-start gap-4">
        <span className="h-9 w-9 rounded-lg bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            <Toggle checked={enabled} onChange={onToggle} />
          </div>
          <p className="text-[12.5px] text-zinc-400 mt-1">{subtitle}</p>
          {extras}
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-violet-500" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
