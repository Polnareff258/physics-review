import {chooseQuestions, nextDue, pickLatestEvents} from './review.mjs';
import {analyze} from './analytics.mjs';
import {orderQuestionImages, questionPage} from './viewer.mjs';
import {createStorage} from './storage.mjs';
import {createGitHubSync} from './github.mjs';
import {buildBackup, readBackup} from './backup.mjs';

const $ = id => document.getElementById(id);
const preview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
const store = createStorage(preview ? sessionStorage : localStorage);
let bank=null, set=[], index=0, selection='', selectionAtReveal='', typedAtReveal='', usedHint=false;
let urls=[], generation=0, syncTimer=null, questionStarted=0, sessionId='', sessionRatings=[], noteDirty=false;
const label={remembered:'记住了',known:'记住了',fuzzy:'模糊',forgot:'不会'};
const client = preview ? {
  async loadQuestions(){const r=await fetch('./data/questions.json');if(!r.ok)throw new Error('无法读取本地题库');const q=await r.json();store.setQuestions(q);return q;},
  async loadImage(path){const r=await fetch('./'+path);if(!r.ok)throw new Error('无法读取本地图片');return r.blob();},
  async sync(){return store.getEvents();}
} : createGitHubSync({storage:store,onStatus:({state,message})=>{
  const text=state==='syncing'?'正在同步…':state==='success'?'同步完成。':`同步未完成：${message||'请检查网络和设置'}。本机记录仍然保留。`;
  $('connection-status').textContent=text;$('sync-status').textContent=text;
  if(state==='success' && !$('setup').hidden) refreshDashboard();
}});
function screen(name){for(const s of ['setup','practice','finished','settings'])$(s).hidden=s!==name;if(name==='setup')refreshDashboard();}
function releaseImages(){for(const url of urls)URL.revokeObjectURL(url);urls=[];}
function showError(id,e){$(id).textContent=e instanceof Error?e.message:String(e);}
function configInputs(){const c=store.getConfig();$('repo').value=c.owner&&c.repo?`${c.owner}/${c.repo}`:'';$('token').value=c.token||'';}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>client.sync().catch(()=>{}),1500);}
function recommendationRandom(){const d=new Date();let state=(d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate())>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
function current(){return set[index];}
function formatDate(value){const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}):'待定';}
function latestFor(id){return pickLatestEvents(store.getEvents()).get(id);}
function lastNote(id){return store.getEvents().filter(e=>e.questionId===id && Object.hasOwn(e,'note') && Number.isFinite(Date.parse(e.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||String(b.id).localeCompare(String(a.id)))[0]?.note||'';}
function el(tag,text,cls){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;}
function refreshDashboard(){
  const data=bank?.questions;
  if(!Array.isArray(data)||!data.length){$('recommended-start').disabled=true;$('recommendations').replaceChildren();return;}
  try{
    const events=store.getEvents(), info=analyze(data,events), latest=pickLatestEvents(events), studied=info.totalQuestions-info.mastery.unreviewed;
    $('stat-due').textContent=String(info.dueCount);$('stat-weak').textContent=String(info.mastery.fuzzy+info.mastery.forgot);
    $('stat-covered').textContent=`${studied}/${info.totalQuestions}`;$('stat-today').textContent=String(info.activity.at(-1)?.count||0);
    $('overview-date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
    const unscheduled=info.recommendations.filter(r=>r.rating!=='unreviewed'&&!Number.isFinite(Date.parse(latest.get(r.questionId)?.due))).length;
    $('recommend-intro').textContent=info.dueCount?`有 ${info.dueCount} 道题到了复习时间，先从这些题开始。`:unscheduled?`有 ${unscheduled} 道旧记录没有复习时间，可以先回顾。`:info.mastery.unreviewed?`目前没有到期的题，可以先认识 ${info.mastery.unreviewed} 道未学题中的几道。`:'目前没有到期的题，可以随机看看或提前复习薄弱题。';
    const byId=new Map(data.map(q=>[q.id,q])), reasons=new Map(info.recommendations.map(r=>[r.questionId,r]));
    const suggestions=chooseQuestions(data,events,{count:3,mode:'weak'},recommendationRandom());
    const list=$('recommendations');list.replaceChildren();
    for(const q of suggestions){const detail=reasons.get(q.id),previous=latest.get(q.id);let why;
      if(detail?.reasons.includes('到期'))why=`已到复习时间${previous?.rating?` · 上次${label[previous.rating]||'已练习'}`:''}`;
      else if(!previous)why='还没有练过';else if(!Number.isFinite(Date.parse(previous.due)))why=`旧记录待回顾 · 上次${label[previous.rating]||'已练习'}`;else why=`提前看看 · 上次${label[previous.rating]||'已练习'}`;
      const button=el('button',null,'recommendation');button.type='button';button.append(el('span',`${q.subject} · 第 ${q.number} 题`,'rec-title'),el('span',why,'rec-reason'),el('span','练这题 →','rec-action'));button.addEventListener('click',()=>startSession({questionId:q.id}));list.append(button);
    }
    $('recommended-start').disabled=false;
    $('mastery-summary').textContent=`记住了 ${info.mastery.known} · 模糊 ${info.mastery.fuzzy} · 不会 ${info.mastery.forgot} · 未练 ${info.mastery.unreviewed}`;
    const compared=info.sourceComparison.match+info.sourceComparison.different;
    $('source-summary').textContent=compared?`新记录中有 ${info.sourceComparison.match} 次与原答案相同、${info.sourceComparison.different} 次不同。原答案尚未逐题核验，该对照不代表得分。`:'作答对照从新版开始记录；旧记录保留，但无法判断是否在看答案前作答。';
    const subjectBox=$('subject-stats');subjectBox.replaceChildren();
    for(const [subject,g] of Object.entries(info.subjects)){const item=el('div',null,'subject-row');const covered=g.total-g.unreviewed;item.append(el('strong',subject),el('span',`已练 ${covered}/${g.total} · 待复习 ${g.due} · 不熟悉 ${g.fuzzy+g.forgot}`));subjectBox.append(item);}
    const activity=$('activity');activity.replaceChildren();const max=Math.max(1,...info.activity.map(x=>x.count));
    for(const day of info.activity){const item=el('div',null,'activity-day'),bar=el('span',null,'activity-bar');bar.style.height=`${Math.max(4,Math.round(38*day.count/max))}px`;item.append(el('span',String(day.count),'activity-value'),bar,el('span',day.date.slice(5).replace('-','/'),'activity-label'));activity.append(item);}
    const recent=$('recent-activity');recent.replaceChildren();
    if(!info.recent.length)recent.append(el('p','完成几道题后，这里会显示你的记录。','muted'));
    for(const event of info.recent.slice(0,5)){const q=byId.get(event.questionId);if(!q)continue;const item=el('button',null,'recent-row');item.type='button';item.append(el('span',`${q.subject} · 第 ${q.number} 题`),el('span',`${formatDate(event.at)} · ${label[event.rating]||'已练习'}`,'subtle'));item.addEventListener('click',()=>startSession({questionId:q.id}));recent.append(item);}
  }catch(e){showError('setup-status',e);}
}
async function images(target,paths,version,{pages=[],isQuestion=false}={}){
  target.replaceChildren();const selected=isQuestion?orderQuestionImages(paths,pages):(paths||[]);const wanted=new Set(pages.map(Number));
  for(let i=0;i<selected.length;i++){
    if(version!==generation)return;const path=selected[i],page=questionPage(path);
    const frame=el('figure',null,'image-frame'),toolbar=el('figcaption',null,'image-toolbar');
    const caption=page!==null?(wanted.has(page)?`题目所在页 · 第 ${page} 页`:`相关原页 · 第 ${page} 页`):`${isQuestion?'题面':'答案'}${selected.length>1?` ${i+1}/${selected.length}`:''}`;
    toolbar.append(el('span',caption,'image-caption'));const controls=el('span',null,'image-controls');
    const minus=el('button','−','image-control'),fit=el('button','适屏','image-control'),plus=el('button','+','image-control');
    for(const b of [minus,fit,plus])b.type='button';minus.setAttribute('aria-label','缩小图片');plus.setAttribute('aria-label','放大图片');controls.append(minus,fit,plus);toolbar.append(controls);
    const viewport=el('div',null,'image-scroll'),holder=el('p','正在加载图片…','muted image-loading');viewport.tabIndex=0;viewport.append(holder);frame.append(toolbar,viewport);target.append(frame);
    try{const blob=await client.loadImage(path);if(version!==generation)return;const url=URL.createObjectURL(blob);urls.push(url);
      const img=document.createElement('img');img.alt=`${caption}，可用上方按钮放大，左右滑动查看`;img.src=url;img.loading='lazy';let scale=matchMedia('(max-width: 540px)').matches?1.8:1;
      const apply=()=>{img.style.width=`${Math.round(scale*100)}%`;};apply();minus.addEventListener('click',()=>{scale=Math.max(1,scale-.4);apply();});plus.addEventListener('click',()=>{scale=Math.min(3,scale+.4);apply();});fit.addEventListener('click',()=>{scale=1;apply();});
      holder.replaceWith(img);
    }catch(e){holder.textContent=`图片加载失败：${e.message}。请检查网络或重新连接。`;}
  }
}
function renderQuestion(){
  generation++;releaseImages();selection='';selectionAtReveal='';typedAtReveal='';usedHint=false;questionStarted=performance.now();
  $('answer').hidden=true;$('reveal').hidden=false;$('pre-hint').hidden=true;$('pre-hint').textContent='';$('choices').replaceChildren();$('answer-images').replaceChildren();$('original-answer').hidden=true;
  $('typed-answer').value='';$('typed-answer').disabled=false;const q=current(),previous=latestFor(q.id),note=lastNote(q.id);
  $('progress').textContent=`第 ${index+1} / ${set.length} 题 · ${q.subject} · ${q.type==='choice'?'选择题':'填空题'}`;$('progress-bar').style.width=`${100*(index+1)/set.length}%`;
  $('question-title').textContent=`${q.subject} · 第 ${q.number} 题`;
  $('question-history').textContent=previous?`上次自评：${label[previous.rating]||'已练习'}${previous.due?` · 复习时间 ${formatDate(previous.due)}`:''}`:'第一次练习这道题';
  $('question-warning').textContent=q.cropStatus==='page_fallback'?'暂用原页显示；题目页优先，其他页可能包含相关图。可用 + 放大并左右滑动。':'题面由原文裁切，尚待逐题核验；图片可放大并左右滑动。';
  $('original-question').hidden=!q.originalImages?.length||q.cropStatus==='page_fallback';
  images($('question-images'),q.images,generation,{pages:q.source?.pages||[],isQuestion:true});
  $('typed-wrap').hidden=q.type!=='fill';$('choice-note').textContent=q.type==='choice'?'对照题图选择；不确定也可以直接看答案。':'可以先写关键词、在纸上作答，或只在心里回忆。';
  $('show-hint').hidden=!(note||q.hint);$('show-hint').disabled=false;$('question-note').value=note;noteDirty=false;
  if(q.type==='choice')for(const letter of ['A','B','C','D','E']){const b=el('button',letter);b.type='button';b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{selection=letter;for(const item of $('choices').children){const selected=item===b;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));}});$('choices').append(b);}
}
async function showAnswer(){
  const q=current();selectionAtReveal=selection;typedAtReveal=$('typed-answer').value.trim();for(const b of $('choices').children)b.disabled=true;$('typed-answer').disabled=true;$('show-hint').disabled=true;
  $('reveal').hidden=true;$('answer').hidden=false;
  $('answer-text').textContent=q.answer?`${selectionAtReveal?`你选 ${selectionAtReveal}，`:''}原答案区对应 ${q.answer}${selectionAtReveal?(selectionAtReveal===q.answer?'，两者相同':'，两者不同'):''}。（自动配对，尚未逐题核实）`:q.derivedAnswer?`推导参考：${q.derivedAnswer}（原文编号不一致，请结合原文核对）`:'请查看原答案，自行核对。';
  const previous=latestFor(q.id), prior=previous?.typedAnswer||previous?.selected||'';
  $('prior-answer').textContent=prior?`上次作答：${prior}`:'';
  $('answer-note').textContent=q.answerStatus==='missing_or_ambiguous'?'原题与答案区的编号存在疑点，未自动确定答案，请对照原文核查。':'原答案与提示尚未逐题核实，请结合原文核对。';
  $('study-hint').textContent=q.derivedReason?`推导说明：${q.derivedReason}`:q.hint?`思路提示：${q.hint}`:'此题的思路提示还在整理。';if(q.caveat)$('answer-note').textContent+=` ${q.caveat}`;
  const noteEvents=store.getEvents().filter(e=>e.questionId===q.id&&typeof e.note==='string'&&e.note.trim()).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||String(b.id).localeCompare(String(a.id)));$('note-history-wrap').hidden=noteEvents.length===0;const notes=$('note-history');notes.replaceChildren();for(const event of noteEvents.slice(0,10))notes.append(el('p',`${formatDate(event.at)} · ${event.note}`,'muted'));
  if(q.answerImages?.length)await images($('answer-images'),q.answerImages,generation);else{$('answer-note').textContent+=' 该题需要打开原答案页，页面会含其他题的答案。';$('original-answer').hidden=!(q.originalAnswerImages?.length);}
}
function record(rating){
  const q=current(),at=new Date().toISOString(),previous=latestFor(q.id);
  const compared=q.type==='choice'&&selectionAtReveal&&q.answer&&q.answerStatus==='source_matched_not_visually_verified'?(selectionAtReveal===q.answer?'match':'different'):null;
  const next=nextDue(at,rating,previous?.interval||0,usedHint,previous?.due||null);
  const event={id:crypto.randomUUID(),schemaVersion:2,sessionId,questionId:q.id,at,rating,selected:selectionAtReveal,typedAnswer:typedAtReveal,elapsedMs:Math.max(0,Math.round(performance.now()-questionStarted)),usedHint,answeredBeforeReveal:q.type==='choice'?Boolean(selectionAtReveal):typedAtReveal?true:null,comparedToSource:compared,sourceAnswer:compared?q.answer:null,sourceAnswerStatus:compared?q.answerStatus:null,interval:next.interval,due:next.due};
  if(noteDirty)event.note=$('question-note').value.trim();
  try{store.addEvent(event);}catch(e){$('answer-note').textContent=`记录未保存：${e.message}。请检查本机存储空间后重试。`;return;}
  sessionRatings.push(rating);scheduleSync();index++;
  const saved=`已保存 · 下次复习 ${formatDate(next.due)}${compared==='different'?' · 与原答案不同，建议核对':usedHint?' · 看过提示，安排较早回忆':''}`;
  if(index>=set.length){releaseImages();generation++;$('finished-text').textContent=preview?`本组共复习 ${set.length} 题。预览记录只保存在当前标签页。`:`本组共复习 ${set.length} 题。记录先保存在本机，联网后同步。`;const summary=$('session-summary');summary.replaceChildren();for(const [name,n] of [['记住了',sessionRatings.filter(r=>r==='remembered').length],['模糊',sessionRatings.filter(r=>r==='fuzzy').length],['不会',sessionRatings.filter(r=>r==='forgot').length]])summary.append(el('span',`${name} ${n}`));summary.append(el('span',saved));screen('finished');}
  else{$('last-saved').textContent=saved;renderQuestion();}
}
async function startSession(options={}){
  $('start').disabled=true;$('recommended-start').disabled=true;
  try{bank=store.getQuestions()||bank;if(!bank?.questions?.length){$('setup-status').textContent='请先在设置中连接私有题库。';return;}
    if(navigator.onLine){$('setup-status').textContent='正在同步最新进度…';try{await client.sync();$('setup-status').textContent='';}catch(e){$('setup-status').textContent=`同步未完成，先使用本机记录：${e.message}`;}}
    const data=bank.questions,events=store.getEvents();
    set=options.questionId?data.filter(q=>q.id===options.questionId):chooseQuestions(data,events,options.custom?{subject:$('subject').value,type:$('type').value,count:$('count').value,mode:$('mode').value}:{count:10,mode:'weak'},options.custom?Math.random:recommendationRandom());
    if(!set.length){$('setup-status').textContent=options.custom&&$('mode').value==='due'?'当前没有已到期的题，可以先练新题或提前复习。':'没有符合条件的题，请调整筛选。';return;}
    index=0;sessionId=crypto.randomUUID();sessionRatings=[];$('last-saved').textContent='';screen('practice');renderQuestion();
  }catch(e){showError('setup-status',e);}finally{$('start').disabled=false;$('recommended-start').disabled=false;}
}
$('settings-open').addEventListener('click',()=>{configInputs();screen('settings');});$('settings-close').addEventListener('click',()=>screen('setup'));
$('connect').addEventListener('click',async()=>{const match=$('repo').value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/),token=$('token').value.trim();if(!match||!token){$('connection-status').textContent='请填写用户名/仓库名和访问令牌。';return;}try{store.setConfig({owner:match[1],repo:match[2],token});$('connection-status').textContent='正在连接并读取题库…';bank=await client.loadQuestions();if(!Array.isArray(bank.questions))throw new Error('题库格式不正确');await client.sync();$('setup-status').textContent=`已载入 ${bank.questions.length} 题。`;screen('setup');}catch(e){showError('connection-status',e);}});
$('backup-export').addEventListener('click',()=>{try{const records=store.getEvents();const blob=new Blob([JSON.stringify(buildBackup(records),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`物理复习记录-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('backup-status').textContent=`已准备 ${records.length} 条记录的备份。`;}catch(e){showError('backup-status',e);}});
$('backup-import').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('备份文件超过 10 MB');const incoming=readBackup(await file.text()),before=store.getEvents().length;store.setEvents(incoming);const added=store.getEvents().length-before;$('backup-status').textContent=`已合并 ${added} 条新记录；已有记录未覆盖。`;scheduleSync();}catch(e){$('backup-status').textContent=`导入未完成（部分记录可能已保存）：${e.message}`;}finally{event.target.value='';}});
$('sync').addEventListener('click',()=>client.sync().catch(()=>{}));
$('clear').addEventListener('click',()=>{if(!confirm('确定清除本机的令牌、题库缓存和所有本机记录吗？尚未同步的记录会丢失。'))return;try{store.clear();bank=null;releaseImages();$('token').value='';$('repo').value='';$('connection-status').textContent='已清除本机数据。';$('setup-status').textContent='请先连接私有题库。';}catch(e){showError('connection-status',e);}});
$('start').addEventListener('click',()=>startSession({custom:true}));$('recommended-start').addEventListener('click',()=>startSession());
$('reveal').addEventListener('click',showAnswer);
$('question-note').addEventListener('input',()=>{noteDirty=true;});
$('show-hint').addEventListener('click',()=>{const q=current(),note=lastNote(q.id);usedHint=true;$('pre-hint').hidden=false;$('pre-hint').textContent=note?`我的线索：${note}`:`思路提示：${q.hint}`;$('show-hint').hidden=true;});
$('original-question').addEventListener('click',()=>{$('original-question').hidden=true;$('question-warning').textContent='显示原题所在页，可能包含相邻题；可用 + 放大并左右滑动。';images($('question-images'),current().originalImages,generation,{pages:current().source?.pages||[],isQuestion:true});});
$('original-answer').addEventListener('click',()=>{$('original-answer').hidden=true;images($('answer-images'),current().originalAnswerImages,generation);});
for(const b of document.querySelectorAll('[data-rating]'))b.addEventListener('click',()=>record(b.dataset.rating));
$('end').addEventListener('click',()=>{generation++;releaseImages();screen('setup');});$('again').addEventListener('click',()=>screen('setup'));
try{bank=store.getQuestions();if(bank?.questions?.length)$('setup-status').textContent=`已载入 ${bank.questions.length} 题。`;else $('setup-status').textContent='请先在设置中连接私有题库。';}catch(e){showError('setup-status',e);}screen('setup');
window.addEventListener('online',()=>client.sync().catch(()=>{}));
if(preview){$('settings-open').hidden=true;$('sync-status').textContent='本机预览：记录仅保存在当前预览标签页，不会同步。';client.loadQuestions().then(q=>{bank=q;$('setup-status').textContent=`本机预览已载入 ${q.questions.length} 题。`;refreshDashboard();}).catch(e=>showError('setup-status',e));}
