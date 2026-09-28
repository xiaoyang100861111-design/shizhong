'use strict';

// Local, lazy-loaded geographic data. No API key or third-party runtime request.
(() => {
  const MY = {'吉隆坡':76497,'八打灵再也':76543,'槟城':76447,'新山':76455,'马六甲':76520,'怡保':76450};
  const popular = ['MY','SG','CN','TH','ID','JP','KR','AU','GB','US'];
  const continents = {'全部':'','亚洲':'Asia','欧洲':'Europe','美洲':'Americas','非洲':'Africa','大洋洲':'Oceania','其他':'Polar'};
  const pending = new Map();
  let picker = null, serial = 0, debounce;
  const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const title = row => row[2] || row[1];
  const meta = () => window.SHIZHONG_REGIONS_META;
  const country = code => meta()?.countries.find(c => c.code === code);
  const chunk = code => window.SHIZHONG_REGION_CHUNKS?.[code];
  const geoKey = loc => [loc.countryCode,loc.cityId || ('state:'+loc.stateId),loc.custom ? loc.cityName : ''].join('|');
  function serviceLocation(city = '吉隆坡') {
    return {countryCode:'MY',countryName:'马来西亚',cityId:MY[city] || '',cityName:city,stateId:'',stateName:'',custom:!MY[city]};
  }
  function normalize(loc) {
    if (!loc || typeof loc !== 'object' || !/^[A-Z]{2}$/.test(loc.countryCode || '')) return serviceLocation(state.city);
    return {countryCode:loc.countryCode,countryName:String(loc.countryName || loc.countryCode),cityId:loc.cityId || '',cityName:String(loc.cityName || ''),stateId:loc.stateId || '',stateName:String(loc.stateName || ''),lat:loc.lat ?? null,lon:loc.lon ?? null,custom:!!loc.custom};
  }
  function fromCity(code,row) {
    const s = chunk(code)?.states.find(s => String(s.id) === String(row[3]));
    return normalize({countryCode:code,countryName:country(code)?.name,cityId:row[0],cityName:code==='MY'&&Number(row[0])===76447?'槟城':title(row),stateId:row[3],stateName:s?.name || '',lat:row[4],lon:row[5]});
  }
  function placeText(loc) { return [...new Set([loc.cityName,loc.stateName,loc.countryName].filter(Boolean))].join(' · '); }
  function applyLocation(loc) { state.location=normalize(loc);state.city=state.location.cityName || state.location.stateName || state.location.countryName; }
  initialState.location=serviceLocation('吉隆坡');initialState.recentLocations=[];
  const previousCity=state.city;
  applyLocation(state.location || serviceLocation(state.city));
  state.recentLocations=Array.isArray(state.recentLocations)?state.recentLocations.filter(x=>x&&/^[A-Z]{2}$/.test(x.countryCode)).slice(0,8).map(normalize):[];

  function load(file,read) {
    if(read())return Promise.resolve(read());
    if(pending.has(file))return pending.get(file);
    const task=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);script.remove();pending.delete(file);error?reject(error):resolve(read());};
      const timer=setTimeout(()=>finish(new Error('地区数据加载超时，请重试')),18000);
      script.src=resourceURL('data/regions/'+file+'.js');script.async=true;
      script.onload=()=>finish(read()?null:new Error('地区文件不完整，请重新上传部署包'));
      script.onerror=()=>finish(new Error('地区数据暂时无法加载，请检查网络或部署文件'));
      document.head.append(script);
    });pending.set(file,task);return task;
  }
  const loadMeta=()=>load('meta',meta);
  const loadCountry=code=>/^[A-Z]{2}$/.test(code)?load(code,()=>chunk(code)):Promise.reject(new Error('请选择有效国家／地区'));
  function alive(p,t) { return picker===p && p.request===t && !!document.querySelector('.region-sheet'); }
  function loading() { return `<div class="region-loading" role="status">${icon('globe')}<strong>正在整理地区…</strong><p>地名按需加载，稍等片刻</p></div>`; }
  function resultHTML(html) { const node=document.querySelector('.region-results');if(node){node.innerHTML=html;node.scrollTop=0;} }
  function errorHTML(error) { return `<div class="region-empty" role="alert">${icon('globe')}<strong>暂时没有加载成功</strong><p>${esc(error.message)}</p>${act('region-retry','','重新加载','region-chip')}</div>`; }
  const section = text => `<h3 class="region-section-title">${esc(text)}</h3>`;
  function flagHTML(code,compact=false) {
    const c=country(code);
    if(!c)return '';
    return `<span class="region-flag${compact?' region-flag-compact':''}" aria-hidden="true"><img src="${asset('flags/'+c.code.toLowerCase()+'.png')}" alt="" width="80" height="60" loading="lazy" decoding="async"></span>`;
  }
  function rowHTML(action,id,primary,secondary,code,aside,selected=false) {
    return act(action,id,`${flagHTML(code)}<span class="region-row-main"><strong>${esc(primary)}</strong><small>${esc(secondary)}</small></span><span class="region-row-meta">${esc(aside||'')}</span><span class="region-selected">${icon(selected?'check':'chevron')}</span>`,action==='region-country'?'region-country-row':'region-city-row');
  }
  function countryRow(c) { return rowHTML('region-country',c.code,c.name,c.en,c.code,c.cityCount.toLocaleString()+' 地名'); }
  function cityRow(code,r,global=false) {
    const s=chunk(code)?.states.find(s=>String(s.id)===String(r[3]));
    const loc=code+'|'+r[0];
    const p=picker;const selected=p&&String(p.selected.cityId)===String(r[0])&&p.selected.countryCode===code;
    return rowHTML('region-city',loc,title(r),r[1],code,global?country(code)?.name:(s?.name||''),selected);
  }
  function searchCityRow(r) {
    return rowHTML('region-city',r[0]+'|'+r[1],r[3]||r[2],[r[2],r[5]].filter(Boolean).join(' · '),r[0],country(r[0])?.name);
  }
  function adminRow(r) { return rowHTML('region-admin',r[0]+'|'+r[1],r[2],r[3],r[0],country(r[0])?.name+' · 州省'); }
  function skeleton() {
    const p=picker,c=country(p.code);
    const recent=(state.recentLocations||[]).slice(0,4);
    document.querySelector('.region-sheet .sheet-body').innerHTML=`<div class="region-picker">
      <div class="region-search">${icon('search')}<input id="region-query" type="search" autocomplete="off" enterkeyhint="search" aria-label="搜索国家、城市或州省" placeholder="${p.code?'搜索此地区城市、州省':'搜索国家、城市或州省'}" value="${esc(p.query)}">${act('region-clear','',icon('close'),'','aria-label="清空地区搜索"')}</div>
      ${p.code?`<div class="region-country-heading">${act('region-back','','‹ 全球地区')}<strong>${flagHTML(p.code,true)}<span>${esc(c?.name || p.code)}</span></strong><small>${(c?.cityCount||0).toLocaleString()} 个地名</small></div><div class="region-state-filter"><label for="region-state">州 / 省</label><select id="region-state" aria-label="按州省筛选"><option value="">全部州省</option>${(chunk(p.code)?.states||[]).map(s=>`<option value="${esc(s.id)}" ${String(s.id)===p.stateId?'selected':''}>${esc(s.name)} · ${esc(s.en)}</option>`).join('')}</select></div>`:
      `<div class="region-current"><span class="region-label">当前选择</span><strong>${esc(p.selected.cityName||p.selected.stateName||p.selected.countryName)}</strong><small>${flagHTML(p.selected.countryCode,true)}${esc(p.selected.countryName)}</small></div>
      ${recent.length?`<div class="region-recent"><h3>最近选择</h3><div>${recent.map((r,i)=>act('region-recent',i,esc(r.cityName||r.stateName||r.countryName),'region-chip',`title="${esc(placeText(r))}"`)).join('')}</div></div>`:''}
      <div class="region-continent-filters" aria-label="按大洲浏览">${Object.entries(continents).map(([label,value])=>act('region-continent',value,label,p.continent===value?'active':'',`aria-pressed="${p.continent===value}"`)).join('')}</div>`}
      <div class="region-results" tabindex="0" aria-label="地区结果">${loading()}</div>
      ${act('region-custom','','找不到城市？补充地区','region-custom')}
      <p class="region-source-note">地名数据：<a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noopener">CSC · ODbL 1.0</a> · ${act('region-info','','覆盖范围','region-source-button')}</p>
    </div>`;
  }
  function showRows(items,draw,prefix='',suffix='') {
    const p=picker;
    resultHTML(prefix+items.slice(0,p.limit).map(draw).join('')+(items.length>p.limit?act('region-more','','查看更多 · '+p.limit+' / '+items.length,'region-load-more'):'')+suffix);
  }
  async function refresh() {
    const p=picker;if(!p)return;const t=++p.request;
    try {
      await loadMeta();if(!alive(p,t))return;
      if(p.code){
        await loadCountry(p.code);if(!alive(p,t))return;
        const d=chunk(p.code), q=fold(p.query);
        const terms=q.split(' ').filter(Boolean);
        // Some sources have nested administrative divisions (for example the UK).
        const allowed=new Set(p.stateId?[p.stateId]:[]);
        if(p.stateId){let changed=true;while(changed){changed=false;for(const s of d.states)if(s.parentId!=null&&allowed.has(String(s.parentId))&&!allowed.has(String(s.id))){allowed.add(String(s.id));changed=true;}}}
        const states=d.states.filter(s=>!p.stateId||allowed.has(String(s.id)));
        let rows=d.cities.filter(r=>(!p.stateId||allowed.has(String(r[3]))));
        if(q)rows=rows.filter(r=>{const s=d.states.find(s=>String(s.id)===String(r[3]));const text=fold([r[1],r[2],...(r[6]||[]),s?.name,s?.en].join(' '));return terms.every(v=>text.includes(v));}).sort((a,b)=>searchRank(a[1],a[2],q)-searchRank(b[1],b[2],q));
        if(!q&&!p.stateId){const hot=new Map((meta().hot||[]).filter(h=>h.countryCode===p.code).map((h,i)=>[String(h.cityId),i]));rows.sort((a,b)=>(hot.get(String(a[0]))??999)-(hot.get(String(b[0]))??999));}
        const admins=q?states.filter(s=>terms.every(v=>fold([s.name,s.en,...(s.aliases||[])].join(' ')).includes(v))):[];
        let prefix=admins.length?section('州 / 省')+admins.map(s=>adminRow([p.code,s.id,s.name,s.en])).join(''):'';
        if(p.stateId)prefix+=act('region-use-admin',p.stateId,'使用 '+esc(d.states.find(s=>String(s.id)===p.stateId)?.name||'当前州省'),'region-load-more');
        prefix+=section('城市 / 城镇 · '+rows.length.toLocaleString()+' 个结果');
        const footer=!rows.length?`<div class="region-empty"><strong>暂未收录符合条件的城市</strong><p>可修改关键词，选择州省，或补充你的地区。</p>${act('region-country-only',p.code,'仅选择 '+esc(country(p.code).name),'region-chip')}</div>`:'';
        showRows(rows,r=>cityRow(p.code,r),prefix,footer);return;
      }
      const q=fold(p.query);
      if(!q){
        const all=meta().countries.filter(c=>!p.continent||c.region===p.continent||(p.continent==='Polar'&&!['Asia','Europe','Americas','Africa','Oceania'].includes(c.region))).sort((a,b)=>a.en.localeCompare(b.en));
        const hot=!p.continent?popular.map(country).filter(Boolean):[];
        showRows(all,countryRow,(hot.length?section('常用国家／地区')+hot.map(countryRow).join(''):'')+section('全部国家／地区 · '+all.length));return;
      }
      resultHTML(loading());
      await Promise.all([load('search-meta',()=>window.SHIZHONG_REGION_SEARCH_META),load('admins',()=>window.SHIZHONG_REGION_ADMINS)]);
      if(!alive(p,t))return;
      const first=Array.from(q)[0],firstWord=q.split(' ')[0];
      const shortLatin=/^[a-z]$/.test(firstWord);
      const shard=/[a-z]/.test(first)?firstWord.slice(0,2):/\p{N}/u.test(first)?'d0':'u'+(first.codePointAt(0)%32);
      if(!shortLatin&&window.SHIZHONG_REGION_SEARCH_META.shards[shard])await load('search/'+shard,()=>window.SHIZHONG_REGION_SEARCH?.[shard]);
      if(!alive(p,t))return;
      const terms=q.split(' ');const inContinent=code=>!p.continent||country(code)?.region===p.continent||(p.continent==='Polar'&&!['Asia','Europe','Americas','Africa','Oceania'].includes(country(code)?.region));
      const countries=meta().countries.filter(c=>inContinent(c.code)&&terms.every(v=>fold([c.name,c.en,c.native,...(c.searchAliases||[])].join(' ')).includes(v)));
      const admins=window.SHIZHONG_REGION_ADMINS.filter(r=>inContinent(r[0])&&terms.every(v=>fold([r[2],r[3],r[4]].join(' ')).includes(v)));
      const matches=(shortLatin?[]:window.SHIZHONG_REGION_SEARCH?.[shard]||[]).filter(r=>inContinent(r[0])&&terms.every(v=>r[6].includes(v)));
      matches.sort((a,b)=>searchRank(a[2],a[3],q)-searchRank(b[2],b[3],q));
      const prefix=(countries.length?section('国家／地区')+countries.map(countryRow).join(''):'')+(admins.length?section('州 / 省')+admins.slice(0,30).map(adminRow).join(''):'')+section('城市 / 城镇 · '+matches.length.toLocaleString()+' 个结果');
      showRows(matches,searchCityRow,prefix,!matches.length?`<div class="region-empty"><strong>${shortLatin?'再输入一个字母，搜索全球城市':countries.length||admins.length?'选择上方地区继续浏览':'没有找到匹配的城市'}</strong><p>试试中文、英文或当地名称。全球搜索从地名开头匹配；进入国家后可搜索名称中的任意片段。</p></div>`:'');
    } catch(e) {if(alive(p,t))resultHTML(errorHTML(e));}
  }
  function searchRank(en,local,q){const names=[fold(en),fold(local)];return names.some(n=>n===q)?0:names.some(n=>n.startsWith(q))?1:names.some(n=>n.includes(q))?2:3;}
  async function open(field=null) {
    if(picker)return;
    if(typeof demand==='function')demand([],()=>{});
    let parent=null;
    if(field){const root=document.getElementById('overlay-root');const nodes=document.createDocumentFragment();while(root.firstChild)nodes.append(root.firstChild);parent={nodes,overlay:currentOverlay,field,focus:document.activeElement};}
    const selected=field?readForm(field):normalize(state.location);
    const p={id:++serial,request:0,code:'',stateId:'',continent:'',query:'',limit:40,selected,parent};picker=p;
    showSheet('选择国家与城市',`<div class="region-picker"><div class="region-results">${loading()}</div></div>`);
    document.querySelector('#overlay-root .sheet').classList.add('region-sheet');
    if(parent)currentOverlay.returnTo=()=>restore(parent);
    try{await loadMeta();if(picker!==p)return;skeleton();await refresh();}catch(e){if(picker===p)resultHTML(errorHTML(e));}
  }
  function restore(parent) {
    document.getElementById('overlay-root').replaceChildren(parent.nodes);currentOverlay=parent.overlay;document.body.style.overflow='hidden';
    parent.field.querySelector('[data-action="region-field"]')?.focus({preventScroll:true});
  }
  async function browse(code,stateId='') {
    const p=picker;if(!p||!country(code))return;
    p.code=code;p.stateId=String(stateId||'');p.query='';p.limit=40;skeleton();const t=++p.request;
    try{await loadCountry(code);if(!alive(p,t))return;skeleton();refresh();}catch(e){if(alive(p,t))resultHTML(errorHTML(e));}
  }
  function confirm(loc) {
    const p=picker;if(!p)return;p.candidate=normalize(loc);p.request++;
    const l=p.candidate;
    document.querySelector('.region-sheet .sheet-body').innerHTML=`<div class="region-picker"><div class="region-country-heading">${act('region-resume','','‹ 返回地区列表')}</div><div class="region-results"><div class="region-confirm-summary">${flagHTML(l.countryCode)}<h3>${esc(l.cityName||l.stateName||l.countryName)}</h3><p>${esc(placeText(l))}</p><small>${l.custom?'你补充的地区，可随时修改':l.cityId?'所选城市 / 城镇':l.stateId?'所选州 / 省':'所选国家／地区'}</small></div><p class="region-source-note">${p.parent?'确认后将填入当前表单，其余内容会保留。':l.countryCode==='MY'?'确认后用于首页、附近的人及需求表单。':'确认后用于你的地区与表单。当前服务与人物样例主要来自马来西亚。'}</p></div><div class="region-confirm-action">${act('region-confirm','','确认选择','primary-button')}</div></div>`;
  }
  function commit() {
    const p=picker,loc=p?.candidate;if(!loc)return;
    const old={location:state.location,city:state.city,recent:state.recentLocations};
    state.recentLocations=[loc,...state.recentLocations.filter(r=>geoKey(r)!==geoKey(loc))].slice(0,8);
    if(!p.parent)applyLocation(loc);
    if(!save()){state.location=old.location;state.city=old.city;state.recentLocations=old.recent;return;}
    if(p.parent){const el=p.parent.field;el.querySelector('[name="city"]').value=loc.cityName||loc.stateName||loc.countryName;el.querySelector('[name="locationData"]').value=JSON.stringify(loc);el.querySelector('.region-field-label').textContent=placeText(loc);}
    closeOverlay();if(!p.parent)render();toast('已选择 '+(loc.cityName||loc.stateName||loc.countryName));
  }
  function custom() {
    const p=picker;p.request++;
    document.querySelector('.region-sheet .sheet-body').innerHTML=`<div class="region-picker"><div class="region-country-heading">${act('region-resume','','‹ 返回地区列表')}</div><div class="region-results region-custom-fields"><h3>补充你的地区</h3><p class="form-note">资料库可能尚未收录小城镇。补充信息将保存在本机，供你的资料和需求使用。</p><label class="form-group"><span class="form-label">国家／地区</span><select class="field" id="region-custom-country">${meta().countries.map(c=>`<option value="${c.code}" ${c.code===(p.code||p.selected.countryCode)?'selected':''}>${esc(c.name)} · ${esc(c.en)}</option>`).join('')}</select></label><label class="form-group"><span class="form-label">城市 / 城镇 *</span><input id="region-custom-city" class="field" maxlength="80" required placeholder="输入实际城市或城镇名称" value="${esc(p.query)}"></label><label class="form-group"><span class="form-label">州 / 省（选填）</span><input id="region-custom-state" class="field" maxlength="80" placeholder="例如：雪兰莪"></label></div><div class="region-confirm-action">${act('region-custom-next','','确认补充信息','primary-button')}</div></div>`;
  }
  function fieldHTML(label,name,selected) {
    let loc=selected&&typeof selected==='object'?normalize(selected):selected===state.city||!selected?normalize(state.location):serviceLocation(selected);
    return `<div class="form-group region-form-field"><span class="form-label">${esc(label)}</span><input type="hidden" name="${esc(name)}" value="${esc(loc.cityName||loc.stateName||loc.countryName)}"><input type="hidden" name="locationData" value="${esc(JSON.stringify(loc))}">${act('region-field','',`${icon('pin')}<span class="region-field-label">${esc(placeText(loc))}</span>${icon('chevron')}`,'field region-field-button','aria-label="选择国家与城市"')}</div>`;
  }
  function readForm(form) {
    const input=form.querySelector('[name="locationData"]');
    if(input){try{return normalize(JSON.parse(input.value));}catch(_){}}
    const city=form.querySelector('[name="city"]')?.value;
    return city&&city!==state.city?serviceLocation(city):normalize(state.location);
  }
  const originalMenu=menuAction;
  menuAction=function(action,id,button){
    if(action==='city'){open();return true;}
    if(action==='region-field'){open(button.closest('.region-form-field'));return true;}
    if(!action.startsWith('region-'))return originalMenu(action,id,button);
    const p=picker;if(!p)return true;
    switch(action){
      case 'region-country':browse(id);break;
      case 'region-admin':{const [code,sid]=id.split('|');browse(code,sid);break;}
      case 'region-back':p.request++;p.code='';p.stateId='';p.query='';p.limit=40;skeleton();refresh();break;
      case 'region-clear':p.query='';p.limit=40;skeleton();refresh();document.getElementById('region-query')?.focus();break;
      case 'region-continent':p.continent=id;p.limit=40;skeleton();refresh();break;
      case 'region-more':{const scroll=document.querySelector('.region-results').scrollTop;p.limit+=60;refresh().then(()=>{if(picker===p){const results=document.querySelector('.region-results');if(results)results.scrollTop=scroll;}});break;}
      case 'region-retry':if(!meta()){const parent=p.parent;picker=null;if(parent)restore(parent);open(parent?.field||null);}else if(p.code)browse(p.code,p.stateId);else refresh();break;
      case 'region-recent':confirm(state.recentLocations[Number(id)]);break;
      case 'region-city':{const [code,cid]=id.split('|'),t=++p.request;resultHTML(loading());loadCountry(code).then(()=>{if(!alive(p,t))return;const r=chunk(code).cities.find(r=>String(r[0])===cid);if(r)confirm(fromCity(code,r));else throw new Error('未找到这条地区记录');}).catch(e=>{if(alive(p,t))resultHTML(errorHTML(e));});break;}
      case 'region-country-only':confirm({countryCode:id,countryName:country(id)?.name});break;
      case 'region-use-admin':{const s=chunk(p.code).states.find(s=>String(s.id)===id);if(s)confirm({countryCode:p.code,countryName:country(p.code).name,stateId:s.id,stateName:s.name});break;}
      case 'region-confirm':commit();break;
      case 'region-resume':skeleton();refresh();break;
      case 'region-custom':custom();break;
      case 'region-custom-next':{const input=document.getElementById('region-custom-city');input.value=input.value.trim();if(!input.reportValidity())break;const code=document.getElementById('region-custom-country').value,s=document.getElementById('region-custom-state').value.trim();confirm({countryCode:code,countryName:country(code).name,cityId:'custom:'+code+':'+fold(input.value+' '+s),cityName:input.value,stateName:s,custom:true});break;}
      case 'region-info':p.request++;resultHTML(`<div class="region-custom-fields"><h3>关于地名覆盖</h3><p>采用 CSC 2026 年 9 月 26 日数据快照，收录 250 个国家／地区、5,308 个州省、153,336 条城市、城镇及区记录。</p><p>保留完整来源记录，但公开地名库仍可能有遗漏或译名差异；部分地区没有城市记录，可选择州省或手动补充。国家与地区合并展示，沿用来源编码。</p><p>支持已收录的中文、英文及本地名称；不保证所有拼音或简称均可匹配。</p><p>数据按需读取本地文件，不会提交搜索词。ODbL 1.0 数据来源与许可随部署包提供。</p>${act('region-resume','','返回选择','region-load-more')}</div>`);break;
    }return true;
  };
  const originalClose=closeOverlay;
  closeOverlay=function(){if(picker){picker.request++;picker=null;clearTimeout(debounce);}return originalClose();};
  document.addEventListener('input',e=>{if(e.target.id!=='region-query'||!picker||e.isComposing)return;picker.query=e.target.value;picker.limit=40;picker.request++;clearTimeout(debounce);debounce=setTimeout(refresh,160);});
  document.addEventListener('compositionstart',e=>{if(e.target.id==='region-query'&&picker){picker.request++;clearTimeout(debounce);}});
  document.addEventListener('compositionend',e=>{if(e.target.id==='region-query'&&picker){picker.request++;picker.query=e.target.value;picker.limit=40;clearTimeout(debounce);debounce=setTimeout(refresh,160);}});
  document.addEventListener('change',e=>{if(e.target.id==='region-state'&&picker){picker.stateId=e.target.value;picker.limit=40;refresh();}});
  window.ShizhongRegions={field:fieldHTML,readForm,applyLocation,locationLabel:()=>state.location?.countryName||'马来西亚',serviceLocation,open,fold,containsPreservedNode:node=>!!picker?.parent?.nodes.contains(node)};
  if(previousCity!==state.city)render();
})();
