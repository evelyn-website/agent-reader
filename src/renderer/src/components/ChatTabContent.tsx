export default function ChatTabContent(): React.JSX.Element {
  return (
    <div className="chat-tab">
      <div className="chat-tab__session">
        <button type="button" className="chat-tab__session-button" disabled>
          <span className="chat-tab__session-label">Untitled session</span>
          <span className="chat-tab__session-caret">▾</span>
        </button>
      </div>
      <div className="chat-tab__scroll">
        <div className="tab-empty-state">
          Select text and press <kbd className="kbd-chip">⌘⇧A</kbd> to ask
        </div>
      </div>
      <div className="chat-tab__composer">
        <textarea
          className="chat-tab__input"
          placeholder="Ask about this document…"
          rows={2}
          disabled
        />
      </div>
    </div>
  )
}
