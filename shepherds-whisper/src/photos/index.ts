/* Which artwork exists for each slot, resolved at build time.
 *
 * Two kinds of file live here. The `.svg` files are original illustrations
 * drawn for this site — they are what the page ships with today. A photograph
 * dropped in beside one, under the same slot name, takes over automatically:
 * raster wins over SVG, so replacing an illustration with a real photo of the
 * home means adding a file and nothing else.
 *
 * A build-time glob rather than a `public/img/` path on purpose. A bare <img>
 * src for a slot with no file fires a request and logs a 404 on every page
 * load; here the component knows before it renders.
 */

/* The options object must be written inline at each call. Hoisting it to a
   const defeats Vite's static analysis, and the glob silently degrades to lazy
   dynamic imports whose URLs 404 at runtime. */
const drawings = import.meta.glob('./*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const photographs = import.meta.glob('./*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const slot = (filePath: string) => filePath.replace(/^\.\//, '').replace(/\.[^.]+$/, '')

const toEntries = (modules: Record<string, string>) =>
  Object.entries(modules).map(([filePath, url]) => [slot(filePath), url] as const)

/* Photographs are spread last, so a real photo overrides the illustration for
   the same slot rather than depending on glob ordering. */
export const photos: Record<string, string> = Object.fromEntries([
  ...toEntries(drawings),
  ...toEntries(photographs),
])
