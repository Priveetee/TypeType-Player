export function ensurePlayerAlive(destroyed: boolean): void {
  if (destroyed) throw new Error("Player is destroyed");
}

export class PlayerOperation {
  private controller = new AbortController();
  private revision = 0;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  next(): number {
    this.controller.abort();
    this.controller = new AbortController();
    this.revision += 1;
    return this.revision;
  }

  abort(): void {
    this.controller.abort();
  }

  isCurrent(expectedRevision: number): boolean {
    return this.revision === expectedRevision && !this.controller.signal.aborted;
  }

  ensureCurrent(destroyed: boolean, expectedRevision: number): void {
    if (destroyed || this.revision !== expectedRevision || this.controller.signal.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }
  }
}
