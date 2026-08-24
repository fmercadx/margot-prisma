/* ---------------------------------------------------------------------------
 * EDIT THIS FILE, NOT THE COMPONENTS.
 *
 * Every fact about the business lives here exactly once. Nothing factual is
 * hardcoded in a component, so updating a phone number is a one-line change
 * that cannot leave a stale copy behind in a footer somewhere.
 *
 * Fields left as an empty string are TREATED AS UNKNOWN AND HIDDEN rather than
 * rendered blank. That is deliberate. A licensed adult family home is a
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
  tagline: 'Adult Family Home',

  /* CHECK BEFORE LAUNCH. "AFH" is Washington State's term for this licence
     class, so Washington is the assumption baked in here. If the home is in
     Oregon or Michigan (which also use "AFH"), change `state`, `licensingBody`
     and `licensingUrl` together — the FAQ copy reads from all three. */
  city: '',
  state: 'Washington',
  licensingBody: 'Washington State Department of Social and Health Services',
  licensingBodyShort: 'Washington State DSHS',
  licensingUrl: 'https://www.dshs.wa.gov/altsa/residential-care-services/adult-family-homes',

  phone: '',
  email: '',
  address: {
    street: '',
    city: '',
    state: 'WA',
    zip: '',
  },

  licenceNumber: '',
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

/** `+1-360-555-0100` -> `tel:+13605550100`, for the call buttons. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** The one-line locality used in headings and the schema.org payload. */
export const locality = (() => {
  const city = business.city || business.address.city
  return city ? `${city}, ${business.state}` : business.state
})()

export const hasPhone = business.phone.length > 0
export const hasAddress = business.address.street.length > 0
