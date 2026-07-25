export class ProcessingQueue {
  private activeFiles = new Set<string>();
  private dateChains = new Map<string, Promise<void>>();

  isFileActive(path: string): boolean {
    return this.activeFiles.has(path);
  }

  async runForFile(path: string, dateKey: string, task: () => Promise<void>): Promise<void> {
    if (this.activeFiles.has(path)) return;
    this.activeFiles.add(path);
    const previous = this.dateChains.get(dateKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        this.activeFiles.delete(path);
        if (this.dateChains.get(dateKey) === next) {
          this.dateChains.delete(dateKey);
        }
      });
    this.dateChains.set(dateKey, next);
    await next;
  }
}
