import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  mountDisplayConfigurator,
  type DisplayConfiguratorApi,
  type DisplayConfiguratorSnapshot,
  type SaveDisplayMapRequest,
} from "../src/model.ts";

const TOKEN = "2".repeat(64);

function display(
  number: number,
  displayId: string,
  x: number,
): DisplayConfiguratorSnapshot["displays"][number] {
  return {
    number,
    displayId,
    label: `Projector ${displayId}`,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workingArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    geometrySha256: String(number).repeat(64),
  };
}

class RecordingApi implements DisplayConfiguratorApi {
  public readonly saved: SaveDisplayMapRequest[] = [];
  public identified = 0;
  public closed = 0;

  public constructor(
    private readonly snapshot: DisplayConfiguratorSnapshot,
  ) {}

  public async getSnapshot(): Promise<DisplayConfiguratorSnapshot> {
    return this.snapshot;
  }

  public async identifyDisplays(topologySha256: string): Promise<void> {
    if (topologySha256 !== this.snapshot.topologySha256) {
      throw new Error("stale topology");
    }
    this.identified += 1;
  }

  public async closeIdentifyDisplays(topologySha256: string): Promise<void> {
    if (topologySha256 !== this.snapshot.topologySha256) {
      throw new Error("stale topology");
    }
    this.closed += 1;
  }

  public async saveDisplayMap(request: SaveDisplayMapRequest): Promise<void> {
    this.saved.push(request);
  }
}

function createDocument(): Document {
  return new JSDOM(
    "<!doctype html><html><body><main data-display-configurator></main></body></html>",
    { url: "file:///display-configurator/index.html" },
  ).window.document;
}

function select(document: Document, softId: string): HTMLSelectElement {
  const element = document.querySelector<HTMLSelectElement>(
    `[data-role='${softId}']`,
  );
  if (element === null) throw new Error(`missing role selector: ${softId}`);
  return element;
}

function change(element: HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("change", {
    bubbles: true,
  }));
}

function click(element: Element): void {
  element.dispatchEvent(new element.ownerDocument.defaultView!.MouseEvent("click", {
    bubbles: true,
  }));
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("manual display configurator DOM model", () => {
  it("renders stable physical numbering and starts with every role unassigned", async () => {
    const document = createDocument();
    const api = new RecordingApi({
      topologySha256: TOKEN,
      displays: [display(1, "A", 0), display(2, "B", 1920), display(3, "C", 3840)],
      allowedModes: ["production-3"],
    });

    await mountDisplayConfigurator(document, api);

    expect(
      [...document.querySelectorAll("[data-display-number]")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["1", "2", "3"]);
    expect(select(document, "SCREEN-1").value).toBe("");
    expect(select(document, "SCREEN-2").value).toBe("");
    expect(select(document, "SCREEN-3").value).toBe("");
    expect(
      document.querySelector<HTMLButtonElement>("[data-save]")?.disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain("JanVim");
    expect(document.body.textContent).toContain("Narrative");
    expect(document.body.textContent).toContain("Jianshan standby");
  });

  it("enables production save only for three distinct explicit selections", async () => {
    const document = createDocument();
    const api = new RecordingApi({
      topologySha256: TOKEN,
      displays: [display(1, "A", 0), display(2, "B", 1920), display(3, "C", 3840)],
      allowedModes: ["production-3"],
    });
    await mountDisplayConfigurator(document, api);

    const mode = document.querySelector<HTMLSelectElement>("[data-mode]")!;
    const save = document.querySelector<HTMLButtonElement>("[data-save]")!;
    change(mode, "production-3");
    change(select(document, "SCREEN-1"), "A");
    change(select(document, "SCREEN-2"), "A");
    change(select(document, "SCREEN-3"), "C");
    expect(save.disabled).toBe(true);

    change(select(document, "SCREEN-2"), "B");
    expect(save.disabled).toBe(false);
    click(save);
    await tick();

    expect(api.saved).toEqual([
      {
        topologySha256: TOKEN,
        mode: "production-3",
        bindings: [
          { softId: "SCREEN-1", displayId: "A" },
          { softId: "SCREEN-2", displayId: "B" },
          { softId: "SCREEN-3", displayId: "C" },
        ],
      },
    ]);
    expect(document.querySelector("[data-status]")?.textContent).toMatch(
      /saved/i,
    );
  });

  it("allows one-screen preview only for SCREEN-1 and records skipped roles", async () => {
    const document = createDocument();
    const api = new RecordingApi({
      topologySha256: TOKEN,
      displays: [display(1, "solo", 0)],
      allowedModes: ["single-display-preview"],
    });
    await mountDisplayConfigurator(document, api);

    change(
      document.querySelector<HTMLSelectElement>("[data-mode]")!,
      "single-display-preview",
    );
    change(select(document, "SCREEN-1"), "solo");

    expect(select(document, "SCREEN-2").disabled).toBe(true);
    expect(select(document, "SCREEN-3").disabled).toBe(true);
    expect(document.querySelector("[data-skipped]")?.textContent).toContain(
      "SCREEN-2, SCREEN-3",
    );
    const save = document.querySelector<HTMLButtonElement>("[data-save]")!;
    expect(save.disabled).toBe(false);
    click(save);
    await tick();
    expect(api.saved[0]).toEqual({
      topologySha256: TOKEN,
      mode: "single-display-preview",
      bindings: [{ softId: "SCREEN-1", displayId: "solo" }],
    });
  });

  it("opens and closes identify cards only through explicit buttons", async () => {
    const document = createDocument();
    const api = new RecordingApi({
      topologySha256: TOKEN,
      displays: [display(1, "solo", 0)],
      allowedModes: ["single-display-preview"],
    });
    await mountDisplayConfigurator(document, api);

    expect(api.identified).toBe(0);
    click(document.querySelector("[data-identify]")!);
    await tick();
    expect(api.identified).toBe(1);

    click(document.querySelector("[data-close-identify]")!);
    await tick();
    expect(api.closed).toBe(1);
  });

  it("shows no inferred mode when the topology has two displays", async () => {
    const document = createDocument();
    const api = new RecordingApi({
      topologySha256: TOKEN,
      displays: [display(1, "A", 0), display(2, "B", 1920)],
      allowedModes: [],
    });

    await mountDisplayConfigurator(document, api);

    expect(
      document.querySelectorAll<HTMLSelectElement>("[data-mode] option"),
    ).toHaveLength(1);
    expect(document.querySelector("[data-status]")?.textContent).toMatch(
      /configuration required|unsupported/i,
    );
  });
});
