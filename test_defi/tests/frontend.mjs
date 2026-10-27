/* Exercise the shipped application route and real UI handlers. The DOM harness
 * does not claim to test layout, transaction execution or a connected wallet. */
import assert from 'node:assert/strict';
import {boot} from '../../tests/frontend-harness.mjs';

const app=await boot('dist',{route:'#defi'});
const root=()=>app.document.querySelector('#defi-practice')??app.document.querySelector('#page-content');
const state=()=>JSON.parse(JSON.stringify(app.context.NodusDefiPractice.getState()));
const action=async name=>{const el=root().querySelector(`[data-defi-action="${name}"]`);assert.ok(el,name);await el.click();};
const select=async id=>{const el=root().querySelector(`[data-defi-select="${id}"]`);assert.ok(el,id);await el.click();};
const tab=async name=>{await root().querySelector(`[data-defi-tab="${name}"]`).click();};
const importText=async text=>{await root().querySelector('#defi-import').fire('change',{target:{files:[{size:Buffer.byteLength(text),text:async()=>text}]}});};
const initialRequests=app.requests.length;
assert.match(root().innerHTML,/Yhdistä TronLink/);
assert.match(root().innerHTML,/DeFi-testilaboratorio/);
assert.equal(app.context.NodusDefi.getState().wallet.connected,false);
assert.equal(root().querySelector('#defi-live-transfer').querySelector('button').disabled,true);
await root().querySelector('[data-defi-live-view="practice"]').click();

assert.match(root().innerHTML,/Paikallinen simulaatio · ei ketjutapahtumia/);
assert.match(root().innerHTML,/Lompakkoasi ja sen tUSDT-saldoa ei ole yhdistetty/);
assert.equal(state().states.length,0,'empty first load has no fabricated funded offers');
await action('examples');
assert.equal(state().states.length,2);
assert.match(root().innerHTML,/Esimerkki 8 %/);
assert.match(root().innerHTML,/1500 <small>tUSDT/);
assert.ok(root().querySelector('[data-defi-action="examples"]').disabled,'examples cannot be duplicated');
assert.match(root().innerHTML,/6\.575343/,'exact full-term rounded interest');

await action('accept');
assert.equal(state().states[0].status,'active');
assert.match(root().innerHTML,/20000 <small>NODUS/);
assert.ok(root().querySelector('[data-defi-action="default"]').disabled);
await action('repay');
assert.equal(state().states[0].status,'repaid');
assert.match(root().innerHTML,/Vakuus palautettu lainaajalle/);
assert.equal(root().querySelector('[data-defi-action="repay"]'),null,'settled loan cannot be repaid twice');

await action('reset');
await action('accept');
await action('due');
assert.equal(root().querySelector('[data-defi-action="repay"]').disabled,false,'repayment remains open in grace period');
assert.equal(root().querySelector('[data-defi-action="default"]').disabled,true);
await action('deadline');
assert.equal(root().querySelector('[data-defi-action="repay"]').disabled,true,'repayment closes exactly at deadline');
assert.equal(root().querySelector('[data-defi-action="default"]').disabled,false);
await action('default');
assert.equal(state().states[0].status,'defaulted');
assert.match(root().innerHTML,/Vakuus siirretty rahoittajalle/);

await select('example-10');
await action('cancel');
assert.equal(state().states[1].status,'cancelled');
assert.match(root().innerHTML,/Käyttämätön rahoitus palautettu/);
await action('export');
const exported=JSON.parse(await app.downloads.at(-1).text());
assert.equal(exported.schema,'nodus-defi/offers-v1');
assert.equal(exported.offers.length,2);
assert.equal(exported.offers[0].status,undefined,'draft export is never a funding proof');

await tab('create');
for(const [key,value]of Object.entries({name:'<img src=x onerror=alert(1)>',principal:'12.000001',collateral:'0.00000001',apr:'10.25',termDays:'3',graceDays:'1'}))root().querySelector('#defi-'+key).value=value;
await root().querySelector('#defi-form').fire('submit');
assert.equal(state().states.length,3);
assert.equal(state().states[2].offer.principalRaw,'12000001');
assert.equal(state().states[2].offer.collateralRaw,'1');
assert.equal(state().states[2].offer.aprBps,1025);
assert.match(root().innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/,'imported and typed names are escaped');
assert.equal(root().querySelector('img'),null);

const before=state().states;
await importText(JSON.stringify({schema:exported.schema,offers:[{...exported.offers[0],name:'changed'}]}));
assert.equal(state().failed,true);
assert.deepEqual(state().states,before,'conflicting import is atomic');
await importText(JSON.stringify({schema:exported.schema,offers:[{...exported.offers[0],id:'score',creditScore:999}]}));
assert.equal(state().failed,true);
assert.deepEqual(state().states,before,'unverified score cannot enter model through a draft');
await importText(JSON.stringify(exported));
assert.equal(state().failed,false);
assert.deepEqual(state().states,before,'reimporting draft terms cannot reset a settled loan');

// Valid large individual offers can add up beyond the single-loan amount cap.
const huge=exported.offers[0],max='1000000000000000000000000';
await importText(JSON.stringify({schema:exported.schema,offers:[1,2,3].map(n=>({...huge,id:'huge-'+n,principalRaw:max,collateralRaw:max}))}));
assert.equal(state().failed,false);
assert.equal(state().states.length,6);
assert.match(root().innerHTML,/3000000000000000012\.000001 <small>tUSDT/,'aggregate rendering stays exact above individual cap');
await select('huge-1');await action('accept');
await select('huge-2');await action('accept');
await select('huge-3');await action('accept');
assert.match(root().innerHTML,/30000000000000000 <small>NODUS/,'aggregate collateral also renders above individual cap');

app.context.NodusI18n.setLanguage('en');
assert.match(root().innerHTML,/Local simulation · no chain transactions/);
assert.match(root().innerHTML,/Example 8%/);
assert.match(root().innerHTML,/The full fixed-term interest is due even if you repay early/);
await tab('create');root().querySelector('#defi-name').value='Kept draft';
app.context.NodusI18n.setLanguage('fi');
assert.equal(root().querySelector('#defi-name').value,'Kept draft','language changes preserve unfinished form values');
assert.equal(app.requests.length,initialRequests,'DeFi actions do not perform network calls');
assert.deepEqual([...app.preferences.keys()],['nodus-observatory-language'],'no simulated funding or wallet data persisted');

const fresh=await boot('dist',{route:'#defi',storageThrows:true,offline:true});
await fresh.document.querySelector('[data-defi-live-view="practice"]').click();
assert.equal(fresh.context.NodusDefiPractice.getState().states.length,0);
assert.match(fresh.document.querySelector('#defi-practice').innerHTML,/ei ketjutapahtumia/,'offline and blocked storage never imply a live connection');
console.log('Test DeFi frontend: route, exact amounts, lifecycle, imports, isolation and FI/EN passed.');
