/* T6.2 UI phase A: presentation only. No anatomical coordinates or teaching text. */
(function(){
'use strict';
const palette=Object.freeze({idle:'#22C3AB',slowPathway:'#22C3AB',accessory:'#22C3AB',
  wavefront:'#FFFFFF',justFired:'#6BF2DB',muscleWave:'#FFC83D',muscleAfter:'#D9A441'});
function callouts({stage,viewer,layer,candidates,selection,mode,view,relevant,status}){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('callout-leaders');svg.setAttribute('aria-hidden','true');stage.appendChild(svg);
  const rails=['left','right'].map(side=>{const el=document.createElement('div');el.className='callout-rail '+side;
    el.setAttribute('role','group');el.setAttribute('aria-label',side+' structure callouts');layer.appendChild(el);return el});
  const paths=new Map();let layoutKey='',shown=[];
  const set=(el,name,value)=>{if(el.getAttribute(name)!==value)el.setAttribute(name,value)};
  function leaders(){
    const sr=stage.getBoundingClientRect(),vr=viewer.getBoundingClientRect();
    set(svg,'viewBox',`0 0 ${sr.width} ${sr.height}`);
    const active=new Set();
    for(const entry of shown){const box=entry.el.getBoundingClientRect(),rail=entry.el.parentElement.getBoundingClientRect();
      if(box.bottom<=rail.top||box.top>=rail.bottom)continue;
      let path=paths.get(entry.el);if(!path){path=document.createElementNS(ns,'path');svg.appendChild(path);paths.set(entry.el,path)}
      active.add(path);const phone=innerWidth<=900,left=entry.el.parentElement===rails[0];
      const x=entry.point.x-sr.left,y=entry.point.y-sr.top;
      const ex=phone?box.left-sr.left+box.width/2:left?box.right-sr.left:box.left-sr.left;
      const ey=phone?box.top-sr.top:box.top-sr.top+box.height/2;
      const elbow=left?vr.left-sr.left-8:vr.right-sr.left+8;
      set(path,'d',phone?`M${x.toFixed(1)},${y.toFixed(1)} L${ex.toFixed(1)},${(vr.bottom-sr.top+8).toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`:
        `M${x.toFixed(1)},${y.toFixed(1)} L${elbow.toFixed(1)},${y.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`);
      set(path,'class',entry.id===selection()?'selected':'');set(path,'display','');
    }
    for(const path of paths.values())if(!active.has(path))set(path,'display','none');
  }
  rails.forEach(rail=>rail.addEventListener('scroll',leaders,{passive:true}));
  function update(){
    const entries=candidates(),selected=selection(),labelMode=mode(),phone=innerWidth<=900,ids=relevant[view()]||[];
    const allowed=new Set(ids),unique=new Map();
    for(const entry of entries)if(entry.visible&&(entry.id===selected||entry.allowed&&
      (labelMode==='all'||labelMode==='relevant'&&allowed.has(entry.id)))){
      if(!unique.has(entry.id)||entry.id===selected)unique.set(entry.id,entry);
    }
    let eligible=[...unique.values()].sort((a,b)=>a.rest.y-b.rest.y||a.id.localeCompare(b.id));
    if(phone)eligible=eligible.filter(e=>e.id===selected).slice(0,1).concat(selected?[]:eligible.slice(0,1));
    const selectedEntry=entries.find(e=>e.id===selected&&e.visible);
    if(labelMode==='explore')eligible=selectedEntry?[selectedEntry]:[];
    if(phone&&eligible.length>1)eligible=eligible.slice(0,1);
    const vr=viewer.getBoundingClientRect(),key=[labelMode,view(),phone,selected,vr.width,vr.height,
      eligible.map(e=>e.id+':'+e.text+':'+(e.rest.x<vr.left+vr.width/2?'L':'R')).join('|')].join(';');
    if(key!==layoutKey){
      layoutKey=key;
      const visible=new Set(eligible.map(e=>e.el));
      for(const entry of entries)if(entry.el.hidden===visible.has(entry.el))entry.el.hidden=!visible.has(entry.el);
      const columns=[[],[]];
      for(const entry of eligible){let side=phone||entry.rest.x<vr.left+vr.width/2?0:1;
        if(!phone&&columns[side].length>columns[1-side].length+1)side=1-side;
        columns[side].push(entry);const rail=rails[side];rail.appendChild(entry.el);
        if(entry.el.textContent!==entry.text)entry.el.textContent=entry.text;
        entry.el.classList.toggle('sel',entry.id===selected);
        entry.el.style.removeProperty('transform');
      }
      const sizes=new Map(eligible.map(e=>[e.el,e.el.offsetHeight]));
      columns.forEach((column,i)=>{const total=column.reduce((n,e)=>n+sizes.get(e.el),0)+Math.max(0,column.length-1)*8;
        const centre=column.length?column.reduce((n,e)=>n+e.rest.y-vr.top,0)/column.length:0;
        rails[i].style.paddingTop=(phone?4:Math.max(12,Math.min(vr.height-total-12,centre-total/2)))+'px';
      });
      if(labelMode==='explore')rails.forEach(r=>r.scrollTop=0);
      status.textContent=labelMode==='relevant'&&!ids.length?'No labels configured for this view. Tap a structure to explore.':labelMode==='explore'&&!eligible.length?'Tap a structure to show its label and card.':'';
      status.hidden=!status.textContent;
    }
    shown=eligible;leaders();
  }
  return {update,invalidate(){layoutKey=''},visible(){return shown.map(e=>{const r=e.el.getBoundingClientRect();return{id:e.id,text:e.el.textContent,layer:e.layer,x:r.left+r.width/2,y:r.top+r.height/2}})},
    boxes(){return shown.map(e=>({id:e.id,box:e.el.getBoundingClientRect().toJSON(),anchor:e.point}))}};
}
function focusMaterial(mat){const prev=mat.onBeforeCompile,key=mat.customProgramCacheKey();
  mat.onBeforeCompile=s=>{prev(s);s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aFocus;varying float vFocus;')
    .replace('#include <begin_vertex>','#include <begin_vertex>\nvFocus=aFocus;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying float vFocus;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),.28*step(.5,vFocus));');};
  mat.customProgramCacheKey=()=>key+'-focus';
}
window.EXPLORE_UI={palette,callouts,focusMaterial};
})();
