/* T6.2 UI phase A: presentation only. No anatomical coordinates or teaching text. */
(function(){
'use strict';
const labelColours=Object.freeze({anatomy:'#D4AD78',conduction:'#22C3AB',vessels:'#E98A7A',valves:'#E9DFBD'});
const palette=Object.freeze({idle:'#22C3AB',slowPathway:'#22C3AB',accessory:'#22C3AB',
  wavefront:'#FFFFFF',justFired:'#6BF2DB',muscleWave:'#FFC83D',muscleAfter:'#FFE9A8'});
/* Callouts sit INSIDE the viewer, in free space next to the heart (never over it), with a straight leader line.
   The heart's on-screen silhouette comes from projected mesh vertices (silhouette()), rasterised into a coarse grid;
   a summed-area table makes each "is this box free?" test O(1). Labels are placed in angular order around the
   heart's centre, each as close to its anchor as possible, so leader lines fan outwards and do not cross. */
function callouts({stage,viewer,layer,candidates,selection,mode,view,relevant,status,silhouette,list,pick}){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('callout-leaders');svg.setAttribute('aria-hidden','true');stage.appendChild(svg);
  const paths=new Map();let layoutKey='',shown=[],grid=null;
  const CELL=8,GAP=8;
  // HALO: clear gap between a label and the heart (so leader lines stay long and labels never crowd the model);
  // EDGE: labels keep away from the box edge too. Smaller on phones, where the box is narrow.
  const spacing=()=>innerWidth<=900?{HALO:28,EDGE:14}:{HALO:48,EDGE:30};
  const set=(el,name,value)=>{if(el.getAttribute(name)!==value)el.setAttribute(name,value)};
  function buildGrid(vr,anchors=[]){
    const W=Math.ceil(vr.width/CELL),H=Math.ceil(vr.height/CELL),occ=new Uint8Array(W*H),pts=silhouette();
    for(let i=0;i<pts.length;i+=2){const x=Math.floor((pts[i]-vr.left)/CELL),y=Math.floor((pts[i+1]-vr.top)/CELL);if(x>=0&&y>=0&&x<W&&y<H)occ[x+y*W]=1}
    // close small gaps between projected vertices, then keep a margin around the heart
    const dilate=(src,r)=>{const out=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!src[x+y*W])continue;
      for(let dy=-r;dy<=r;dy++){const yy=y+dy;if(yy<0||yy>=H)continue;for(let dx=-r;dx<=r;dx++){const xx=x+dx;if(xx>=0&&xx<W)out[xx+yy*W]=1}}}return out};
    const {HALO}=spacing(),heart=dilate(occ,1),blocked=dilate(heart,Math.ceil(HALO/CELL));
    // the heart's left/right edge on every row, for contour-following labels (rows above/below the heart use its full width)
    const rowL=new Float32Array(H).fill(NaN),rowR=new Float32Array(H).fill(NaN);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(heart[x+y*W]){if(isNaN(rowL[y]))rowL[y]=x;rowR[y]=x+1}

    // every visible structure's tap point stays uncovered, so a callout never steals a tap meant for the model
    for(const p of anchors){const x=Math.floor((p.x-vr.left)/CELL),y=Math.floor((p.y-vr.top)/CELL);
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<W&&yy<H)blocked[xx+yy*W]=1}}
    let cx=0,cy=0,n=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(heart[x+y*W]){cx+=x;cy+=y;n++}
    // controls drawn inside the viewer are obstacles too
    for(const el of viewer.querySelectorAll('.zoomctl,.hint')){if(!el.offsetParent)continue;const r=el.getBoundingClientRect();
      for(let y=Math.max(0,Math.floor((r.top-vr.top)/CELL));y<Math.min(H,Math.ceil((r.bottom-vr.top)/CELL));y++)
        for(let x=Math.max(0,Math.floor((r.left-vr.left)/CELL));x<Math.min(W,Math.ceil((r.right-vr.left)/CELL));x++)blocked[x+y*W]=1}
    const sat=new Int32Array((W+1)*(H+1));
    for(let y=0;y<H;y++){let row=0;for(let x=0;x<W;x++){row+=blocked[x+y*W];sat[(x+1)+(y+1)*(W+1)]=sat[(x+1)+y*(W+1)]+row}}
    let x0=W,x1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(heart[x+y*W]){if(x<x0)x0=x;if(x>x1)x1=x}
    const bbox=x1>=0?{left:vr.left+x0*CELL,right:vr.left+(x1+1)*CELL}:{left:vr.left+vr.width/2,right:vr.left+vr.width/2};
    return {W,H,heart,sat,bbox,rowL,rowR,centre:n?{x:vr.left+(cx/n+.5)*CELL,y:vr.top+(cy/n+.5)*CELL}:{x:vr.left+vr.width/2,y:vr.top+vr.height/2},vr};
  }
  const blockedIn=(g,l,t,w,h)=>{const x0=Math.max(0,Math.floor((l-g.vr.left)/CELL)),y0=Math.max(0,Math.floor((t-g.vr.top)/CELL)),
    x1=Math.min(g.W,Math.ceil((l+w-g.vr.left)/CELL)),y1=Math.min(g.H,Math.ceil((t+h-g.vr.top)/CELL)),S=g.sat,R=g.W+1;
    return x1<=x0||y1<=y0?0:S[x1+y1*R]-S[x0+y1*R]-S[x1+y0*R]+S[x0+y0*R]};
  const overHeartXY=(l,t,w,h)=>overHeart({left:l,top:t,right:l+w,bottom:t+h});
  function overHeart(box){if(!grid)return 0;const g=grid;let n=0;
    for(let y=Math.max(0,Math.floor((box.top-g.vr.top)/CELL));y<Math.min(g.H,Math.ceil((box.bottom-g.vr.top)/CELL));y++)
      for(let x=Math.max(0,Math.floor((box.left-g.vr.left)/CELL));x<Math.min(g.W,Math.ceil((box.right-g.vr.left)/CELL));x++)n+=g.heart[x+y*g.W];return n}
  const put=(e,l,t)=>{const lr=layer.getBoundingClientRect();e.el.style.left=(l-lr.left)+'px';e.el.style.top=(t-lr.top)+'px'};
  /* Many labels: two loose ranks, one each side, that follow the heart's outline at a fixed gap (HALO), so they are
     staggered like a textbook figure rather than a rigid column. Ordered top-to-bottom by anchor, then untangled so
     leader lines do not cross. Returns false when there is no room (narrow viewers). */
  function columns(items,vr){
    const g=grid,{HALO,EDGE}=spacing(),top=vr.top+34,bottom=vr.bottom-EDGE;
    const edgeAt=(i,t,h)=>{let v=i?-Infinity:Infinity;   // heart edge (px) over the rows the label covers, plus ~3 rows either side (sloped edges)
      for(let y=Math.max(0,Math.floor((t-g.vr.top)/CELL)-3);y<=Math.min(g.H-1,Math.ceil((t+h-g.vr.top)/CELL)+2);y++){
        const e=g.vr.left+(i?g.rowR[y]:g.rowL[y])*CELL;if(!isNaN(e))v=i?Math.max(v,e):Math.min(v,e)}
      return isFinite(v)?v:i?g.bbox.right:g.bbox.left};
    const side=[[],[]];for(const it of items)side[it.e.rest.x<g.centre.x?0:1].push(it);
    const room=[g.bbox.left-HALO-(vr.left+EDGE),vr.right-EDGE-(g.bbox.right+HALO)];
    const fits=i=>side[i].every(it=>it.w<=room[i])&&side[i].reduce((n,it)=>n+it.h+GAP,0)<=bottom-top;
    // balance: move the anchors nearest the centre line across if one side is much longer
    while(Math.abs(side[0].length-side[1].length)>3){const from=side[0].length>side[1].length?0:1;
      side[from].sort((a,b)=>Math.abs(a.e.rest.x-g.centre.x)-Math.abs(b.e.rest.x-g.centre.x));const it=side[from][0];
      if(it.w>room[1-from])break;side[from].shift();side[1-from].push(it)}
    for(const i of [0,1])if(side[i].length&&side[i].some(it=>it.w>room[i])){if(room[1-i]<Math.max(...side[i].map(it=>it.w)))return false;side[1-i].push(...side[i]);side[i]=[]}
    if(![0,1].every(fits))return false;
    const stack=col=>{const ys=col.map(it=>Math.min(bottom-it.h,Math.max(top,it.e.rest.y-it.h/2)));
      for(let k=1;k<ys.length;k++)ys[k]=Math.max(ys[k],ys[k-1]+col[k-1].h+GAP);                 // push down
      for(let k=ys.length-1;k>=0;k--){const limit=k===ys.length-1?bottom-col[k].h:ys[k+1]-GAP-col[k].h;ys[k]=Math.min(ys[k],limit)}   // pull up from the bottom
      for(let k=0;k<ys.length;k++)ys[k]=Math.max(ys[k],k?ys[k-1]+col[k-1].h+GAP:top);return ys};
    const o=(ax,ay,bx,by,cx,cy)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const crosses=(p,q)=>o(...p,q[0],q[1])*o(...p,q[2],q[3])<0&&o(...q,p[0],p[1])*o(...q,p[2],p[3])<0;
    let ok=true;
    side.forEach((col,i)=>{col.sort((a,b)=>a.e.rest.y-b.e.rest.y);
      // x follows the outline; every other label steps a little further out so neighbours do not line up
      const xFor=(it,t,k)=>{const step=k%2?18:0,e=edgeAt(i,t,it.h);
        return i?Math.min(vr.right-EDGE-it.w,e+HALO+step):Math.max(vr.left+EDGE,e-HALO-step-it.w)};
      const segs=ys=>col.map((it,k)=>{const l=xFor(it,ys[k],k),x=it.e.rest.x,y=it.e.rest.y;return [x,y,Math.min(l+it.w,Math.max(l,x)),Math.min(ys[k]+it.h,Math.max(ys[k],y))]});
      let ys=stack(col);
      // a leader line through another label's box (shrunk a little, so touching corners don't count)
      const through=(sg,l,t,w,h)=>{const r=[l+3,t+3,l+w-3,t+h-3],[x1,y1,x2,y2]=sg;
        if(x1>=r[0]&&x1<=r[2]&&y1>=r[1]&&y1<=r[3])return true;
        return [[r[0],r[1],r[2],r[1]],[r[2],r[1],r[2],r[3]],[r[0],r[3],r[2],r[3]],[r[0],r[1],r[0],r[3]]].some(e=>crosses(sg,e))};
      for(let pass=0;pass<60;pass++){const sg=segs(ys);let swapped=false;
        for(let a=0;a<col.length&&!swapped;a++)for(let b=0;b<col.length;b++){if(a===b)continue;
          if(b>a&&crosses(sg[a],sg[b])||through(sg[a],xFor(col[b],ys[b],b),ys[b],col[b].w,col[b].h)){[col[a],col[b]]=[col[b],col[a]];ys=stack(col);swapped=true;break}}
        if(!swapped)break}
      // nudge: a label still sitting in another label's leader line slides outward until the line is clear
      const xs=col.map((it,k)=>xFor(it,ys[k],k)),dir=i?1:-1;
      const seg=k=>{const it=col[k],x=it.e.rest.x,y=it.e.rest.y;return [x,y,Math.min(xs[k]+it.w,Math.max(xs[k],x)),Math.min(ys[k]+it.h,Math.max(ys[k],y))]};
      for(let pass=0;pass<4;pass++)for(let a=0;a<col.length;a++)for(let b=0;b<col.length;b++){if(a===b)continue;
        for(let n=0;n<14&&through(seg(a),xs[b],ys[b],col[b].w,col[b].h);n++){
          const nx=xs[b]+dir*12;if(nx<vr.left+EDGE||nx+col[b].w>vr.right-EDGE)break;xs[b]=nx}}
      col.forEach((it,k)=>{const l=xs[k];if(blockedIn(g,l,ys[k],it.w,it.h)>0&&overHeartXY(l,ys[k],it.w,it.h))ok=false;put(it.e,l,ys[k])});
    });return ok;
  }
  function place(eligible,vr,anchors){
    grid=buildGrid(vr,anchors);const C=grid.centre,placed=[];
    const items=eligible.map(e=>{const w=e.el.offsetWidth,h=e.el.offsetHeight,dx=e.rest.x-C.x,dy=e.rest.y-C.y;
      return {e,w,h,ang:Math.atan2(dy,dx),r0:Math.hypot(dx,dy)}}).sort((a,b)=>a.ang-b.ang);
    if(items.length>3&&columns(items,vr))return;
    const hits=(l,t,w,h)=>placed.some(p=>l<p.l+p.w+GAP&&p.l<l+w+GAP&&t<p.t+p.h+GAP&&p.t<t+h+GAP);
    const {EDGE}=spacing();
    for(const it of items){let best=null;
      for(let k=0;k<=24&&!(best&&k>2*Math.abs(best.k)+2);k++){const a=it.ang+(k%2?1:-1)*Math.ceil(k/2)*Math.PI/24,ux=Math.cos(a),uy=Math.sin(a);
        for(let r=Math.max(0,it.r0-20);r<2000;r+=CELL){
          // the side of the box nearest the heart sits on the ray, so the box hugs the free space
          const px=C.x+ux*r,py=C.y+uy*r,l=px-it.w/2+ux*it.w/2,t=py-it.h/2+uy*it.h/2;
          if(l<vr.left+EDGE&&ux<=0||l+it.w>vr.right-EDGE&&ux>=0||t<vr.top+EDGE&&uy<=0||t+it.h>vr.bottom-EDGE&&uy>=0)break;
          if(l<vr.left+EDGE||l+it.w>vr.right-EDGE||t<vr.top+EDGE||t+it.h>vr.bottom-EDGE)continue;
          if(blockedIn(grid,l,t,it.w,it.h)||hits(l,t,it.w,it.h))continue;
          const cost=Math.hypot(l+it.w/2-it.e.rest.x,t+it.h/2-it.e.rest.y)+Math.ceil(k/2)*14;
          if(!best||cost<best.cost)best={l,t,cost,k:Math.ceil(k/2)};break;}
      }
      if(!best){// no free spot: hug the viewer edge in the anchor's direction (rare: very crowded All)
        const ux=Math.cos(it.ang),uy=Math.sin(it.ang);best={l:Math.min(vr.right-EDGE-it.w,Math.max(vr.left+EDGE,C.x+ux*vr.width-it.w/2)),
          t:Math.min(vr.bottom-EDGE-it.h,Math.max(vr.top+EDGE,C.y+uy*vr.height-it.h/2))}}
      placed.push({l:best.l,t:best.t,w:it.w,h:it.h});put(it.e,best.l,best.t);
    }
  }
  function leaders(){
    const sr=stage.getBoundingClientRect();set(svg,'viewBox',`0 0 ${sr.width} ${sr.height}`);const active=new Set();
    for(const entry of shown){const box=entry.el.getBoundingClientRect();
      let path=paths.get(entry.el);if(!path){path=document.createElementNS(ns,'path');svg.appendChild(path);paths.set(entry.el,path)}
      active.add(path);const x=entry.point.x,y=entry.point.y;
      const ex=Math.min(box.right,Math.max(box.left,x)),ey=Math.min(box.bottom,Math.max(box.top,y));
      set(path,'d',`M${(x-sr.left).toFixed(1)},${(y-sr.top).toFixed(1)} L${(ex-sr.left).toFixed(1)},${(ey-sr.top).toFixed(1)}`);
      set(path,'class',entry.id===selection()?'selected':'');set(path,'display','');
    }
    for(const path of paths.values())if(!active.has(path))set(path,'display','none');
  }
  function syncList(entries,labelMode,phone,ids){
    if(!list)return;const show=phone&&labelMode!=='explore';list.hidden=!show;if(!show)return;
    const pool=entries.filter(e=>e.allowed&&e.visible!==undefined&&(labelMode==='all'?e.visible:ids.includes(e.id)));
    const seen=new Set(),items=pool.filter(e=>!seen.has(e.id)&&seen.add(e.id)).sort((a,b)=>a.text.localeCompare(b.text));
    const key=items.map(e=>e.id).join('|')+'#'+selection();if(list.dataset.key===key)return;list.dataset.key=key;
    list.replaceChildren(...items.map(e=>{const b=document.createElement('button');b.type='button';b.className='chip'+(e.id===selection()?' sel':'');
      b.textContent=e.text;b.dataset.id=e.id;b.style.borderColor=e.id===selection()?'#FFFFFF':labelColours[e.layer]||labelColours.anatomy;b.style.opacity=e.id===selection()?'1':e.fade?'.55':'1';b.onclick=()=>pick(e.el);return b}));
  }
  function update(){
    const entries=candidates(),selected=selection(),labelMode=mode(),phone=innerWidth<=900,ids=relevant[view()]||[];
    const allowed=new Set(ids),unique=new Map();
    for(const entry of entries)if(entry.visible&&(entry.id===selected||entry.allowed&&
      (labelMode==='all'||labelMode==='relevant'&&allowed.has(entry.id)))){
      if(!unique.has(entry.id)||entry.id===selected)unique.set(entry.id,entry);
    }
    let eligible=[...unique.values()];
    const selectedEntry=entries.find(e=>e.id===selected&&e.visible);
    // phones: one callout at a time (the selected one); All/Relevant become a tappable list under the viewer
    if(labelMode==='explore'||phone)eligible=selectedEntry?[selectedEntry]:[];
    syncList(entries,labelMode,phone,ids);
    const vr=viewer.getBoundingClientRect(),key=[labelMode,view(),phone,selected,vr.width,vr.height,vr.left,vr.top,silhouette.key?.()||'',
      eligible.map(e=>e.id+':'+e.text+':'+Math.round(e.rest.x/4)+','+Math.round(e.rest.y/4)).join('|')].join(';');
    if(key!==layoutKey){
      layoutKey=key;
      const visible=new Set(eligible.map(e=>e.el));
      for(const entry of [...entries,...shown])if(entry.el.hidden===visible.has(entry.el))entry.el.hidden=!visible.has(entry.el);
      for(const entry of eligible){if(entry.el.parentElement!==layer)layer.appendChild(entry.el);
        if(entry.el.textContent!==entry.text)entry.el.textContent=entry.text;
        entry.el.classList.add('callout');entry.el.classList.toggle('sel',entry.id===selected);entry.el.style.removeProperty('transform');}
      if(eligible.length)place(eligible,vr,entries.flatMap(e=>[e.visible&&e.point,e.tap].filter(Boolean)));
      status.textContent=labelMode==='relevant'&&!ids.length?'No labels configured for this view. Tap a structure to explore.':labelMode==='explore'&&!eligible.length?'Tap a structure to show its label and card.':'';
      status.hidden=!status.textContent;
    }
    for(const entry of eligible){entry.el.style.borderColor=entry.id===selected?'#FFFFFF':labelColours[entry.layer]||labelColours.anatomy;entry.el.style.opacity=entry.id===selected?'1':entry.fade?'.55':'1'}
    shown=eligible;leaders();
  }
  return {update,invalidate(){layoutKey=''},visible(){return shown.map(e=>{const r=e.el.getBoundingClientRect();return{id:e.id,text:e.el.textContent,layer:e.layer,x:r.left+r.width/2,y:r.top+r.height/2}})},
    boxes(){return shown.map(e=>{const box=e.el.getBoundingClientRect();const {HALO}=spacing(),m=HALO/2;return {id:e.id,box:box.toJSON(),anchor:e.point,overHeart:overHeart(box),nearHeart:overHeart({left:box.left-m,right:box.right+m,top:box.top-m,bottom:box.bottom+m})}})},
    listIds(){return list&&!list.hidden?[...list.children].map(b=>b.dataset.id):[]}};
}
function focusMaterial(mat){const prev=mat.onBeforeCompile,key=mat.customProgramCacheKey();
  mat.onBeforeCompile=s=>{prev(s);s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aFocus;varying float vFocus;')
    .replace('#include <begin_vertex>','#include <begin_vertex>\nvFocus=aFocus;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying float vFocus;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),.28*step(.5,vFocus));');};
  mat.customProgramCacheKey=()=>key+'-focus';
}
window.EXPLORE_UI={palette,labelColours,callouts,focusMaterial};
})();
