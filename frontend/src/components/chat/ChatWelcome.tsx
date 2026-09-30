import './chatWelcome.css'

export function ChatWelcome() {
  return (
    <header className="chat-welcome">
      <div className="chat-welcome-emblem" aria-hidden="true">
        <div className="chat-welcome-logo">
          <img
            src="/tessmora-logo.png"
            alt=""
            width={88}
            height={88}
            draggable={false}
          />
        </div>
      </div>
      <div className="chat-welcome-copy">
        <h1 className="chat-welcome-title">
          <span className="chat-welcome-greeting">你好，我是 </span>
          <span className="chat-welcome-name" lang="en">Tessmora</span>
        </h1>
        <p className="chat-welcome-hint" lang="en">
          Every <span className="chat-welcome-fragment">fragment</span>{' '}
          <span className="chat-welcome-destination">
            finds its place.
            <svg className="chat-welcome-slogan-stroke" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
              <path d="M3 8C43 3 116 3 194 5M14 11C69 7 132 7 181 8" />
            </svg>
          </span>
        </p>
      </div>
    </header>
  )
}
