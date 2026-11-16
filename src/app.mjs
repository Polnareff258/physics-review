import {chooseQuestions, nextDue} from './review.mjs';
import {createStorage} from './storage.mjs';
import {createGitHubSync} from './github.mjs';

const $ = id => document.getElementById(id);
const preview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
const store = createStorage(preview ? sessionStorage : localStorage);
const client = preview ? {
  async loadQuestions() { const r=await fetch('./data/questions.json'); if(!r.ok)throw new Error('无法读取本地题库'); const q=await r.json(); store.setQuestions(q); return q; },
  async loadImage(path) { const r=await fetch('./'+path); if(!r.ok)throw new Error('无法读取本地图片'); return r.blob(); },
  async sync() { return store.getEvents(); }
} : createGitHubSync({storage:store,onStatus:({state,message})=>{
  const text = state === 'syncing' ? '正在同步…' : state === 'success' ? '同步完成。' : `同步未完成：${message || '请检查网络和设置'}。本机记录仍然保留。`;
  $('connection-status').textContent = text; $('sync-status').textContent = text;
}});
let bank = null, set = [], index = 0, selection = '', urls = [], generation = 0, syncTimer = null;
function screen(name) { for (const s of ['setup','practice','finished','settings']) $(s).hidden = s !== name; }
function releaseImages() { for (const url of urls) URL.revokeObjectURL(url); urls = []; }
function showError(id, e) { $(id).textContent = e instanceof Error ? e.message : String(e); }
function configInputs() { const c=store.getConfig(); $('repo').value=c.owner&&c.repo?`${c.owner}/${c.repo}`:''; $('token').value=c.token||''; }
function scheduleSync() { clearTimeout(syncTimer); syncTimer=setTimeout(()=>client.sync().catch(()=>{}),1500); }
async function images(target, paths, version) {
  target.replaceChildren();
  for (const path of paths || []) {
    if (version !== generation) return;
    const img=document.createElement('img'); img.alt='题库原文图片，可点击放大'; img.loading='lazy';
    const holder=document.createElement('p'); holder.className='muted'; holder.textContent='正在加载图片…'; target.append(holder);
    try {
      const blob=await client.loadImage(path);
      if (version !== generation) return;
      const url=URL.createObjectURL(blob); urls.push(url); img.src=url;
      img.addEventListener('click',()=>{ img.classList.toggle('zoomed'); });
      holder.replaceWith(img);
    } catch (e) { holder.textContent=`图片加载失败：${e.message}。请检查网络或重新连接。`; }
  }
}
function current() { return set[index]; }
function renderQuestion() {
  generation++; releaseImages(); selection=''; $('answer').hidden=true; $('reveal').hidden=false;
  $('choices').replaceChildren(); $('answer-images').replaceChildren(); $('original-answer').hidden=true;
  const q=current(); $('progress').textContent=`第 ${index+1} / ${set.length} 题 · ${q.subject} · ${q.type==='choice'?'选择题':'填空题'}`;
  $('question-title').textContent=`${q.subject} · 第 ${q.number} 题`;
  $('question-warning').textContent=q.cropStatus==='page_fallback'?'本题含图或边界尚待核验，暂显示原页，页面可能包含相邻题。点击图片放大，左右滑动查看。':'题面由原文裁切，尚待逐题核验。点击图片放大，左右滑动查看。';
  $('original-question').hidden=!q.originalImages?.length || q.cropStatus==='page_fallback';
  images($('question-images'),q.images,generation);
  $('choice-note').textContent=q.type==='choice'?'请结合上方原题图片选择；不知道时可直接查看答案。':'请先在心里或纸上作答，再查看原答案并自评。';
  if(q.type==='choice') for(const letter of ['A','B','C','D','E']) {
    const b=document.createElement('button'); b.type='button'; b.textContent=letter; b.setAttribute('aria-pressed','false');
    b.addEventListener('click',()=>{selection=letter; for(const el of $('choices').children){const selected=el===b;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));}});
    $('choices').append(b);
  }
}
async function showAnswer() {
  const q=current(); $('reveal').hidden=true; $('answer').hidden=false;
  $('answer-text').textContent=q.answer?`${selection ? `你选 ${selection}，` : ''}原答案区对应 ${q.answer}${selection ? (selection===q.answer?'，两者相同':'，两者不同') : ''}。（自动配对，尚未逐题核实）`:q.derivedAnswer?`推导参考：${q.derivedAnswer}（原文编号不一致，请结合原文核对）`:'请查看原答案，自行核对。';
  $('answer-note').textContent=q.answerStatus==='missing_or_ambiguous'?'原题与答案区的编号存在疑点，未自动确定答案，请对照原文核查。':'原答案与提示尚未逐题核实，请结合原文核对。';
  $('study-hint').textContent=q.derivedReason?`推导说明：${q.derivedReason}`:q.hint?`思路提示：${q.hint}`:'此题的思路提示还在整理。';
  if(q.caveat) $('answer-note').textContent += ` ${q.caveat}`;
  if(q.answerImages?.length) await images($('answer-images'),q.answerImages,generation);
  else { $('answer-note').textContent+=' 该题需要打开原答案页，页面会含其他题的答案。'; $('original-answer').hidden=!(q.originalAnswerImages?.length); }
}
function record(rating) {
  const q=current(); const at=new Date().toISOString();
  const previous=store.getEvents().filter(e=>e.questionId===q.id).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
  const next=nextDue(at,rating,previous?.interval || 0);
  const event={id:crypto.randomUUID(),questionId:q.id,at,rating,selected:selection,interval:next.interval,due:next.due};
  try { store.addEvent(event); } catch(e) { $('answer-note').textContent=`记录未保存：${e.message}。请检查本机存储空间后重试。`; return; }
  scheduleSync(); index++;
  if(index>=set.length) { releaseImages(); generation++; $('finished-text').textContent=`已复习 ${set.length} 题。记录先保存在本机，联网后会同步。`; screen('finished'); }
  else renderQuestion();
}
$('settings-open').addEventListener('click',()=>{configInputs();screen('settings')});
$('settings-close').addEventListener('click',()=>screen('setup'));
$('connect').addEventListener('click',async()=>{
  const match=$('repo').value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/); const token=$('token').value.trim();
  if(!match||!token){$('connection-status').textContent='请填写用户名/仓库名和访问令牌。';return;}
  try {store.setConfig({owner:match[1],repo:match[2],token}); $('connection-status').textContent='正在连接并读取题库…'; bank=await client.loadQuestions(); if(!Array.isArray(bank.questions))throw new Error('题库格式不正确'); await client.sync(); $('setup-status').textContent=`已载入 ${bank.questions.length} 题。`; screen('setup');}
  catch(e){showError('connection-status',e);}
});
$('sync').addEventListener('click',()=>client.sync().catch(()=>{}));
$('clear').addEventListener('click',()=>{if(!confirm('确定清除本机的令牌、题库缓存和所有本机记录吗？尚未同步的记录会丢失。'))return;try{store.clear();bank=null;releaseImages();$('token').value='';$('repo').value='';$('connection-status').textContent='已清除本机数据。';$('setup-status').textContent='请先连接私有题库。';}catch(e){showError('connection-status',e)}});
$('start').addEventListener('click',async()=>{ $('start').disabled=true; try {bank=store.getQuestions()||bank;if(!bank?.questions?.length){$('setup-status').textContent='请先在连接与设置中配置私有题库。';return;} if(navigator.onLine){$('setup-status').textContent='正在同步最新进度…';try{await client.sync()}catch(e){$('setup-status').textContent=`同步未完成，先使用本机记录：${e.message}`;}} set=chooseQuestions(bank.questions,store.getEvents(),{subject:$('subject').value,type:$('type').value,count:$('count').value,mode:$('mode').value});if(!set.length){$('setup-status').textContent='没有符合条件的题，请调整筛选。';return;}index=0;screen('practice');renderQuestion();}catch(e){showError('setup-status',e)}finally{$('start').disabled=false}});
$('reveal').addEventListener('click',showAnswer);
$('original-question').addEventListener('click',()=>{ $('original-question').hidden=true; $('question-warning').textContent='显示原题所在页，可能包含相邻题；点击图片放大，左右滑动查看。'; images($('question-images'),current().originalImages,generation); });
$('original-answer').addEventListener('click',()=>{ $('original-answer').hidden=true; images($('answer-images'),current().originalAnswerImages,generation); });
for(const b of document.querySelectorAll('[data-rating]'))b.addEventListener('click',()=>record(b.dataset.rating));
$('end').addEventListener('click',()=>{generation++;releaseImages();screen('setup')}); $('again').addEventListener('click',()=>screen('setup'));
try {bank=store.getQuestions(); if(bank?.questions?.length) $('setup-status').textContent=`已载入 ${bank.questions.length} 题。`; else $('setup-status').textContent='请先在连接与设置中配置私有题库。';} catch(e) {showError('setup-status',e)}
window.addEventListener('online',()=>client.sync().catch(()=>{}));

if (preview) { $('settings-open').hidden=true; $('sync-status').textContent='本机预览：记录仅保存在当前预览标签页，不会同步。'; client.loadQuestions().then(q=>{bank=q;$('setup-status').textContent=`本机预览已载入 ${q.questions.length} 题。`;}).catch(e=>showError('setup-status',e)); }
