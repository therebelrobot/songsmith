import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusTargetAfterDelete, type FocusSection } from './focus';

test('deleting a middle line focuses the line above it', () => {
  const sections: FocusSection[] = [
    { id: 1, lines: [{ id: 10 }, { id: 11 }, { id: 12 }] },
  ];
  assert.deepEqual(focusTargetAfterDelete(sections, 11), { kind: 'line', id: 10 });
});

test("deleting a section's first line (with lines still in that section) focuses the last line of the previous section", () => {
  const sections: FocusSection[] = [
    { id: 1, lines: [{ id: 10 }, { id: 11 }] },
    { id: 2, lines: [{ id: 20 }, { id: 21 }] },
  ];
  assert.deepEqual(focusTargetAfterDelete(sections, 20), { kind: 'line', id: 11 });
});

test("deleting a section's only line focuses the last line of the previous section", () => {
  const sections: FocusSection[] = [
    { id: 1, lines: [{ id: 10 }, { id: 11 }] },
    { id: 2, lines: [{ id: 20 }] },
  ];
  assert.deepEqual(focusTargetAfterDelete(sections, 20), { kind: 'line', id: 11 });
});

test("deleting the song's only line focuses nothing", () => {
  const sections: FocusSection[] = [{ id: 1, lines: [{ id: 10 }] }];
  assert.equal(focusTargetAfterDelete(sections, 10), null);
});

test('deleting the first line of the first section focuses nothing', () => {
  const sections: FocusSection[] = [
    { id: 1, lines: [{ id: 10 }, { id: 11 }] },
    { id: 2, lines: [{ id: 20 }] },
  ];
  assert.equal(focusTargetAfterDelete(sections, 10), null);
});

test('skips over an empty previous section to find the last line further back', () => {
  const sections: FocusSection[] = [
    { id: 1, lines: [{ id: 10 }] },
    { id: 2, lines: [] },
    { id: 3, lines: [{ id: 30 }] },
  ];
  assert.deepEqual(focusTargetAfterDelete(sections, 30), { kind: 'line', id: 10 });
});
