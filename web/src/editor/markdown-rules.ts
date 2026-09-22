/**
 * src/editor/markdown-rules.ts
 * Daylight Writer - Real-Time Markdown Syntax Formatting Engine (F10)
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 */

export interface EditorBlock {
  id: string; // e.g. "p-0", "h1-1", "li-2"
  type: 'paragraph' | 'heading' | 'blockquote' | 'list_item';
  level?: number; // 1-6 for headings
  text: string; // Raw markdown text content
  yOffset: number;
  height: number;
}

export interface CaretPosition {
  blockId: string;
  charOffset: number;
}

/**
 * Parses markdown inline and block-level syntax into semantic HTML.
 * Strictly satisfies E2E test F10:
 * - # Heading -> <h1>Heading</h1>
 * - ## Subheading -> <h2>Subheading</h2>
 * - **bold** -> <strong>bold</strong>
 * - *italic* -> <em>italic</em>
 * - - List item -> <li>List item</li>
 */
export function parseMarkdownInline(text: string): string {
  if (!text) return '';

  return text
    // Headings
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
    .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
    .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
    // Blockquotes
    .replace(/^>\s+(.*)$/, '<blockquote>$1</blockquote>')
    // Lists (unordered and ordered)
    .replace(/^[-*]\s+(.*)$/, '<li>$1</li>')
    .replace(/^\d+\.\s+(.*)$/, '<li>$1</li>')
    // Bold + Italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___(.*?)___/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Strikethrough
    .replace(/~~(.*?)~~/g, '<del>$1</del>');
}

/**
 * Measures character offset of the caret relative to a container DOM node.
 * Uses TreeWalker to sum text node lengths up to the selection anchor.
 */
export function getCaretCharacterOffset(root: Node): number {
  const ownerDoc = root.ownerDocument || document;
  const defaultView = ownerDoc.defaultView || (typeof window !== 'undefined' ? window : null);
  const selection = defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  const preCaretRange = ownerDoc.createRange();
  try {
    preCaretRange.selectNodeContents(root);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  } catch {
    return 0;
  }
}

/**
 * Restores the caret to an exact character offset inside root using TreeWalker.
 * Ensures zero caret jumping across DOM re-renders.
 */
export function setCaretCharacterOffset(root: Node, targetOffset: number): void {
  const ownerDoc = root.ownerDocument || document;
  const defaultView = ownerDoc.defaultView || (typeof window !== 'undefined' ? window : null);
  const selection = defaultView?.getSelection() || (typeof window !== 'undefined' ? window.getSelection() : null);
  if (!selection) return;

  const walker = ownerDoc.createTreeWalker(root, 4 /* SHOW_TEXT */, null);
  let currentOffset = 0;
  let targetNode: Text | null = null;
  let targetNodeOffset = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (currentOffset + len >= targetOffset) {
      targetNode = node;
      targetNodeOffset = targetOffset - currentOffset;
      break;
    }
    currentOffset += len;
    node = walker.nextNode() as Text | null;
  }

  const range = ownerDoc.createRange();
  if (targetNode) {
    range.setStart(targetNode, Math.min(targetNodeOffset, targetNode.nodeValue?.length ?? 0));
    range.collapse(true);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Parses raw document markdown text into discrete EditorBlock records.
 */
export function parseMarkdownToBlocks(markdown: string): EditorBlock[] {
  if (!markdown) {
    return [
      { id: 'p-0', type: 'paragraph', text: '', yOffset: 0, height: 40 },
    ];
  }

  const lines = markdown.split('\n');
  const blocks: EditorBlock[] = [];
  let currentY = 100;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Determine block type and height
    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const level = match ? match[1].length : 1;
      const text = match ? match[2] : trimmed;
      const height = level === 1 ? 50 : level === 2 ? 40 : 35;
      blocks.push({
        id: `h${level}-${i}`,
        type: 'heading',
        level,
        text,
        yOffset: currentY,
        height,
      });
      currentY += height + 20;
    } else if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      blocks.push({
        id: `li-${i}`,
        type: 'list_item',
        text: trimmed,
        yOffset: currentY,
        height: 35,
      });
      currentY += 45;
    } else if (/^>\s+/.test(trimmed)) {
      blocks.push({
        id: `bq-${i}`,
        type: 'blockquote',
        text: trimmed,
        yOffset: currentY,
        height: 50,
      });
      currentY += 65;
    } else {
      // Standard paragraph
      blocks.push({
        id: `p-${i}`,
        type: 'paragraph',
        text: line,
        yOffset: currentY,
        height: 60,
      });
      currentY += 80;
    }
  }

  return blocks;
}

/**
 * Serializes discrete blocks back into standard CommonMark markdown string.
 */
export function blocksToMarkdown(blocks: EditorBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'heading') {
        const prefix = '#'.repeat(b.level || 1);
        return `${prefix} ${b.text}`;
      }
      return b.text;
    })
    .join('\n\n');
}

/**
 * Checks if a typed character sequence constitutes a markdown trigger shortcut.
 */
export function detectMarkdownTrigger(lineText: string): {
  isTrigger: boolean;
  type?: 'h1' | 'h2' | 'h3' | 'blockquote' | 'bullet_list' | 'numbered_list';
} {
  if (lineText === '# ') return { isTrigger: true, type: 'h1' };
  if (lineText === '## ') return { isTrigger: true, type: 'h2' };
  if (lineText === '### ') return { isTrigger: true, type: 'h3' };
  if (lineText === '> ') return { isTrigger: true, type: 'blockquote' };
  if (lineText === '- ' || lineText === '* ') return { isTrigger: true, type: 'bullet_list' };
  if (/^\d+\.\s$/.test(lineText)) return { isTrigger: true, type: 'numbered_list' };
  return { isTrigger: false };
}
