interface Props {
  size?: number
}

export default function HomeIcon({ size = 12 }: Props): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 7.25 8 2.75l5.5 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 6.5v6a.5.5 0 0 0 .5.5h2.25V9.5h2.5V13h2.25a.5.5 0 0 0 .5-.5v-6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
