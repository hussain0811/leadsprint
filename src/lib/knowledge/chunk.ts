import type { ChunkDraft, ExtractedPage } from "./types";

const DEFAULT_TARGET_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 150;
const MAX_HEADING_CHARS = 200;
// A standalone line this short, with no sentence punctuation, reads as a title.
const MAX_TITLE_CHARS = 80;
const MAX_TITLE_WORDS = 10;

// Ends of sentences (including the Arabic question mark), allowing a closing quote or bracket.
const SENTENCE_END = /(?<=[.!?؟۔…]["'”’)\]]*)\s+/;

// A page is read as headings and paragraphs (lines with no blank line between them).
type Block = { heading: string } | { paragraph: string };
// A piece of passage text, and what separated it from the piece before it in the page.
type Piece = { text: string; joiner: string };

/**
 * Splits extracted pages into search passages of roughly `targetChars` characters with a small
 * sentence-aligned overlap, never crossing a page boundary, and records the nearest heading.
 */
export function chunkPages(pages: ExtractedPage[], opts?: { targetChars?: number; overlapChars?: number }): ChunkDraft[] {
  const target = Math.max(1, Math.floor(opts?.targetChars ?? DEFAULT_TARGET_CHARS));
  const overlap = Math.min(Math.max(0, Math.floor(opts?.overlapChars ?? DEFAULT_OVERLAP_CHARS)), Math.floor(target / 2));
  const drafts: ChunkDraft[] = [];
  // A section can run on over the next page, so the heading carries over.
  let heading: string | null = null;

  for (const { page, text } of pages) {
    let pieces: Piece[] = [];
    let length = 0; // characters in the passage being built
    let fresh = 0; // characters added since the overlap

    const add = (piece: Piece) => {
      length += (pieces.length ? piece.joiner.length : 0) + piece.text.length;
      pieces.push(piece);
      fresh += piece.text.length;
    };
    const emit = () => {
      const passage = fresh > 0 ? joinPieces(pieces) : "";
      if (passage) drafts.push({ ordinal: drafts.length, heading, page, text: passage });
      pieces = [];
      length = 0;
      fresh = 0;
    };

    for (const block of readBlocks(text)) {
      if ("heading" in block) {
        emit();
        heading = block.heading;
        continue;
      }
      for (const unit of splitParagraph(block.paragraph, target)) {
        const grown = length + (pieces.length ? unit.joiner.length : 0) + unit.text.length;
        // With only a scrap of new text so far, let the passage run long rather than end it.
        if (grown > target && fresh > 0 && fresh >= Math.min(overlap, target / 4)) {
          const carried = overlapPieces(pieces, overlap);
          emit();
          carried.forEach(add);
          fresh = 0;
        }
        add(unit);
      }
    }
    emit();
  }
  return drafts;
}

function readBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const section of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let lines: string[] = [];
    const endParagraph = () => {
      if (lines.length) blocks.push({ paragraph: lines.join("\n") });
      lines = [];
    };
    for (const raw of section.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      const marked = /^#{1,6}(?: (.*))?$/.exec(line);
      if (marked) {
        endParagraph();
        const heading = cleanHeading(marked[1] ?? "");
        if (heading) blocks.push({ heading });
      } else if (line) {
        lines.push(line);
      }
    }
    endParagraph();
  }

  // A short line standing alone before a paragraph is a title, even without a "#". A run of
  // short lines (a list laid out one item per paragraph) stays content.
  return blocks.map((block, i) => {
    const next = blocks[i + 1];
    const introduces = next !== undefined && "paragraph" in next && !isTitleLike(next.paragraph);
    return "paragraph" in block && introduces && isTitleLike(block.paragraph) ? { heading: cleanHeading(block.paragraph) } : block;
  });
}

function isTitleLike(text: string): boolean {
  if (text.includes("\n") || text.length < 3 || text.length > MAX_TITLE_CHARS) return false;
  if (text.split(" ").length > MAX_TITLE_WORDS) return false;
  // Sentences, "Label: value" lines, table rows and list items are content.
  if (/[.!?؟,;،…]$/.test(text) || /:./.test(text) || text.includes("|") || /^[-*•·▪►✓]/.test(text)) return false;
  // Mostly letters: prices, phone numbers and dates on their own line are content too.
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters * 2 >= text.replace(/\s/g, "").length;
}

function cleanHeading(text: string): string {
  return text
    .replace(/\s#+$/, "")
    .replace(/^[*_\s]+|[*_:\s]+$/g, "")
    .slice(0, MAX_HEADING_CHARS)
    .trim();
}

// A paragraph that fits is one piece; a longer one is split into sentences, and any sentence
// that is still too long is split between words.
function splitParagraph(paragraph: string, target: number): Piece[] {
  const whole = { text: paragraph, joiner: "\n\n" };
  if (paragraph.length <= target) return [whole];
  return splitSentences(whole).flatMap((sentence) => (sentence.text.length <= target ? [sentence] : splitWords(sentence, target)));
}

// Line breaks count as sentence ends: they separate rows, list items and lines of a PDF.
function splitSentences(piece: Piece): Piece[] {
  const sentences: Piece[] = [];
  for (const line of piece.text.split("\n")) {
    line.split(SENTENCE_END).forEach((part, i) => {
      const text = part.trim();
      if (!text) return;
      sentences.push({ text, joiner: sentences.length === 0 ? piece.joiner : i === 0 ? "\n" : " " });
    });
  }
  return sentences;
}

function splitWords(piece: Piece, target: number): Piece[] {
  const parts: Piece[] = [];
  let current = "";
  const push = () => {
    if (current) parts.push({ text: current, joiner: parts.length ? " " : piece.joiner });
    current = "";
  };
  for (const word of piece.text.split(/\s+/)) {
    let rest = word;
    while (rest) {
      const room = current ? target - current.length - 1 : target;
      if (rest.length <= room) {
        current = current ? `${current} ${rest}` : rest;
        rest = "";
      } else if (current) {
        push();
      } else {
        // A single "word" longer than a passage (a long link, say) is cut where it must be.
        current = rest.slice(0, target);
        rest = rest.slice(target);
        push();
      }
    }
  }
  push();
  return parts;
}

// Whole sentences from the end of a passage, up to `max` characters, to repeat at the start of
// the next one so a fact split across the boundary is still found in one piece.
function overlapPieces(pieces: Piece[], max: number): Piece[] {
  const tail: Piece[] = [];
  let size = 0;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const sentences = splitSentences(pieces[i]);
    for (let j = sentences.length - 1; j >= 0; j--) {
      const grown = size + sentences[j].text.length + (tail.length ? tail[0].joiner.length : 0);
      if (grown > max) return tail;
      tail.unshift(sentences[j]);
      size = grown;
    }
  }
  // The whole passage fits: repeating all of it would only make a duplicate.
  return [];
}

function joinPieces(pieces: Piece[]): string {
  return pieces
    .map((piece, i) => (i === 0 ? piece.text : piece.joiner + piece.text))
    .join("")
    .trim();
}
