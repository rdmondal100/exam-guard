/** Whether the teacher has logged in since this server process started. */
export class AuthState {
  private loggedIn = false;

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  setLoggedIn(value: boolean): void {
    this.loggedIn = value;
  }
}
