/** A single conversation bubble, kept legible at the compact list size. */
export function ConversationGlyph() {
  return (
    <svg
      className="conversation-glyph"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path className="conversation-glyph-outline" d="M7 4h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H9l-5.5 2V8A4 4 0 0 1 7 4Z" />
      <path className="conversation-glyph-lines" d="M8 9.5h8M8 13.5h5" />
    </svg>
  )
}
