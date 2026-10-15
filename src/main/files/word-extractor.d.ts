/** The part of word-extractor (MIT, no bundled types) that legacyOffice.ts uses. */
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(options?: { includeFooters?: boolean }): string
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>
  }
}
