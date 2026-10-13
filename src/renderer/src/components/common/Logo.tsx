/** Agentbits mark: a pixel agent with a trail of bits (source: build-resources/icon.svg). */
const LOGO_ROWS = [
  '...........B',
  '.....A...B..',
  '.....H....B.',
  '..HHHHHHHH..',
  '.HHHHHHHHHH.',
  '.HVVVVVVVVH.',
  '.HVEEVVEEVH.',
  '.HVEEVVEEVH.',
  '.HVVVVVVVVH.',
  '.HHHHHHHHHH.',
  '..HHHHHHHH..'
]
const LOGO_FILL: Record<string, string> = { H: '#F4F4FF', V: '#1E1B4B', E: '#FBBF24', A: '#FBBF24', B: '#C4B5FD' }

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-label="Agentbits">
      <defs>
        <linearGradient id="agentbits-logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="16" height="16" rx="3.5" fill="url(#agentbits-logo-bg)" />
      <g shapeRendering="crispEdges">
        {LOGO_ROWS.flatMap((row, y) =>
          [...row].map((ch, x) =>
            LOGO_FILL[ch] ? <rect key={`${x}-${y}`} x={x + 2} y={y + 2} width={1} height={1} fill={LOGO_FILL[ch]} /> : null
          )
        )}
      </g>
    </svg>
  )
}
