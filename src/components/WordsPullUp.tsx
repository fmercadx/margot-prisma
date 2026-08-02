import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

interface WordsPullUpProps {
  text: string
  className?: string
  /* Hangs a superscript asterisk off the final "a" of the last word. Only the
     hero uses it, but it has to live in here: the asterisk is positioned
     against the letter, so it cannot be appended from outside. */
  showAsterisk?: boolean
  delayOffset?: number
}

export default function WordsPullUp({
  text,
  className = '',
  showAsterisk = false,
  delayOffset = 0,
}: WordsPullUpProps) {
  const words = text.split(' ')
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  return (
    <div ref={ref} className={className}>
      {words.map((word, i) => {
        const isLast = i === words.length - 1

        return (
          <motion.span
            key={`${word}-${i}`}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{
              duration: 0.6,
              delay: delayOffset + i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="inline-block"
            style={{ marginRight: isLast ? 0 : '0.25em' }}
          >
            {showAsterisk && isLast ? (
              <span className="relative inline-block">
                {word}
                <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">
                  *
                </span>
              </span>
            ) : (
              word
            )}
          </motion.span>
        )
      })}
    </div>
  )
}
