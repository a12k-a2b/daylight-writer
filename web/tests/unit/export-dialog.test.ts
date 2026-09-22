/**
 * tests/unit/export-dialog.test.ts
 * Unit tests for Sol:OS Grayscale Export & Share Modal Dialog (F60)
 */

import test from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { ExportDialog, FORMAT_OPTIONS } from '../../src/ui/export-dialog.ts';
import { ExportService } from '../../src/export/export-service.ts';
import { ShareService } from '../../src/export/share-service.ts';
import type { DocumentRecord, ThoughtNoteRecord } from '../../src/storage/schema.ts';

function setupEnvironment() {
  const win = new Window();
  const doc = win.document;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).KeyboardEvent = win.KeyboardEvent;

  const shell = doc.createElement('div');
  shell.className = 'dc1-shell';
  doc.body.appendChild(shell);

  const shareService = new ShareService();
  const exportService = new ExportService(shareService);

  return { win, doc, shell, exportService, shareService };
}

function createSampleDoc(): DocumentRecord {
  return {
    id: 'doc_modal_test',
    title: 'Dialog Test Manuscript',
    content: 'Testing modal rendering and user interaction flows on LivePaper.',
    is_title_custom: true,
    format_version: 1,
    sync_status: 'synced',
    created_at: 1700000000000,
    updated_at: 1700005000000,
    deleted_at: null,
  };
}

function createSampleNotes(): ThoughtNoteRecord[] {
  return [
    {
      id: 'n1',
      document_id: 'doc_modal_test',
      paragraph_anchor_id: 'p-0',
      content: 'Modal test note.',
      created_at: 1700001000000,
      updated_at: 1700001000000,
      deleted_at: null,
    },
  ];
}

test('ExportDialog: Renders accessible dialog structure with 6 format tiles and ARIA markup', async () => {
  const { shell, exportService, shareService } = setupEnvironment();
  const dialog = new ExportDialog({
    exportService,
    shareService,
    shellElement: shell as any,
  });

  const doc = createSampleDoc();
  const notes = createSampleNotes();
  await dialog.open(doc, notes, ['testing']);

  assert.strictEqual(dialog.isOpen, true);
  assert.ok(dialog.dialogEl !== null);
  assert.strictEqual(dialog.dialogEl?.getAttribute('role'), 'dialog');
  assert.strictEqual(dialog.dialogEl?.getAttribute('aria-modal'), 'true');

  const tiles = dialog.dialogEl?.querySelectorAll('.export-format-tile');
  assert.strictEqual(tiles?.length, 6);
  assert.strictEqual(FORMAT_OPTIONS.length, 6);

  // Default selection is markdown ('md')
  assert.strictEqual(dialog.selectedFormat, 'md');
  const activeTile = dialog.dialogEl?.querySelector('.export-format-tile.active');
  assert.ok(activeTile?.textContent?.includes('Markdown'));

  dialog.close();
});

test('ExportDialog: Format selection updates selectedFormat and button label', async () => {
  const { shell, exportService, shareService } = setupEnvironment();
  const dialog = new ExportDialog({
    exportService,
    shareService,
    shellElement: shell as any,
  });

  const doc = createSampleDoc();
  await dialog.open(doc);

  // Click Word (.docx) tile (tile index 2)
  const docxTile = dialog.dialogEl?.querySelector('[data-format="docx"]') as HTMLElement | null;
  assert.ok(docxTile !== null);
  docxTile?.click();

  assert.strictEqual(dialog.selectedFormat, 'docx');
  assert.ok(dialog.primaryActionBtn?.textContent?.includes('.docx'));

  // Click Email tile
  const emailTile = dialog.dialogEl?.querySelector('[data-format="email"]') as HTMLElement | null;
  emailTile?.click();

  assert.strictEqual(dialog.selectedFormat, 'email');
  assert.ok(
    dialog.primaryActionBtn?.textContent?.includes('Email') ||
    dialog.primaryActionBtn?.textContent?.includes('Draft')
  );

  dialog.close();
});

test('ExportDialog: Keyboard shortcuts (1-6 switch formats, Escape dismisses)', async () => {
  const { shell, exportService, shareService } = setupEnvironment();
  const dialog = new ExportDialog({
    exportService,
    shareService,
    shellElement: shell as any,
  });

  const doc = createSampleDoc();
  await dialog.open(doc);

  // Press '2' -> plain text
  const key2 = new KeyboardEvent('keydown', { key: '2' });
  window.dispatchEvent(key2);
  assert.strictEqual(dialog.selectedFormat, 'txt');

  // Press '4' -> pdf
  const key4 = new KeyboardEvent('keydown', { key: '4' });
  window.dispatchEvent(key4);
  assert.strictEqual(dialog.selectedFormat, 'pdf');

  // Press 'Escape' -> dialog closes
  const keyEsc = new KeyboardEvent('keydown', { key: 'Escape' });
  window.dispatchEvent(keyEsc);
  assert.strictEqual(dialog.isOpen, false);
});

test('ExportDialog: Checkboxes toggle frontmatter and notes inclusion', async () => {
  const { shell, exportService, shareService } = setupEnvironment();
  const dialog = new ExportDialog({
    exportService,
    shareService,
    shellElement: shell as any,
  });

  const doc = createSampleDoc();
  const notes = createSampleNotes();
  await dialog.open(doc, notes);

  assert.strictEqual(dialog.includeFrontmatter, true);
  assert.strictEqual(dialog.includeNotes, true);

  // Toggle frontmatter checkbox
  if (dialog.frontmatterCheckbox) {
    dialog.frontmatterCheckbox.checked = false;
    dialog.frontmatterCheckbox.dispatchEvent(new window.Event('change'));
    assert.strictEqual(dialog.includeFrontmatter, false);
  }

  // Toggle notes checkbox
  if (dialog.notesCheckbox) {
    dialog.notesCheckbox.checked = false;
    dialog.notesCheckbox.dispatchEvent(new window.Event('change'));
    assert.strictEqual(dialog.includeNotes, false);
  }

  dialog.close();
});

test('ExportDialog: Primary action button triggers export and calls onExportSuccess callback', async () => {
  const { shell, exportService, shareService } = setupEnvironment();
  let successFormat: string | null = null;
  let successResult: any = null;

  const dialog = new ExportDialog({
    exportService,
    shareService,
    shellElement: shell as any,
    onExportSuccess: (format, res) => {
      successFormat = format;
      successResult = res;
    },
  });

  const doc = createSampleDoc();
  await dialog.open(doc, [], [], 'md');

  // Click primary button
  dialog.primaryActionBtn?.click();

  // Wait for async export
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(successFormat, 'md');
  assert.ok(successResult !== null);
  assert.strictEqual(dialog.isOpen, false);
});
