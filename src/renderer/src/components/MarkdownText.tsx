import React from 'react'

interface MarkdownTextProps {
  text: string
  className?: string
}

// Token regex: bold (**text**), underline (__text__), italic (*text*), link [label](url)
// Bold and underline must come before italic to avoid ** matching as two *
const TOKEN_REGEX =
  /(\*\*(.+?)\*\*)|(__(.+?)__)|((?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g

function tokenizeLine(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let matchIndex = 0

  const matches = Array.from(line.matchAll(TOKEN_REGEX))

  for (const match of matches) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      nodes.push(line.substring(lastIndex, match.index))
    }

    // Determine which token type matched and emit the corresponding element
    if (match[1]) {
      // **bold**
      nodes.push(
        <strong key={`${matchIndex}-strong`}>{match[2]}</strong>
      )
    } else if (match[3]) {
      // __underline__
      nodes.push(
        <u key={`${matchIndex}-u`}>{match[4]}</u>
      )
    } else if (match[5]) {
      // *italic*
      nodes.push(
        <em key={`${matchIndex}-em`}>{match[6]}</em>
      )
    } else if (match[7]) {
      // [label](url)
      const label = match[8]
      const url = match[9]
      nodes.push(
        <a
          key={`${matchIndex}-link`}
          href="#"
          className="md-link"
          onClick={(e) => {
            e.preventDefault()
            window.open(url, '_blank')
          }}
        >
          {label}
        </a>
      )
    }

    lastIndex = match.index + match[0].length
    matchIndex++
  }

  // Add any remaining plain text after the last match
  if (lastIndex < line.length) {
    nodes.push(line.substring(lastIndex))
  }

  return nodes
}

export default function MarkdownText({ text, className }: MarkdownTextProps): React.JSX.Element {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    nodes.push(...tokenizeLine(lines[i]))
    if (i < lines.length - 1) {
      nodes.push(<br key={`br-${i}`} />)
    }
  }

  return <span className={className}>{nodes}</span>
}
