export function getInitials(name) {
  const words = name.split(' ')
  let initials = ''

  if (words.length > 0) {
    initials += words[0].charAt(0).toUpperCase()
    if (words.length > 1) {
      initials += words[1].charAt(0).toUpperCase()
    }
  }

  return initials
}
