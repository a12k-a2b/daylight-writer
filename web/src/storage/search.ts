/**
 * src/storage/search.ts
 * Daylight Writer - High-Performance Sub-50ms Fuzzy Search & Hierarchical Tag Parser
 * Tailored for Daylight Computer (DC1) Sol:OS Grayscale Environment
 */

import type { DocumentRecord, TagRecord } from './schema';

export interface SearchHit {
  document: DocumentRecord;
  score: number;
  matchHighlights: string[];
}

export interface TagTreeNode {
  name: string;
  path: string;
  count: number;
  directCount: number;
  children: TagTreeNode[];
  isExpanded?: boolean;
}

export interface ParsedSearchQuery {
  rawQuery: string;
  tagFilters: string[];
  textTerms: string[];
}

export interface SubsequenceMatchResult {
  score: number;
  highlightRanges: [number, number][]; // [start, end] inclusive/exclusive
}

/**
 * Normalizes tag strings: strips leading '#', trims, and converts to lowercase.
 */
export function normalizeTagPath(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase();
}

/**
 * Extracts leaf name from a tag path (e.g. "project/drafts" -> "drafts").
 */
export function getTagLeafName(tagPath: string): string {
  const norm = normalizeTagPath(tagPath);
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

/**
 * Extracts all hierarchical tags from a markdown text block.
 * Matches #segment/subsegment syntax while excluding punctuation at boundaries.
 */
export function extractTagsFromText(text: string): string[] {
  if (!text) return [];
  const regex = /(?:^|[^\w/])#([a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]+)*)/g;
  const tags = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[1];
    const cleanTag = rawTag.replace(/[.,:;!?]+$/, '');
    if (cleanTag) {
      tags.add(cleanTag.toLowerCase());
    }
  }

  return Array.from(tags);
}

/**
 * Returns all ancestor paths for a given tag path.
 * e.g. "novel/chapter1/scene2" -> ["novel", "novel/chapter1", "novel/chapter1/scene2"]
 */
export function getTagAncestors(tagPath: string): string[] {
  const norm = normalizeTagPath(tagPath);
  if (!norm) return [];
  const parts = norm.split('/');
  const ancestors: string[] = [];
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    ancestors.push(current);
  }

  return ancestors;
}

/**
 * Checks if a document tag path matches a query tag path (exact or prefix descendant).
 */
