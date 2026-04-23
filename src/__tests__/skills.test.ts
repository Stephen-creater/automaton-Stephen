import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillMd } from "../skills/format.js";

test("parseSkillMd reads frontmatter and instructions", () => {
  const skill = parseSkillMd(
    `---
name: web-search
description: search the web
auto-activate: true
---

Use this skill carefully.`,
    "/tmp/web-search/SKILL.md",
  );

  assert.ok(skill);
  assert.equal(skill?.name, "web-search");
  assert.equal(skill?.description, "search the web");
  assert.equal(skill?.autoActivate, true);
  assert.match(skill?.instructions || "", /Use this skill carefully/);
});
