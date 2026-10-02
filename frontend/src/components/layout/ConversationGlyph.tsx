/** A folded conversation note; subtle line variations keep long lists readable. */
export function ConversationGlyph({ sessionId }: { sessionId: string }) {
  const variant = Array.from(sessionId).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0
  ) % 3
  const contentLines = [
    'M7 12.75h6M7 16h3.5',
    'M7 12.75h4.5M7 16h6',
    'M7 12.75h6M7 16h2.75',
  ][variant]

  return (
    <svg
      className="conversation-glyph"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path className="conversation-glyph-back" d="M8 3.5h10a2 2 0 0 1 2 2v9" />
      <path className="conversation-glyph-outline" d="M5.5 6.5h8.75L18 10.25v7.25a2 2 0 0 1-2 2H9l-5.5 3v-14a2 2 0 0 1 2-2Z" />
      <path className="conversation-glyph-fold" d="M14.25 6.5v3.75H18" />
      <path className="conversation-glyph-lines" d={contentLines} />
      {variant === 2 && <circle className="conversation-glyph-dot" cx="13.5" cy="16" r=".65" stroke="none" />}
    </svg>
  )
}
