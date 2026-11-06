"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { connectWallet, currentAccount } from "@/lib/arkivzk-client";
import { errorMessage } from "@/lib/format";

type WalletState = {
  address: `0x${string}` | null;
  checking: boolean;
  connecting: boolean;
  checkError: string | null;
  connectError: string | null;
  connect: () => Promise<void>;
  /** Record picked in one tab (e.g. Vault → "Prove") and preselected in another. */
  focusRecord: string | null;
  setFocusRecord: (k: string | null) => void;
};

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [focusRecord, setFocusRecord] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    currentAccount()
      .then((a) => {
        if (!cancelled) setAddress(a);
      })
      .catch((e) => {
        if (!cancelled) setCheckError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const { address } = await connectWallet();
      setAddress(address);
    } catch (e) {
      setConnectError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  return (
    <Ctx.Provider
      value={{ address, checking, connecting, checkError, connectError, connect, focusRecord, setFocusRecord }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
