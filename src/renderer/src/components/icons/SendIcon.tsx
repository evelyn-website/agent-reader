interface Props {
  size?: number
}

/** Upward send arrow (chat composer). */
export default function SendIcon({ size = 16 }: Props): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 12V5M5 9l3-4 3 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
