/**
 * src/export/docx-exporter.ts
 * Daylight Writer - Pure TypeScript OOXML Microsoft Word (.docx) Generator
 * Features: F56 (Client-Side OOXML Word Export Pipeline)
 *
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Zero external npm dependencies.
 */

import type { DocumentRecord, ThoughtNoteRecord } from '../storage/schema.ts';
import {
  type ExportResult,
  sanitizeFilename,
  sortThoughtNotes,
  extractAnchorIndex,
  formatNoteAnchorLabel,
} from './markdown-exporter.ts';
import { buildZipArchive } from './zip-builder.ts';

export interface DocxExportOptions {
  includeThoughtNotes?: boolean;
  fontSizePt?: number;
  lineSpacing?: number;
}

export function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Strip invalid XML 1.0 control characters
}

export function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

export function buildPackageRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

export function buildDocumentRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

export function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
        <w:sz w:val="24"/>
        <w:color w:val="1A1A1A"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="360" w:lineRule="auto" w:after="160"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="280"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="48"/>
      <w:color w:val="000000"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr>
      <w:spacing w:before="360" w:after="140"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
      <w:color w:val="000000"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr>
      <w:spacing w:before="240" w:after="100"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:color w:val="1A1A1A"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="MarginCallout">
    <w:name w:val="Margin Callout"/>
    <w:pPr>
      <w:pBdr>
        <w:left w:val="single" w:sz="12" w:space="12" w:color="CCCCCC"/>
      </w:pBdr>
      <w:shd w:val="clear" w:color="auto" w:fill="F7F7F7"/>
      <w:ind w:left="720" w:right="360"/>
      <w:spacing w:before="120" w:after="120" w:line="280" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="20"/>
      <w:color w:val="535353"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

export function buildDocumentXml(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = [],
  options: DocxExportOptions = {}
): string {
  const includeNotes = options.includeThoughtNotes ?? true;
  let pXml = '';

  // 1. Document Title
  pXml += `
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>${escapeXml(doc.title || 'Untitled')}</w:t></w:r>
    </w:p>`;

  // 2. Metadata subtitle (Tags & Date)
  if (tags && tags.length > 0) {
    const formattedTags = tags
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(', ');
    pXml += `
      <w:p>
        <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
        <w:r>
          <w:rPr><w:sz w:val="18"/><w:color w:val="858585"/></w:rPr>
          <w:t>${escapeXml(formattedTags)}</w:t>
        </w:r>
      </w:p>`;
  }

  // 3. Body paragraphs & Headings
  const paragraphs = (doc.content || '').split(/\n\n+/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      pXml += `
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>${escapeXml(trimmed.slice(2))}</w:t></w:r>
        </w:p>`;
    } else if (trimmed.startsWith('## ')) {
      pXml += `
        <w:p>
          <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
          <w:r><w:t>${escapeXml(trimmed.slice(3))}</w:t></w:r>
        </w:p>`;
    } else {
      pXml += `
        <w:p>
          <w:r><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r>
        </w:p>`;
    }
  }

  // 4. Margin Notes Section
  const activeNotes = sortThoughtNotes(notes);
  if (includeNotes && activeNotes.length > 0) {
    pXml += `
      <w:p>
        <w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="400" w:after="160"/></w:pPr>
        <w:r><w:t>Thought Notes &amp; Annotations</w:t></w:r>
      </w:p>`;

    for (const note of activeNotes) {
      const label = `${formatNoteAnchorLabel(note)} `;
      pXml += `
        <w:p>
          <w:pPr><w:pStyle w:val="MarginCallout"/></w:pPr>
          <w:r><w:rPr><w:b/><w:i w:val="0"/></w:rPr><w:t>${escapeXml(label)}</w:t></w:r>
          <w:r><w:t xml:space="preserve">${escapeXml(note.content || '')}</w:t></w:r>
        </w:p>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${pXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

export async function exportToDocx(
  doc: DocumentRecord,
  notes: ThoughtNoteRecord[] = [],
  tags: string[] = [],
  options: DocxExportOptions = {}
): Promise<ExportResult> {
  const contentTypesXml = buildContentTypesXml();
  const packageRelsXml = buildPackageRelsXml();
  const documentRelsXml = buildDocumentRelsXml();
  const stylesXml = buildStylesXml();
  const documentXml = buildDocumentXml(doc, notes, tags, options);

  const zipBytes = buildZipArchive([
    { path: '[Content_Types].xml', data: contentTypesXml },
    { path: '_rels/.rels', data: packageRelsXml },
    { path: 'word/_rels/document.xml.rels', data: documentRelsXml },
    { path: 'word/styles.xml', data: stylesXml },
    { path: 'word/document.xml', data: documentXml },
  ]);

  return {
    filename: sanitizeFilename(doc.title, 'docx'),
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    data: zipBytes,
  };
}

export class DocxExporter {
  public export(
    doc: DocumentRecord,
    notes: ThoughtNoteRecord[] = [],
    tags: string[] = [],
    options: DocxExportOptions = {}
  ): ExportResult {
    const contentTypesXml = buildContentTypesXml();
    const packageRelsXml = buildPackageRelsXml();
    const documentRelsXml = buildDocumentRelsXml();
    const stylesXml = buildStylesXml();
    const documentXml = buildDocumentXml(doc, notes, tags, options);

    const zipBytes = buildZipArchive([
      { path: '[Content_Types].xml', data: contentTypesXml },
      { path: '_rels/.rels', data: packageRelsXml },
      { path: 'word/_rels/document.xml.rels', data: documentRelsXml },
      { path: 'word/styles.xml', data: stylesXml },
      { path: 'word/document.xml', data: documentXml },
    ]);

    return {
      filename: sanitizeFilename(doc.title, 'docx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: zipBytes,
    };
  }
}
