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
        background: "#101010",
        primaryColor: "#262626",
        primaryTextColor: "#ededed",
        primaryBorderColor: "#8b8b8b",
        secondaryColor: "#272727",
        secondaryBorderColor: "#9d9d9d",
        tertiaryColor: "#161616",
        tertiaryBorderColor: "#4b4b4b",
        lineColor: "#a3a3a3",
        textColor: "#ededed",
        mainBkg: "#262626",
        nodeBorder: "#a3a3a3",
        clusterBkg: "#161616",
        clusterBorder: "#a3a3a3",
        edgeLabelBackground: "#101010",
        actorBkg: "#272727",
        actorBorder: "#a3a3a3",
        actorTextColor: "#ededed",
        actorLineColor: "#a3a3a3",
        signalColor: "#a3a3a3",
        signalTextColor: "#ededed",
        labelBoxBkgColor: "#252525",
        labelBoxBorderColor: "#a3a3a3",
        labelTextColor: "#ededed",
        loopTextColor: "#ededed",
        noteBkgColor: "#252525",
        noteBorderColor: "#a3a3a3",
        noteTextColor: "#ededed",
        activationBkgColor: "#252525",
        activationBorderColor: "#a3a3a3",
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