export function isTagMatch(documentTagPath: string, queryTagPath: string): boolean {
  if (!documentTagPath || !queryTagPath) return false;
  let d = documentTagPath.charCodeAt(0) === 35 ? documentTagPath.replace(/^#+/, '') : documentTagPath;
  let q = queryTagPath.charCodeAt(0) === 35 ? queryTagPath.replace(/^#+/, '') : queryTagPath;
  if (d.charCodeAt(0) <= 32 || d.charCodeAt(d.length - 1) <= 32) d = d.trim();
  if (q.charCodeAt(0) <= 32 || q.charCodeAt(q.length - 1) <= 32) q = q.trim();
  d = d.toLowerCase();
  q = q.toLowerCase();
  if (!d || !q) return false;
  return d === q || (d.startsWith(q) && d.charCodeAt(q.length) === 47);
}

/**
 * Parses user search query string into tag filters and text terms.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { rawQuery: '', tagFilters: [], textTerms: [] };
  }

  const tokens = trimmed.split(/\s+/);
  const tagFilters: string[] = [];
  const textTerms: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('#')) {
      const cleanTag = normalizeTagPath(token);
      if (cleanTag) tagFilters.push(cleanTag);
    } else {
      textTerms.push(token);
    }
  }

  return {
    rawQuery: trimmed,
    tagFilters,
    textTerms,
  };
}

/**
 * Fast character code checker for word boundary delimiters.
 * Delimiters: whitespace (<= 32), / (47), - (45), _ (95), . (46), , (44), ; (59), : (58).
 */
export function isWordBoundaryCode(code: number): boolean {
  return (
    code <= 32 ||
    code === 47 ||
    code === 45 ||
    code === 95 ||
    code === 46 ||
    code === 44 ||
    code === 59 ||
    code === 58
  );
}

/**
 * Zero-allocation subsequence score calculation.
 * Returns -1 if no match, or positive score.
 */
export function scoreSubsequenceScore(
  needle: string,
  haystack: string,
  needleLower?: string,
  haystackLower?: string
): number {
  const n = needleLower !== undefined ? needleLower : needle.toLowerCase();
  const h = haystackLower !== undefined ? haystackLower : haystack.toLowerCase();

  if (n.length === 0) {
    return 0;
  }
  if (n.length > h.length) {
    return -1;
  }

  // Fast exact substring path first: O(1) SIMD match
  const subIdx = h.indexOf(n);
  if (subIdx !== -1) {
    const L = n.length;
    let score = 10 * L + 5 * ((L * (L + 1)) / 2);
    if (subIdx === 0 || isWordBoundaryCode(h.charCodeAt(subIdx - 1))) {
      score += 25;
    }
    if (L === h.length) {
      score += 50;
    }
    score += 20;
    score -= Math.min(20, Math.floor(h.length / 25));
    return Math.max(1, score);
  }

  // Fast SIMD-accelerated rejection: first and last character must exist in haystack
  const firstIdx = h.indexOf(n[0]);
  if (firstIdx === -1) return -1;
  const lastIdx = h.lastIndexOf(n[n.length - 1]);
  if (lastIdx === -1 || lastIdx < firstIdx) return -1;

  // Fast sequential character existence probe using native SIMD indexOf
  let checkPos = firstIdx;
  const step = n.length > 8 ? 2 : 1;
  for (let i = step; i < n.length - 1; i += step) {
    checkPos = h.indexOf(n[i], checkPos);
    if (checkPos === -1 || checkPos > lastIdx) return -1;
  }

  let nIdx = 0;
  let score = 0;
  let consecutive = 0;

  for (let hIdx = firstIdx; hIdx <= lastIdx; hIdx++) {
    if (h.length - hIdx < n.length - nIdx) {
      return -1;
    }

    if (h.charCodeAt(hIdx) === n.charCodeAt(nIdx)) {
      nIdx++;
      consecutive++;
      score += 10 + consecutive * 5;
      if (hIdx === 0 || isWordBoundaryCode(h.charCodeAt(hIdx - 1))) {
        score += 25;
      }
      if (nIdx === n.length) {
        break;
      }
    } else {
      consecutive = 0;
    }
  }

  if (nIdx < n.length) {
    return -1;
  }

  score -= Math.min(20, Math.floor(haystack.length / 25));
  return Math.max(1, score);
}

/**
 * Scores subsequence fuzzy match of needle against haystack.
 * Returns null if needle characters do not appear in sequence.
 */
export function scoreSubsequenceMatch(
  needle: string,
  haystack: string,
  needleLower?: string,
  haystackLower?: string
): SubsequenceMatchResult | null {
  const n = needleLower !== undefined ? needleLower : needle.toLowerCase();
  const h = haystackLower !== undefined ? haystackLower : haystack.toLowerCase();

  if (n.length === 0) {
    return { score: 0, highlightRanges: [] };
  }
  if (n.length > h.length) {
    return null;
  }

  // Fast exact substring path first: O(1) SIMD match
  const subIdx = h.indexOf(n);
  if (subIdx !== -1) {
    const L = n.length;
    let score = 10 * L + 5 * ((L * (L + 1)) / 2);
    if (subIdx === 0 || isWordBoundaryCode(h.charCodeAt(subIdx - 1))) {
      score += 25;
    }
    if (L === h.length) {
      score += 50;
    }
    score += 20; // Substring exact match bonus
    score -= Math.min(20, Math.floor(h.length / 25));
    return {
      score: Math.max(1, score),
      highlightRanges: [[subIdx, subIdx + L]],
    };
  }

  // Fast SIMD-accelerated rejection: first and last character must exist in haystack
  const firstIdx = h.indexOf(n[0]);
  if (firstIdx === -1) return null;
  const lastIdx = h.lastIndexOf(n[n.length - 1]);
  if (lastIdx === -1 || lastIdx < firstIdx) return null;

  // Fast sequential character existence probe using native SIMD indexOf
  let checkPos = firstIdx;
  const step = n.length > 8 ? 2 : 1;
  for (let i = step; i < n.length - 1; i += step) {
    checkPos = h.indexOf(n[i], checkPos);
    if (checkPos === -1 || checkPos > lastIdx) return null;
  }

  let nIdx = 0;
  let score = 0;
  let consecutive = 0;
  const matchIndices: number[] = [];

  for (let hIdx = firstIdx; hIdx <= lastIdx; hIdx++) {
    if (h.length - hIdx < n.length - nIdx) {
      return null;
    }

    if (h.charCodeAt(hIdx) === n.charCodeAt(nIdx)) {
      matchIndices.push(hIdx);
      nIdx++;
      consecutive++;

      // Base score + bonus for contiguous sequence
      score += 10 + consecutive * 5;

      // Bonus for match at word boundary (start of string or after whitespace/punctuation)
      if (hIdx === 0 || isWordBoundaryCode(h.charCodeAt(hIdx - 1))) {
        score += 25;
      }

      if (nIdx === n.length) {
        break;
      }
    } else {
      consecutive = 0;
    }
  }

  // If needle characters were not fully matched in order
  if (nIdx < n.length) {
    return null;
  }

  // Length penalty to favor concise matches
  score -= Math.min(20, Math.floor(haystack.length / 25));

  const highlightRanges: [number, number][] = matchIndices.map(idx => [idx, idx + 1]);

  return {
    score: Math.max(1, score),
    highlightRanges,
  };
}

/**
 * HTML-escapes special characters (&, <, >, ", ') to prevent XSS and DOM markup corruption.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds HTML highlight snippet formatted for Sol:OS grayscale rendering.
 */
export function formatHighlightSnippet(
  text: string,
  ranges: [number, number][],
  maxLength = 120
): string {
  if (!text || ranges.length === 0) {
    return text ? escapeHtml(text.slice(0, maxLength)) : '';
  }

  // Merge overlapping or adjacent ranges
  const merged: [number, number][] = [];
  for (const range of ranges) {
    if (merged.length === 0) {
      merged.push([...range]);
    } else {
      const last = merged[merged.length - 1];
      if (range[0] <= last[1]) {
        last[1] = Math.max(last[1], range[1]);
      } else {
        merged.push([...range]);
      }
    }
  }

  // Find bounding box for snippet around first match
  const firstMatch = merged[0];
  const start = Math.max(0, firstMatch[0] - 20);
  const end = Math.min(text.length, start + maxLength);

  let result = '';
  let cursor = start;

  if (start > 0) result += '...';

  for (const [rStart, rEnd] of merged) {
    if (rEnd <= start) continue;
    if (rStart >= end) break;

    const clampStart = Math.max(start, rStart);
    const clampEnd = Math.min(end, rEnd);

    if (clampStart > cursor) {
      result += escapeHtml(text.slice(cursor, clampStart));
    }
    result += `<mark class="os-search-highlight">${escapeHtml(text.slice(clampStart, clampEnd))}</mark>`;
    cursor = clampEnd;
  }

  if (cursor < end) {
    result += escapeHtml(text.slice(cursor, end));
  }
  if (end < text.length) {
    result += '...';
  }

  return result;
}

/**
 * Splits document content into bounded paragraph blocks (<= 2500 chars)
 * for fallback subsequence fuzzy matching on large manuscripts without performance degradation.
 */
export function getSearchBlocks(content: string, maxBlockSize = 2500): string[] {
  if (content.length <= maxBlockSize) {
    return [content];
  }
  const rawBlocks = content.split(/\n+/);
  const blocks: string[] = [];
  for (const block of rawBlocks) {
    if (block.length <= maxBlockSize) {
      if (block.trim().length > 0) blocks.push(block);
    } else {
      // Chunk large paragraphs with 100-character overlap
      const step = maxBlockSize - 100;
      for (let i = 0; i < block.length; i += step) {
        blocks.push(block.slice(i, i + maxBlockSize));
      }
    }
  }
  return blocks.length > 0 ? blocks : [content.slice(0, maxBlockSize)];
}

const titleLowerCache = new WeakMap<DocumentRecord, string>();
const contentLowerCache = new WeakMap<DocumentRecord, string>();

interface TermHighlightData {
  type: 'title' | 'tag' | 'content_sub' | 'content_match';
  tag?: string;
  contentIdx?: number;
  termLen?: number;
  snippetText?: string;
  range?: [number, number];
  blockText?: string;
  blockRanges?: [number, number][];
}

class SearchHitItem implements SearchHit {
  document: DocumentRecord;
  score: number;
  private hitData: TermHighlightData[];
  private _cachedHl: string[] | null = null;

  constructor(document: DocumentRecord, score: number, hitData: TermHighlightData[]) {
    this.document = document;
    this.score = score;
    this.hitData = hitData;
  }

  get matchHighlights(): string[] {
    if (this._cachedHl !== null) return this._cachedHl;
    const hlList: string[] = [];
    for (const data of this.hitData) {
      let hl = '';
      if (data.type === 'title') {
        hl = `Title: ${escapeHtml(this.document.title)}`;
      } else if (data.type === 'tag' && data.tag) {
        hl = `Tag: #${escapeHtml(data.tag)}`;
      } else if (
        data.type === 'content_sub' &&
        data.contentIdx !== undefined &&
        data.termLen !== undefined
      ) {
        const winStart = Math.max(0, data.contentIdx - 60);
        const winEnd = Math.min(
          this.document.content.length,
          data.contentIdx + data.termLen + 60
        );
        const snippetText = this.document.content.slice(winStart, winEnd);
        const range: [number, number] = [
          data.contentIdx - winStart,
          data.contentIdx - winStart + data.termLen,
        ];
        hl = formatHighlightSnippet(snippetText, [range], 120);
      } else if (data.type === 'content_match' && data.blockText && data.blockRanges) {
        hl = formatHighlightSnippet(data.blockText, data.blockRanges, 120);
      }
      if (hl && !hlList.includes(hl)) {
        hlList.push(hl);
      }
    }
    this._cachedHl = hlList;
    return hlList;
  }
}

/**
 * Executes high-performance sub-50ms fuzzy search across documents and tags.
 */
export function searchDocumentsInMemory(
  query: string,
  documents: DocumentRecord[],
  documentTagsMap: Map<string, string[]> // docId -> tagPaths[]
): SearchHit[] {
  const parsed = parseSearchQuery(query);
  if (!parsed.rawQuery) {
    return documents
      .filter(doc => doc.deleted_at === null)
      .map(doc => ({
        document: doc,
        score: 1,
        matchHighlights: [],
      }));
  }

  const results: SearchHit[] = [];
  const now = Date.now();
  const lowerTerms = parsed.textTerms.map(t => t.toLowerCase());
  const tagScoreCaches: Array<Map<string, number>> = parsed.textTerms.map(() => new Map());

  for (const doc of documents) {
    if (doc.deleted_at !== null) continue;

    const docTags = documentTagsMap.get(doc.id) || [];

    // 1. Evaluate Tag Filters (#tag)
    if (parsed.tagFilters.length > 0) {
      const hasAllTags = parsed.tagFilters.every(queryTag =>
        docTags.some(docTag => isTagMatch(docTag, queryTag))
      );
      if (!hasAllTags) {
        continue; // Must satisfy all explicitly specified #tags
      }
    }

    // If query was ONLY tags, match with high score
    if (parsed.textTerms.length === 0) {
      results.push({
        document: doc,
        score: 100,
        matchHighlights: docTags.map(t => `#${escapeHtml(t)}`),
      });
      continue;
    }

    // 2. Evaluate Free-Text Tokens
    let totalScore = 0;
    let matchedAllTerms = true;
    const highlights: string[] = [];

    let docTitleLower = titleLowerCache.get(doc);
    if (docTitleLower === undefined) {
      docTitleLower = doc.title.toLowerCase();
      titleLowerCache.set(doc, docTitleLower);
    }

    let docContentLower: string | null = null;

    const termHighlightDatas: TermHighlightData[] = [];

    for (let tIdx = 0; tIdx < parsed.textTerms.length; tIdx++) {
      const term = parsed.textTerms[tIdx];
      const termLower = lowerTerms[tIdx];
      let termBestScore = 0;
      let termHl: TermHighlightData | null = null;

      // Check Title (Weight: 10.0x / 3x multiplier)
      const titleScore = scoreSubsequenceScore(term, doc.title, termLower, docTitleLower);
      if (titleScore > 0) {
        const weightedTitleScore = titleScore * 10.0;
        if (weightedTitleScore > termBestScore) {
          termBestScore = weightedTitleScore;
          termHl = { type: 'title' };
        }
      }

      // Check Tags (Weight: 8.0x / 2x multiplier)
      const tagCache = tagScoreCaches[tIdx];
      for (const tag of docTags) {
        // Tag paths in docTags are pre-normalized lowercase
        let tagScore = tagCache.get(tag);
        if (tagScore === undefined) {
          tagScore = scoreSubsequenceScore(term, tag, termLower, tag);
          tagCache.set(tag, tagScore);
        }
        if (tagScore > 0) {
          const weightedTagScore = tagScore * 8.0;
          if (weightedTagScore > termBestScore) {
            termBestScore = weightedTagScore;
            termHl = { type: 'tag', tag };
          }
        }
      }

      // Check Body / Content (Weight: 5.0x / 1x multiplier) - Full Manuscript Search via SIMD indexOf
      const L = term.length;
      const maxPossibleContentScore = (L * 10 + 5 * ((L * (L + 1)) / 2) + 45) * 5.0;
      if (doc.content.length > 0 && termBestScore < maxPossibleContentScore) {
        if (docContentLower === null) {
          docContentLower = contentLowerCache.get(doc) || null;
          if (docContentLower === null) {
            docContentLower = doc.content.toLowerCase();
            contentLowerCache.set(doc, docContentLower);
          }
        }

        // Fast Path: Exact Substring check across full manuscript
        const contentIdx = docContentLower.indexOf(termLower);
        if (contentIdx !== -1) {
          const baseScore = L * 10;
          const consecutiveBonus = 5 * ((L * (L + 1)) / 2);
          const isWordBoundary =
            contentIdx === 0 || isWordBoundaryCode(doc.content.charCodeAt(contentIdx - 1));
          const boundaryBonus = isWordBoundary ? 25 : 0;
          const substringBonus = 20;
          const lengthPenalty = Math.min(20, Math.floor(doc.content.length / 25));
          const rawScore = Math.max(
            1,
            baseScore + consecutiveBonus + boundaryBonus + substringBonus - lengthPenalty
          );
          const weightedContentScore = rawScore * 5.0;

          if (weightedContentScore > termBestScore) {
            termBestScore = weightedContentScore;
            termHl = {
              type: 'content_sub',
              contentIdx,
              termLen: L,
            };
          }
        }
      }

      if (termBestScore === 0) {
        matchedAllTerms = false;
        break;
      }

      totalScore += termBestScore;
      if (termHl) {
        termHighlightDatas.push(termHl);
      }
    }

    if (!matchedAllTerms) {
      continue;
    }

    // Tag filter presence bonus
    if (parsed.tagFilters.length > 0) {
      totalScore += 50;
    }

    // Recency boost (up to +10 pts for recent activity)
    const weeksOld = Math.max(0, Math.floor((now - doc.updated_at) / (86400000 * 7)));
    const recencyBoost = Math.max(0, 10 - weeksOld);
    totalScore += recencyBoost;

    results.push(new SearchHitItem(doc, Math.round(totalScore), termHighlightDatas));
  }

  // Sort descending by score; tie-break by updated_at DESC
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.document.updated_at - a.document.updated_at;
  });

  return results;
}

