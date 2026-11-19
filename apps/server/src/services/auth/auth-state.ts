/** Whether the teacher has logged in since this server process started. */
export class AuthState {
  private loggedIn = false;
  private readonly logoutListeners = new Set<() => void>();

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  setLoggedIn(value: boolean): void {
    const wasIn = this.loggedIn;
    this.loggedIn = value;
    if (wasIn && !value) for (const listener of [...this.logoutListeners]) listener();
  }

  /** Runs `listener` on each logout (open teacher sockets close then, M59); returns the undo. */
  onLogout(listener: () => void): () => void {
    this.logoutListeners.add(listener);
    return () => this.logoutListeners.delete(listener);
  }
}
