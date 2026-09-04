import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type {
  RendererEvent,
  RendererToControllerEvent,
  RunStatusEvent,
} from "@janvim-exhibition/show-schema";

import {
  ShowSurfaceGroup,
  type ShowNarrativeSurface,
  type ShowSurfaceGroupChild,
} from "../src/show-surface-group.ts";

type CloseFailure = { readonly throws: true; readonly value: unknown };

class FakeChild implements ShowSurfaceGroupChild {
  public readonly destroyedListeners = new Set<() => void>();
  public closeCount = 0;

  public constructor(
    private readonly name: string,
    private readonly trace: string[],
    private readonly closeFailure?: CloseFailure,
  ) {}

  public onDestroyed(listener: () => void): () => void {
    this.destroyedListeners.add(listener);
    return () => this.destroyedListeners.delete(listener);
  }

  public close(): void {
    this.closeCount += 1;
    this.trace.push(`${this.name}:close`);
    for (const listener of [...this.destroyedListeners]) listener();
    if (this.closeFailure?.throws === true) throw this.closeFailure.value;
  }

  public destroyUnexpectedly(): void {
    for (const listener of [...this.destroyedListeners]) listener();
  }

  public diagnostics(): { listeners: number } {
    return { listeners: this.destroyedListeners.size };
  }
}

class FakeNarrative extends FakeChild implements ShowNarrativeSurface {
  public readonly rendererPid = 4102;
  public readonly sent: RendererEvent[] = [];
  public readonly eventListeners = new Set<
    (event: RendererToControllerEvent) => void
  >();
  public hideCount = 0;
  public showCount = 0;

  public constructor(
    trace: string[],
    closeFailure?: CloseFailure,
  ) {
    super("narrative", trace, closeFailure);
    this.trace = trace;
  }

  private readonly trace: string[];

  public send(event: RendererEvent): void {
    this.sent.push(event);
    this.trace.push(
      "type" in event ? `narrative:send:${event.type}:${"state" in event ? event.state : ""}` : "narrative:send:cue",
    );
  }

  public onEvent(
    listener: (event: RendererToControllerEvent) => void,
  ): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public emitEvent(event: RendererToControllerEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }

  public hide(): void {
    this.hideCount += 1;
    this.trace.push("narrative:hide");
  }

  public show(): void {
    this.showCount += 1;
    this.trace.push("narrative:show");
  }

  public override diagnostics(): { listeners: number } {
    return {
      listeners:
        super.diagnostics().listeners + this.eventListeners.size,
    };
  }
}

const readyStatus: RunStatusEvent = {
  schema: 1,
  type: "run-status",
  generationId: 1,
  state: "ready",
};

describe("Jianshan standby artifact", () => {
  it("is one bounded script-free local page with a deny-by-default CSP", () => {
    const bytes = readFileSync(
      join(process.cwd(), "show", "jianshan-standby.html"),
    );
    const document = new JSDOM(bytes.toString("utf8")).window.document;
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");

    expect(bytes.byteLength).toBeLessThanOrEqual(4_096);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'none'");
    const style = document.querySelector("style")?.textContent;
    expect(style).toBeDefined();
    expect(policy).toContain(
      `style-src 'sha256-${createHash("sha256").update(style!).digest("base64")}'`,
    );
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(document.querySelectorAll("[src], [href]")).toHaveLength(0);
    expect(document.body.textContent?.replace(/\s+/gu, " ").trim()).toBe(
      "见山 / STANDBY",
    );
    expect(document.querySelector("style")?.textContent).toMatch(
      /background:\s*#[0-1][0-9a-f]{5}/iu,
    );
  });
});

