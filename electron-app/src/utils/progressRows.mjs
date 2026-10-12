function clampProgress(value) {
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(nextValue)))
}

export function buildProgressRows(totalProgress, currentVideoProgress) {
  return [
    {
      key: 'total',
      label: '总体进度',
      value: clampProgress(totalProgress)
    },
    {
      key: 'current',
      label: '当前视频',
      value: clampProgress(currentVideoProgress)
    }
  ]
}
