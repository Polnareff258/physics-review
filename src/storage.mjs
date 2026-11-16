const prefix='physics-review:';
export function createStorage(storage=globalThis.localStorage) {
 const read=(key,fallback)=>{const v=storage.getItem(prefix+key);return v===null?fallback:JSON.parse(v)};
 const write=(key,v)=>storage.setItem(prefix+key,JSON.stringify(v));
 const eventPrefix=prefix+'event:';
 const versionPrefix=prefix+'event-v2:';
 const dataEpoch=()=>read('data-epoch','initial');
 const events=()=>{const generation=dataEpoch();const found=new Map();for(const e of read('events',[]))if(e?.id)found.set(e.id,e);for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(eventPrefix)||k?.startsWith(versionPrefix+generation+':')){const raw=storage.getItem(k);if(raw!==null){const e=JSON.parse(raw);if(e?.id)found.set(e.id,e)}}}return [...found.values()]};
 const add=(e,generation=dataEpoch(),alreadyChecked=false)=>{if(!e?.id)throw new Error('事件缺少 id');if(!alreadyChecked&&events().some(old=>old.id===e.id))return;const key=versionPrefix+generation+':'+encodeURIComponent(e.id);if(storage.getItem(key)===null){storage.setItem(key,JSON.stringify(e));if(dataEpoch()!==generation){storage.removeItem(key);throw new Error('本地数据已清除，请重试')}}};
 const invalidate=()=>write('epoch',`${Date.now()}-${Math.random()}`);
 return {getEpoch:()=>read('epoch',null),getDataEpoch:dataEpoch,getQuestions:()=>read('questions',null),setQuestions:v=>write('questions',v),getEvents:events,setEvents:(v,generation=dataEpoch())=>{const known=new Set(events().map(e=>e.id));for(const e of v){if(!known.has(e?.id)){add(e,generation,true);known.add(e.id)}}},addEvent:add,getConfig:()=>read('config',{}),setConfig:v=>{const old=read('config',{});const identity=c=>[c.owner?.trim().toLowerCase()||'',c.repo?.trim().toLowerCase()||'',c.branch||''];if(old.owner&&old.repo&&JSON.stringify(identity(old))!==JSON.stringify(identity(v))&&(events().length||read('questions',null)))throw new Error('已有本地数据，请先清除本地数据再切换仓库');if(JSON.stringify(old)!==JSON.stringify(v))invalidate();write('config',v)},clear:()=>{invalidate();write('data-epoch',`${Date.now()}-${Math.random()}`);for(let i=storage.length-1;i>=0;i--){const k=storage.key(i);if(k?.startsWith(eventPrefix)||k?.startsWith(versionPrefix))storage.removeItem(k)}for(const k of ['questions','events','config'])storage.removeItem(prefix+k)}};
}
