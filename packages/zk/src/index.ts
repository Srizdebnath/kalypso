import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend } from "@aztec/bb.js";
import { fieldHex, sha256Hex, BN254_P } from "@arkivzk/crypto";
import commitCircuit from "./circuits/commit.js";
import rangeCircuit from "./circuits/range.js";

export const SLOTS = 8;
export const RANGE_CIRCUIT_ID = "arkivzk.range.v1";

type CompiledCircuit = { bytecode: string; abi: any };
const commitC = commitCircuit as unknown as CompiledCircuit;
const rangeC = rangeCircuit as unknown as CompiledCircuit;

let apiPromise: Promise<Barretenberg> | null = null;
/** One shared Barretenberg instance (WASM). Threads are used when the environment allows it. */
export function barretenberg(): Promise<Barretenberg> {
  apiPromise ??= Barretenberg.new();
  return apiPromise;
}
export async function shutdown() {
  if (apiPromise) (await apiPromise).destroy();
  apiPromise = null;
}

const asField = (x: bigint) => {
  if (x < 0n || x >= BN254_P) throw new Error("value out of field");
  return fieldHex(x);
};

function checkFields(fields: bigint[]) {
  if (fields.length !== SLOTS) throw new Error(`exactly ${SLOTS} field slots required`);
}

/** C = Poseidon2(fields[0..8] || salt), computed by executing the Noir commit circuit (same hash as in-proof). */
export async function computeCommitment(fields: bigint[], salt: bigint): Promise<bigint> {
  checkFields(fields);
  const { returnValue } = await new Noir(commitC as any).execute({
    fields: fields.map(asField),
    salt: asField(salt),
  });
  return BigInt(returnValue as string);
}

export type RangeStatement = {
  commitment: bigint;
  slot: number;
  min: bigint;
  max: bigint;
  /** Binds the proof to a context (record key + verifier nonce) so it can't be replayed elsewhere. */
  context: bigint;
};

export type RangeProof = {
  circuitId: typeof RANGE_CIRCUIT_ID;
  proof: Uint8Array;
  publicInputs: string[];
};

export async function proveRange(fields: bigint[], salt: bigint, st: RangeStatement): Promise<RangeProof> {
  checkFields(fields);
  if (st.slot < 0 || st.slot >= SLOTS) throw new Error("slot out of range");
  const { witness } = await new Noir(rangeC as any).execute({
    fields: fields.map(asField),
    salt: asField(salt),
    commitment: asField(st.commitment),
    slot: st.slot,
    min: asField(st.min),
    max: asField(st.max),
    context: asField(st.context),
  });
  const backend = new UltraHonkBackend(rangeC.bytecode, await barretenberg());
  const pd = await backend.generateProof(witness);
  return { circuitId: RANGE_CIRCUIT_ID, proof: pd.proof, publicInputs: pd.publicInputs };
}

let vkCache: Uint8Array | null = null;
export async function rangeVerificationKey(): Promise<Uint8Array> {
  vkCache ??= await new UltraHonkBackend(rangeC.bytecode, await barretenberg()).getVerificationKey();
  return vkCache;
}

export const vkHash = (vk: Uint8Array) => sha256Hex(vk);

/** Public inputs as the circuit lays them out: [commitment, slot, min, max, context]. */
export function statementOf(publicInputs: string[]): RangeStatement {
  if (publicInputs.length !== 5) throw new Error("unexpected public input count");
  const [c, slot, min, max, ctx] = publicInputs.map((x) => BigInt(x));
  return { commitment: c, slot: Number(slot), min, max, context: ctx };
}

export function encodeStatement(st: RangeStatement): string[] {
  return [st.commitment, BigInt(st.slot), st.min, st.max, st.context].map(fieldHex);
}

/**
 * Verify a range proof against an EXPECTED statement and a verification key.
 * Verifier never needs keys or plaintext: only the public commitment from Arkiv.
 */
export async function verifyRange(
  proof: Uint8Array,
  expected: RangeStatement,
  vk: Uint8Array,
): Promise<boolean> {
  const publicInputs = encodeStatement(expected);
  const v = new UltraHonkVerifierBackend(await barretenberg());
  try {
    return await v.verifyProof({ proof, publicInputs, verificationKey: vk });
  } catch {
    return false;
  }
}
