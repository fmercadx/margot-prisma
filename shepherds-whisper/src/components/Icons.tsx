/* Hand-rolled stroke icons rather than an icon package. The set is small, the
   weight is tuned to the display face, and it keeps the site's runtime
   dependency list at exactly react + react-dom. */

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

export const ClockIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 1.75" />
  </svg>
)

export const BowlIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3.5 11h17a8.5 8.5 0 0 1-8.5 8.5A8.5 8.5 0 0 1 3.5 11Z" />
    <path d="M9 7.5c0-1.2 1-1.6 1-2.6S9 3.2 9 3.2M13.5 8c0-1.2 1-1.6 1-2.6s-1-1.7-1-1.7" />
    <path d="M2 21h20" />
  </svg>
)

export const PillIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" />
    <path d="M12 8.5v7" />
    <path d="M6.25 10.75v2.5M8.75 12h-5" />
  </svg>
)

export const HeartIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.6 12 20 12 20Z" />
  </svg>
)

export const HomeIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3.5 10.2 12 3.5l8.5 6.7" />
    <path d="M5.5 9v11h13V9" />
    <path d="M10 20v-5.5h4V20" />
  </svg>
)

export const ShieldIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 3.2 4.8 6v5.6c0 4.2 3 7.6 7.2 9.2 4.2-1.6 7.2-5 7.2-9.2V6Z" />
    <path d="m9 12 2.2 2.2L15.4 10" />
  </svg>
)

export const LeafIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M20 4s.8 8.4-4.2 12C12.2 18.6 7 18 5.4 15.4 3.4 12.2 6 7 11 6c3-.6 9-2 9-2Z" />
    <path d="M4.5 20c2-4.2 5-7 9.5-9.5" />
  </svg>
)

export const UsersIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5c.6-3 2.9-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
    <path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.6" />
    <path d="M17.6 15.2c2 .6 3.4 2.2 3.9 4.3" />
  </svg>
)

export const PhoneIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M6.2 3.5h2.6l1.5 3.9-2 1.4a11 11 0 0 0 4.9 4.9l1.4-2 3.9 1.5v2.6a2 2 0 0 1-2.2 2A16.3 16.3 0 0 1 4.2 5.7a2 2 0 0 1 2-2.2Z" />
  </svg>
)

export const MailIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="2.8" y="5" width="18.4" height="14" rx="2.5" />
    <path d="m3.5 7.2 8.5 5.8 8.5-5.8" />
  </svg>
)

export const PinIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 21s6.8-6 6.8-11a6.8 6.8 0 1 0-13.6 0C5.2 15 12 21 12 21Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
)

export const CalendarIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.5" />
    <path d="M3.2 10h17.6M8 3.2v4M16 3.2v4" />
  </svg>
)

export const ChevronIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </svg>
)

export const CheckIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
)

export const ArrowIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </svg>
)

export const QuoteIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 32 24" fill="currentColor" aria-hidden focusable="false" className={className}>
    <path d="M13.2 24V12.9C13.2 5.9 17 1.2 24 0l1.3 3.4c-3.9 1-5.9 3.2-6.2 6.2h4.7V24Zm-13.2 0V12.9C0 5.9 3.8 1.2 10.8 0l1.3 3.4c-3.9 1-5.9 3.2-6.2 6.2h4.7V24Z" />
  </svg>
)
