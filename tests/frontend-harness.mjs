/** Offline DOM harness for shipped frontend modules and actual handlers.
 * It is deliberately not a browser: no layout or EVM execution claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const fixtures = {'/api/dashboard':'snapshot.json','/api/history':'history.json',
  '/api/network':'network.json','/api/rewards':'rewards.json','/api/events':'events.json'};
const decode = value => value.replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

// A small tree implements only the browser APIs used by this application. It
// deliberately retains disabled controls and user-supplied text as real values.
function node(tag = 'div', attributes = {}, parent = null) {
  const attrs = {...attributes};
  const listeners = new Map();
  let markup = '';
  let classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const el = {
    tagName:tag.toUpperCase(), parentElement:parent, children:[], style:{}, dataset:{},
    value:attrs.value || '', name:attrs.name || '', checked:Object.hasOwn(attrs,'checked'),
    disabled:Object.hasOwn(attrs,'disabled'), hidden:Object.hasOwn(attrs,'hidden'),
    textContent:'', scrollLeft:0,
    setAttribute(key,value) {attrs[key]=String(value); if(key==='disabled')this.disabled=true;},
    getAttribute(key) {return attrs[key]??null;},
    removeAttribute(key) {delete attrs[key];if(key==='disabled')this.disabled=false;},
    classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);},
      toggle(name,force){const yes=force===undefined?!classes.has(name):force;if(yes)classes.add(name);else classes.delete(name);return yes;}},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    removeEventListener(type,handler){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==handler));},
    dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler.call(this,event);return true;},
    async fire(type,extra={}) {
      const event={type,target:this,currentTarget:this,key:'',clientX:0,clientY:0,
        preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
      if(this.disabled&&type==='click')return event;
      for(const handler of listeners.get(type)||[])await handler.call(this,event);
      await this[`on${type}`]?.(event);
      return event;
    },
    click(){return this.fire('click');},focus(){this.focused=true;},
    appendChild(child){child.parentElement=this;this.children.push(child);return child;},
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
    querySelectorAll(selector){return descendants(this).filter(child=>matches(child,selector));},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
    closest(selector){let cursor=this;while(cursor){if(matches(cursor,selector))return cursor;cursor=cursor.parentElement;}return null;},
    contains(other){return this===other||descendants(this).includes(other);},
    getBoundingClientRect(){return {left:0,top:0,right:1000,bottom:600,width:1000,height:600};},
    setPointerCapture(){},releasePointerCapture(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},
  };
  for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))el.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(el,'innerHTML',{get(){return markup;},set(value){markup=String(value);this.children=parse(markup,this);}});
  return el;
}
function descendants(root){return root.children.flatMap(child=>[child,...descendants(child)]);}
function matches(el, selector){
  if(selector.includes(','))return selector.split(',').some(part=>matches(el,part.trim()));
  if(selector==='nav a'){let ancestor=el.parentElement;while(ancestor&&ancestor.tagName!=='NAV')ancestor=ancestor.parentElement;return el.tagName==='A'&&!!ancestor;}
  if(selector.startsWith('#'))return el.getAttribute('id')===selector.slice(1);
  if(selector.startsWith('.'))return el.classList.contains(selector.slice(1));
  const attr=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if(attr)return attr[2]===undefined?el.getAttribute(attr[1])!==null:el.getAttribute(attr[1])===attr[2];
  return el.tagName===selector.toUpperCase();
}
function parse(html,parent){
  const children=[];const stack=[{children,tagName:'ROOT',el:parent}];
  const tokens=/<\/?([a-z][\w-]*)\b([^>]*)>|([^<]+)/gi;let token;
  const voidTags=new Set(['INPUT','BR','HR','IMG','META','LINK','SOURCE','AREA','BASE','EMBED','WBR']);
  while((token=tokens.exec(html))){
    if(token[3]){stack.at(-1).el.textContent+=decode(token[3]);continue;}
    const tag=token[1].toUpperCase();
    if(token[0][1]==='/'){const index=stack.findLastIndex(item=>item.tagName===tag);if(index>0)stack.splice(index);continue;}
    const attributes={};
    for(const attribute of token[2].matchAll(/([\w-]+)(?:="([^"]*)"|'([^']*)')?/g))attributes[attribute[1]]=decode(attribute[2]??attribute[3]??'');
    const current=stack.at(-1);const el=node(tag,attributes,current.el);current.children.push(el);
    if(!voidTags.has(tag)&&!token[0].endsWith('/>'))stack.push({children:el.children,tagName:tag,el});
  }
  return children;
}
export const flush = async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
export async function boot(dist, {offline=false,storageThrows=false,saved={},route='#contracts-escrow',fetchHandler=null,crypto=webcrypto}={}){
  const shell=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const scripts=[...shell.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
  const root=node('document');root.children=parse(shell,root);
  const document={body:root.querySelector('body'),documentElement:root.querySelector('html'),title:'',
    querySelector:root.querySelector.bind(root),querySelectorAll:root.querySelectorAll.bind(root),
    addEventListener(){},createElement:tag=>node(tag),createElementNS:(_,tag)=>node(tag)};
  const preferences=new Map(Object.entries(saved));const downloads=[];const requests=[];const clipboard=[];
  const events=new EventTarget();
  const context={document,location:{hash:route},Event,CustomEvent,AbortController,Date,Intl,Number,BigInt,JSON,console,Blob,crypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URLSearchParams,
    navigator:{clipboard:{writeText:async text=>{clipboard.push(String(text));}}},
    localStorage:{getItem(key){if(storageThrows)throw Error('Storage blocked');return preferences.get(key)??null;},
      setItem(key,value){if(storageThrows)throw Error('Storage blocked');preferences.set(key,String(value));},
      removeItem(key){if(storageThrows)throw Error('Storage blocked');preferences.delete(key);}},
    addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),scrollTo(){},
    setTimeout(){return 1;},clearTimeout(){},requestAnimationFrame(callback){callback();return 1;},cancelAnimationFrame(){},
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},
    fetch:async(request,options)=>{requests.push({request,options});if(fetchHandler){const result=await fetchHandler(request,options);if(result!==undefined)return result;}if(offline)throw Error('Network unavailable');return {ok:true,
      json:async()=>JSON.parse(fs.readFileSync(path.join(dist,fixtures[request.split('?')[0]]||request),'utf8'))};},
  };
  context.window=context;vm.createContext(context);
  for(const script of scripts)vm.runInContext(fs.readFileSync(path.join(dist,script),'utf8'),context,{filename:script});
  await flush();
  return {context,document,preferences,downloads,requests,clipboard,root,run:source=>vm.runInContext(source,context)};
}
