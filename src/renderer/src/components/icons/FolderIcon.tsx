interface Props {
  size?: number
}

export default function FolderIcon({ size = 12 }: Props): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5a.5.5 0 0 1 .5-.5h3.6a.5.5 0 0 1 .35.146l1.208 1.208A.5.5 0 0 0 8.01 5.5H13.5a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-8z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
