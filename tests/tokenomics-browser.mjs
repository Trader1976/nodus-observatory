/** Real browser + real Python API smoke test. No Nodus or remote RPC required. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
assert.ok(process.env.PLAYWRIGHT_MODULE,'Set PLAYWRIGHT_MODULE to an installed, pinned Playwright package');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(join(tmpdir(),'nodus-tokenomics-browser-'));
const port=Number(process.env.TOKENOMICS_TEST_PORT||18990);
assert.ok(Number.isInteger(port)&&port>1023&&port<65536,'Invalid test port');
const base='http://127.0.0.1:'+port;
const state=join(temp,'state');
await mkdir(state);
const config=join(temp,'config.json');
await writeFile(config,JSON.stringify({bind_host:'127.0.0.1',bind_port:port,state_dir:state,frontend_dir:join(repo,'dist'),cli_path:'/nonexistent/nodus-cli'}));
let browser,server,serverError;
let serverLog='';
const pageErrors=[],externalRequests=[];
const pause=ms=>new Promise(resolvePause=>setTimeout(resolvePause,ms));
try {
  server=spawn(process.env.PYTHON||'python3',['backend/server.py','--config',config],{cwd:repo,env:{...process.env,PYTHONPATH:repo},stdio:['ignore','pipe','pipe']});
  server.on('error',error=>{serverError=error;});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{serverLog=(serverLog+chunk.toString()).slice(-12000);});
  let listening=false;
  for(let i=0;i<100;i++){
    if(serverError)throw serverError;
    if(server.exitCode!==null)throw Error('Python server exited: '+serverLog);
    try {const response=await fetch(base+'/api/tokenomics');if(response.ok){listening=true;break;}} catch {}
    await pause(100);
  }
  assert.ok(listening,'Python server did not start: '+serverLog);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(base+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();
    externalRequests.push(url);return route.abort();
  });
  const ready=()=>page.waitForFunction(()=>{
    const s=window.NodusTokenomics?.getState();
    return s&&!s.loading&&!s.error&&s.result?.series?.length>1&&document.querySelector('#tk-month');
  });
  const isApi=response=>new URL(response.url()).pathname==='/api/tokenomics';
  const initialResponse=page.waitForResponse(isApi);
  await page.goto(base+'/#tokenomics');
  const initial=await (await initialResponse).json();
  await ready();
  assert.equal(initial.schema_version,1);
  assert.equal(initial.parameters.storage_cost_usdt_year,1800);
  assert.equal(await page.locator('#tk-form').evaluate(el=>el.checkValidity()),true,'Default scenario form must be valid');
  assert.equal(await page.locator('[data-tk-chart] svg').count(),4);

  await page.locator('#tk-storage_cost_usdt_year').fill('2400');
  const customResponse=page.waitForResponse(isApi);
  await page.locator('#tk-run').click();
  const custom=await (await customResponse).json();
  await ready();
  assert.equal(custom.parameters.storage_cost_usdt_year,2400);
  for(const language of ['en','fi']){
    await page.locator('[data-language="'+language+'"]').click();
    await ready();
    assert.equal(await page.locator('#tk-storage_cost_usdt_year').inputValue(),'2400');
    assert.equal(await page.evaluate(()=>window.NodusI18n.language()),language);
  }
  await page.evaluate(()=>{location.hash='#overview';});
  await page.waitForFunction(()=>!document.querySelector('#tk-run'));
  await page.locator('[data-area="tokenomics"]').click();
  await ready();
  assert.equal(await page.locator('#tk-storage_cost_usdt_year').inputValue(),'2400');

  const presetResponse=page.waitForResponse(isApi);
  await page.locator('#tk-preset').selectOption('hardware');
  assert.equal((await (await presetResponse).json()).parameters.storage_cost_usdt_year,3600);
  await ready();
  await page.locator('#tk-month').evaluate(el=>{el.value='12';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.NodusTokenomics.getState().selected),12);
  assert.match(await page.locator('#tk-readout-nodes').textContent(),/12/);
  const hit=page.locator('[data-tk-hit="nodes"]');
  await hit.click({position:{x:5,y:5}});
  assert.notEqual(await page.evaluate(()=>window.NodusTokenomics.getState().selected),12);

  await page.route('**/api/tokenomics*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Simulated service interruption'})}),{times:1});
  await page.locator('#tk-storage_cost_usdt_year').fill('2500');
  await page.locator('#tk-run').click();
  await page.waitForFunction(()=>{const s=window.NodusTokenomics.getState();return !s.loading&&!!s.error;});
  assert.match(await page.locator('#tk-feedback').textContent(),/Simulated service interruption/);
  const retryResponse=page.waitForResponse(isApi);
  await page.locator('#tk-run').click();
  assert.equal((await (await retryResponse).json()).parameters.storage_cost_usdt_year,2500);
  await ready();

  await page.locator('#tk-result-details').evaluate(el=>{el.open=true;});
  for(const [id,extension] of [['tk-export-json','json'],['tk-export-csv','csv']]){
    const pending=page.waitForEvent('download');
    await page.locator('#'+id).click();
    const download=await pending,path=join(temp,'export.'+extension);
    await download.saveAs(path);
    const content=await readFile(path,'utf8');
    if(extension==='json')assert.equal(JSON.parse(content).parameters.storage_cost_usdt_year,2500);
    else {assert.match(content.split('\n')[0],/storage_nodes/);assert.equal(content.trim().split('\n').length,122);}
  }
  await page.locator('#tk-result-details').evaluate(el=>{el.open=false;});
  if(process.env.TOKENOMICS_SCREENSHOTS)await mkdir(resolve(process.env.TOKENOMICS_SCREENSHOTS),{recursive:true});
  for(const width of [1280,736,320]){
    await page.setViewportSize({width,height:1000});
    // Allow the ResizeObserver callback and the next browser paint to complete.
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    const dimensions=await page.locator('#page-content').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    assert.ok(dimensions.scroll<=dimensions.width+1,'Horizontal page-content overflow at '+width+': '+JSON.stringify(dimensions));
    assert.equal(await page.locator('[data-tk-chart] svg').count(),4);
    if(process.env.TOKENOMICS_SCREENSHOTS)await page.screenshot({path:join(resolve(process.env.TOKENOMICS_SCREENSHOTS),'tokenomics-'+width+'.png'),fullPage:true});
  }
  assert.deepEqual(pageErrors,[],'Browser JavaScript exceptions');
  assert.deepEqual(externalRequests,[],'Unexpected remote requests');
  console.log('Tokenomics browser: Python API, controls, locales, navigation, inspection, retry, exports and responsive layout passed.');
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(server?.pid&&server.exitCode===null&&server.signalCode===null){
    await new Promise(done=>{
      server.once('exit',done);
      server.kill('SIGTERM');
      const timer=setTimeout(()=>server.kill('SIGKILL'),3000);
      timer.unref();
    });
  }
  await rm(temp,{recursive:true,force:true});
}
