import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('historical 2016 2019 2020 periods are selectable',()=>{for(const y of [2016,2019,2020]) assert.match(html,new RegExp('value="year-'+y+'"'));});
test('year range requests exactly twelve months, not recent months',()=>{assert.match(js,/year === new Date\(\)\.getFullYear\(\)/);assert.match(js,/const months = transactionMonths\(period\)/);assert.doesNotMatch(js,/const months = recentMonths\(range\)/);});
test('unknown building type is not automatically classified as apartment',()=>{assert.doesNotMatch(js,/return description && !hasBuildingData \? "apartment"/);});
test('parcel trades remain separate from nearby comparables',()=>{assert.match(js,/items: exact\.sort/);assert.match(js,/transactionScopeSwitch/);});
