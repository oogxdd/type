import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// These services are the behavioral reference for the Swift shell. Prevent
// accidental dependency on a mounted React tree or a concrete native adapter.
it("keeps domain and application independent of the mobile shell", () => {
  const forbidden = /^(react(?:-native)?(?:\/|$|-)|expo(?:-|\/|$)|zustand(?:\/|$)|@typenotes\/mobile-core)/;
  for (const layer of ["domain", "application"]) {
    const directory = resolve(__dirname, "../src", layer);
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".ts") || name.includes(".test.")) continue;
      const source = readFileSync(resolve(directory, name), "utf8");
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/g)) {
        const dependency = match[1];
        expect(forbidden.test(dependency), name + ": " + dependency).toBe(false);
        if (dependency.startsWith(".")) {
          const target = resolve(directory, dependency);
          const allowed = ["domain", ...(layer === "application" ? ["application"] : [])];
          expect(allowed.some((item) => target.startsWith(resolve(directory, "..", item) + "/")), name + ": " + dependency).toBe(true);
        }
      }
    }
  }
});
