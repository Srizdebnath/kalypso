"use client";

import { useEffect, useId, useState } from "react";

let initialized = false;

async function loadMermaid() {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        background: "#ffffff",
        primaryColor: "#f5f5f5",
        primaryTextColor: "#111111",
        primaryBorderColor: "#a3a3a3",
        secondaryColor: "#fafafa",
        secondaryBorderColor: "#a3a3a3",
        tertiaryColor: "#fafafa",
        tertiaryBorderColor: "#d4d4d4",
        lineColor: "#737373",
        textColor: "#111111",
        mainBkg: "#f5f5f5",
        nodeBorder: "#737373",
        clusterBkg: "#fafafa",
        clusterBorder: "#737373",
        edgeLabelBackground: "#ffffff",
        actorBkg: "#fafafa",
        actorBorder: "#737373",
        actorTextColor: "#111111",
        actorLineColor: "#737373",
        signalColor: "#737373",
        signalTextColor: "#111111",
        labelBoxBkgColor: "#f5f5f5",
        labelBoxBorderColor: "#737373",
        labelTextColor: "#111111",
        loopTextColor: "#111111",
        noteBkgColor: "#f5f5f5",
        noteBorderColor: "#737373",
        noteTextColor: "#111111",
        activationBkgColor: "#f5f5f5",
        activationBorderColor: "#737373",
        sequenceNumberColor: "#ffffff",
        fontSize: "15px",
      },
      themeCSS: `
        .node rect, .node polygon, .node circle, .cluster rect, .actor, rect.note,
        .stateGroup rect, .statediagram-state rect { stroke-width: 1.25px !important; }
        .edgePath .path, .flowchart-link, .messageLine0, .messageLine1 { stroke-width: 1.25px !important; }
      `,
      flowchart: { curve: "linear", htmlLabels: true },
      sequence: { mirrorActors: false },
    });
    initialized = true;
  }
  return mermaid;
}

/** Renders a mermaid diagram client-side; shows the source on failure. */
export function Mermaid({ code }: { code: string }) {
  const id = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        // mermaid leaves an error element in the body on failure
        document.getElementById("d" + id)?.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <figure className="mb-6 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-1.5 text-[#525252]">
        <span className="font-mono text-xs font-bold uppercase">diagram</span>
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="font-mono text-xs font-bold underline decoration-2"
        >
          {showSource ? "hide source" : "source"}
        </button>
      </div>
      <div className="mermaid-box overflow-x-auto bg-[#fff] p-4">
        {error ? (
          <p className="font-mono text-sm text-danger">Could not render diagram: {error}</p>
        ) : svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="font-mono text-sm opacity-60">rendering diagram…</p>
        )}
      </div>
      {(showSource || error) && (
        <pre className="m-0 overflow-x-auto border-t border-[#e5e5e5] bg-[#fafafa] p-4 font-mono text-xs text-[#262626]">
          {code}
        </pre>
      )}
    </figure>
  );
}
