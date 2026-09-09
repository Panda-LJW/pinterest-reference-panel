import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const shared=await readFile(new URL('../shared.js',import.meta.url),'utf8');
const source=await readFile(new URL('../content.js',import.meta.url),'utf8');

function harness(send) {
  const nodes=new Map(), listeners=new Map(), requests=[];
  let storageCallback, receive, mutationCallback, observedTarget, mountWrites=0;
  function node(id='') {
    const attributes=new Map(),classes=new Set();
    return {id,dataset:{},style:{},hidden:false,disabled:false,textContent:'',parentNode:null,children:[],
      classList:{toggle(key,value){if(value??!classes.has(key))classes.add(key);else classes.delete(key);},add(key){classes.add(key);},remove(key){classes.delete(key);}},
      setAttribute(key,value){attributes.set(key,value);},getAttribute(key){return attributes.get(key)??null;},removeAttribute(key){attributes.delete(key);},
      addEventListener(type,listener){listeners.set(`${id}:${type}`,listener);},
      append(child){child.remove();child.parentNode=this;this.children.push(child);mountWrites++;},
      remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;},contains(){return false;},
      attachShadow(){return shadow;}
    };
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
  const quality=['original','high','light'].map(value=>{const n=node();n.dataset.quality=value;return n;});
  const shadow={getElementById:get,querySelector:()=>get('panel'),querySelectorAll:()=>quality};
  const context={URL,console,requestAnimationFrame:()=>1,MutationObserver:class{constructor(callback){mutationCallback=callback;}observe(target){observedTarget=target;}},
    setTimeout,clearTimeout,
    location:{href:'https://www.pinterest.com/test/board/',pathname:'/test/board/'},
    window:{scrollY:0,innerHeight:800,scrollTo(){}},
    document:{getElementById:()=>null,createElement:()=>node(),documentElement:node(),head:node(),body:node(),querySelectorAll:()=>[],addEventListener(){}},
    chrome:{runtime:{lastError:null,onMessage:{addListener(listener){receive=listener;}},sendMessage(message,callback){requests.push(message);send(message,callback);}},storage:{local:{get(_keys,callback){storageCallback=callback;},set(){}}}}
  };
  runInNewContext(shared,context);
  runInNewContext(source.replace(/\}\)\(\);\s*$/,`globalThis.collector={selected,enqueueAssets,setQuality,root,pageStyle,getJob:()=>currentJobId};})();`),context);
  return {...context.collector,nodes,requests,document:context.document,observedTarget,
    mutate:()=>mutationCallback([]),newNode:node,mountWrites:()=>mountWrites,
    click:id=>listeners.get(`${id}:click`)(),receive:message=>receive(message),loadPreferences:values=>storageCallback(values)};
}
const asset={pinId:'1',boardSlug:'board',title:'test',imageUrl:'https://i.pinimg.com/736x/test.jpg'};
const status=(jobId,overrides={})=>({jobId,total:1,pending:1,success:0,skipped:0,failed:0,processingFailed:0,originalUnavailable:0,cancelled:false,done:false,...overrides});

test('failed or unconfirmed submission preserves selected images and allows retry',async()=>{
 for(const response of [undefined,{ok:false,error:'offline'}]){
  const h=harness((_message,callback)=>callback(response));h.selected.set('1',asset);
  await h.enqueueAssets([asset],0,true);
  assert.equal(h.selected.size,1);assert.equal(h.getJob(),null);
  assert.equal(h.nodes.get('downloadSelected').disabled,false);
  assert.match(h.nodes.get('status').textContent,/无法启动下载/);
 }
});

test('selection clears only after the matching queue acknowledgement',async()=>{
 let finish;
 const h=harness((message,callback)=>{finish=()=>callback({ok:true,status:status(message.jobId)});});
 h.selected.set('1',asset);
 const request=h.enqueueAssets([asset],0,true);
 assert.equal(h.selected.size,1);assert.equal(h.nodes.get('downloadSelected').disabled,true);
 await h.enqueueAssets([asset]);assert.equal(h.requests.length,1);
 finish();await request;assert.equal(h.selected.size,0);
});

test('cancellation stays busy until the current download reports done',async()=>{
 const h=harness((message,callback)=>callback({ok:true,status:status(message.jobId)}));
 await h.enqueueAssets([asset]);const jobId=h.getJob();
 h.receive({type:'pinterestInboxDownloadProgress',status:status(jobId,{cancelled:true})});
 assert.equal(h.getJob(),jobId);assert.equal(h.nodes.get('downloadBoard').disabled,true);
 assert.equal(h.nodes.get('progressPhase').textContent,'取消中');
 h.receive({type:'pinterestInboxDownloadProgress',status:status(jobId,{cancelled:true,pending:0,skipped:1,done:true})});
 assert.equal(h.getJob(),null);assert.equal(h.nodes.get('downloadBoard').disabled,false);
});

