export function scrollLogToBottom(element) {
  if (!element) {
    return
  }
  element.scrollTop = element.scrollHeight
}
