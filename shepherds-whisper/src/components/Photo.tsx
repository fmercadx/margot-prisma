import { LeafIcon } from './Icons'
import { photos } from '../photos'

type PhotoProps = {
  /** Slot name — a file called `<name>.jpg` in `src/photos/` fills it. */
  name: string
  /** The caption, and the alt text once a real photograph exists. */
  caption: string
  className?: string
  /** Shown on the placeholder as a note to whoever takes the photograph. */
  hint?: string
  /** Render the caption under the image, not only on the placeholder. */
  captionBelow?: boolean
}

/* Renders the photograph for this slot, or a designed panel when there is not
 * one yet.
 *
 * The home's real photographs are not in the repository, and stock images of
 * somebody else's care home would misrepresent the house to families deciding
 * where a parent is going to live. So the fallback is a deliberate part of the
 * layout rather than a broken image: it reserves the same space, carries the
 * same caption, and steps aside the moment a file appears in `src/photos/`.
 * See that folder's README for the slot names. */
export default function Photo({ name, caption, className = '', hint, captionBelow }: PhotoProps) {
  const src = photos[name]

  /* The artwork shipped with the site is illustration, not photography. Saying
     so in the alt text costs nothing and stops a screen reader announcing a
     drawing as a picture of the actual room. A real photograph dropped into
     src/photos/ is not an .svg, so it loses the prefix automatically. */
  const isDrawing = Boolean(src?.endsWith('.svg'))
  const alt = isDrawing ? `Illustration — ${caption}` : caption

  return (
    <figure className={captionBelow ? 'w-full' : className}>
      {/* The sizing class has to land on whichever element clips the image.
          With a caption below, that is the inner box — leaving the aspect ratio
          on the <figure> would make the caption overflow the sized area. */}
      <div
        className={`group relative overflow-hidden rounded-4xl bg-linen shadow-soft ${
          captionBelow ? className : 'h-full w-full'
        }`}
      >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-linen via-sand/70 to-slate-mist/60 p-6 text-center">
          {/* A dashed rule so an empty slot reads as a reserved space rather
              than an image that is still loading. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-3 rounded-[1.6rem] border border-dashed border-sand-deep/70"
          />
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-cream/80 text-slate-deep">
            <LeafIcon className="h-5 w-5" />
          </span>
          <figcaption className="font-display text-lg leading-snug text-navy">{caption}</figcaption>
          {hint && <p className="max-w-[24ch] text-sm leading-snug text-navy-soft">{hint}</p>}
        </div>
      )}
      </div>

      {captionBelow && src && (
        <figcaption className="mt-3 text-[0.92rem] font-medium text-navy-soft">{caption}</figcaption>
      )}
    </figure>
  )
}