test('a delayed preference read cannot overwrite a quality chosen by the user',()=>{
 const h=harness(()=>{});h.setQuality('original');
 h.loadPreferences({downloadQuality:'light',downloadQualityVersion:1});
 assert.match(h.nodes.get('qualitySummary').textContent,/原图/);
});

test('old-job updates cannot change the new job progress',async()=>{
 const h=harness((message,callback)=>callback({ok:true,status:status(message.jobId)}));
 await h.enqueueAssets([asset]);const first=h.getJob();
 h.receive({type:'pinterestInboxDownloadProgress',status:status(first,{pending:0,success:1,done:true})});
 await h.enqueueAssets([asset]);const second=h.getJob();
 h.receive({type:'pinterestInboxDownloadProgress',status:status(first,{pending:0,success:1,done:true})});
 assert.equal(h.getJob(),second);assert.equal(h.nodes.get('progressPhase').textContent,'下载中');
});

test('removed panel and stylesheet remount as the same instance without resetting selection or collapse',()=>{
 const h=harness(()=>{});h.selected.set('1',asset);h.click('collapse');
 h.root.remove();h.pageStyle.remove();h.mutate();
 assert.equal(h.root.parentNode,h.document.body);assert.equal(h.pageStyle.parentNode,h.document.head);
 assert.equal(h.selected.get('1'),asset);assert.equal(h.nodes.get('body').hidden,true);
 assert.equal(h.requests.length,0);
 const writes=h.mountWrites();for(let i=0;i<10;i++)h.mutate();
 assert.equal(h.mountWrites(),writes,'unrelated mutations must not repeatedly append extension nodes');
});

test('document-level observation survives body and entire document-element replacement',()=>{
 const h=harness(()=>{});assert.equal(h.observedTarget,h.document);
 h.document.body=h.newNode();h.mutate();assert.equal(h.root.parentNode,h.document.body);
 h.document.documentElement=null;h.document.head=null;h.document.body=null;
 assert.doesNotThrow(()=>h.mutate());
 h.document.documentElement=h.newNode();h.document.head=h.newNode();h.document.body=h.newNode();h.mutate();
 assert.equal(h.root.parentNode,h.document.body);assert.equal(h.pageStyle.parentNode,h.document.head);
 assert.equal(h.document.documentElement.getAttribute('data-pinterest-inbox-enabled'),'true');
});

test('remount keeps a paused collector paused and retains the running job',async()=>{
 const h=harness((message,callback)=>callback({ok:true,status:status(message.jobId)}));
 await h.enqueueAssets([asset]);const jobId=h.getJob();
 h.root.remove();h.mutate();assert.equal(h.getJob(),jobId);assert.equal(h.requests.length,1);
 h.receive({type:'pinterestInboxDownloadProgress',status:status(jobId,{pending:0,success:1,done:true})});
 assert.equal(h.nodes.get('successCount').textContent,'1');
 h.click('toggleEnabled');h.root.remove();h.document.documentElement.removeAttribute('data-pinterest-inbox-enabled');h.mutate();
 assert.equal(h.root.parentNode,h.document.body);
 assert.equal(h.document.documentElement.getAttribute('data-pinterest-inbox-enabled'),'false');
 assert.equal(h.nodes.get('toggleEnabled').textContent,'启用');
});

const quick = (h, pinId) => h.enqueueAssets([{...asset,pinId,title:`image ${pinId}`}],0,false,'',true);
const finishJob = (h, jobId, changes={}) => h.receive({type:'pinterestInboxDownloadProgress',status:status(jobId,{pending:0,success:1,done:true,...changes})});

test('single-image clicks enqueue immediately and aggregate progress until all three finish',async()=>{
 const h=harness((message,callback)=>callback({ok:true,status:status(message.jobId)}));
 await Promise.all([quick(h,'1'),quick(h,'2'),quick(h,'3')]);
 assert.equal(h.requests.length,3);assert.equal(new Set(h.requests.map(r=>r.jobId)).size,3);
 assert.equal(h.nodes.get('progressCount').textContent,'0 / 3');
 const group=h.getJob();finishJob(h,h.requests[0].jobId);
 assert.equal(h.getJob(),group);assert.equal(h.nodes.get('progressCount').textContent,'1 / 3');
 finishJob(h,h.requests[1].jobId);assert.equal(h.nodes.get('successCount').textContent,'2');
 finishJob(h,h.requests[2].jobId);assert.equal(h.getJob(),null);
 assert.equal(h.nodes.get('progressCount').textContent,'3 / 3');assert.equal(h.nodes.get('successCount').textContent,'3');
});

