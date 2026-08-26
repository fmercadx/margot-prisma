/* ---------------------------------------------------------------------------
 * EDIT THIS FILE, NOT THE COMPONENTS.
 *
 * Every fact about the business lives here exactly once. Nothing factual is
 * hardcoded in a component, so updating a phone number is a one-line change
 * that cannot leave a stale copy behind in a footer somewhere.
 *
 * Fields left as an empty string are TREATED AS UNKNOWN AND HIDDEN rather than
 * rendered blank. That is deliberate. A licensed adult foster home is a
 * regulated business, and an invented licence number, address, or capacity on
 * a live page is a real problem — not a placeholder to tidy up later. So the
 * page degrades gracefully until you fill these in:
 *
 *   phone          -> call buttons appear; until then CTAs point at the form
 *   email          -> the contact card shows an email row
 *   address        -> the contact card shows a street address and map link
 *   licenceNumber  -> the licence badge shows the number beside the seal
 *   capacity       -> the "X residents" figures appear in copy and stats
 *   city / state   -> currently set below; CHECK THESE BEFORE LAUNCH
 * ------------------------------------------------------------------------- */

export type Business = typeof business

export const business = {
  legalName: "The Shepherd's Whisper AFH LLC",
  name: "The Shepherd's Whisper",

  /* Oregon. "AFH" here is Adult Foster Home, licensed under ORS 443.705 to
     443.825 and OAR chapter 411 division 50 — not Washington's Adult Family
     Home, which is a different statute with a different resident cap. The
     wording throughout the site follows Oregon: "adult foster home", five or
     fewer residents, ODHS as the licensing agency. */
  tagline: 'Adult Foster Home',

  city: 'Hillsboro',
  state: 'Oregon',
  licensingBody: 'Oregon Department of Human Services',
  licensingBodyShort: 'Oregon DHS',

  /* Oregon's public Licensed Long-Term Care Settings Search. This is the one
     to link, not the department's front door: it carries provider profiles,
     inspection reports, substantiated violations and regulatory actions, and
     it refreshes every 24 hours. Sending families somewhere they can check us
     against the record is the point of the link. */
  licensingUrl: 'https://ltclicensing.oregon.gov/',

  phone: '(503) 821-9608',
  email: '',
  address: {
    street: '285 NW 334th Ave',
    city: 'Hillsboro',
    state: 'OR',
    zip: '97124',
  },

  licenceNumber: '',

  /* Oregon licenses adult foster homes as Class 1, 2 or 3 by the level of care
     the home is approved to provide. Families ask about it, so the FAQ answer
     names the class once this is set, and stays general while it is blank. */
  licenceClass: '',

  capacity: '',

  hours: 'Care is provided 24 hours a day, every day of the year.',
  tourHours: 'Tours are welcome seven days a week, by appointment.',

  /* Public profile links. Empty entries are dropped from the footer. */
  social: {
    facebook: '',
    instagram: '',
    google: '',
  },
} as const

/* ---- derived helpers ---------------------------------------------------- */

/** `(503) 821-9608` -> `tel:+15038219608`, for the call buttons.
 *
 * Normalised to E.164 rather than passed through as typed: a bare ten-digit
 * href dials from a US handset but not from one roaming or set to another
 * country, and the person reading this is often an adult child out of state. */
export const telHref = (phone: string) => {
  const digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return `tel:${digits}`
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:${digits}`
}

/** The one-line locality used in headings and the schema.org payload. */
export const locality = (() => {
  const city = business.city || business.address.city
  return city ? `${city}, ${business.state}` : business.state
})()

export const hasPhone = business.phone.length > 0
export const hasAddress = business.address.street.length > 0
