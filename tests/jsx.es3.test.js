const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsxDir = path.join(__dirname, '..', 'jsx');
const files = fs.readdirSync(jsxDir).filter((f) => f.endsWith('.jsx'));

// ExtendScript is ES3: any of these constructs crashes inside After Effects.
for (const f of files) {
  const src = fs.readFileSync(path.join(jsxDir, f), 'utf8');
  test(`${f} contains no ES5+ syntax`, () => {
    assert.doesNotMatch(src, /\b(const|let)\s/, `${f}: const/let found`);
    assert.doesNotMatch(src, /=>/, `${f}: arrow function found`);
    assert.doesNotMatch(src, /`/, `${f}: template literal found`);
    assert.doesNotMatch(src, /\.(map|filter|forEach|reduce|some|every)\s*\(/, `${f}: ES5 array method found`);
    assert.doesNotMatch(src, /Object\.keys/, `${f}: Object.keys found`);
    assert.doesNotMatch(src, /Array\.isArray/, `${f}: Array.isArray found`);
  });
}
