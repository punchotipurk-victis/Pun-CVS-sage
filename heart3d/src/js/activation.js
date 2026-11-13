/* T6.2(c): insulated tissue activation in heart-frame cm; immutable anatomy inputs.
   The same solver runs in a local worker, or yields on the main thread when workers are unavailable. */
(function(){
'use strict';
const NEVER=1e9;
async function solve(job){
  const started=performance.now(),{meshes,spec,landmarks,cap,seeds,mode}=job,N=1e9;
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const pv=Object.values(landmarks.pv_ostia?.points||{}),svc=[landmarks.svc_junction?.p,landmarks.sa_node?.p].filter(Boolean);
  const patterns=spec.regions.neverActivate.map(pattern=>new RegExp('^'+pattern.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$'));
  const excluded=name=>patterns.some(pattern=>pattern.test(name));
  function classify(name,wall,p){
    if(excluded(name))return 0;
    if(name==='pulmonary_veins')return pv.some(q=>dist(p,q)<=1)?1:0;
    if(name==='SVC')return svc.some(q=>dist(p,q)<=1)?1:0;
    if(spec.regions.atrialMuscle.labels.includes(name)||wall==='atria')return 1;
    if(spec.regions.ventricularMuscle.labels.includes(name)||wall==='LV'||wall==='RV')return wall==='RV'||name==='RV_free_wall'||name==='moderator_band'?3:2;
    return 0;
  }
  // Fixed-size binary min-heap with decrease-key; one entry per voxel.
  class Heap{
    constructor(n,t){this.h=new Int32Array(n);this.at=new Int32Array(n).fill(-1);this.n=0;this.t=t}
    put(id){let i=this.at[id];if(i<0)i=this.n++;
      while(i){const p=(i-1)>>1,q=this.h[p];if(this.t[q]<=this.t[id])break;this.h[i]=q;this.at[q]=i;i=p}
      this.h[i]=id;this.at[id]=i;
    }
    pop(){const id=this.h[0],last=this.h[--this.n];this.at[id]=-1;if(this.n){let i=0;
      while(i*2+1<this.n){let k=i*2+1;if(k+1<this.n&&this.t[this.h[k+1]]<this.t[this.h[k]])k++;
        if(this.t[last]<=this.t[this.h[k]])break;this.h[i]=this.h[k];this.at[this.h[i]]=i;i=k}
      this.h[i]=last;this.at[last]=i}return id;
    }
  }
  const inWorker=typeof document==='undefined';let nextYield=performance.now()+12;
  async function cooperate(){
    // A dedicated worker already leaves rendering free. Timer yields there can
    // be throttled to seconds when its owning iframe is hidden/offscreen.
    if(!inWorker&&performance.now()>nextYield){await new Promise(r=>typeof requestIdleCallback==='function'?requestIdleCallback(r,{timeout:50}):setTimeout(r,0));nextYield=performance.now()+12}
  }
  for(const m of meshes){
    const n=m.positions.length/3;m.classes=new Uint8Array(n);m.strength=new Float32Array(n);m.tA=new Float32Array(n).fill(N);m.tV=new Float32Array(n).fill(N);
    for(let i=0;i<n;i++){const p=Array.from(m.positions.subarray(i*3,i*3+3));m.classes[i]=classify(m.names[m.labels[i]]||'',m.walls[m.wall[i]],p);m.strength[i]=m.classes[i]?1:0;if((i&1023)===0)await cooperate()}
  }
  let classes,labels,tA,tV,nearest,voxelPosition;
  const diagnostics={solver:cap?'geodesic-26':'euclidean',seedsA:seeds.a.length,seedsV:seeds.v.length,unmapped:0,unreachable:0};
  if(cap){
    const [nx,ny,nz]=cap.n,xy=nx*ny,total=xy*nz,v=cap.v,lo=cap.lo;
    labels=cap.labels;classes=new Uint8Array(total);
    voxelPosition=id=>[lo[0]+(id%nx+.5)*v,lo[1]+(Math.floor(id/nx)%ny+.5)*v,lo[2]+(Math.floor(id/xy)+.5)*v];
    const wallFor=name=>name==='RV_free_wall'||name==='moderator_band'?'RV':spec.regions.ventricularMuscle.labels.includes(name)?'LV':spec.regions.atrialMuscle.labels.includes(name)?'atria':'';
    const byLabel=meshes[1].names.map(name=>({name,wall:wallFor(name),fixed:['pulmonary_veins','SVC'].includes(name)?-1:classify(name,wallFor(name),[0,0,0])}));
    for(let id=0;id<total;id++){const l=byLabel[labels[id]];if(l)classes[id]=l.fixed<0?classify(l.name,l.wall,voxelPosition(id)):l.fixed;if((id&32767)===0)await cooperate()}
    nearest=(p,side,max=.3)=>{
      const cx=Math.floor((p[0]-lo[0])/v),cy=Math.floor((p[1]-lo[1])/v),cz=Math.floor((p[2]-lo[2])/v),r=Math.ceil(max/v);let best=-1,dd=max*max+1e-9;
      for(let z=Math.max(0,cz-r);z<=Math.min(nz-1,cz+r);z++)for(let y=Math.max(0,cy-r);y<=Math.min(ny-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(nx-1,cx+r);x++){
        const id=x+nx*y+xy*z,c=classes[id];if(side===1?c!==1:c<2)continue;
        const d=(p[0]-lo[0]-(x+.5)*v)**2+(p[1]-lo[1]-(y+.5)*v)**2+(p[2]-lo[2]-(z+.5)*v)**2;
        if(d<dd){dd=d;best=id}
      }return best;
    };
    async function propagate(side,source){
      const t=new Float32Array(total).fill(N),heap=new Heap(total,t),velocity=spec.timing.muscleVelocity_mps[side===1?'atrial':'ventricular'];
      for(const s of source){const id=nearest(s.p,side);if(id>=0&&s.t<t[id]){t[id]=s.t;heap.put(id)}}
      const steps=[];for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy||dz)steps.push([dx,dy,dz,dx+nx*dy+xy*dz,Math.hypot(dx,dy,dz)*v*10/velocity]);
      let visits=0;
      while(heap.n){const id=heap.pop(),time=t[id],x=id%nx,y=Math.floor(id/nx)%ny,z=Math.floor(id/xy);
        for(const [dx,dy,dz,delta,cost] of steps){if(x+dx<0||x+dx>=nx||y+dy<0||y+dy>=ny||z+dz<0||z+dz>=nz)continue;
          const q=id+delta,c=classes[q];if(side===1?c!==1:c<2)continue;
          const value=time+cost;if(value<t[q]-.00001){t[q]=value;heap.put(q)}
        }if((++visits&2047)===0)await cooperate();
      }return t;
    }
    tA=await propagate(1,seeds.a);tV=await propagate(2,seeds.v);
    for(const m of meshes)for(let i=0;i<m.classes.length;i++){const c=m.classes[i];if(!c)continue;
      const id=nearest(m.positions.subarray(i*3,i*3+3),c===1?1:2);if(id<0){diagnostics.unmapped++;continue}
      const t=c===1?tA[id]:tV[id];(c===1?m.tA:m.tV)[i]=t;if(t>=N)diagnostics.unreachable++;if((i&511)===0)await cooperate();
    }
  }else{
    // Legacy fallback only when capVolume is absent. A/V are still separate;
    // LV/RV crossing carries the contract's 1.5x distance plus 22 ms penalty.
    for(const m of meshes)for(let i=0;i<m.classes.length;i++){
      const c=m.classes[i];if(!c)continue;const p=m.positions.subarray(i*3,i*3+3),source=c===1?seeds.a:seeds.v,velocity=spec.timing.muscleVelocity_mps[c===1?'atrial':'ventricular'];let best=N;
      for(const s of source){let cost=dist(p,s.p)*10/velocity;if(c>1&&s.chamber&&s.chamber!==c)cost=cost*1.5+22;best=Math.min(best,s.t+cost)}
      (c===1?m.tA:m.tV)[i]=best;if((i&1023)===0)await cooperate();
    }
  }
  // Display-only exception. Never change classes or introduce a cross-side time.
  const outer=meshes[0],inner=meshes[1],bins=new Map(),cell=.5,key=p=>p.map(x=>Math.floor(x/cell)).join(',');
  for(let i=0;i<inner.classes.length;i++){if(inner.classes[i]>1&&inner.tV[i]<N){const p=Array.from(inner.positions.subarray(i*3,i*3+3)),k=key(p);if(!bins.has(k))bins.set(k,[]);bins.get(k).push(i)}if((i&2047)===0)await cooperate()}
  for(let i=0;bins.size&&i<outer.classes.length;i++)if(!outer.classes[i]&&['LV','RV'].includes(outer.walls[outer.wall[i]])&&/^(epicardial_fat|LCA|RCA|cardiac_veins)$/.test(outer.names[outer.labels[i]])){
    const p=Array.from(outer.positions.subarray(i*3,i*3+3)),c=p.map(x=>Math.floor(x/cell));let best=-1,dd=Infinity;
    for(let r=0;r<=20;r++){for(let dz=-r;dz<=r;dz++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(r&&Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))!==r)continue;
      for(const q of bins.get([c[0]+dx,c[1]+dy,c[2]+dz].join(','))||[]){const d=dist(p,inner.positions.subarray(q*3,q*3+3));if(d<dd){dd=d;best=q}}
    }if(best>=0&&dd<(r-.5)*cell)break}
    if(best>=0){outer.tV[i]=inner.tV[best];outer.strength[i]=.4}await cooperate();
  }
  diagnostics.computeMs=performance.now()-started;
  return {meshes:meshes.map(({tA,tV,classes,strength})=>({tA,tV,classes,strength})),diagnostics,
    volume:cap?{tA,tV,classes}:null};
}
function create({graph,outer,inner,landmarks,cap,onReady}){
  const cache=new Map();let worker,serial=0,wanted,latestMode,visible=true;const pending=new Map();
  if(typeof Worker!=='undefined')try{
    const url=URL.createObjectURL(new Blob(['const solve='+solve.toString()+';let queue=Promise.resolve();onmessage=e=>{queue=queue.then(async()=>{try{postMessage({id:e.data.id,result:await solve(e.data.job)})}catch(error){postMessage({id:e.data.id,error:String(error)})}})}'],{type:'text/javascript'}));
    worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=e=>{const p=pending.get(e.data.id);pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data.result)};
    worker.onerror=e=>{for(const p of pending.values())p.reject(new Error(e.message));pending.clear()};
  }catch(e){worker=null}
  const length=e=>e.points.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((x,k)=>x-e.points[i][k])),0);
  async function sources(mode,stillWanted){
    const am=graph.spec.modes.atrial[mode.atrial],vm=graph.spec.modes.ventricular[mode.ventricular];
    const block=new Set([...(am.blk||[]),...(vm.blk||[]),...(mode.blocks||[]).flatMap(id=>{const b=graph.spec.blockSites[id];return b?.edge?[graph.edges.find(e=>e.id===b.edge)?.struct]:b?.node==='SA'?['*']:b?.node==='AVN'?['avn']:[]})]);
    let a=graph.atrialTimes(mode.atrial),v=graph.ventGraph(mode.ventricular);
    if(mode.blocks?.length){a=graph.times('A',Object.fromEntries(Object.entries(a).filter(([id])=>Object.hasOwn(am.seed,id))),[...block],0);v=graph.times('V',Object.fromEntries(Object.entries(v).filter(([id])=>id==='HIS')),[...block])}
    const A=[],Q=[],V=[];
    for(const e of graph.edges){if(e.circuitOnly||block.has('*')||block.has(e.struct)||block.has(e.id))continue;
      const isA=e.side==='A'&&!['sa','ine','avn'].includes(e.kind)&&!['none','avnOnly','saOnly'].includes(mode.atrial),isV=e.side==='V'&&['bb','fasc','mod','purk'].includes(e.kind);
      if(!isA&&!isV)continue;const count=Math.ceil(length(e)/(isA?.3:.2));
      for(let i=0;i<=count;i++){const u=i/Math.max(1,count),t=graph.edgeTimeAt(e,u,isA?a:v);if(Number.isFinite(t))(isA?A:Q).push({p:graph.pointAt(e,u),t,chamber:['rbb','purk'].includes(e.struct)?3:2})}
    }
    if(a.SA<NEVER&&!['none','avnOnly','saOnly'].includes(mode.atrial))A.push({p:graph.nodes.SA.p,t:6});
    for(const [id,n] of Object.entries(graph.nodes))if(n.purkinje&&v[id]<NEVER)Q.push({p:n.p,t:v[id],chamber:['RB3','RBAP','MODFW'].includes(id)?3:2});
    let nextIdle=performance.now()+8;
    if(!vm.noMuscle){for(let i=0;i<inner.positions.length/3;i++){
      if((i&511)===0){if(!stillWanted())throw 'superseded';if(performance.now()>=nextIdle){await new Promise(resolve=>typeof requestIdleCallback==='function'?requestIdleCallback(resolve,{timeout:50}):setTimeout(resolve,0));nextIdle=performance.now()+8}}
      const c=inner.names[inner.cavity[i]],label=inner.names[inner.labels[i]],p=inner.positions.subarray(i*3,i*3+3),rv=['RV_cavity','RVOT'].includes(c),lv=['LV_cavity','LVOT'].includes(c);
      if(!rv&&!lv)continue;if(lv&&p[2]<1.8&&label!=='IVS'||rv&&(c==='RVOT'||p[2]<1.5))continue;
      // Only muscle endocardium receives fast-network seeds; classification in
      // the solver rejects any excluded/non-muscle destination as well.
      if(!graph.spec.regions.ventricularMuscle.labels.includes(label))continue;
      let t=NEVER;for(const q of Q){const d=Math.hypot(...q.p.map((x,k)=>x-p[k]));if(d<=3.5)t=Math.min(t,q.t+d*10/2.6+4)}
      if(t<NEVER)V.push({p:Array.from(p),t,chamber:rv?3:2});
    }
    if(vm.ap)V.push({p:graph.nodes.AP_V.p,t:22-graph.constants.WPW_LEAD,chamber:2});
    if(vm.focus)V.push({p:graph.spec.foci[vm.focus].p,t:0,chamber:vm.focus==='rvot'?3:2});}
    return {a:A,v:V};
  }
  function get(mode){const key=JSON.stringify([mode.atrial,mode.ventricular,mode.avDelay,[...(mode.blocks||[])].sort()]);wanted=key;latestMode=mode;
    let entry=cache.get(key);if(!entry){entry={key,ready:false};entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject});cache.set(key,entry)}
    if((visible||entry.requested)&&!entry.ready&&!entry.error&&!entry.started&&!entry.timer){
      // Coalesce quick mode changes. Obsolete seed passes yield without filling
      // the worker queue; their promises resume if that mode is selected again.
      entry.timer=setTimeout(async()=>{entry.timer=null;if(wanted!==key||!visible&&!entry.requested)return;entry.started=true;
        try{const start=performance.now(),seeds=await sources(mode,()=>wanted===key&&(visible||entry.requested)),seedMs=performance.now()-start;
          if(wanted!==key||!visible&&!entry.requested)throw 'superseded';
          const job={meshes:[outer,inner],spec:graph.spec,landmarks,cap,seeds,mode};
          const result=await (worker?new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,job})}):solve(job));
          Object.assign(entry,result,{ready:true,requested:false});entry.diagnostics.seedMs=seedMs;entry.diagnostics.elapsedMs=performance.now()-start;onReady?.(entry);entry.resolve(entry);
        }catch(error){if(error!=='superseded'){entry.error=String(error);onReady?.(entry);entry.reject(error)}}finally{
          entry.started=false;
          // Visibility can resume between an aborted source pass and its finally
          // handler. Do not leave the selected entry with an unfulfilled promise.
          if(!entry.ready&&!entry.error&&wanted===key&&(visible||entry.requested))get(mode);
        }
      },100);
    }return entry;
  }
  return {get,cache,worker:!!worker,request(mode){const entry=get(mode);if(!entry.ready){entry.requested=true;get(mode)}return entry.promise},visibility(on){visible=!!on;if(visible&&latestMode)get(latestMode)}};
}
function display({T,meshes,materials,capMaterials,capUniforms,cap,clock,legend}){
  const uniforms={uActEnabled:{value:0},uIso:{value:0},uActA:{value:0},uActV:{value:0},uIsoMin:{value:0},uIsoMax:{value:150},
    uActHot:{value:new T.Color(CGRAPH.spec.display.colours.wavefront.match(/#[0-9a-f]{6}/i)[0])},
    uActAfter:{value:new T.Color(CGRAPH.spec.display.colours.justFired.match(/#[0-9a-f]{6}/i)[0])}};
  const common=`uniform float uActEnabled,uIso,uActA,uActV,uIsoMin,uIsoMax;uniform vec3 uActHot,uActAfter;
    vec3 isoInk(float t){float x=clamp((floor(t/10.0)*10.0-uIsoMin)/(uIsoMax-uIsoMin),0.0,1.0)*4.0;
      vec3 a=vec3(.993,.906,.144),b=vec3(.369,.788,.382),c=vec3(.129,.569,.549),d=vec3(.231,.322,.545),e=vec3(.267,.005,.329);
      if(x<1.0)return mix(a,b,x);if(x<2.0)return mix(b,c,x-1.0);if(x<3.0)return mix(c,d,x-2.0);return mix(d,e,x-3.0);}
    vec3 activationInkFast(vec3 ink,vec4 act){if(uActEnabled<.5)return ink;
      float strength=act.z*(1.0-step(1e8,act.y));
      if(uIso>.5)return mix(ink,isoInk(act.y),strength);
      float fired=step(12.0,act.x),hot=step(0.0,act.x)-fired;
      float after=fired*max(0.0,1.0-act.x*act.w)*.75;
      // The hot band and refractory tail are disjoint. Combining their weights
      // avoids per-fragment divergent validity branches and two dependent mixes.
      return ink+(hot*(uActHot-ink)+after*(uActAfter-ink))*strength;}
    vec3 activationInk(vec3 ink,vec4 act){float isA=1.0-step(1.5,act.z),t=mix(act.y,act.x,isA);
      return activationInkFast(ink,vec4(mix(uActV,uActA,isA)-t,t,act.w,mix(${(1/CGRAPH.spec.timing.refractory_ms.ventricular).toFixed(9)},${(1/CGRAPH.spec.timing.refractory_ms.atrial).toFixed(9)},isA)));}`;
  for(const mesh of meshes){const n=mesh.geometry.attributes.position.count,a=new Float32Array(n*4);for(let i=0;i<n;i++){a[i*4]=a[i*4+1]=NEVER}
    mesh.geometry.setAttribute('aActivation',new T.BufferAttribute(a,4));}
  materials.forEach(mat=>{const prev=mat.onBeforeCompile,key=mat.customProgramCacheKey();mat.onBeforeCompile=s=>{prev(s);Object.assign(s.uniforms,uniforms);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float uActA,uActV;attribute vec4 aActivation;varying vec4 vActivation;').replace('#include <begin_vertex>',`#include <begin_vertex>
      float actIsA=1.0-step(1.5,aActivation.z),actTime=mix(aActivation.y,aActivation.x,actIsA);
      vActivation=vec4(mix(uActV,uActA,actIsA)-actTime,actTime,aActivation.w,mix(${(1/CGRAPH.spec.timing.refractory_ms.ventricular).toFixed(9)},${(1/CGRAPH.spec.timing.refractory_ms.atrial).toFixed(9)},actIsA));`);
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vActivation;\n'+common).replace('#include <roughnessmap_fragment>','diffuseColor.rgb=activationInkFast(diffuseColor.rgb,vActivation);\n#include <roughnessmap_fragment>');};mat.customProgramCacheKey=()=>key+'-activation';});
  let texture;
  if(capUniforms){uniforms.uActivationVolume={value:null};capMaterials.forEach(mat=>{const prev=mat.onBeforeCompile,key=mat.customProgramCacheKey();mat.onBeforeCompile=s=>{prev(s);Object.assign(s.uniforms,uniforms);
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform highp sampler3D uActivationVolume;\n'+common).replace('#include <roughnessmap_fragment>',`if(uActEnabled>.5){vec3 uv=(p-uCapLo)/uCapSize;if(all(greaterThanEqual(uv,vec3(0.0)))&&all(lessThan(uv,vec3(1.0))))diffuseColor.rgb=activationInk(diffuseColor.rgb,texture(uActivationVolume,uv));}\n#include <roughnessmap_fragment>`);};mat.customProgramCacheKey=()=>key+'-activation';});}
  function apply(entry){if(!entry.ready){uniforms.uActEnabled.value=0;return}
    let min=0,max=10;entry.meshes.forEach((map,i)=>{const attr=meshes[i].geometry.attributes.aActivation,a=attr.array;
      for(let j=0;j<map.tA.length;j++){a[j*4]=map.tA[j];a[j*4+1]=map.tV[j];a[j*4+2]=map.classes[j]||2;a[j*4+3]=map.strength[j];
        if(map.tA[j]<NEVER){min=Math.min(min,map.tA[j]);max=Math.max(max,map.tA[j])}if(map.tV[j]<NEVER){min=Math.min(min,map.tV[j]);max=Math.max(max,map.tV[j])}}attr.needsUpdate=true;});
    uniforms.uIsoMin.value=Math.floor(min/10)*10;uniforms.uIsoMax.value=Math.ceil(max/10)*10;
    if(capUniforms&&entry.volume){const v=entry.volume,data=new Float32Array(v.tA.length*4);for(let i=0;i<v.tA.length;i++){data[i*4]=v.tA[i];data[i*4+1]=v.tV[i];data[i*4+2]=v.classes[i];data[i*4+3]=v.classes[i]?1:0}
      texture?.dispose();texture=new T.Data3DTexture(data,...cap.n);texture.format=T.RGBAFormat;texture.type=T.FloatType;texture.minFilter=texture.magFilter=T.NearestFilter;texture.needsUpdate=true;uniforms.uActivationVolume.value=texture;}
    legend.querySelector('output').textContent=uniforms.uIsoMin.value+'–'+uniforms.uIsoMax.value+' ms · 10 ms';
  }
  let legendKey='';
  function update(enabled,iso,ready,ms,error){const t=clock(ms);uniforms.uActEnabled.value=enabled&&ready?1:0;uniforms.uIso.value=iso?1:0;uniforms.uActA.value=t.a;uniforms.uActV.value=t.v;
    const key=[enabled,iso,ready,error].join('|');if(key===legendKey)return;legendKey=key;
    legend.hidden=!enabled;legend.classList.toggle('pending',!ready);legend.classList.toggle('is-map',iso&&ready);legend.querySelector('.actStatus').textContent=error?'Activation unavailable':ready?'':'Computing…';}
  return {apply,update,uniforms};
}
window.ACTIVATION={create,solve,display,NEVER};
})();
