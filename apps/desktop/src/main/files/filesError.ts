/** A refusal the Files panel shows to the student as it is: bad name, over a limit, not found. */
export class FilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilesError';
  }
}
