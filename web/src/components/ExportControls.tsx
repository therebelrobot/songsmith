import { useRef, useState } from 'react';

interface Props {
  onExportChordPro: () => void;
  onExportMidi: () => void;
  onImport: (text: string) => void;
}

/** Export/import/print, kept small and unobtrusive in the song header. */
export function ExportControls({ onExportChordPro, onExportMidi, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="export-controls">
      <button className="ghost" onClick={onExportChordPro} title="Download this song as a ChordPro file">
        .chordpro
      </button>
      <button className="ghost" onClick={onExportMidi} title="Download the chord track as a MIDI file">
        .mid
      </button>
      <button className="ghost" onClick={() => window.print()} title="Print a leadsheet">
        Print
      </button>
      <button className="ghost" onClick={() => setOpen((v) => !v)} title="Import a ChordPro file as a new song">
        Import…
      </button>

      {open ? (
        <div className="export-import-popover">
          <input
            ref={fileRef}
            type="file"
            accept=".chordpro,.cho,.crd,.pro,.txt,text/plain"
            aria-label="Choose a ChordPro file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.text().then(setText);
            }}
          />
          <textarea
            className="export-import-text"
            placeholder="Paste ChordPro text, or choose a file above"
            value={text}
            aria-label="ChordPro text to import"
            rows={6}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="export-import-actions">
            <button
              className="solid"
              disabled={!text.trim()}
              onClick={() => {
                onImport(text);
                setText('');
                setOpen(false);
                if (fileRef.current) fileRef.current.value = '';
              }}
            >
              Import as new song
            </button>
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
