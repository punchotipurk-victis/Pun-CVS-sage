/* T6.2(b): contract-driven conduction geometry, picking and a shared playback clock.
   Tissue activation/isochrones are supplied by T6.2(c); circuits by T8.2. */
(function(){
'use strict';
function create(o){
  const {T,world,cam,host,labelLayer,beatify,clips,deform,removed,onSelect,onChange}=o;
  const cycleMs=o.cycleMs||(()=>60000/CONTENT.SC.normal.rh.rate);
  const g=CGRAPH,s=g.spec,d=s.display,group=new T.Group(),parts=[],labels=[],rings=[];
  const colour=key=>o.palette?.[key]||d.colours[key].match(/#[0-9a-f]{6}/i)[0];
  world.add(group);group.visible=false;
  const state={enabled:false,ms:0,playing:!o.reduced,speed:o.reduced?.25:1,selected:null,
    mode:{atrial:'sinus',ventricular:'normal',avDelay:g.constants.D0,blocks:[]}};
  let anchorMs=0,anchorWall=performance.now(),suspended=false;
  const current=()=>state.playing&&!suspended?anchorMs+(performance.now()-anchorWall)*state.speed:state.ms;
  function anchor(ms=current()){state.ms=Math.max(0,ms)%(cycleMs()*120);anchorMs=state.ms;anchorWall=performance.now()}
  const cache=new Map();let timing;
  const vector=p=>new T.Vector3(...p);
  const priority=id=>id==='sa'||id==='avn'?0:id==='his'?1:/^avn_/.test(id)?2:
    ['lbb','rbb','moderator'].includes(id)?3:['lsf','laf','lpf'].includes(id)?4:
    id==='ap'?5:id==='cti'?6:id==='purk'?8:7;
  const front=T.LessEqualDepth,behind=T.GreaterDepth;
  const tapIds=Object.keys(d.shortNames),waveUniforms={uNowA:{value:0},uNowV:{value:-1e9},uPulse:{value:0},
    uSelectedId:{value:-1},uHot:{value:new T.Color(colour('wavefront'))},uAfter:{value:new T.Color(colour('justFired'))},uBlockedInk:{value:new T.Color(colour('blocked'))}};
  let batch;
  function material(depthFunc){
    const mat=beatify(new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:depthFunc===behind?.45:1,
      depthWrite:false,depthTest:true,depthFunc,clippingPlanes:clips}));
    const previous=mat.onBeforeCompile;
    mat.onBeforeCompile=shader=>{previous(shader);Object.assign(shader.uniforms,waveUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 aCenter,aInk;attribute float aU,aTime,aSide,aRefractory,aAvNode,aBlocked,aTap,aVisible;
        varying vec3 vInk;varying float vU,vTime,vSide,vRefractory,vAvNode,vBlocked,vSelected,vVisible;
        uniform float uSelectedId;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSelected=1.0-step(.1,abs(aTap-uSelectedId));transformed=aCenter+(transformed-aCenter)*(1.0+vSelected);
        vU=aU;vTime=aTime;vSide=aSide;vRefractory=aRefractory;vAvNode=aAvNode;vBlocked=aBlocked;vInk=aInk;vVisible=aVisible;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vInk;varying float vU,vTime,vSide,vRefractory,vAvNode,vBlocked,vSelected,vVisible;
        uniform float uNowA,uNowV,uPulse;uniform vec3 uHot,uAfter,uBlockedInk;`)
        .replace('#include <color_fragment>',`#include <color_fragment>
        if(vVisible<.5)discard;if(vBlocked>.5 && mod(vU*24.0,2.0)>1.0)discard;
        float elapsed=mix(uNowA,uNowV,vSide)-vTime;
        float hot=step(0.0,elapsed)*(1.0-step(12.0,elapsed));
        float after=step(12.0,elapsed)*max(0.0,1.0-elapsed/vRefractory);
        diffuseColor.rgb=mix(vInk,uBlockedInk,vBlocked);
        diffuseColor.rgb=mix(diffuseColor.rgb,uAfter,after*.75);
        diffuseColor.rgb=mix(diffuseColor.rgb,uHot,max(hot,uPulse*vAvNode));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),vSelected*.55);`);
    };mat.customProgramCacheKey=()=> 'conduction-batched-wave-v1';mat.userData.wave=waveUniforms;return mat;
  }
  function addPart(id,geometry,centres,uu,info){
    geometry.setAttribute('aCenter',new T.Float32BufferAttribute(centres,3));geometry.setAttribute('aU',new T.Float32BufferAttribute(uu,1));
    const ink=colour(id==='avn_slow'?'slowPathway':id==='ap'?'accessory':'idle');
    const part={id,geometry,colour:ink,...info};parts.push(part);return part;
  }
  function buildBatch(){
    const count=parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0),geometry=new T.BufferGeometry(),arrays={};
    const fields={position:3,normal:3,aCenter:3,aU:1,aTime:1,aSide:1,aRefractory:1,aAvNode:1,aBlocked:1,aTap:1,aVisible:1,aInk:3};
    for(const [key,width] of Object.entries(fields))arrays[key]=new Float32Array(count*width);
    const indices=[];let offset=0;
    for(const p of parts){p.offset=offset;p.count=p.geometry.attributes.position.count;
      for(const key of ['position','normal','aCenter','aU'])arrays[key].set(p.geometry.attributes[key].array,offset*fields[key]);
      for(const index of p.geometry.index.array)indices.push(index+offset);
      const ink=new T.Color(p.colour).toArray();
      for(let i=offset;i<offset+p.count;i++){arrays.aInk.set(ink,i*3);arrays.aTap[i]=tapIds.indexOf(p.id);arrays.aAvNode[i]=p.nodeId==='AVN'?1:0}
      offset+=p.count;
    }
    for(const [key,width] of Object.entries(fields))geometry.setAttribute(key,new T.BufferAttribute(arrays[key],width));
    geometry.setIndex(indices);geometry.computeBoundingSphere();
    const pair=[behind,front].map((depth,i)=>{const mesh=new T.Mesh(geometry,material(depth));mesh.renderOrder=10+i;group.add(mesh);return mesh});
    for(const p of parts)p.pair=pair;
    batch={geometry,arrays,pair};
  }
  function refreshTiming(){
    const {arrays,geometry}=batch;
    for(const p of parts){const edge=p.edge,isA=edge?edge.side==='A':p.nodeId?g.nodes[p.nodeId].side==='A':true;
      const times=isA?timing.a:timing.v;let ta=p.nodeId?times[p.nodeId]:edge?times[edge.a]:timing.a.SA;
      let tb=p.nodeId?ta:edge?times[edge.b]:1e9;
      const blocked=!!(edge&&(timing.blocked.has(edge.struct)||timing.blocked.has(edge.id)||timing.blocked.has('*')));
      if(edge?.side==='AP'){ta=timing.a.AP_A;tb=g.constants.TA_AVN+state.mode.avDelay+22-g.constants.WPW_LEAD}
      // atrialTimes retains the legacy zero-delay HIS alias; this display bridge
      // ends only after the AV delay, so it cannot fire backwards from that alias.
      if(edge?.T_ms==='avDelay')tb=ta+state.mode.avDelay;
      if(state.mode.atrial==='avnOnly'&&edge?.side==='A'&&edge.kind!=='avn')ta=tb=1e9;
      if(blocked)ta=tb=1e9;
      ta=Number.isFinite(ta)?ta:1e9;tb=Number.isFinite(tb)?tb:1e9;
      const travel=edge?g.edgeDuration(edge,state.mode.avDelay)||0:p.nodeId?0:1;
      for(let i=p.offset;i<p.offset+p.count;i++){
        const u=arrays.aU[i];arrays.aTime[i]=Math.min(ta+u*travel,tb+(1-u)*travel);
        arrays.aSide[i]=isA||edge?.side==='AP'?0:1;arrays.aRefractory[i]=isA?s.timing.refractory_ms.atrial:s.timing.refractory_ms.ventricular;
        arrays.aBlocked[i]=blocked?1:0;arrays.aVisible[i]=isVisible(p)?1:0;
      }
    }
    for(const key of ['aTime','aSide','aRefractory','aBlocked','aVisible'])geometry.attributes[key].needsUpdate=true;
  }
  function tube(edge,curve,radius,id=edge.tap){
    const segments=Math.max(12,Math.ceil(curve.getLength()/.12)),radial=6;
    const geometry=new T.TubeGeometry(curve,segments,radius,radial,false),centres=[],uu=[];
    let saFraction=.5;
    if(!edge){let distance=Infinity;for(let i=0;i<=200;i++){const u=i/200,d=curve.getPointAt(u).distanceToSquared(vector(g.nodes.SA.p));if(d<distance){distance=d;saFraction=u}}}
    for(let i=0;i<geometry.attributes.position.count;i++){
      const u=Math.floor(i/(radial+1))/segments,p=curve.getPointAt(u);centres.push(p.x,p.y,p.z);
      uu.push(edge?u:u<=saFraction?8*(saFraction-u)/saFraction:10*(u-saFraction)/(1-saFraction));
    }
    const pickMaterial=beatify(new T.MeshBasicMaterial({visible:false,clippingPlanes:clips}));
    const picker=new T.Mesh(new T.TubeGeometry(curve,segments,Math.max(.35,2.5*radius),5,false),pickMaterial);
    picker.userData.tap=id;group.add(picker);
    return addPart(id,geometry,centres,uu,{edge,curve,radius,picker,
      samples:curve.getSpacedPoints(segments*2),anchor:curve.getPointAt(.5)});
  }
  for(const edge of g.edges){
    if(edge.kind==='sa')continue;
    const curve=new T.CatmullRomCurve3(edge.points.map(vector),false,'centripetal');
    tube(edge,curve,d.radiiCm[edge.kind]||.1);
  }
  const saCurve=new T.CatmullRomCurve3(['SA_H','SA','SA_T'].map(id=>vector(g.nodes[id].p)),false,'centripetal');
  tube(null,saCurve,.14,'sa');
  function node(nodeId,radii,id){
    const centre=vector(g.nodes[nodeId].p),geometry=new T.SphereGeometry(1,16,10);
    if(nodeId==='AVN'){
      const rotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(1,0,0),vector(g.nodes.HIS.p).sub(centre).normalize());
      geometry.scale(...radii).applyQuaternion(rotation).translate(...centre.toArray());
    }else geometry.scale(...radii).translate(...centre.toArray());
    const n=geometry.attributes.position.count,centres=Array.from({length:n},()=>centre.toArray()).flat();
    const picker=new T.Mesh(new T.SphereGeometry(['SA','AVN'].includes(nodeId)?.45:.35,10,8).translate(...centre.toArray()),
      beatify(new T.MeshBasicMaterial({visible:false,clippingPlanes:clips})));group.add(picker);
    addPart(id,geometry,centres,new Float32Array(n),{nodeId,radius:radii[0],anchor:centre,samples:[centre],picker});
  }
  node('SA',[.35,.2,.2],'sa');node('AVN',[.3,.18,.2],'avn');node('HIS',[.16,.16,.16],'his');node('BIF',[.14,.14,.14],'his');
  buildBatch();
  // One leader/label per contract tap id. Node anchors take precedence over curves.
  for(const id of Object.keys(d.shortNames)){
    const candidates=parts.filter(p=>p.id===id),at=d.labelAnchors?.[id];
    // spec display.labelAnchors: the label points at a node on one of the tap id's curves (T6.2-B)
    let part=candidates.find(p=>p.nodeId)||(at&&candidates.find(p=>p.edge&&[p.edge.a,p.edge.b].includes(at)))||candidates[0];if(!part)continue;
    if(at&&g.nodes[at])part=Object.assign(Object.create(part),{anchor:vector(g.nodes[at].p)});
    const el=document.createElement('button');el.type='button';el.className='lab lab-conduction conduction-label';
    el.dataset.tap=id;el.textContent=d.shortNames[id];el.hidden=true;labelLayer.appendChild(el);
    labels.push({id,part,el});
  }
  const leaderGeometry=new T.BufferGeometry(),leaderPosition=new Float32Array(labels.length*6),leaderScreen=new Float32Array(labels.length*4),leaderShow=new Float32Array(labels.length*2);
  const leaderEnd=new Float32Array(labels.length*2);
  labels.forEach((l,i)=>{leaderPosition.set(l.part.anchor.toArray(),i*6);leaderPosition.set(l.part.anchor.toArray(),i*6+3);leaderEnd[i*2+1]=1});
  leaderGeometry.setAttribute('position',new T.BufferAttribute(leaderPosition,3));leaderGeometry.setAttribute('aScreen',new T.BufferAttribute(leaderScreen,2));
  leaderGeometry.setAttribute('aEnd',new T.BufferAttribute(leaderEnd,1));leaderGeometry.setAttribute('aShow',new T.BufferAttribute(leaderShow,1));
  const leaderMat=beatify(new T.LineBasicMaterial({color:'#b9fff2',transparent:true,opacity:.7,depthTest:false,depthWrite:false,clippingPlanes:clips}));
  const leaderCompile=leaderMat.onBeforeCompile;
  leaderMat.onBeforeCompile=shader=>{leaderCompile(shader);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aScreen;attribute float aEnd,aShow;varying float vShow;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvShow=aShow;if(aEnd>.5)gl_Position=vec4(aScreen,0.0,1.0);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vShow;')
      .replace('#include <color_fragment>','#include <color_fragment>\nif(vShow<.5)discard;');
  };leaderMat.customProgramCacheKey=()=> 'beat-conduction-leaders-v1';
  const leaders=new T.LineSegments(leaderGeometry,leaderMat);leaders.frustumCulled=false;leaders.renderOrder=12;group.add(leaders);
  if(o.externalLabels)leaders.visible=false;
  const blockMap={SA:['*'],AVN:['AVN-HIS'],HIS:['his'],RBB:['rbb'],LBB:['lbb','laf','lpf'],LAF:['laf'],LPF:['lpf'],BACH:['bach']};
  function setMode(options={}){
    const next={...state.mode,...options,blocks:[...(options.blocks??state.mode.blocks)]};
    if(!s.modes.atrial[next.atrial]||!s.modes.ventricular[next.ventricular]||!Number.isFinite(next.avDelay)||next.avDelay<0||
      next.blocks.some(id=>!blockMap[id]))throw new Error('Invalid conduction mode');
    state.mode=next;const key=JSON.stringify([next.atrial,next.ventricular,next.avDelay,[...next.blocks].sort()]);
    if(!cache.has(key)){
      const vm=s.modes.ventricular[next.ventricular],a=g.atrialTimes(next.atrial),v=g.ventGraph(next.ventricular);
      const blocked=new Set(next.blocks.flatMap(id=>blockMap[id]));
      const atrialBlocked=[...(s.modes.atrial[next.atrial].blk||[]),...blocked];
      let ta=a,tv=v;
      if(next.blocks.length){
        const sources=next.atrial==='none'?{}:next.atrial==='avnOnly'?{AVN:g.constants.TA_AVN}:
          next.atrial==='retro'?{AVN:0}:next.atrial==='focal'?{CT1:0}:{SA:0};
        ta=g.times('A',sources,atrialBlocked,0);
        if(['saOnly','avnOnly'].includes(next.atrial))ta={...g.times('A',sources,['*'],0)};
        const entry=vm.focus?Object.keys(v).filter(id=>Number.isFinite(v[id])).sort((a,b)=>v[a]-v[b])[0]:'HIS';
        tv=g.times('V',blocked.has('AVN-HIS')||blocked.has('*')?{}:{[entry]:v[entry]},[...vm.blk,...blocked]);
      }
      cache.set(key,{a:ta,v:tv,blocked:new Set([...vm.blk,...atrialBlocked])});
    }
    timing=cache.get(key);refreshTiming();
    for(const ring of rings){group.remove(ring);ring.geometry.dispose();ring.material.dispose()}rings.length=0;
    const sites=new Set(next.blocks);
    for(const [id,site] of Object.entries(s.blockSites))if(site.edge){
      const edge=g.edges.find(e=>e.id===site.edge);
      if((s.modes.ventricular[next.ventricular].blk||[]).includes(edge?.struct))sites.add(id);
    }
    if(next.atrial==='iab')sites.add('BACH');
    if(next.atrial==='saOnly')sites.add('SA');
    for(const id of sites){const site=s.blockSites[id],p=site.node?vector(g.nodes[site.node].p):vector(g.pointAt(g.edges.find(e=>e.id===site.edge),site.u));
      const geometry=new T.TorusGeometry(.25,.035,6,20).translate(...p.toArray());
      const mat=beatify(new T.MeshBasicMaterial({color:'#FF3B3B',depthTest:false,clippingPlanes:clips}));
      const ring=new T.Mesh(geometry,mat);ring.userData.block=id;ring.renderOrder=12;group.add(ring);rings.push(ring);
      // Geometry ×: colour is accompanied by a shape at the block site.
      for(const sign of [-1,1]){const cross=new T.CylinderGeometry(.025,.025,.35,5);cross.rotateZ(sign*Math.PI/4).translate(...p.toArray());
        const mesh=new T.Mesh(cross,mat.clone());beatify(mesh.material);mesh.renderOrder=12;group.add(mesh);rings.push(mesh)}
    }
    update(state.ms);onChange?.();return next;
  }
  function isVisible(part){return !part.edge?.circuitOnly&&(part.edge?.kind!=='ap'||!!s.modes.ventricular[state.mode.ventricular].ap)}
  function update(ms){
    state.ms=ms;const rr=cycleMs(),phase=((ms%rr)+rr)%rr;
    const clocks=o.clocks?o.clocks(ms):{a:phase,v:phase-g.constants.TA_AVN-state.mode.avDelay};
    waveUniforms.uNowA.value=clocks.a;waveUniforms.uNowV.value=clocks.v;
    waveUniforms.uSelectedId.value=tapIds.indexOf(state.selected);
    waveUniforms.uPulse.value=clocks.a>=timing.a.AVN&&clocks.a<timing.a.AVN+state.mode.avDelay?
      .55+.45*Math.sin((clocks.a-timing.a.AVN)*.11)**2:0;
  }
  function project(p,beat=true){const w=(beat?deform(p):p.clone()).applyMatrix4(world.matrixWorld),v=w.clone().project(cam),r=host.getBoundingClientRect();
    return {w,x:r.left+(v.x*.5+.5)*r.width,y:r.top+(-v.y*.5+.5)*r.height,z:v.z};}
  let labelKey='',labelLayout=new Map();
  document.fonts?.addEventListener('loadingdone',()=>{labelKey='';onChange?.()});
  function placeLabels(){
    if(o.externalLabels)return;
    const r=host.getBoundingClientRect(),small=host.clientWidth<=400;
    const points=new Map(labels.map(l=>[l.id,project(l.part.anchor)]));
    const valid=labels.filter(l=>{const p=points.get(l.id);return state.enabled&&isVisible(l.part)&&!removed(p.w)&&p.z<1&&p.z>-1&&
      p.x>=r.left&&p.x<r.right&&p.y>=r.top&&p.y<r.bottom&&(!small||['sa','avn','his','lbb','rbb'].includes(l.id))});
    const generic=Array.from(labelLayer.querySelectorAll('.lab:not(.conduction-label)')).filter(el=>!el.hidden);
    const key=[r.width,r.height,...cam.matrixWorld.elements,...cam.projectionMatrix.elements,
      valid.map(l=>l.id).join(','),generic.map(el=>el.dataset.id).join(',')].join('|');
    if(key!==labelKey){
      labelKey=key;labelLayout=new Map();
      // Reveal all measuring candidates before reading any dimensions: one layout,
      // rather than alternating a layout read/write for every individual label.
      for(const l of valid)l.el.hidden=false;
      const occupied=generic.map(el=>{const b=el.getBoundingClientRect();return[b.left-r.left,b.top-r.top,b.right-r.left,b.bottom-r.top]});
      const sizes=new Map(valid.map(l=>[l.id,[l.el.offsetWidth,l.el.offsetHeight]]));
      const targets=valid.map(l=>{const p=points.get(l.id);return[p.x-r.left,p.y-r.top]});
      for(const l of [...valid].sort((a,b)=>priority(a.id)-priority(b.id))){
        const p=points.get(l.id),x=p.x-r.left,y=p.y-r.top,[w,h]=sizes.get(l.id);let box=null;
        const fits=c=>!targets.some(([x,y])=>x>=c[0]-5&&x<=c[2]+5&&y>=c[1]-5&&y<=c[3]+5)&&
          !occupied.some(q=>c[0]<q[2]+3&&c[2]+3>q[0]&&c[1]<q[3]+3&&c[3]+3>q[1]);
        for(const distance of [14,38,62,90,120,155,190,230,280]){
          for(const [dx,dy] of [[1,-1],[1,1],[-1,-1],[-1,1],[0,-1],[0,1]]){
            const bx=T.MathUtils.clamp(x+dx*distance-(dx<=0?w:0),4,r.width-w-4),by=T.MathUtils.clamp(y+dy*distance-(dy<0?h:0),30,r.height-h-4);
            const c=[bx,by,bx+w,by+h];if(fits(c)){box=c;break}
          }if(box)break;
        }
        if(!box){let best=Infinity;for(let by=30;by<r.height-h;by+=h+5)for(let bx=4;bx<r.width-w;bx+=w+8){
          const c=[bx,by,bx+w,by+h],cost=Math.hypot(bx+w/2-x,by+h/2-y);if(cost<best&&fits(c)){box=c;best=cost}
        }}
        if(box){occupied.push(box);labelLayout.set(l.id,{x:box[0],y:box[1],w,h})}
      }
    }
    const show=new Set(valid.map(l=>l.id));let leaderDirty=false;
    labels.forEach((l,i)=>{const box=labelLayout.get(l.id),visible=show.has(l.id)&&!!box;
      if(l.el.hidden===visible)l.el.hidden=!visible;
      const flag=visible?1:0;if(leaderShow[i*2]!==flag){leaderShow[i*2]=leaderShow[i*2+1]=flag;leaderDirty=true}
      if(!visible)return;
      const transform='translate3d('+box.x+'px,'+box.y+'px,0)';if(l.transform!==transform){l.el.style.transform=transform;l.transform=transform;}
      l.el.classList.toggle('sel',state.selected===l.id);
      const rest=project(l.part.anchor,false),x=rest.x-r.left,y=rest.y-r.top;
      const lx=T.MathUtils.clamp(x,box.x,box.x+box.w),ly=T.MathUtils.clamp(y,box.y,box.y+box.h);
      const sx=lx/r.width*2-1,sy=1-ly/r.height*2;
      if(Math.abs(leaderScreen[i*4+2]-sx)>1e-6||Math.abs(leaderScreen[i*4+3]-sy)>1e-6){leaderScreen[i*4+2]=sx;leaderScreen[i*4+3]=sy;leaderDirty=true}
    });
    if(leaderDirty){leaderGeometry.attributes.aShow.needsUpdate=true;leaderGeometry.attributes.aScreen.needsUpdate=true}
  }
  function pick(x,y,ray){
    if(!state.enabled)return null;const hits=[];
    for(const p of parts){if(!isVisible(p))continue;let px=Infinity,hit3d=false,point=null;
      for(const sample of p.samples){const q=project(sample);if(q.z<-1||q.z>1||removed(q.w))continue;
        const distance=Math.hypot(q.x-x,q.y-y);if(distance<px){px=distance;point=q.w}
        if(ray.distanceToPoint(q.w)<(p.nodeId?(['SA','AVN'].includes(p.nodeId)?.45:.35):Math.max(.35,2.5*p.radius)))hit3d=true;
      }
      const rank=p.nodeId?(['SA','AVN'].includes(p.nodeId)?0:1):p.id==='avn'?2:priority(p.id);
      if(hit3d||px<=d.pick.minScreenPx)hits.push({id:p.id,px,hit3d,point,priority:rank});
    }
    if(!hits.length)return null;
    // A directly targeted centre stays selectable in the tightly packed His/LBB region;
    // contract priority resolves equally close hits and the wider finger fallback.
    const direct=hits.filter(h=>h.px<=3),pool=direct.length?direct:hits;
    pool.sort((a,b)=>direct.length&&Math.abs(a.px-b.px)>.15?a.px-b.px:a.priority-b.priority||a.px-b.px);return pool[0];
  }
  function select(id){if(!(id in d.shortNames))return false;state.selected=id;update(state.ms);onSelect(id);onChange?.();return true;}
  function enable(on){state.enabled=!!on;group.visible=state.enabled;update(state.ms);placeLabels();onChange?.()}
  function seek(ms){if(!Number.isFinite(ms))throw new TypeError('Seek requires milliseconds');anchor(ms);update(state.ms);onChange?.();return state.ms}
  function advance(){const ms=current();state.ms=ms%(cycleMs()*120);if(ms>=cycleMs()*120)anchor(state.ms);return state.ms}
  function playback({playing=state.playing,speed=state.speed}={}){if(![1,.25,.1].includes(speed))throw new Error('Invalid speed');anchor();state.playing=!!playing;state.speed=speed;onChange?.()}
  function visibility(active){if(suspended===!active)return;anchor();suspended=!active;onChange?.()}
  const clockState=()=>({ms:anchorMs,wall:anchorWall,rate:state.speed,running:state.playing&&!suspended});
  function midpoint(id,rest=false){const l=labels.find(l=>l.id===id);if(!l)return null;const p=project(l.part.anchor,!rest);return {x:p.x,y:p.y,visible:state.enabled&&isVisible(l.part)&&!removed(p.w),point:l.part.anchor.toArray()};}
  setMode({});
  return {state,group,parts,labels,rings,enable,update,placeLabels,pick,select,seek,advance,playback,setMode,midpoint,cycleMs,visibility,clockState,now:()=>current()%(cycleMs()*120),
    timing:()=>timing,cacheSize:()=>cache.size,playCircuit(){throw new Error('T8.2')}};
}

/* Normal phase strings copied verbatim from app.js. No new teaching text. */
const PHASE_TEXT={base:'Diastole: cells at rest, baseline flat; ventricles filling.',
  P:'SA node fires → atria depolarise → P wave',PR:'Impulse held in the AV node → flat PR segment',
  HIS:'His bundle and bundle branches firing (silent on the surface ECG)',
  QRS:'His–Purkinje fires the ventricles → narrow QRS; mitral & tricuspid valves close (S1)',
  HOCM:'Thick septum depolarises first → deep narrow Q, huge voltage',
  WIDE:'Slow muscle-to-muscle spread → wide QRS',WPW:'Pre-excitation through the accessory pathway → delta wave',
  ST:'Plateau (phase 2): ventricles ejecting, aortic valve open',T:'Ventricles repolarise → T wave; aortic valve closes (S2)'};
function strip({root,engine,getContext,view}){
  const plot=root.querySelector('.conECG'),select=root.querySelector('select'),leads=Object.keys(engine.LEADS);
  for(const lead of leads){const option=document.createElement('option');option.value=option.textContent=lead;select.appendChild(option)}select.value='II';
  const q=selector=>root.querySelector(selector),phaseNodes=Array.from(root.querySelectorAll('[data-phase]'));
  const fields={text:q('.phaseTxt'),hr:q('.rHR'),pr:q('.rPR'),qrs:q('.rQRS'),clock:q('.clockRead'),play:q('.bConPlay')};
  const write=(el,text)=>{text=String(text);if(el.textContent!==text)el.textContent=text};
  let key='',cells=[],cache=null,animationKey='',plotVisible=false,sleeping=true;
  const sleep=()=>{if(!sleeping)for(const cell of cells)for(const animation of cell.animations)animation.pause();sleeping=true;animationKey='';};
  new IntersectionObserver(entries=>{plotVisible=entries[0].isIntersecting;
    if(plotVisible&&view.state.enabled)draw(view.now(),true);else sleep();
  }).observe(plot);
  const themeChanged=()=>{cache=null;draw(view.state.ms,true)};
  const observer=new MutationObserver(themeChanged);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  observer.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme']});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',themeChanged);
  select.onchange=()=>{cache=null;draw(view.state.ms,true)};
  function draw(ms,force=false){
    if(!view.state.enabled||(!plotVisible&&!force)){sleep();return}
    const width=plot.clientWidth,height=plot.clientHeight;if(!width||!height)return;
    const narrow=matchMedia('(max-width:520px)').matches,ratio=Math.min(devicePixelRatio||1,2);
    const displayed=narrow?[select.value]:['I','aVR','V1','V4','II','aVL','V2','V5','III','aVF','V3','V6'];
    const columns=narrow?1:4,rows=narrow?1:3,cw=width/columns,ch=height/rows,win=cw*10;
    const nextKey=[width,height,ratio,...displayed].join('|');
    if(nextKey!==key){key=nextKey;cache=null;cells=[];
      for(const lead of displayed){const cell=document.createElement('div');cell.className='conPlotCell';
        const canvas=document.createElement('canvas');canvas.className='conTrace';canvas.width=Math.round(cw*ratio);canvas.height=Math.round(ch*ratio);canvas.setAttribute('aria-hidden','true');
        const name=document.createElement('span');name.className='conLeadName';name.textContent=lead;
        const cursor=document.createElement('i');cursor.className='conCursor';cursor.setAttribute('aria-hidden','true');
        const sweep=canvas.animate([{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)'}],{duration:win,iterations:Infinity,easing:'linear'});
        const cursorAnimation=cursor.animate([{transform:'translateX(0%)'},{transform:'translateX(100%)'}],{duration:win,iterations:Infinity,easing:'linear'});
        cell.append(canvas,name,cursor);cells.push({lead,cell,canvas,ctx:canvas.getContext('2d'),animations:[sweep,cursorAnimation]});
      }plot.replaceChildren(...cells.map(c=>c.cell));root.dataset.leadCount=displayed.length;
      plot.setAttribute('aria-label',narrow?'Lead '+select.value+' rhythm strip':'Live twelve-lead ECG with moving cursor');
    }
    const now=ms+200,start=Math.floor(ms/win)*win+200,context=getContext();
    if(!cache||cache.context!==context||cache.start!==start){
      const css=getComputedStyle(root),trace=css.getPropertyValue('--trace').trim();
      const paths=Object.fromEntries(displayed.map(lead=>[lead,new Path2D()]));let first=true;
      for(let t=0;t<=win;t+=2){const vec=engine.vecAt(context,start+t),x=t/win*cw;
        for(const lead of displayed){const y=ch*.57-engine.leadVal(vec,lead)*40;first?paths[lead].moveTo(x,y):paths[lead].lineTo(x,y)}first=false;
      }
      for(const {lead,ctx,canvas} of cells){ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,cw,ch);ctx.strokeStyle=trace;ctx.lineWidth=1.2;ctx.stroke(paths[lead]);}
      cache={context,start};
    }
    const clock=view.clockState(),running=clock.running&&plotVisible,signature=[key,clock.ms,clock.wall,clock.rate,running].join('|');
    if(signature!==animationKey){animationKey=signature;
      for(const cell of cells)for(const animation of cell.animations){animation.playbackRate=clock.rate;
        if(running){animation.play();animation.startTime=clock.wall-clock.ms/clock.rate;}
        else{animation.pause();animation.currentTime=ms;}
      }
      sleeping=!running;
    }
    const {a,v}=engine.curEv(context.ev,now),mode=v&&engine.VCG[v.mode];let phase='base',text=PHASE_TEXT.base;
    if(a){const r=now-a.t;if(r>=0&&r<115){phase='P';text=PHASE_TEXT.P}else if(r>=115&&r<engine.LEGACY_TA+a.d+5){phase='PR';text=PHASE_TEXT.PR}}
    if(v&&v.qrs){const r=now-v.t-v.on;if(r>=-v.on&&r<0){phase='PR';text=PHASE_TEXT.HIS}
      else if(r>=0&&r<mode.dur){phase='QRS';text=mode===engine.VCG.wpw&&r<45?PHASE_TEXT.WPW:mode===engine.VCG.hocm?PHASE_TEXT.HOCM:mode.dur>=120?PHASE_TEXT.WIDE:PHASE_TEXT.QRS}
      else if(r>=mode.dur&&r<mode.T.c-70){phase='ST';text=PHASE_TEXT.ST}
      else if(r>=mode.T.c-70&&r<mode.T.c+70){phase='T';text=PHASE_TEXT.T}}
    const beatPhase=a?now-a.t:-1e9,avPause=beatPhase>=CGRAPH.constants.TA_AVN&&beatPhase<CGRAPH.constants.TA_AVN+view.state.mode.avDelay;
    phaseNodes.forEach(el=>el.classList.toggle('on',el.dataset.phase===phase||(el.dataset.phase==='PR'&&avPause)));
    const qs=[];for(let i=engine.bsearch(context.ev.V,now);i>=0&&qs.length<2;i--)if(context.ev.V[i].qrs)qs.unshift(context.ev.V[i]);
    const hr=qs.length===2?Math.round(60000/(qs[1].t+qs[1].on-qs[0].t-qs[0].on)):'–';
    write(fields.text,text);write(fields.hr,hr);
    write(fields.pr,v?.qrs&&v?.from?.p?Math.round(v.t+v.on-v.from.t-12):'–');write(fields.qrs,v?.qrs?mode?.dur??'–':'–');
    write(fields.clock,(view.state.playing?Math.floor(ms/50)*50:ms).toFixed(0)+' ms');write(fields.play,view.state.playing?'Pause':'Play');
    fields.play.setAttribute('aria-pressed',!view.state.playing);
    root.querySelectorAll('[data-speed]').forEach(el=>el.setAttribute('aria-pressed',+el.dataset.speed===view.state.speed));
    if(root.dataset.phase!==phase)root.dataset.phase=phase;
  }
  root.querySelector('.bConPlay').onclick=()=>view.playback({playing:!view.state.playing});
  root.querySelectorAll('[data-speed]').forEach(el=>el.onclick=()=>view.playback({speed:+el.dataset.speed}));
  root.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>{view.playback({playing:false});view.seek(view.state.ms+ +el.dataset.step)});
  return {draw};
}
window.CONDUCTION_VIEW={create,strip};
})();
