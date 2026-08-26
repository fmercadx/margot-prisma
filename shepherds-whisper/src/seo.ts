import { business, hasAddress, hasPhone, locality } from './content/business'

/* Structured data is built from `business.ts` rather than duplicated into
   index.html, so there is exactly one place to edit a phone number. Fields that
   are still unknown are omitted entirely — an empty `telephone` in a schema.org
   payload is worse than no `telephone` at all. */
export function injectStructuredData() {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ResidentialCareFacility',
    name: business.legalName,
    alternateName: business.name,
    description: `${business.name} is a licensed adult foster home in ${locality} providing 24-hour personal care, meals, medication management and memory care for older adults and adults living with disabilities.`,
    url: window.location.origin,
    areaServed: locality,
    availableService: [
      'Personal care',
      'Medication management',
      'Memory care',
      'Respite care',
      'Hospice-supportive care',
    ].map((name) => ({ '@type': 'Service', name })),
  }

  if (hasPhone) data.telephone = business.phone
  if (business.email) data.email = business.email

  if (hasAddress) {
    data.address = {
      '@type': 'PostalAddress',
      streetAddress: business.address.street,
      addressLocality: business.address.city,
      addressRegion: business.address.state,
      postalCode: business.address.zip,
      addressCountry: 'US',
    }
  }

  const sameAs = Object.values(business.social).filter(Boolean)
  if (sameAs.length) data.sameAs = sameAs

  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.textContent = JSON.stringify(data)
  document.head.appendChild(script)
}
