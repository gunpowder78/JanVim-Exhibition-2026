import type {
  ConfigurationSnapshot,
  SaveDisplayMapRequest as ControllerSaveDisplayMapRequest,
} from "../../controller/src/display-config-ipc-contract.js";
import type {
  DisplayMode,
  SoftDisplayId,
} from "../../controller/src/display-routing-contract.js";

export type DisplayConfiguratorSnapshot = ConfigurationSnapshot;
export type SaveDisplayMapRequest = ControllerSaveDisplayMapRequest;

export interface DisplayConfiguratorApi {
  getSnapshot(): Promise<DisplayConfiguratorSnapshot>;
  identifyDisplays(topologySha256: string): Promise<void>;
  closeIdentifyDisplays(topologySha256: string): Promise<void>;
  saveDisplayMap(request: SaveDisplayMapRequest): Promise<void>;
}

export interface MountedDisplayConfigurator {
  dispose(): void;
}

const ROLE_DETAILS: ReadonlyArray<{
  softId: SoftDisplayId;
  title: string;
}> = [
  { softId: "SCREEN-1", title: "SCREEN-1 — JanVim" },
  { softId: "SCREEN-2", title: "SCREEN-2 — Narrative" },
  { softId: "SCREEN-3", title: "SCREEN-3 — Jianshan standby" },
];

