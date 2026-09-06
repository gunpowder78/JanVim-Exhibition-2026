import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

const modulePath = new URL("../site-mix.mjs", import.meta.url);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "janvim-site-mix-"));
  const directory = path.join(root, "site-config");
  const profilePath = path.join(directory, "sound-mix-v1.json");
  return {
    directory,
    profilePath,
    root,
    async close() { await rm(root, { force: true, recursive: true }); },
  };
}

test("site mix parser accepts only the exact bounded integer schema", async () => {
  const { parseSiteMix } = await import(modulePath);
  assert.deepEqual(
    parseSiteMix(Buffer.from('{"schema":1,"windGainDb":-3,"instrumentGainDb":2}\n')),
    { schema: 1, windGainDb: -3, instrumentGainDb: 2 },
  );

  for (const value of [
    '{"schema":1,"windGainDb":0,"instrumentGainDb":0,"extra":1}\n',
    '{"schema":1,"windGainDb":0,"wind\\u0047ainDb":1,"instrumentGainDb":0}\n',
    '{"schema":1,"windGainDb":0.5,"instrumentGainDb":0}\n',
    '{"schema":1,"windGainDb":-25,"instrumentGainDb":0}\n',
    '{"schema":1,"windGainDb":0,"instrumentGainDb":7}\n',
    '{"schema":2,"windGainDb":0,"instrumentGainDb":0}\n',
    '{"schema":1,"windGainDb":0,"instrumentGainDb":0}\r\n',
    `${'{"schema":1,"windGainDb":0,"instrumentGainDb":0}'.padEnd(4096, " ")}\n`,
  ]) assert.throws(() => parseSiteMix(Buffer.from(value)), /site-mix-invalid/u);
});

test("missing profile starts at zero and first adjustment creates one canonical file", async (t) => {
  const value = await fixture();
  t.after(() => value.close());
  const { openSiteMixStore } = await import(modulePath);
  const store = await openSiteMixStore({ profilePath: value.profilePath });

  assert.deepEqual(store.snapshot(), {
    windGainDb: 0, instrumentGainDb: 0, persistence: "saved",
  });
  assert.deepEqual(store.take(), {
    kind: "site-mix", windGainDb: 0, instrumentGainDb: 0,
  });
  assert.equal(store.take(), null);
  assert.equal(store.profileHash(), null);

  assert.deepEqual(await store.adjust("wind", -1), {
    ok: true, windGainDb: -1, instrumentGainDb: 0,
  });
  assert.equal(
    await readFile(value.profilePath, "utf8"),
    '{"schema":1,"windGainDb":-1,"instrumentGainDb":0}\n',
  );
  assert.match(store.profileHash(), /^[0-9a-f]{64}$/u);
  assert.deepEqual(store.snapshot(), {
    windGainDb: -1, instrumentGainDb: 0, persistence: "saved",
  });
  assert.deepEqual(store.take(), {
    kind: "site-mix", windGainDb: -1, instrumentGainDb: 0,
  });
  assert.deepEqual(await readdirNames(value.directory), ["sound-mix-v1.json"]);

  const reopened = await openSiteMixStore({ profilePath: value.profilePath });
  assert.deepEqual(reopened.snapshot(), {
    windGainDb: -1, instrumentGainDb: 0, persistence: "saved",
  });
  assert.deepEqual(reopened.take(), {
    kind: "site-mix", windGainDb: -1, instrumentGainDb: 0,
  });
});

test("serialized adjustments clamp each stem and coalesce sender state", async (t) => {
  const value = await fixture();
  t.after(() => value.close());
  await mkdir(value.directory);
  await writeFile(value.profilePath,
    '{"schema":1,"windGainDb":5,"instrumentGainDb":-23}\n', "utf8");
  const { openSiteMixStore } = await import(modulePath);
  const store = await openSiteMixStore({ profilePath: value.profilePath });
  store.take();

  const results = await Promise.all([
    store.adjust("wind", 1),
    store.adjust("wind", 1),
    store.adjust("instrument", -1),
    store.adjust("instrument", -1),
  ]);
  assert.deepEqual(results, [
    { ok: true, windGainDb: 6, instrumentGainDb: -23 },
    { ok: true, windGainDb: 6, instrumentGainDb: -23 },
    { ok: true, windGainDb: 6, instrumentGainDb: -24 },
    { ok: true, windGainDb: 6, instrumentGainDb: -24 },
  ]);
  assert.deepEqual(store.take(), {
    kind: "site-mix", windGainDb: 6, instrumentGainDb: -24,
  });
  assert.equal(store.take(), null);
  assert.equal(
    await readFile(value.profilePath, "utf8"),
    '{"schema":1,"windGainDb":6,"instrumentGainDb":-24}\n',
  );
});

