"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  exportRecoveryKit,
  getSignerMode,
  restoreFromKit,
  setSignerMode,
  type SignerMode,
} from "@/lib/arkivzk-client";
import { downloadBlob, errorMessage } from "@/lib/format";
import { Button, Card, ErrorBox, Field, cx } from "@/components/ui";
import { StepLog } from "@/components/step-list";

const MIN_PASS = 12;

export function SettingsView() {
  return (
    <div className="space-y-8">
      <SignerModeCard />
      <div className="grid gap-8 lg:grid-cols-2">
        <ExportKit />
        <RestoreKit />
      </div>
    </div>
  );
}

function ExportKit() {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = pass.length > 0 && pass.length < MIN_PASS;
  const mismatch = pass2.length > 0 && pass !== pass2;
  const ok = pass.length >= MIN_PASS && pass === pass2 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const json = await exportRecoveryKit(pass);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(`arkivzk-recovery-kit-${date}.json`, new Blob([json], { type: "application/json" }));
      setDone(true);
      setPass("");
      setPass2("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="self-start p-0">
      <div className="border-b-[3px] border-ink bg-yellow p-5">
        <p className="font-mono text-xs font-bold uppercase">recovery</p>
        <h2 className="text-2xl font-bold">Export recovery kit</h2>
        <p className="mt-1 text-sm">
          Your device key share, encrypted with a passphrase. Lets you restore your vault on a new
          device.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label={`Passphrase (min ${MIN_PASS} characters)`} htmlFor="kit-pass" hint={tooShort ? `${pass.length}/${MIN_PASS} characters` : undefined}>
          <input
            id="kit-pass"
            className="nb-input"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Repeat passphrase" htmlFor="kit-pass2" hint={mismatch ? "Passphrases don't match" : undefined}>
          <input
            id="kit-pass2"
            className="nb-input"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            disabled={busy}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-black" checked={show} onChange={(e) => setShow(e.target.checked)} />
          show passphrase
        </label>
        <div className="nb-border bg-[#eaeaea] p-3 text-sm">
          <p className="font-bold">A kit is key material outside Kalypso&apos;s reach.</p>
          <p className="mt-1">
            Shredding a record can&apos;t delete copies of this file. If you shred later, destroy old
            kits too.
          </p>
        </div>
        <Button type="submit" tone="ink" size="lg" className="w-full" disabled={!ok}>
          {busy ? "Encrypting kit…" : "Export & download"}
        </Button>
        {error && <ErrorBox title="Export failed" error={error} />}
        {done && <p className="nb-border bg-lime p-3 font-bold">Kit downloaded. Store it somewhere safe and offline.</p>}
      </form>
    </Card>
  );
}

function RestoreKit() {
  const [kit, setKit] = useState<{ name: string; text: string } | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string[] | null>(null);

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return setKit(null);
    try {
      setKit({ name: file.name, text: await file.text() });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kit || !pass) return;
    setBusy(true);
    setSteps([]);
    setError(null);
    setRestored(null);
    try {
      setRestored(await restoreFromKit(kit.text, pass, (s) => setSteps((p) => [...p, s])));
      setPass("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="self-start p-0">
      <div className="border-b-[3px] border-ink bg-cyan p-5">
        <p className="font-mono text-xs font-bold uppercase">recovery</p>
        <h2 className="text-2xl font-bold">Restore from recovery kit</h2>
        <p className="mt-1 text-sm">Rebuild this device&apos;s vault from a kit you exported earlier.</p>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label="Kit file (.json)" htmlFor="kit-file">
          <input
            id="kit-file"
            type="file"
            accept="application/json,.json"
            className="nb-input cursor-pointer file:mr-3 file:border-2 file:border-ink file:bg-yellow file:px-2 file:py-0.5 file:font-sans file:font-bold"
            onChange={(e) => pick(e.target.files?.[0])}
            disabled={busy}
          />
          {kit && <p className="mt-1 font-mono text-xs">{kit.name}</p>}
        </Field>
        <Field label="Passphrase" htmlFor="kit-restore-pass">
          <input
            id="kit-restore-pass"
            className="nb-input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Button type="submit" tone="ink" size="lg" className="w-full" disabled={!kit || !pass || busy}>
          {busy ? "Restoring…" : "Restore"}
        </Button>
        <StepLog lines={steps} running={busy} />
        {error && <ErrorBox title="Restore failed" error={error} />}
        {restored && (
          <div className="nb-border bg-lime p-4">
            <p className="font-bold">
              Recovered {restored.length} record{restored.length === 1 ? "" : "s"}.
            </p>
            {restored.length > 0 && (
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {restored.map((k) => (
                  <li key={k} className="break-all">
                    {k}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/app" className="nb-btn mt-3 bg-white px-2.5 py-1 text-xs">
              Open Vault →
            </Link>
          </div>
        )}
      </form>
    </Card>
  );
}

const MODES: { mode: SignerMode; label: string; desc: string }[] = [
  {
    mode: "wallet",
    label: "Your wallet",
    desc: "Your wallet signs and owns each record entity. Simple, but your address is visibly linked to every record.",
  },
  {
    mode: "ephemeral",
    label: "One-time signer via relayer",
    desc: "A fresh key per record, with gas paid by a shared relayer pool, so your wallet address does not appear as the owner.",
  },
];

function SignerModeCard() {
  const [mode, setMode] = useState<SignerMode>(() => getSignerMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(m: SignerMode) {
    if (m === mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setSignerMode(m);
      setMode(getSignerMode());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b-[3px] border-ink bg-pink p-5">
        <p className="font-mono text-xs font-bold uppercase">privacy</p>
        <h2 className="text-2xl font-bold">Signer for new records</h2>
        <p className="mt-1 text-sm">
          Who appears as the owner on Arkiv. Existing records keep their owner; this only affects
          records you create from now on.
        </p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2" role="radiogroup" aria-label="Signer for new records">
        {MODES.map((m) => {
          const on = mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => choose(m.mode)}
              className={cx(
                "border-[3px] border-ink p-4 text-left transition-transform",
                on ? "bg-yellow shadow-brutal" : "bg-white hover:-translate-y-0.5",
              )}
            >
              <span className="flex items-center gap-2 font-bold">
                <span className={cx("grid h-5 w-5 place-items-center border-[3px] border-ink", on ? "bg-ink" : "bg-white")} />
                {m.label}
              </span>
              <span className="mt-2 block text-sm">{m.desc}</span>
            </button>
          );
        })}
      </div>
      {(busy || error) && (
        <div className="px-5 pb-5">
          {busy && <p className="font-mono text-sm">Switching…</p>}
          {error && <ErrorBox title="Could not switch signer" error={error} />}
        </div>
      )}
    </Card>
  );
}