export async function mountDisplayConfigurator(
  document: Document,
  api: DisplayConfiguratorApi,
): Promise<MountedDisplayConfigurator> {
  const root = document.querySelector<HTMLElement>("[data-display-configurator]");
  if (root === null) throw new Error("Display configurator root is missing");
  const snapshot = await api.getSnapshot();
  root.replaceChildren();

  const title = createElement(document, "h1", "Display routing");
  const guidance = createElement(
    document,
    "p",
    "Identify the physical outputs, then bind every artwork role manually. No role is inferred.",
  );
  guidance.className = "guidance";

  const displayList = document.createElement("ol");
  displayList.className = "display-list";
  for (const display of snapshot.displays) {
    const item = document.createElement("li");
    const badge = createElement(document, "span", String(display.number));
    badge.dataset.displayNumber = String(display.number);
    badge.className = "display-number";
    const description = createElement(
      document,
      "span",
      `${display.label || "Unlabelled display"} · ID ${display.displayId} · bounds ${display.bounds.x},${display.bounds.y} ${display.bounds.width}×${display.bounds.height} · work ${display.workingArea.x},${display.workingArea.y} ${display.workingArea.width}×${display.workingArea.height} · scale ${display.scaleFactor} · rotation ${display.rotation}°`,
    );
    item.append(badge, description);
    displayList.append(item);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const identify = button(document, "Identify displays", "identify");
  const closeIdentify = button(document, "Close identification", "closeIdentify");
  actions.append(identify, closeIdentify);

  const form = document.createElement("form");
  form.noValidate = true;
  const modeLabel = createElement(document, "label", "Mode");
  const mode = document.createElement("select");
  mode.dataset.mode = "true";
  mode.append(createOption(document, "Choose a mode", ""));
  for (const allowed of snapshot.allowedModes) {
    mode.append(
      createOption(
        document,
        allowed === "production-3"
          ? "Production — three artwork displays"
          : "Single-display safe preview — JanVim only",
        allowed,
      ),
    );
  }
  modeLabel.append(mode);
  form.append(modeLabel);

  const roleSelectors = new Map<SoftDisplayId, HTMLSelectElement>();
  const roleGrid = document.createElement("div");
  roleGrid.className = "role-grid";
  for (const role of ROLE_DETAILS) {
    const label = createElement(document, "label", role.title);
    const select = document.createElement("select");
    select.dataset.role = role.softId;
    select.append(createOption(document, "Unassigned", ""));
    for (const display of snapshot.displays) {
      select.append(
        createOption(
          document,
          `#${display.number} · ${display.label || "Unlabelled"} · ${display.displayId}`,
          display.displayId,
        ),
      );
    }
    label.append(select);
    roleGrid.append(label);
    roleSelectors.set(role.softId, select);
  }
  form.append(roleGrid);

  const skipped = createElement(document, "p", "No roles are skipped.");
  skipped.dataset.skipped = "true";
  const save = button(document, "Save display map", "save");
  save.type = "submit";
  save.disabled = true;
  const status = createElement(
    document,
    "p",
    snapshot.allowedModes.length === 0
      ? "Configuration required: this display count has no supported mode."
      : "Choose a mode and assign displays.",
  );
  status.dataset.status = "true";
  status.setAttribute("role", "status");
  form.append(skipped, save, status);
  root.append(title, guidance, displayList, actions, form);

  const listeners: Array<{
    target: EventTarget;
    event: string;
    listener: EventListener;
  }> = [];
  const listen = (
    target: EventTarget,
    event: string,
    listener: EventListener,
  ): void => {
    target.addEventListener(event, listener);
    listeners.push({ target, event, listener });
  };

  const selectedMode = (): DisplayMode | undefined => {
    if (
      mode.value === "production-3" ||
      mode.value === "single-display-preview"
    ) {
      return mode.value;
    }
    return undefined;
  };
  const update = (): void => {
    const selected = selectedMode();
    const preview = selected === "single-display-preview";
    for (const softId of ["SCREEN-2", "SCREEN-3"] as const) {
      const select = roleSelectors.get(softId)!;
      if (preview) select.value = "";
      select.disabled = preview;
    }
    skipped.textContent = preview
      ? "Skipped in safe preview: SCREEN-2, SCREEN-3"
      : "No roles are skipped.";

    const requiredRoles: readonly SoftDisplayId[] =
      selected === "production-3"
        ? ["SCREEN-1", "SCREEN-2", "SCREEN-3"]
        : selected === "single-display-preview"
          ? ["SCREEN-1"]
          : [];
    const values = requiredRoles.map(
      (softId) => roleSelectors.get(softId)!.value,
    );
    save.disabled =
      selected === undefined ||
      !snapshot.allowedModes.includes(selected) ||
      values.some((value) => value.length === 0) ||
      new Set(values).size !== values.length;
  };

  listen(mode, "change", update);
  for (const select of roleSelectors.values()) listen(select, "change", update);
  listen(identify, "click", () => {
    if (identify.disabled) return;
    identify.disabled = true;
    void runAction(status, async () => {
      await api.identifyDisplays(snapshot.topologySha256);
      return "Identification cards opened for 12 seconds.";
    }).finally(() => {
      identify.disabled = false;
    });
  });
  listen(closeIdentify, "click", () => {
    void runAction(status, async () => {
      await api.closeIdentifyDisplays(snapshot.topologySha256);
      return "Identification cards closed.";
    });
  });
  listen(form, "submit", (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const selected = selectedMode();
    if (selected === undefined) return;
    const roles: readonly SoftDisplayId[] =
      selected === "production-3"
        ? ["SCREEN-1", "SCREEN-2", "SCREEN-3"]
        : ["SCREEN-1"];
    const request: SaveDisplayMapRequest = {
      topologySha256: snapshot.topologySha256,
      mode: selected,
      bindings: roles.map((softId) => ({
        softId,
        displayId: roleSelectors.get(softId)!.value,
      })),
    };
    save.disabled = true;
    void runAction(status, async () => {
      await api.saveDisplayMap(request);
      return "Display map saved.";
    }).finally(update);
  });
  update();

  let disposed = false;
  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of listeners) {
        entry.target.removeEventListener(entry.event, entry.listener);
      }
      listeners.length = 0;
    },
  });
}

async function runAction(
  status: HTMLElement,
  action: () => Promise<string>,
): Promise<void> {
  try {
    status.textContent = await action();
  } catch (error) {
    status.textContent = `Configuration required: ${
      error instanceof Error ? error.message : "operation failed"
    }`;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function button(
  document: Document,
  label: string,
  dataKey: "identify" | "closeIdentify" | "save",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (dataKey === "closeIdentify") element.dataset.closeIdentify = "true";
  else element.dataset[dataKey] = "true";
  return element;
}

function createOption(
  document: Document,
  label: string,
  value: string,
): HTMLOptionElement {
  const option = document.createElement("option");
  option.textContent = label;
  option.value = value;
  return option;
}