test('duplicate clicks during submission or download do not create duplicate requests',async()=>{
 let reply;const h=harness((message,callback)=>{reply=()=>callback({ok:true,status:status(message.jobId)});});
 const first=quick(h,'1');await quick(h,'1');assert.equal(h.requests.length,1);
 reply();await first;await quick(h,'1');assert.equal(h.requests.length,1);
 finishJob(h,h.requests[0].jobId);
 const again=quick(h,'1');assert.equal(h.requests.length,2);reply();await again;
});

test('one failed submission does not drop the remaining queued jobs',async()=>{
 const h=harness((message,callback)=>callback(message.assets[0].pinId==='2'?{ok:false,error:'offline'}:{ok:true,status:status(message.jobId)}));
 await Promise.all([quick(h,'1'),quick(h,'2'),quick(h,'3')]);
 assert.ok(h.getJob());assert.equal(h.nodes.get('failedCount').textContent,'1');
 finishJob(h,h.requests[0].jobId);assert.ok(h.getJob());
 finishJob(h,h.requests[2].jobId);assert.equal(h.getJob(),null);
 assert.equal(h.nodes.get('successCount').textContent,'2');assert.match(h.nodes.get('status').textContent,/未加入的图片可重试/);
});

test('cancel covers every queued job and waits for the active download to finish cancelling',async()=>{
 let active;
 const h=harness((message,callback)=>{
  if(message.type==='pinterestInboxEnqueue')active??=message.jobId;
  callback({ok:true,status:status(message.jobId,message.type==='pinterestInboxCancel'?{cancelled:true,...(message.jobId!==active?{pending:0,skipped:1,done:true}:{})}:{})});
 });
 await Promise.all([quick(h,'1'),quick(h,'2'),quick(h,'3')]);
 await h.click('cancel');
 assert.equal(h.requests.filter(r=>r.type==='pinterestInboxCancel').length,3);
 assert.ok(h.getJob());assert.equal(h.nodes.get('progressPhase').textContent,'取消中');
 await quick(h,'4');assert.equal(h.requests.filter(r=>r.type==='pinterestInboxEnqueue').length,3);
 finishJob(h,active,{success:0,cancelled:true,skipped:1});
 assert.equal(h.getJob(),null);assert.equal(h.nodes.get('progressPhase').textContent,'已取消');
});

test('pause cancels late-acknowledged submissions and prevents new clicks from enqueueing',async()=>{
 const replies=[];
 const h=harness((message,callback)=>{
  if(message.type==='pinterestInboxEnqueue')replies.push(()=>callback({ok:true,status:status(message.jobId)}));
  else callback({ok:true,status:status(message.jobId,{pending:0,skipped:1,cancelled:true,done:true})});
 });
 const submissions=[quick(h,'1'),quick(h,'2')];await h.click('toggleEnabled');
 assert.equal(h.requests.length,2);await quick(h,'3');assert.equal(h.requests.length,2);
 replies.forEach(reply=>reply());await Promise.all(submissions);
 assert.equal(h.requests.filter(r=>r.type==='pinterestInboxCancel').length,2);
 assert.equal(h.getJob(),null);assert.match(h.nodes.get('status').textContent,/采集已暂停/);
});

test('a delayed enqueue acknowledgement cannot regress already-completed progress',async()=>{
 let reply;const h=harness((message,callback)=>{reply=()=>callback({ok:true,status:status(message.jobId)});});
 const request=quick(h,'1');finishJob(h,h.requests[0].jobId);
 assert.ok(h.getJob(),'keep tracking until the submission is acknowledged');
 reply();await request;
 assert.equal(h.getJob(),null);assert.equal(h.nodes.get('successCount').textContent,'1');
 assert.equal(h.nodes.get('progressCount').textContent,'1 / 1');
});

test('remount preserves all pending single-image jobs and combined progress',async()=>{
 const h=harness((message,callback)=>callback({ok:true,status:status(message.jobId)}));
 await Promise.all([quick(h,'1'),quick(h,'2')]);h.root.remove();h.mutate();
 finishJob(h,h.requests[0].jobId);assert.equal(h.nodes.get('progressCount').textContent,'1 / 2');
 assert.equal(h.root.parentNode,h.document.body);
 finishJob(h,h.requests[1].jobId);assert.equal(h.nodes.get('successCount').textContent,'2');
});
