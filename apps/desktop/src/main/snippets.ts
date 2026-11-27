import { plain, type Snippet, snippetFrom } from "@subx/core";
import type { SnippetItem } from "../shared/ipc";
import { JsonFile } from "./stores";

/** What one snippet may hold (the Mac's SnippetSheet): said under 60 letters, typed under 10,000. */
export const TRIGGER_MAX = 60;
export const TEXT_MAX = 10_000;

/**
 * The person's snippets, kept on this computer in the account's own folder (snippets.json, as the
 * Mac's NotesStore "snippet"). The text of a snippet is never sent anywhere.
 */
export class SnippetStore {
  private readonly file: JsonFile<SnippetItem[]>;
  private items: SnippetItem[] | null = null;

  constructor(path: () => string) {
    this.file = new JsonFile(path, []);
  }

  /** What is held belongs to the account that just signed out. */
  forget(): void {
    this.items = null;
  }

  async list(): Promise<SnippetItem[]> {
    return [...(await this.load())];
  }

  /** The ones a dictation can use. */
  async usable(): Promise<Snippet[]> {
    return (await this.load()).map(snippetFrom).filter((item): item is Snippet => item !== null);
  }

  /**
   * Adds or changes one. Refused with a sentence the sheet can show: something too long, or words
   * another snippet already uses (the Mac checks these in its sheet; here they hold for any caller).
   */
  async save(input: { id?: string; triggers: string[]; text: string }): Promise<SnippetItem> {
    const triggers = input.triggers.map((item) => item.trim()).filter((item) => plain(item) !== "");
    const text = input.text.replace(/^\n+|\n+$/g, "");
    if (!triggers.length || !text.trim()) throw new Error("Say what to type, and what you will say for it.");
    const long = triggers.find((item) => [...item].length > TRIGGER_MAX);
    if (long)
      throw new Error(
        `"${[...long].slice(0, 24).join("")}..." is long to say. Keep what you say under 60 letters.`,
      );
    if ([...text].length > TEXT_MAX)
      throw new Error("The text is too long for a snippet. Keep it under 10,000 letters.");
    const items = await this.load();
    const mine = new Set(triggers.map(plain));
    const other = items.find(
      (item) => item.id !== input.id && item.triggers.some((said) => mine.has(plain(said))),
    );
    if (other) {
      const clash = other.triggers.find((said) => mine.has(plain(said))) ?? "";
      throw new Error(`Another snippet already uses "${clash}".`);
    }
    const now = Date.now();
    const before = items.find((item) => item.id === input.id);
    const item: SnippetItem = {
      ...before,
      id: before?.id ?? crypto.randomUUID(),
      triggers,
      text,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    this.items = [item, ...items.filter((entry) => entry.id !== item.id)];
    await this.file.write(this.items);
    return item;
  }

  async remove(id: string): Promise<void> {
    this.items = (await this.load()).filter((item) => item.id !== id);
    await this.file.write(this.items);
  }

  /** How often each snippet went in, for its page. */
  async used(id: string): Promise<void> {
    const items = await this.load();
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    item.uses = (item.uses ?? 0) + 1;
    item.lastUsedAt = Date.now();
    await this.file.write(items);
  }

  async text(id: string): Promise<string> {
    return (await this.load()).find((item) => item.id === id)?.text ?? "";
  }

  private async load(): Promise<SnippetItem[]> {
    this.items ??= await this.file.read();
    return this.items;
  }
}
