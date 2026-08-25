/* ---------------------------------------------------------------------------
 * Real people only.
 *
 * This array ships empty, and while it is empty the Caregivers section still
 * renders — it just shows the standards every caregiver here is held to,
 * instead of profiles. That is deliberate. An invented caregiver is worse than
 * an invented testimonial: a family reads these names expecting to meet them on
 * the tour, and a photograph of a stranger presented as your staff is the kind
 * of claim the FTC treats as deceptive advertising.
 *
 * Add someone only with their permission. Nothing here is required beyond a
 * name, a role and a line about them.
 *
 * For a portrait, drop `team-<slug>.jpg` into `src/photos/` and set `photo` to
 * that slot name. Without one the card shows their initials, which looks
 * deliberate rather than missing — a monogram is a fine way to run this section
 * permanently if your team would rather not be photographed.
 * ------------------------------------------------------------------------- */

export type Caregiver = {
  name: string
  /** "Owner and provider", "Caregiver", "Resident manager", "Cook". */
  role: string
  /** Optional: "With us since 2019", "Fourteen years in dementia care". */
  tenure?: string
  /** A sentence or two. What they are like to be cared for by, not a CV. */
  bio: string
  /** Slot name in `src/photos/`, e.g. 'team-maria' for team-maria.jpg. */
  photo?: string
}

export const caregivers: Caregiver[] = [
  // {
  //   name: 'Maria Alvarez',
  //   role: 'Owner and provider',
  //   tenure: 'Caring for older adults since 2011',
  //   bio: 'Maria trained as a caregiver looking after her own grandmother...',
  //   photo: 'team-maria',
  // },
]
