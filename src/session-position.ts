export function shouldApplySessionPosition(startTimeMs: number, isSeek: boolean): boolean {
  return isSeek || startTimeMs > 0;
}
