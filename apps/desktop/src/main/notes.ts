import type { Note } from "../shared/ipc";
import { JsonFile } from "./stores";

/** What one note may hold: a long letter, not a book. */
export const NOTE_MAX = 200_000;

/**
 * Notes kept on this computer in the account's own folder: drafts (drafts.json) and teleprompter
 * scripts (scripts.json), one store each (the Mac's NotesStore, faf6e42, 70e8535). A note is its text,
 * when it was made and changed, whether it is pinned, and for a script its own settings.
 */
export class NotesStore {
  private readonly file: JsonFile<Note[]>;
  private items: Note[] | null = null;

  constructor(path: () => string) {
    this.file = new JsonFile(path, []);
  }

  /** What is held belongs to the account that just signed out. */
  forget(): void {
    this.items = null;
  }

  async list(): Promise<Note[]> {
    return [...(await this.load())];
  }

  /**
   * Adds or changes one: only the fields given change (pinning keeps the text; the text keeps the
   * pin). A new one takes the id given, so a tab opened before its first word keeps its place.
   */
  async save(patch: Partial<Note> & { id: string }): Promise<Note> {
    if (patch.text !== undefined && patch.text.length > NOTE_MAX)
      throw new Error("This is too long to keep here. Split it into two.");
    const items = await this.load();
    const now = Date.now();
    const before = items.find((item) => item.id === patch.id);
    const note: Note = {
      ...before,
      ...patch,
      text: patch.text ?? before?.text ?? "",
      createdAt: before?.createdAt ?? now,
      updatedAt: patch.text !== undefined && patch.text !== before?.text ? now : (before?.updatedAt ?? now),
    };
    this.items = before ? items.map((item) => (item.id === note.id ? note : item)) : [note, ...items];
    await this.file.write(this.items);
    return note;
  }

  async remove(id: string): Promise<void> {
    this.items = (await this.load()).filter((item) => item.id !== id);
    await this.file.write(this.items);
  }

  private async load(): Promise<Note[]> {
    this.items ??= await this.file.read();
    return this.items;
  }
}
