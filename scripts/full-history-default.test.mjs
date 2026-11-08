import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('full history selected by default',()=>{assert.match(html,/value="all" selected/);assert.doesNotMatch(html,/value="24" selected/);});
test('all period reaches 2006 and loads incrementally',()=>{assert.match(js,/year >= 2006/);assert.match(js,/INITIAL_MONTH_LIMIT = 3/);assert.match(js,/MORE_MONTH_LIMIT = 12/);assert.match(js,/candidates\.slice\(0, limit\)/);assert.match(js,/renderTransactionView\(\)/);});
test('nearby transactions are limited to last 24 months in all mode',()=>assert.match(js,/session\.period === "all" \? scoped\.comparable\.filter\(item => item\.month >= nearbyCutoff/));
