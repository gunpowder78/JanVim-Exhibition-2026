import { describe, expect, it } from "vitest";

import type { RuntimeDisplay } from "../src/display-router.ts";
import {
  captureRehearsalDisplays,
  confirmRehearsalDisplayMap,
  parseConfirmedRehearsalDisplayMap,
  parseRehearsalDisplayCatalog,
} from "../src/rehearsal-display-map.ts";

const displays: RuntimeDisplay[] = [
  {
    displayId: 111,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  },
  {
    displayId: 222,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  },
];

describe("rehearsal display map", () => {
  it("captures without guessing roles and confirms only explicit distinct IDs", () => {
    const catalog = captureRehearsalDisplays(displays);
    expect(catalog.mappingStatus).toBe("unconfirmed");
    expect(catalog.displays.map((display) => display.displayId)).toEqual(["111", "222"]);
    expect(catalog.displays.map((display) => display.geometrySha256)).toEqual([
      "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
      "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
    ]);

    const confirmed = confirmRehearsalDisplayMap(catalog, "111", "222");
    expect(confirmed).toMatchObject({
      schema: 1,
      mappingStatus: "confirmed",
      expectedDisplayCount: 2,
      primary: { displayId: "111" },
      secondary: { displayId: "222" },
    });
    expect(() => confirmRehearsalDisplayMap(catalog, "111", "111")).toThrow(
      /distinct/i,
    );
    expect(() => confirmRehearsalDisplayMap(catalog, "111", "missing")).toThrow(
      /captured/i,
    );
  });

  it("rejects capture unless exactly two distinct valid displays are present", () => {
    expect(() => captureRehearsalDisplays(displays.slice(0, 1))).toThrow(/exactly two/i);
    expect(() =>
      captureRehearsalDisplays([
        { ...displays[0]!, scaleFactor: 0 },
        displays[1]!,
      ]),
    ).toThrow(/invalid/i);
    expect(() =>
      captureRehearsalDisplays([
        displays[0]!,
        { ...displays[1]!, displayId: 111 },
      ]),
    ).toThrow(/distinct/i);
  });

  it("strictly parses external catalogs and rejects forged geometry", () => {
    const catalog = captureRehearsalDisplays(displays);
    expect(parseRehearsalDisplayCatalog(catalog)).toEqual(catalog);
    expect(() =>
      parseRehearsalDisplayCatalog({ ...catalog, unexpected: true }),
    ).toThrow();

    const confirmed = confirmRehearsalDisplayMap(catalog, "111", "222");
    expect(parseConfirmedRehearsalDisplayMap(confirmed)).toEqual(confirmed);
    expect(() =>
      parseConfirmedRehearsalDisplayMap({
        ...confirmed,
        primary: { ...confirmed.primary, geometrySha256: "0".repeat(64) },
      }),
    ).toThrow(/hash/i);
  });
});
