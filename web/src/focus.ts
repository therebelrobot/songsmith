/** What `useSong` sets after a mutation so the right element can focus itself once it exists in the DOM. */
export type PendingFocus = { kind: 'line'; id: number } | { kind: 'section'; id: number } | null;

export interface FocusLine {
  id: number;
}

export interface FocusSection {
  id: number;
  lines: readonly FocusLine[];
}

/**
 * Which line should receive focus after deleting `lineId` from `sections`.
 * Backspace-in-empty-line merges into the previous line; deleting a
 * section's first line falls back to the last line of the nearest previous
 * non-empty section; deleting the song's only line (or the first line of
 * the first section) leaves nothing to focus.
 */
export function focusTargetAfterDelete(
  sections: readonly FocusSection[],
  lineId: number,
): { kind: 'line'; id: number } | null {
  const sectionIndex = sections.findIndex((s) => s.lines.some((l) => l.id === lineId));
  if (sectionIndex === -1) return null;
  const section = sections[sectionIndex];
  if (!section) return null;

  const lineIndex = section.lines.findIndex((l) => l.id === lineId);
  if (lineIndex > 0) {
    const prevLine = section.lines[lineIndex - 1];
    return prevLine ? { kind: 'line', id: prevLine.id } : null;
  }

  for (let i = sectionIndex - 1; i >= 0; i--) {
    const prev = sections[i];
    if (!prev || prev.lines.length === 0) continue;
    const lastLine = prev.lines[prev.lines.length - 1];
    if (lastLine) return { kind: 'line', id: lastLine.id };
  }

  return null;
}
