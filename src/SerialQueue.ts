/** Runs operations in order without allowing a rejection to block later work. */
export class SerialQueue {
  private _pending: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._pending.then(operation, operation);
    this._pending = run.then(() => undefined, () => undefined);
    return run;
  }
}
