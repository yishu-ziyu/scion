export class PortLease<T extends { disconnect(): void }> {
  private active: T | null = null;

  get current(): T | null {
    return this.active;
  }

  replace(next: T): void {
    const previous = this.active;
    this.active = next;
    if (previous && previous !== next) previous.disconnect();
  }

  release(port: T): boolean {
    if (this.active !== port) return false;
    this.active = null;
    return true;
  }
}
