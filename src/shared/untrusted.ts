/**
 * Text placed inside a `<<<… UNTRUSTED DATA …>>>` envelope (a web page, an app's result, a file, project memory) must not
 * be able to close the envelope or open a new one: its own markers become look-alikes. Also for header values (a URL,
 * a name). Doesn't make the content trustworthy — the model is still told it is data. Tests: `tests/untrusted.test.ts`.
 */
export function neutralizeMarkers(text: string): string {
  return text.replace(/<<</g, '‹‹‹').replace(/>>>/g, '›››')
}
