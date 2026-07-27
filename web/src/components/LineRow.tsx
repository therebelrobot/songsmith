import { useEffect, useRef, useState } from 'react';
import type { Line } from '../api';
import { StressLine, Segmentation, scansionLabel } from './Scansion';

interface Props {
  line: Line;
  active: boolean;
  onFocus: () => void;
  onChange: (text: string) => void;
  onSplitBelow: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
}

export function LineRow({
  line,
  active,
  onFocus,
  onChange,
  onSplitBelow,
  onDelete,
  onDragStart,
  onDropOn,
}: Props) {
  const [draft, setDraft] = useState(line.text);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Adopt server text only when this line is not the one being typed in,
  // otherwise an in-flight autosave response would yank the cursor.
  useEffect(() => {
    if (!active) setDraft(line.text);
  }, [line.text, active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const estimated = line.syllables.some((w) => !w.known);

  return (
    <li
      className={`line${active ? ' line-active' : ''}${over ? ' line-over' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropOn();
      }}
    >
      <div className="gutter" title={scansionLabel(line.syllables)}>
        <span className={estimated ? 'count count-guess' : 'count'}>{line.syllable_count}</span>
        <StressLine words={line.syllables} />
      </div>

      <div className="line-body">
        <textarea
          ref={ref}
          className="line-input"
          rows={1}
          value={draft}
          placeholder="…"
          spellCheck
          onFocus={onFocus}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSplitBelow();
            }
            if (e.key === 'Backspace' && draft === '') {
              e.preventDefault();
              onDelete();
            }
          }}
        />
        {active ? <Segmentation words={line.syllables} /> : null}
      </div>

      <span
        className={line.rhyme_label ? 'tab' : 'tab tab-none'}
        title={line.rhyme_key ? `rhymes on ${line.rhyme_key}` : 'last word not in dictionary'}
      >
        {line.rhyme_label ?? '·'}
      </span>

      {line.alternates.length > 0 ? (
        <span className="alt-count" title={`${line.alternates.length} stashed`}>
          {line.alternates.length}
        </span>
      ) : null}
    </li>
  );
}
