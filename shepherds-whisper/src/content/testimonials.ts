/* ---------------------------------------------------------------------------
 * Real families only.
 *
 * This array ships empty on purpose, and the Testimonials section does not
 * render at all while it is. Invented reviews on a care-home site are not a
 * harmless placeholder: they are the exact thing an anxious family is relying
 * on to be true, and fabricated endorsements are treated as deceptive
 * advertising under the FTC's endorsement rules (16 CFR Part 255).
 *
 * Add entries only with the family's permission. `attribution` should say who
 * is speaking and their relationship to the resident — "Daughter of a
 * resident" is enough, and initials or a first name are fine.
 * ------------------------------------------------------------------------- */

export type Testimonial = {
  quote: string
  attribution: string
  /** Optional: "Google review, March 2026", "Letter, 2025". */
  source?: string
}

export const testimonials: Testimonial[] = [
  // {
  //   quote: 'They called me the morning Dad stopped finishing his breakfast...',
  //   attribution: 'Daughter of a resident',
  //   source: 'Google review, 2026',
  // },
]
