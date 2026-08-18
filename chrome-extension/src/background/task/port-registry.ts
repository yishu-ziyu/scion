export class PortRegistry<T> {
  private readonly ports = new Set<T>();

  add(port: T): void {
    this.ports.add(port);
  }

  release(port: T): boolean {
    if (!this.ports.delete(port)) return false;
    return this.ports.size === 0;
  }

  broadcast(send: (port: T) => void): void {
    for (const port of this.ports) {
      try {
        send(port);
      } catch {
        continue;
      }
    }
  }
}
