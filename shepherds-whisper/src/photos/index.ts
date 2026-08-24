/* Which photographs actually exist, resolved at build time.
 *
 * Drop a file into this folder named after the slot it fills — `living-room.jpg`,
 * `garden.webp` — and it appears on the page with no code change. Nothing else
 * is required, and nothing needs removing when a slot is still empty.
 *
 * This is a build-time glob rather than a `public/img/` path on purpose. A bare
 * <img src> for a photo that has not been taken yet fires a request and logs a
 * 404 on every page load, which looks like a broken site to anyone who opens
 * devtools — and the placeholder only appeared after that round trip failed.
 * Here the component knows before it renders. */

const modules = import.meta.glob('./*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export const photos: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([filePath, url]) => [
    filePath.replace(/^\.\//, '').replace(/\.[^.]+$/, ''),
    url,
  ]),
)
