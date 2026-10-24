import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessAdmin } from "./auth.ts";

test("missing user is denied", () => assert.equal(canAccessAdmin(null), false));
test("inactive administrator is denied", () => assert.equal(canAccessAdmin({ active: false, role: "admin" }), false));
test("active viewer is denied", () => assert.equal(canAccessAdmin({ active: true, role: "viewer" }), false));
test("active administrator is allowed", () => assert.equal(canAccessAdmin({ active: true, role: "admin" }), true));
