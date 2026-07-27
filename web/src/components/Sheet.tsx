import { useRef } from 'react';
import type { Song } from '../api';
import { LineRow } from './LineRow';

interface Props {
  song: Song;
  activeLineId: number | null;
  onSelectLine: (id: number) => void;
  onEditLine: (id: number, text: string) => void;
  onAddLine: (sectionId: number, afterId?: number) => void;
  onDeleteLine: (id: number) => void;
  onMoveLine: (id: number, beforeId: number) => void;
  onRenameSection: (id: number, name: string) => void;
  onAddSection: (afterId?: number) => void;
  onDeleteSection: (id: number) => void;
}

export function Sheet({
  song,
  activeLineId,
  onSelectLine,
  onEditLine,
  onAddLine,
  onDeleteLine,
  onMoveLine,
  onRenameSection,
  onAddSection,
  onDeleteSection,
}: Props) {
  const dragged = useRef<number | null>(null);

  return (
    <div className="sheet">
      {song.sections.map((section) => (
        <section key={section.id} className="sec">
          <header className="sec-head">
            <input
              className="sec-name"
              value={section.name}
              aria-label="Section name"
              onChange={(e) => onRenameSection(section.id, e.target.value)}
            />
            <span className="sec-meta">
              {section.lines.reduce((a, l) => a + l.syllable_count, 0)} syl ·{' '}
              {section.lines.length} {section.lines.length === 1 ? 'line' : 'lines'}
            </span>
            <button className="ghost" onClick={() => onAddSection(section.id)}>
              Add section below
            </button>
            <button
              className="ghost danger"
              onClick={() => onDeleteSection(section.id)}
              title="Deletes the section and its lines. Snapshot first if you want it back."
            >
              Delete section
            </button>
          </header>

          {section.lines.length === 0 ? (
            <p className="empty">
              Nothing here yet.{' '}
              <button className="link" onClick={() => onAddLine(section.id)}>
                Write the first line
              </button>
              .
            </p>
          ) : (
            <ol className="lines">
              {section.lines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  active={line.id === activeLineId}
                  onFocus={() => onSelectLine(line.id)}
                  onChange={(text) => onEditLine(line.id, text)}
                  onSplitBelow={() => onAddLine(section.id, line.id)}
                  onDelete={() => onDeleteLine(line.id)}
                  onDragStart={() => {
                    dragged.current = line.id;
                  }}
                  onDropOn={() => {
                    const from = dragged.current;
                    dragged.current = null;
                    if (from !== null && from !== line.id) onMoveLine(from, line.id);
                  }}
                />
              ))}
            </ol>
          )}

          <button className="ghost add-line" onClick={() => onAddLine(section.id)}>
            Add line
          </button>
        </section>
      ))}

      <button className="ghost add-section" onClick={() => onAddSection()}>
        Add section
      </button>
    </div>
  );
}
