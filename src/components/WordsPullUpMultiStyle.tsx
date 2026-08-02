import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

export interface Segment {
  text: string
  className?: string
}

interface WordsPullUpMultiStyleProps {
  segments: Segment[]
  className?: string
}

/* Same pull-up as WordsPullUp, but the stagger has to run across the whole
   heading rather than restart per segment, so the segments are flattened to a
   single word list first and each word carries its own class. */
export default function WordsPullUpMultiStyle({
  segments,
  className = '',
}: WordsPullUpMultiStyleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  const words = segments.flatMap((segment) =>
    segment.text
      .split(' ')
      .filter(Boolean)
      .map((word) => ({ word, className: segment.className ?? '' })),
  )

  return (
    <div ref={ref} className={className}>
      <span className="inline-flex flex-wrap justify-center">
        {words.map(({ word, className: wordClass }, i) => (
          <motion.span
            key={`${word}-${i}`}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{
              duration: 0.6,
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={`inline-block ${wordClass}`}
            style={{ marginRight: '0.25em' }}
          >
            {word}
          </motion.span>
        ))}
      </span>
    </div>
  )
}
