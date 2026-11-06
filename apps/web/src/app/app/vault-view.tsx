"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getRecord,
  listRecords,
  putRecord,
  type DecryptedRecord,
  type PutResult,
} from "@/lib/arkivzk-client";
import { downloadBlob, errorMessage, formatBytes } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { Button, Card, ErrorBox, Field, KV, Loading, cx } from "@/components/ui";
import { HashLine } from "@/components/copy-button";
import { StepLog } from "@/components/step-list";
import { RecordsPanel } from "./records-panel";

const SCHEMA_ID = "medical.v1";
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const DAY = 86_400;
const RETENTION = [
  { label: "5 min (demo)", seconds: 300 },
  { label: "1 day", seconds: DAY },
  { label: "7 days", seconds: 7 * DAY },
  { label: "30 days", seconds: 30 * DAY },
  { label: "180 days", seconds: 180 * DAY },
];

export function VaultView() {
  const records = useAsync(listRecords);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <CreateRecord onCreated={records.reload} />
      <div className="min-w-0 space-y-8">
        <RecordsPanel state={records} selected={selected} onSelect={setSelected} />
        {selected && <RecordViewer key={selected} entityKey={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ create */

function CreateRecord({ onCreated }: { onCreated: () => void }) {
  const [age, setAge] = useState("");
  const [country, setCountry] = useState("");
  const [bloodGroup, setBloodGroup] = useState(BLOOD_GROUPS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [retentionSeconds, setRetentionSeconds] = useState(7 * DAY);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PutResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const ageNum = Number(age);
  const ageValid = age.trim() !== "" && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 150;
  const countryValid = country.trim().length > 0;
  const canSubmit = ageValid && countryValid && !running;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setRunning(true);
    setSteps([]);
    setError(null);
    setResult(null);
    try {
      const res = await putRecord(
        {
          schemaId: SCHEMA_ID,
          values: { age: ageNum, country: country.trim(), bloodGroup },
          file: file ?? undefined,
          retentionSeconds,
        },
        (s) => setSteps((prev) => [...prev, s]),
      );
      setResult(res);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setAge("");
    setCountry("");
    setBloodGroup(BLOOD_GROUPS[0]);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setSteps([]);
    setResult(null);
    setError(null);
  }

  return (
    <Card className="self-start p-0">
      <div className="border-b-[3px] border-ink bg-cyan p-5">
        <p className="font-mono text-xs font-bold uppercase">new record · {SCHEMA_ID}</p>
        <h2 className="text-2xl font-bold">Store a medical record</h2>
        <p className="mt-1 text-sm">Encrypted on this device before anything is sent.</p>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Age" htmlFor="age" hint={age && !ageValid ? "Whole number 0–150" : undefined}>
            <input
              id="age"
              className="nb-input"
              inputMode="numeric"
              type="number"
              min={0}
              max={150}
              step={1}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              disabled={running}
              required
            />
          </Field>
          <Field label="Blood group" htmlFor="bloodGroup">
            <select
              id="bloodGroup"
              className="nb-input"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              disabled={running}
            >
              {BLOOD_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Country" htmlFor="country" hint="e.g. IN">
          <input
            id="country"
            className="nb-input"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={running}
            required
          />
        </Field>
        <Field label="Attachment (optional)" htmlFor="file" hint="Encrypted, then stored on Swarm.">
          <input
            id="file"
            ref={fileInput}
            type="file"
            className="nb-input cursor-pointer file:mr-3 file:border-2 file:border-ink file:bg-yellow file:px-2 file:py-0.5 file:font-sans file:font-bold"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={running}
          />
          {file && <p className="mt-1 font-mono text-xs">{file.name} · {formatBytes(file.size)}</p>}
        </Field>
        <fieldset>
          <legend className="nb-label">Retention</legend>
          <div className="grid grid-cols-3 gap-2">
            {RETENTION.map((r) => (
              <button
                key={r.seconds}
                type="button"
                onClick={() => setRetentionSeconds(r.seconds)}
                disabled={running}
                aria-pressed={retentionSeconds === r.seconds}
                className={cx(
                  "border-[3px] border-ink px-2 py-2 text-sm font-bold",
                  retentionSeconds === r.seconds ? "bg-yellow shadow-brutal-sm" : "bg-white hover:bg-paper",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs opacity-70">
            The Arkiv entity expires after this. Expiry alone isn&apos;t erasure; shred to destroy the keys.
          </p>
        </fieldset>

        <Button type="submit" tone="ink" size="lg" className="w-full" disabled={!canSubmit}>
          {running ? "Encrypting & writing…" : "Encrypt & store"}
        </Button>

        <StepLog lines={steps} running={running} />
        {error && <ErrorBox title="Could not store record" error={error} />}
        {result && (
          <div className="nb-border bg-lime p-4">
            <p className="font-bold">Stored. Only ciphertext and a commitment are on Arkiv.</p>
            <dl className="mt-2">
              <KV k="Entity key"><HashLine value={result.entityKey} /></KV>
              <KV k="Tx hash"><HashLine value={result.txHash} /></KV>
              <KV k="Commitment">{result.commitment}</KV>
              <KV k="Expires at block">{result.expiresAtBlock}</KV>
              {result.swarmRef && <KV k="Swarm ref">{result.swarmRef}</KV>}
            </dl>
            <Button type="button" tone="white" size="sm" className="mt-3" onClick={reset}>
              New record
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ viewer */

function RecordViewer({ entityKey, onClose }: { entityKey: string; onClose: () => void }) {
  const { data, error, loading, reload } = useAsync<DecryptedRecord>(() => getRecord(entityKey), entityKey);

  return (
    <Card className="p-0">
      <div className="flex items-start justify-between gap-3 border-b-[3px] border-ink bg-yellow p-4">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase">decrypted on this device</p>
          <p className="break-all font-mono text-sm">{entityKey}</p>
        </div>
        <Button size="sm" tone="white" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="p-5">
        {loading && <Loading label="Reassembling key and decrypting" />}
        {error && <ErrorBox title="Could not decrypt" error={error} onRetry={reload} />}
        {data && (
          <>
            <dl>
              {Object.entries(data.values).map(([k, v]) => (
                <KV key={k} k={k}>
                  {String(v)}
                </KV>
              ))}
            </dl>
            {data.file && <FileAttachment file={data.file} />}
            <p className="mt-4 text-xs">
              Plaintext exists only in this browser tab. Close this panel when you&apos;re done.
            </p>
          </>
        )}
        <p className="mt-4 text-sm">
          <Link href="/app/shred" className="font-bold underline">
            Done with it? Shred it →
          </Link>
        </p>
      </div>
    </Card>
  );
}

function FileAttachment({ file }: { file: NonNullable<DecryptedRecord["file"]> }) {
  const img = useRef<HTMLImageElement>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage || !img.current) return;
    const u = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
    img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);

  return (
    <div className="mt-4 nb-border bg-paper p-4">
      <p className="nb-label">Attachment (from Swarm)</p>
      <p className="font-mono text-sm">
        {file.name} · {file.type || "unknown type"} · {formatBytes(file.bytes.byteLength)}
      </p>
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} alt={file.name} className="mt-3 max-h-72 border-[3px] border-ink" />
      )}
      <Button
        size="sm"
        tone="white"
        className="mt-3"
        onClick={() =>
          downloadBlob(file.name, new Blob([file.bytes as BlobPart], { type: file.type || "application/octet-stream" }))
        }
      >
        Download
      </Button>
    </div>
  );
}
