// Unit tests (no model, no VS Code): run with `npm run test:unit`.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { cleanMessage } = require("../dist/postprocess.js");
// Shared with the Python CLI's tests (tests/test_postprocess.py), so both clean messages the same way.
const cases = JSON.parse(readFileSync(new URL("./clean-cases.json", import.meta.url), "utf8"));

for (const [input, expected] of cases) {
    test(`cleanMessage: ${input}`, () => {
        assert.strictEqual(cleanMessage(input), expected);
    });
}