test("invalid existing profile fails closed without overwriting it", async (t) => {
  const value = await fixture();
  t.after(() => value.close());
  await mkdir(value.directory);
  const invalid = '{"schema":1,"windGainDb":99,"instrumentGainDb":0}\n';
  await writeFile(value.profilePath, invalid, "utf8");
  const { openSiteMixStore } = await import(modulePath);
  const store = await openSiteMixStore({ profilePath: value.profilePath });

  assert.deepEqual(store.snapshot(), {
    windGainDb: 0, instrumentGainDb: 0, persistence: "save-error",
  });
  assert.deepEqual(await store.adjust("wind", 1), {
    ok: false, reason: "save-failed", windGainDb: 0, instrumentGainDb: 0,
  });
  assert.equal(await readFile(value.profilePath, "utf8"), invalid);
  assert.equal(store.take().windGainDb, 0);
  assert.equal(store.take(), null);
});

test("hard-linked or reparse-point profile inputs are never replaced", async (t) => {
  const hard = await fixture();
  const soft = await fixture();
  t.after(async () => { await hard.close(); await soft.close(); });
  const { openSiteMixStore } = await import(modulePath);

  await mkdir(hard.directory);
  const sibling = path.join(hard.directory, "sibling.json");
  const original = '{"schema":1,"windGainDb":0,"instrumentGainDb":0}\n';
  await writeFile(sibling, original, "utf8");
  await link(sibling, hard.profilePath);
  const hardStore = await openSiteMixStore({ profilePath: hard.profilePath });
  assert.equal(hardStore.snapshot().persistence, "save-error");
  assert.equal((await hardStore.adjust("wind", 1)).ok, false);
  assert.equal(await readFile(sibling, "utf8"), original);

  await mkdir(soft.directory);
  const target = path.join(soft.root, "target.json");
  await writeFile(target, original, "utf8");
  try {
    await symlink(target, soft.profilePath, "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.diagnostic("Windows symlink fixture not run: host lacks symlink privilege");
      return;
    }
    throw error;
  }
  const softStore = await openSiteMixStore({ profilePath: soft.profilePath });
  assert.equal(softStore.snapshot().persistence, "save-error");
  assert.equal((await softStore.adjust("instrument", 1)).ok, false);
  assert.equal(await readFile(target, "utf8"), original);
});

test("a profile changed after load is not overwritten", async (t) => {
  const value = await fixture();
  t.after(() => value.close());
  await mkdir(value.directory);
  const original = '{"schema":1,"windGainDb":0,"instrumentGainDb":0}\n';
  const external = '{"schema":1,"windGainDb":-6,"instrumentGainDb":2}\n';
  await writeFile(value.profilePath, original, "utf8");
  const { openSiteMixStore } = await import(modulePath);
  const store = await openSiteMixStore({ profilePath: value.profilePath });
  await writeFile(value.profilePath, external, "utf8");

  assert.deepEqual(await store.adjust("wind", 1), {
    ok: false, reason: "save-failed", windGainDb: 0, instrumentGainDb: 0,
  });
  assert.equal(await readFile(value.profilePath, "utf8"), external);
  assert.deepEqual(store.snapshot(), {
    windGainDb: 0, instrumentGainDb: 0, persistence: "save-error",
  });
});

test("invalid request and invalid destination path never mutate state", async (t) => {
  const value = await fixture();
  t.after(() => value.close());
  const { openSiteMixStore } = await import(modulePath);
  await assert.rejects(
    () => openSiteMixStore({ profilePath: path.join(value.root, "wrong.json") }),
    /site-mix-path-invalid/u,
  );
  const store = await openSiteMixStore({ profilePath: value.profilePath });
  await assert.rejects(() => store.adjust("master", 1), /site-mix-adjust-invalid/u);
  await assert.rejects(() => store.adjust("wind", 2), /site-mix-adjust-invalid/u);
  assert.deepEqual(store.snapshot(), {
    windGainDb: 0, instrumentGainDb: 0, persistence: "saved",
  });
});

async function readdirNames(directory) {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(directory)).sort();
}
