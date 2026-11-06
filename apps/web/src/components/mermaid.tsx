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
        primaryColor: "#ffe14d",
        primaryTextColor: "#0a0a0a",
        primaryBorderColor: "#0a0a0a",
        secondaryColor: "#6ee7f2",
        secondaryBorderColor: "#0a0a0a",
        tertiaryColor: "#fffbea",
        tertiaryBorderColor: "#0a0a0a",
        lineColor: "#0a0a0a",
        textColor: "#0a0a0a",
        mainBkg: "#ffe14d",
        nodeBorder: "#0a0a0a",
        clusterBkg: "#fffbea",
        clusterBorder: "#0a0a0a",
        edgeLabelBackground: "#ffffff",
        actorBkg: "#6ee7f2",
        actorBorder: "#0a0a0a",
        actorTextColor: "#0a0a0a",
        actorLineColor: "#0a0a0a",
        signalColor: "#0a0a0a",
        signalTextColor: "#0a0a0a",
        labelBoxBkgColor: "#ff7ac6",
        labelBoxBorderColor: "#0a0a0a",
        labelTextColor: "#0a0a0a",
        loopTextColor: "#0a0a0a",
        noteBkgColor: "#b8f26b",
        noteBorderColor: "#0a0a0a",
        noteTextColor: "#0a0a0a",
        activationBkgColor: "#ff7ac6",
        activationBorderColor: "#0a0a0a",
        sequenceNumberColor: "#ffffff",
        fontSize: "15px",
      },
      themeCSS: `
        .node rect, .node polygon, .node circle, .cluster rect, .actor, rect.note,
        .stateGroup rect, .statediagram-state rect { stroke-width: 2.5px !important; }
        .edgePath .path, .flowchart-link, .messageLine0, .messageLine1 { stroke-width: 2px !important; }
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
    <figure className="nb-card mb-6 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b-[3px] border-ink bg-cyan px-3 py-1.5">
        <span className="font-mono text-xs font-bold uppercase">diagram</span>
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="font-mono text-xs font-bold underline decoration-2"
        >
          {showSource ? "hide source" : "source"}
        </button>
      </div>
      <div className="mermaid-box overflow-x-auto bg-white p-4">
        {error ? (
          <p className="font-mono text-sm text-danger">Could not render diagram: {error}</p>
        ) : svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="font-mono text-sm opacity-60">rendering diagram…</p>
        )}
      </div>
      {(showSource || error) && (
        <pre className="m-0 overflow-x-auto border-t-[3px] border-ink bg-ink p-4 font-mono text-xs text-paper">
          {code}
        </pre>
      )}
    </figure>
  );
}
