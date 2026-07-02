import type { CSSProperties } from "react";

// Convert an inline "prop:val;prop2:val2" CSS string (as produced by the ported
// prototype logic) into a React style object.
export function parseStyle(css: string): CSSProperties {
  const out: Record<string, string> = {};
  css.split(";").forEach((decl) => {
    const idx = decl.indexOf(":");
    if (idx < 0) return;
    const key = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!key) return;
    const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = val;
  });
  return out as CSSProperties;
}