/**
 * Builds a nested collapsible TagTreeNode tree from tag records and document associations.
 */
export function buildTagTree(
  tags: TagRecord[],
  documentTagsMap: Map<string, string[]> // docId -> tagPaths[]
): TagTreeNode[] {
  const rootNodes: TagTreeNode[] = [];
  const nodeMap = new Map<string, TagTreeNode>();

  // Count document associations per tag path
  const directCounts = new Map<string, number>();
  for (const tagPaths of documentTagsMap.values()) {
    for (const rawPath of tagPaths) {
      const norm = normalizeTagPath(rawPath);
      directCounts.set(norm, (directCounts.get(norm) || 0) + 1);
    }
  }

  // Ensure all registered tags and their ancestors are in the tree
  const allPaths = new Set<string>();
  for (const tag of tags) {
    const ancestors = getTagAncestors(tag.path);
    for (const anc of ancestors) {
      allPaths.add(anc);
    }
  }
  for (const docTag of directCounts.keys()) {
    const ancestors = getTagAncestors(docTag);
    for (const anc of ancestors) {
      allPaths.add(anc);
    }
  }

  // Sort paths to process parents before children
  const sortedPaths = Array.from(allPaths).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  for (const path of sortedPaths) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;

    const node: TagTreeNode = {
      name,
      path,
      count: 0,
      directCount: directCounts.get(path) || 0,
      children: [],
      isExpanded: false,
    };
    nodeMap.set(path, node);

    if (parentPath && nodeMap.has(parentPath)) {
      nodeMap.get(parentPath)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Calculate recursive counts (depth-first post-order)
  function computeRecursiveCount(node: TagTreeNode): number {
    let total = node.directCount;
    for (const child of node.children) {
      total += computeRecursiveCount(child);
    }
    node.count = total;
    return total;
  }

  for (const root of rootNodes) {
    computeRecursiveCount(root);
  }

  // Sort children alphabetically by name
  function sortChildren(node: TagTreeNode): void {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) {
      sortChildren(child);
    }
  }

  rootNodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const root of rootNodes) {
    sortChildren(root);
  }

  return rootNodes;
}
