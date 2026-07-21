export class PlaybackLoopTaskController {
  private controller = new AbortController();
  private operationSignal: AbortSignal | null = null;
  private detachOperationAbort: (() => void) | null = null;

  stop(): void {
    this.controller.abort();
    this.detachOperationAbort?.();
    this.detachOperationAbort = null;
    this.operationSignal = null;
  }

  signal(operationSignal: AbortSignal): AbortSignal {
    if (!this.controller.signal.aborted && this.operationSignal === operationSignal) {
      return this.controller.signal;
    }
    this.detachOperationAbort?.();
    const controller = new AbortController();
    this.controller = controller;
    this.operationSignal = operationSignal;
    if (operationSignal.aborted) {
      controller.abort();
      this.detachOperationAbort = null;
      return controller.signal;
    }
    const abort = () => controller.abort();
    operationSignal.addEventListener("abort", abort, { once: true });
    this.detachOperationAbort = () => operationSignal.removeEventListener("abort", abort);
    return controller.signal;
  }
}
