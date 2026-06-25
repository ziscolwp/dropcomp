const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsSrc = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'tools.jsx'), 'utf8');

test('solid creation applies the After Effects Fill effect', () => {
  assert.match(
    toolsSrc,
    /function\s+tlApplyFillEffect\s*\(\s*layer\s*\)/,
    'tools.jsx should keep Fill effect application in a focused helper'
  );
  assert.match(
    toolsSrc,
    /property\s*\(\s*['"]ADBE Effect Parade['"]\s*\)\s*\.addProperty\s*\(\s*['"]ADBE Fill['"]\s*\)/,
    'solid creation should add the AE Fill effect by match name'
  );

  const solidBranchStart = toolsSrc.indexOf("kind === 'solid'");
  assert.notEqual(solidBranchStart, -1, 'tlCreateLayer should have a solid branch');
  const solidBranchEnd = toolsSrc.indexOf("} else if (kind === 'camera')", solidBranchStart);
  assert.notEqual(solidBranchEnd, -1, 'tlCreateLayer solid branch should precede camera branch');
  const solidBranch = toolsSrc.slice(solidBranchStart, solidBranchEnd);
  assert.match(solidBranch, /tlApplyFillEffect\s*\(\s*layer\s*\)/);
});
