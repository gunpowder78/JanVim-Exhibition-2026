import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const hashSensitivePaths = [
  "janvim-artifact.lock.json",
  "show/janvim-show.toml",
  "content/p0.1/content-lock.json",
  "content/p0.1/profiles/songfeng-source/paper.md",
  "nvim/lua/janvim_exhibition/buffer.lua",
  "nvim/lua/janvim_exhibition/init.lua",
  "nvim/lua/janvim_exhibition/typography.lua",
  "nvim/lua/janvim_exhibition/visuals.lua",
] as const;

function configValue(
  config: string,
  section: string,
  key: string,
): string {
  const sectionMatch = config.match(
    new RegExp(
      `(?:^|\\r?\\n)\\[${section}\\]\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\[|$)`,
      "u",
    ),
  );
  expect(sectionMatch, `missing [${section}] section`).not.toBeNull();
  const valueMatch = sectionMatch![1]!.match(
    new RegExp(`^${key}\\s*=\\s*([^#\\r\\n]+)`, "mu"),
  );
  expect(valueMatch, `missing ${section}.${key}`).not.toBeNull();
  return valueMatch![1]!.trim().replace(/^"|"$/gu, "");
}

describe("frozen G2 show runtime selection", () => {
  it("locks the explicit orthogonal Plugin Lab config by its exact bytes", () => {
    const configBytes = readFileSync(
      join(repositoryRoot, "show", "janvim-show.toml"),
    );
    const lock = JSON.parse(
      readFileSync(join(repositoryRoot, "janvim-artifact.lock.json"), "utf8"),
    ) as {
      configSha256?: string;
      layoutEngine?: string;
    };

    expect(lock.layoutEngine).toBe("orthogonal");
    expect(lock.configSha256).toBe(createHash("sha256").update(configBytes).digest("hex"));
  });

  it("keeps the approved sparse orthogonal exhibition composition", () => {
    const config = readFileSync(
      join(repositoryRoot, "show", "janvim-show.toml"),
      "utf8",
    );

    expect(configValue(config, "cursor", "vfx_type")).toBe("swordsman");
    expect(configValue(config, "layout", "engine")).toBe("orthogonal");
    const columnWidth = Number(configValue(config, "layout", "column_width"));
    const columnGap = Number(configValue(config, "layout", "column_gap"));
    expect(columnWidth).toBe(26);
    expect(columnGap).toBe(columnWidth);
    expect(configValue(config, "layout", "glyph_advance")).toBe("24.0");
    expect(configValue(config, "typography", "english_layout")).toBe("sideways");
    expect(configValue(config, "typography", "latin_punctuation_layout")).toBe("upright");
    expect(configValue(config, "typography", "cjk_punctuation_layout")).toBe("upright");
    expect(configValue(config, "typography", "symbol_layout")).toBe("upright");
    expect(configValue(config, "neovim", "colorscheme")).toBe("catppuccin-mocha");
  });

  it.each([
    "show/janvim-show.toml",
    "content/fixture/poem.txt",
  ])("checks out hash-sensitive input %s with LF bytes", (path) => {
    const result = spawnSync(
      "git",
      ["check-attr", "eol", "--", path],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 5_000 },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout.trim()).toBe(`${path}: eol: lf`);
  });

  it.each(hashSensitivePaths)("keeps hash-sensitive input %s free of CR bytes", (path) => {
    const bytes = readFileSync(join(repositoryRoot, ...path.split("/")));
    expect(bytes.includes(13), `${path} contains CR bytes`).toBe(false);
  });
});
