interface Props {
  size?: number
}

export default function NoteIcon({ size = 12 }: Props): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5V10l-3 3H4.5A1.5 1.5 0 0 1 3 11.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5.5 5.5h5M5.5 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M13 10l-3 3v-2.5A.5.5 0 0 1 10.5 10H13Z" fill="currentColor" fillOpacity="0.2" />
    </svg>
  )
}
