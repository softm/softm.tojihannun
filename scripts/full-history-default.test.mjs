import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('default is saved evidence, never an exhaustive historical scan',()=>{assert.match(html,/value="saved" selected/);assert.doesNotMatch(html,/value="all"/);assert.match(html,/value="3"/);});
test('each explicit step is bounded and one refresh cannot scan years',()=>{assert.match(js,/INITIAL_MONTH_LIMIT = 3/);assert.match(js,/MORE_MONTH_LIMIT = 3/);assert.match(js,/candidates\.slice\(0, limit\)/);});
test('same-dong disclosure is not advertised as radius comparison',()=>{assert.match(js,/같은 법정동 비교/);assert.match(js,/반경·거리 기준 자료가 아닙니다/);assert.match(js,/전체 거래이력 확보 여부 미확인/);});
