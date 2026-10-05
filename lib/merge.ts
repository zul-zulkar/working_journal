import type { JournalData } from "./types";

// ── Three-way merge for multi-device editing ────────────────────────────────
// Saves are whole-document, so when two devices edit at once the server refuses
// the later save (409, stale revision) and hands back its current data. The
// client folds its own changes — relative to the snapshot it last synced
// (`base`) — onto that server copy, record by record (by id):
//   • added here            → kept
//   • edited here           → our version wins
//   • deleted here          → stays deleted
//   • untouched here        → server version (their edits / adds / deletes)
//   • edited here, deleted there → kept (never silently drop a fresh edit)

/** Stable JSON: sorted keys, undefined dropped — for equality checks. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        if ((val as Record<string, unknown>)[k] !== undefined) out[k] = (val as Record<string, unknown>)[k];
      }
      return out;
    }
    return val;
  });
}

export function sameData(a: JournalData, b: JournalData): boolean {
  return canon(a) === canon(b);
}

function mergeById<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
  addedAtFront: boolean,
): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const editedHere = (x: T) => {
    const o = b.get(x.id);
    return !o || canon(o) !== canon(x);
  };

  const added = local.filter((x) => !b.has(x.id) && !r.has(x.id));
  const out: T[] = addedAtFront ? [...added] : [];
  for (const rx of remote) {
    const lx = l.get(rx.id);
    if (!b.has(rx.id)) {
      // New on the server (or, rarely, created on both sides with one id).
      out.push(lx && editedHere(lx) ? lx : rx);
      continue;
    }
    if (!lx) continue; // deleted here
    out.push(editedHere(lx) ? lx : rx);
  }
  for (const lx of local) {
    if (b.has(lx.id) && !r.has(lx.id) && editedHere(lx)) out.push(lx);
  }
  if (!addedAtFront) out.push(...added);
  return out;
}

export function mergeJournal(base: JournalData, local: JournalData, remote: JournalData): JournalData {
  return {
    // New activities are unshifted in the UI; new categories / groups appended.
    activities: mergeById(base.activities, local.activities, remote.activities, true),
    categories: mergeById(base.categories, local.categories, remote.categories, false),
    groups: mergeById(base.groups || [], local.groups || [], remote.groups || [], false),
  };
}
