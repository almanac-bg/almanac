// The specs' test: Playwright's, and one more check on every page of its context. An error the page throws and no one
// catches (an exception or a rejected promise: what the page reports to /api/errors, and the server logs as "client
// error") fails the test that saw it, instead of passing with a line in the log nobody reads. A problem the page caught
// itself and reported (`reportProblem`, where "caught") is the page working as meant, and passes.
import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

export const test = base.extend<{ pageFaults: undefined }>({
  pageFaults: [
    async ({ context }, use) => {
      const faults: string[] = [];
      context.on("request", (req) => {
        if (req.method() !== "POST" || new URL(req.url()).pathname !== "/api/errors") return;
        const r = req.postDataJSON() as { message?: string; where?: string } | null;
        if (r?.where !== "caught") faults.push(`${r?.message} (at ${r?.where})`);
      });
      await use(undefined);
      expect(faults, "errors the page threw").toEqual([]);
    },
    { auto: true },
  ],
});
