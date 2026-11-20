import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');

test('basic information includes a transparent nearby land per-pyeong reference card',()=>{
  assert.match(html,/id="nearbyLandPrice"[\s\S]*?id="nearbyLandPriceValue"[\s\S]*?id="nearbyLandPriceNote"/);
  assert.match(css,/\.nearby-land-price-main/);
  assert.match(js,/같은 법정동의 공개 토지 거래를 면적 기준으로 환산한 참고값/);
  assert.match(js,/도로·용도·형상에 따라 실제 시세와 다를 수 있습니다/);
});

test('nearby reference uses five years, similar area and no interactive government scan',()=>{
  assert.match(js,/lookup\(area, "land", \{includeNearby: true, months: recentMonths\(60\)\}\)/);
  assert.match(js,/nearbyLandPriceSummary\(scoped\.comparable\)/);
  assert.match(js,/중앙 50% 범위/);
  assert.match(html,/market-data\.js\?v=20261120\.4/);
});
