import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('Cloudflare account icon is mounted in the existing header, without Firebase',()=>{
  const index=read('index.html'), script=read('account.js'), build=read('scripts/build-pages.mjs');
  assert.match(index,/id="siteAccountSlot"/);
  assert.match(index,/type="module" src="\.\/account\.js/);
  assert.match(build,/"account\.js"/);
  assert.match(script,/createCloudflareAccountClient/);
  assert.match(script,/mountSiteAccount/);
  assert.match(script,/siteId:SITE_ID/);
  assert.doesNotMatch(script,/firebase|firestore/i);
});
test('district controls are icon-only, accessible and separated from map zoom/locate controls',()=>{
  const js=read('districts.js'), css=read('districts.css');
  assert.match(js,/iconButton\(/);
  assert.match(js,/aria-label", label/);
  assert.match(js,/aria-controls", "districtPanel"/);
  assert.match(js,/setAttribute\("aria-expanded"/);
  assert.match(css,/\.district-controls\{position:fixed;right:74px;top:155px/);
  assert.match(css,/\.district-panel\{position:fixed;top:155px;right:130px/);
  assert.match(css,/\.district-controls\{top:max\(200px/);
  assert.match(css,/\.district-toolbar\{flex-direction:row/);
  assert.doesNotMatch(js,/toggle\.textContent\s*=/);
});
