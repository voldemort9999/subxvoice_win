import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceHeader, deviceId } from "./device";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "subx-device-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("device", () => {
  it("makes a random id once and keeps it", async () => {
    const first = deviceId(dir);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(deviceId(dir)).toBe(first);
    expect((await readFile(join(dir, "device-id"), "utf8")).trim()).toBe(first);
  });

  it("replaces a broken id file with a new id", async () => {
    await writeFile(join(dir, "device-id"), "my-macbook");
    expect(deviceId(dir)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("builds the header the server reads", () => {
    const id = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    expect(deviceHeader(id, "Apple M2", "26.1")).toBe(`id=${id}; chip=Apple M2; os=26.1`);
    expect(deviceHeader(id, "Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz", "15.6")).toBe(
      `id=${id}; chip=Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz; os=15.6`,
    );
  });

  it("cleans what the server would drop, and leaves out what is empty", () => {
    const id = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    expect(deviceHeader(id, "Apple M2; os=hack", "")).toBe(`id=${id}; chip=Apple M2 oshack`);
    expect(deviceHeader(id, "", "26.1")).toBe(`id=${id}; os=26.1`);
  });
});
