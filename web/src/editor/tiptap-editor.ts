/**
 * src/editor/tiptap-editor.ts
 * Daylight Writer - TipTap Rich-Text Engine
 * Seamlessly integrates ProseMirror, TipTap StarterKit, and Yjs CRDT Live Collaboration
 * Tailored for Daylight Computer (DC1) 10.5" 4:3 LivePaper Display
 * Sol:OS 8-bit Grayscale Design Tokens (--os-0 to --os-1000)
 */

import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { CollaborationManager } from './tiptap-collaboration.ts';
import type { ParagraphBlockInfo } from './editor.ts';

export interface TipTapEditorOptions {
  element: HTMLElement;
  content?: string;
  collaborationManager?: CollaborationManager | null;
  onUpdate?: (content: string) => void;
  onSelectionUpdate?: () => void;
  autofocus?: boolean;
}

/**
 * Custom TipTap Extension: Block ID injector
 * Ensures every top-level block (paragraph, heading, blockquote) in ProseMirror
 * has a stable data-block-id so the right thought margin drawer can anchor notes 1:1.
 */
export const BlockIdExtension = Extension.create({
  name: 'daylightBlockId',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('daylightBlockIdPlugin'),
        view: () => ({
          update: (view) => {
            // Assign sequential data-block-ids to rendered DOM blocks for 1:1 margin anchoring
            const contentEl = view.dom;
            const children = Array.from(contentEl.children);
            children.forEach((child, index) => {
              if (child instanceof HTMLElement && !child.dataset.blockId) {
                child.dataset.blockId = `p-${index}`;
                child.classList.add('editor-paragraph');
              }
            });
          },
        }),
      }),
    ];
  },
});

export class TipTapTypewriterEngine {
  public editor: Editor;
  public element: HTMLElement;
  public collaborationManager: CollaborationManager | null;

  constructor(options: TipTapEditorOptions) {
    this.element = options.element;
    this.collaborationManager = options.collaborationManager || null;

    const extensions: any[] = [
      StarterKit.configure({
        // When Yjs collaboration is active, history is managed by CRDT
        history: this.collaborationManager ? false : undefined,
        dropcursor: {
          color: '#535353', // --os-400
          width: 2,
        },
      }),
      BlockIdExtension,
    ];

    // Attach Yjs CRDT Collaboration if manager is provided
    if (this.collaborationManager) {
      extensions.push(
        Collaboration.configure({
          document: this.collaborationManager.ydoc,
          field: 'prosemirror',
        })
      );

      const provider = this.collaborationManager.activeProvider;
      if (provider && provider.awareness) {
        extensions.push(
          CollaborationCursor.configure({
            provider: provider,
            user: {
              name: this.collaborationManager.localUser.name,
              color: this.collaborationManager.localUser.color,
            },
          })
        );
      }
    }

    this.editor = new Editor({
      element: options.element,
      extensions,
      content: options.content || '<p class="editor-paragraph" data-block-id="p-0"><br /></p>',
      autofocus: options.autofocus ?? false,
      editorProps: {
        attributes: {
          class: 'daylight-tiptap-content editor-canvas-focus-root',
          spellcheck: 'false',
        },
      },
      onUpdate: ({ editor }) => {
        if (options.onUpdate) {
          options.onUpdate(editor.getText());
        }
      },
      onSelectionUpdate: () => {
        if (options.onSelectionUpdate) {
          options.onSelectionUpdate();
        }
      },
    });
  }

  // --------------------------------------------------------------------------
  // Content & Paragraph Extraction
  // --------------------------------------------------------------------------
  public getContent(): string {
    return this.editor.getText();
  }

  public getHTML(): string {
    return this.editor.getHTML();
  }

  public getJSON(): Record<string, any> {
    return this.editor.getJSON();
  }

  public setContent(content: string): void {
    this.editor.commands.setContent(content);
  }

  public insertText(text: string): void {
    this.editor.commands.insertContent(text);
  }

  public clearContent(): void {
    this.editor.commands.clearContent();
  }

  public focus(): void {
    this.editor.commands.focus();
  }

  public blur(): void {
    this.editor.commands.blur();
  }

  /**
   * Extract paragraph block geometry for the right margin thought drawer
   */
  public getParagraphBlocks(): ParagraphBlockInfo[] {
    const blocks: ParagraphBlockInfo[] = [];
    const dom = this.editor.view.dom;
    if (!dom) return blocks;

    const elements = Array.from(dom.children);
    elements.forEach((el, idx) => {
      if (!(el instanceof HTMLElement)) return;

      const id = el.dataset.blockId || `p-${idx}`;
      const text = el.textContent || '';
      const rect = el.getBoundingClientRect();
      const parentRect = dom.getBoundingClientRect();

      const tagName = el.tagName.toLowerCase();
      let type: 'paragraph' | 'heading' = 'paragraph';
      let level: number | undefined;

      if (/^h[1-6]$/.test(tagName)) {
        type = 'heading';
        level = parseInt(tagName.charAt(1), 10);
      }

      blocks.push({
        id,
        type,
        level,
        text,
        yOffset: rect.top - parentRect.top,
        height: rect.height || 34,
      });
    });

    return blocks;
  }

  // --------------------------------------------------------------------------
  // Rich-Text Formatting Commands
  // --------------------------------------------------------------------------
  public toggleBold(): boolean {
    return this.editor.chain().focus().toggleBold().run();
  }

  public toggleItalic(): boolean {
    return this.editor.chain().focus().toggleItalic().run();
  }

  public toggleStrike(): boolean {
    return this.editor.chain().focus().toggleStrike().run();
  }

  public toggleCode(): boolean {
    return this.editor.chain().focus().toggleCode().run();
  }

  public toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
    return this.editor.chain().focus().toggleHeading({ level }).run();
  }

  public toggleBulletList(): boolean {
    return this.editor.chain().focus().toggleBulletList().run();
  }

  public toggleOrderedList(): boolean {
    return this.editor.chain().focus().toggleOrderedList().run();
  }

  public toggleBlockquote(): boolean {
    return this.editor.chain().focus().toggleBlockquote().run();
  }

  public toggleCodeBlock(): boolean {
    return this.editor.chain().focus().toggleCodeBlock().run();
  }

  public setHorizontalRule(): boolean {
    return this.editor.chain().focus().setHorizontalRule().run();
  }

  public undo(): boolean {
    return this.editor.chain().focus().undo().run();
  }

  public redo(): boolean {
    return this.editor.chain().focus().redo().run();
  }

  // --------------------------------------------------------------------------
  // Teardown
  // --------------------------------------------------------------------------
  public destroy(): void {
    this.editor.destroy();
  }
}
