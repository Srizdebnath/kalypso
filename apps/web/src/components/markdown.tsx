import type { ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Mermaid } from "./mermaid";
import { slugify } from "@/lib/slug";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

function hastText(n: HastNode | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

function nodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return nodeText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** Map links between docs (e.g. `docs/02-architecture.md`, `03-zk.md#x`) to /docs routes. */
function docHref(href: string | undefined): string | undefined {
  if (!href) return href;
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const m = href.match(/(?:^|\/)(\d\d-[\w-]+)\.md(#.*)?$/);
  if (m) return `/docs/${m[1]}${m[2] ?? ""}`;
  return href;
}

/** Relative image paths in docs (e.g. `img/x.png`) are served by /docs/img/[file]. */
function docImgSrc(src: string): string {
  if (/^[a-z]+:/i.test(src) || src.startsWith("/")) return src;
  const m = src.match(/(?:^|\/)img\/([\w.-]+)$/);
  return m ? `/docs/img/${m[1]}` : src;
}

function Anchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="Link to this section"
      className="heading-anchor ml-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
    >
      #
    </a>
  );
}

const components: Components = {
  pre({ node, children }) {
    const code = (node as HastNode | undefined)?.children?.[0];
    const cls = code?.properties?.className;
    const classes = Array.isArray(cls) ? cls.map(String) : [];
    if (code?.tagName === "code" && classes.includes("language-mermaid")) {
      return <Mermaid code={hastText(code).trim()} />;
    }
    return <pre>{children}</pre>;
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
  h2({ children }) {
    const id = slugify(nodeText(children));
    return (
      <h2 id={id} className="group">
        {children}
        <Anchor id={id} />
      </h2>
    );
  },
  h3({ children }) {
    const id = slugify(nodeText(children));
    return (
      <h3 id={id} className="group">
        {children}
        <Anchor id={id} />
      </h3>
    );
  },
  h4({ children }) {
    const id = slugify(nodeText(children));
    return (
      <h4 id={id} className="group">
        {children}
        <Anchor id={id} />
      </h4>
    );
  },
  img({ src, alt }) {
    const url = typeof src === "string" ? docImgSrc(src) : undefined;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt ?? ""} loading="lazy" />;
  },
  a({ href, children }) {
    const h = docHref(href);
    if (h?.startsWith("/")) return <Link href={h}>{children}</Link>;
    const external = h ? /^https?:/i.test(h) : false;
    return (
      <a href={h} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </a>
    );
  },
};

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose-nb">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, plainText: ["mermaid"] }]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
