export function assetPath(relativePath) {
  return `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, '')}`
}