describe("ShowSurfaceGroup", () => {
  it("presents Narrative telemetry and events as the sole coordinator surface", () => {
    const trace: string[] = [];
    const narrative = new FakeNarrative(trace);
    const standby = new FakeChild("standby", trace);
    const group = new ShowSurfaceGroup({ narrative, standby });
    const rendererEvent = {
      schema: 1,
      type: "operator-action",
      action: "start",
    } as const;
    const received: RendererToControllerEvent[] = [];

    group.onEvent((event) => received.push(event));
    group.send(readyStatus);
    narrative.emitEvent(rendererEvent);

    expect(group.rendererPid).toBe(narrative.rendererPid);
    expect(narrative.sent).toEqual([readyStatus]);
    expect(received).toEqual([rendererEvent]);
    expect(standby).not.toHaveProperty("send");
    expect(standby).not.toHaveProperty("onEvent");
  });

  it.each(["narrative", "standby"] as const)(
    "reports unexpected %s loss once for the whole group",
    async (lostChild) => {
      const narrative = new FakeNarrative([]);
      const standby = new FakeChild("standby", []);
      const group = new ShowSurfaceGroup({ narrative, standby });
      const lost = vi.fn();
      group.onDestroyed(lost);

      (lostChild === "narrative" ? narrative : standby).destroyUnexpectedly();
      narrative.destroyUnexpectedly();
      standby.destroyUnexpectedly();
      await Promise.resolve();

      expect(lost).toHaveBeenCalledOnce();
      expect(narrative.destroyedListeners).toHaveLength(0);
      expect(standby.destroyedListeners).toHaveLength(0);
    },
  );

  it("latches child loss before registration and delivers it once on a microtask", async () => {
    const narrative = new FakeNarrative([]);
    const standby = new FakeChild("standby", []);
    const group = new ShowSurfaceGroup({ narrative, standby });
    const first = vi.fn();
    const later = vi.fn();

    standby.destroyUnexpectedly();
    group.onDestroyed(first);
    expect(first).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();

    group.onDestroyed(later);
    narrative.destroyUnexpectedly();
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
  });

  it("closes idempotently after detaching listeners and attempts every child", () => {
    const trace: string[] = [];
    const firstError = new Error("narrative close failed");
    const narrative = new FakeNarrative(trace, {
      throws: true,
      value: firstError,
    });
    const standby = new FakeChild("standby", trace, {
      throws: true,
      value: new Error("standby close failed"),
    });
    const group = new ShowSurfaceGroup({ narrative, standby });
    const lost = vi.fn();
    group.onEvent(() => undefined);
    group.onDestroyed(lost);

    expect(() => group.close()).toThrow(firstError);
    expect(trace).toEqual(["narrative:close", "standby:close"]);
    expect(narrative.closeCount).toBe(1);
    expect(standby.closeCount).toBe(1);
    expect(narrative.destroyedListeners).toHaveLength(0);
    expect(standby.destroyedListeners).toHaveLength(0);
    expect(narrative.eventListeners).toHaveLength(0);
    expect(group.diagnostics()).toEqual({ listeners: 0 });
    expect(lost).not.toHaveBeenCalled();

    expect(() => group.close()).not.toThrow();
    expect(narrative.closeCount).toBe(1);
    expect(standby.closeCount).toBe(1);
  });

  it("hides preview only after running is sent and re-shows on non-running status", () => {
    const trace: string[] = [];
    const narrative = new FakeNarrative(trace);
    const group = new ShowSurfaceGroup({
      narrative,
      previewVisibility: true,
    });
    const status = (
      state: RunStatusEvent["state"],
      generationId = 1,
    ): RunStatusEvent => ({
      schema: 1,
      type: "run-status",
      generationId,
      state,
    });

    group.send(status("ready"));
    group.send(status("running"));
    group.send(status("running"));
    group.send(status("black-recovering", 2));
    group.send(status("safe-ready", 2));
    group.send(status("running", 2));
    group.send(status("shutting-down", 3));

    expect(trace).toEqual([
      "narrative:send:run-status:ready",
      "narrative:send:run-status:running",
      "narrative:hide",
      "narrative:send:run-status:running",
      "narrative:send:run-status:black-recovering",
      "narrative:show",
      "narrative:send:run-status:safe-ready",
      "narrative:send:run-status:running",
      "narrative:hide",
      "narrative:send:run-status:shutting-down",
      "narrative:show",
    ]);
    expect(narrative.hideCount).toBe(2);
    expect(narrative.showCount).toBe(2);
  });
});
