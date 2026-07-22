export async function copyTextToClipboard(value: string, timeoutMs = 800) {
  const fallbackCopy = () => {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    if (!copied) throw new Error('Clipboard fallback failed')
  }

  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('Clipboard timeout')), timeoutMs)
        }),
      ])
    } else {
      fallbackCopy()
    }
  } catch {
    fallbackCopy()
  }
}
