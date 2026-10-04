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
      <path className="conversation-glyph-outline" d="M6.5 4.5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5.5 3v-14a3 3 0 0 1 3-3Z" />
      <path className="conversation-glyph-lines" d="M8 9.5h8M8 13.5h5" />
    </svg>
  )
}
