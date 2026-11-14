/* T6.2-C: contract-driven conduction geometry, picking and a shared playback clock.
   Decorative Purkinje branches remain outside the timing graph; circuits come with T8.2. */
(function(){
'use strict';
function create(o){
  const {T,world,cam,host,labelLayer,beatify,clips,deform,removed,onSelect,onChange}=o;
  const cycleMs=o.cycleMs||(()=>60000/CONTENT.SC.normal.rh.rate);
  const g=CGRAPH,s=g.spec,d=s.display,group=new T.Group(),parts=[],labels=[],rings=[];
  const colour=key=>o.palette?.[key]||d.colours[key].match(/#[0-9a-f]{6}/i)[0];
  const redesign=d.redesign,phone=innerWidth<=900;
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
    uSelectedId:{value:-1},uPull:{value:0},uWidth:{value:1},uRest:{value:state.playing?0:1},uRestInk:{value:new T.Color(colour('rest'))},uNodeInk:{value:new T.Color('#FFE7A8')},uHot:{value:new T.Color(colour('wavefront'))},uAfter:{value:new T.Color(colour('justFired'))},uBlockedInk:{value:new T.Color(colour('blocked'))}};
  let fadeFrom=waveUniforms.uRest.value,fadeTo=fadeFrom,fadeStart=performance.now();
  let batch;
  // Pack interpolants into four slots. Separate scalar varyings made the
  // software rasterizer carry mostly empty vec4 slots for every vertex.
  const varyings=`varying vec3 vInk;varying vec4 vData0,vData1,vData2;
    #define vU vData0.x
    #define vTime vData0.y
    #define vSide vData0.z
    #define vRefractory vData0.w
    #define vAvNode vData1.x
    #define vBlocked vData1.y
    #define vSelected vData1.z
    #define vVisible vData1.w
    #define vAlpha vData2.x
    #define vShade vData2.y
    #define vNode vData2.z
  `;
  function material(depthFunc){
    const mat=beatify(new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:depthFunc===behind?.45:1,
      depthWrite:false,depthTest:true,depthFunc,clippingPlanes:clips}));
    const previous=mat.onBeforeCompile;
    mat.onBeforeCompile=shader=>{previous(shader);Object.assign(shader.uniforms,waveUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 aCenter,aInk;attribute vec4 aParam,aFlags;attribute vec2 aStyle;
        #define aU aParam.x
        #define aTime aParam.y
        #define aSide aParam.z
        #define aRefractory aParam.w
        #define aAvNode aFlags.x
        #define aBlocked aFlags.y
        #define aTap aFlags.z
        #define aVisible aFlags.w
        #define aAlpha aStyle.x
        #define aNode aStyle.y
        ${varyings}
        uniform float uSelectedId,uPull,uWidth;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
        vSelected=step(-.5,aTap)*(1.0-step(.1,abs(aTap-uSelectedId)));transformed=aCenter+(transformed-aCenter)*(1.0+vSelected)*uWidth;
        vAlpha=aAlpha;vNode=aNode;vData2.w=0.0;vShade=.72+.28*abs(normal.y);
        vU=aU;vTime=aTime;vSide=aSide;vRefractory=aRefractory;vAvNode=aAvNode;vBlocked=aBlocked;vInk=aInk;vVisible=aVisible;`)
        // T6.2-B: in cut views the network is drawn only where it lies on the visible cut anatomy: pulled uPull cm toward the
        // camera so subendocardial paths pass the depth test, while paths behind a whole wall stay hidden (no see-through pass).
        .replace('#include <project_vertex>',`#include <project_vertex>
        if(uPull>0.0){mvPosition.xyz+=normalize(-mvPosition.xyz)*uPull;gl_Position=projectionMatrix*mvPosition;}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#if NUM_CLIPPING_PLANES > 0\nif(vNode<.5){\n#include <clipping_planes_fragment>\n}\n#endif').replace('#include <common>',`#include <common>
        ${varyings}
        uniform float uNowA,uNowV,uPulse,uRest;uniform vec3 uHot,uAfter,uBlockedInk,uRestInk,uNodeInk;`)
        .replace('#include <color_fragment>',`#include <color_fragment>
        if(vVisible<.5)discard;if(vBlocked>.5 && mod(vU*24.0,2.0)>1.0)discard;
        float elapsed=mix(uNowA,uNowV,vSide)-vTime;
        float hot=step(0.0,elapsed)*(1.0-step(12.0,elapsed));
        float after=step(12.0,elapsed)*max(0.0,1.0-elapsed/vRefractory);
        diffuseColor.rgb=mix(mix(vInk,mix(uRestInk,uNodeInk,vNode),uRest),uBlockedInk,vBlocked);
        diffuseColor.rgb=mix(diffuseColor.rgb,uAfter,after*.75);
        diffuseColor.rgb=mix(diffuseColor.rgb,uHot,max(hot,uPulse*vAvNode));
        diffuseColor.rgb=mix(diffuseColor.rgb*vShade,vec3(1.0),vSelected*.55);diffuseColor.a*=vAlpha;`);
    };mat.customProgramCacheKey=()=> 'conduction-batched-wave-v1';mat.userData.wave=waveUniforms;return mat;
  }
  function addPart(id,geometry,centres,uu,info){
    geometry.setAttribute('aCenter',new T.Float32BufferAttribute(centres,3));geometry.setAttribute('aU',new T.Float32BufferAttribute(uu,1));
    const ink=colour(id==='avn_slow'?'slowPathway':id==='ap'?'accessory':'idle');
    const part={id,geometry,colour:ink,...info};parts.push(part);return part;
  }
  function buildBatch(){
    const count=parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0),geometry=new T.BufferGeometry(),arrays={};
    const fields={position:3,normal:3,aCenter:3,aU:1,aTime:1,aSide:1,aRefractory:1,aAvNode:1,aBlocked:1,aTap:1,aVisible:1,aInk:3,aAlpha:1,aNode:1,aParam:4,aFlags:4,aStyle:2};
    for(const [key,width] of Object.entries(fields))arrays[key]=new Float32Array(count*width);
    const indices=[],glowIndices=[];let offset=0;
    for(const p of parts){p.offset=offset;p.count=p.geometry.attributes.position.count;
      for(const key of ['position','normal','aCenter','aU'])arrays[key].set(p.geometry.attributes[key].array,offset*fields[key]);
      for(const index of p.geometry.index.array)indices.push(index+offset);
      // A soft 15% halo does not need the core tube's sampling density.
      // Reuse every second ring and radial vertex; retain the full core radii.
      if(p.curve&&!p.illustrative){const n=p.geometry.parameters.tubularSegments,r=p.geometry.parameters.radialSegments,stride=r+1;
        for(let j=0;j<n;j+=2)for(let k=0;k<r;k+=2){const a=j*stride+k,b=Math.min(n,j+2)*stride+k,c=j*stride+(k+2)%r,e=Math.min(n,j+2)*stride+(k+2)%r;glowIndices.push(a+offset,b+offset,c+offset,b+offset,e+offset,c+offset)}
      }else if(p.nodeId)for(const i of p.geometry.index.array)glowIndices.push(i+offset);
      const ink=new T.Color(p.colour).toArray();
      for(let i=offset;i<offset+p.count;i++){arrays.aInk.set(ink,i*3);arrays.aTap[i]=p.illustrative?-2:tapIds.indexOf(p.id);arrays.aAvNode[i]=p.nodeId==='AVN'?1:0;arrays.aAlpha[i]=p.alpha??1;arrays.aNode[i]=['SA','AVN'].includes(p.nodeId)?1:0;
        arrays.aFlags[i*4+2]=arrays.aTap[i];arrays.aStyle[i*2]=arrays.aAlpha[i];arrays.aStyle[i*2+1]=arrays.aNode[i];}
      offset+=p.count;
    }
    for(const [key,width] of Object.entries(fields))geometry.setAttribute(key,new T.BufferAttribute(arrays[key],width));
    geometry.setIndex(indices);geometry.computeBoundingSphere();
    const pair=[behind,front].map((depth,i)=>{const mesh=new T.Mesh(geometry,material(depth));mesh.renderOrder=10+i;group.add(mesh);return mesh});
    for(const p of parts)p.pair=pair;
    // One batched halo, shared geometry; no postprocessing or per-branch draws.
    const glowMat=material(front);glowMat.opacity=.15;glowMat.blending=T.AdditiveBlending;
    const baseCompile=glowMat.onBeforeCompile;
    glowMat.onBeforeCompile=shader=>{baseCompile(shader);shader.vertexShader=shader.vertexShader.replace('*uWidth;','*uWidth*1.6;')};
    glowMat.customProgramCacheKey=()=> 'conduction-halo-v2';
    const glowGeometry=new T.BufferGeometry();for(const [key,attr] of Object.entries(geometry.attributes))glowGeometry.setAttribute(key,attr);glowGeometry.setIndex(glowIndices);glowGeometry.boundingSphere=geometry.boundingSphere;
    const glow=new T.Mesh(glowGeometry,glowMat);glow.renderOrder=12;group.add(glow);
    batch={geometry,arrays,pair,glow};
  }
  function refreshTiming(){
    const {arrays,geometry}=batch;
    for(const p of parts){const edge=p.edge,isA=p.illustrative?false:edge?edge.side==='A':p.nodeId?g.nodes[p.nodeId].side==='A':true;
      const times=isA?timing.a:timing.v;let ta=p.terminalId?times[p.terminalId]:p.nodeId?times[p.nodeId]:edge?times[edge.a]:timing.a.SA;
      let tb=p.terminalId||p.nodeId?ta:edge?times[edge.b]:1e9;
      const blocked=!!(edge&&(timing.blocked.has(edge.struct)||timing.blocked.has(edge.id)||timing.blocked.has('*')));
      if(edge?.side==='AP'){ta=timing.a.AP_A;tb=g.constants.TA_AVN+state.mode.avDelay+22-g.constants.WPW_LEAD}
      // atrialTimes retains the legacy zero-delay HIS alias; this display bridge
      // ends only after the AV delay, so it cannot fire backwards from that alias.
      if(edge?.T_ms==='avDelay')tb=ta+state.mode.avDelay;
      if(state.mode.atrial==='avnOnly'&&edge?.side==='A'&&edge.kind!=='avn')ta=tb=1e9;
      if(blocked)ta=tb=1e9;
      ta=Number.isFinite(ta)?ta:1e9;tb=Number.isFinite(tb)?tb:1e9;
      const travel=edge?g.edgeDuration(edge,state.mode.avDelay)||0:p.nodeId||p.terminalId?0:1;
      const visible=isVisible(p);
      for(let i=p.offset;i<p.offset+p.count;i++){
        const u=arrays.aU[i];arrays.aTime[i]=Math.min(ta+u*travel,tb+(1-u)*travel);
        arrays.aSide[i]=isA||edge?.side==='AP'?0:1;arrays.aRefractory[i]=isA?s.timing.refractory_ms.atrial:s.timing.refractory_ms.ventricular;
        arrays.aBlocked[i]=blocked?1:0;arrays.aVisible[i]=visible?1:0;
        arrays.aParam.set([u,arrays.aTime[i],arrays.aSide[i],arrays.aRefractory[i]],i*4);
        arrays.aFlags[i*4]=arrays.aAvNode[i];arrays.aFlags[i*4+1]=arrays.aBlocked[i];arrays.aFlags[i*4+3]=arrays.aVisible[i];
      }
    }
    for(const key of ['aTime','aSide','aRefractory','aBlocked','aVisible','aParam','aFlags'])geometry.attributes[key].needsUpdate=true;
  }
  function tube(edge,curve,radii,id=edge.tap,info={}){
    const [rA,rB]=Array.isArray(radii)?radii:[radii,radii],radius=Math.max(rA,rB);
    // Thin decorative fibres need fewer faces than the tappable main tubes.
    // Keep visibility samples dense independently of the rendered mesh.
    const length=curve.getLength(),segments=Math.max(2,Math.ceil(length/(info.illustrative?.45:.30))),radial=info.illustrative?4:phone?8:12;
    const geometry=new T.TubeGeometry(curve,segments,1,radial,false),centres=[],uu=[];
    let saFraction=.5;
    if(!edge&&id==='sa'){let distance=Infinity;for(let i=0;i<=200;i++){const u=i/200,d=curve.getPointAt(u).distanceToSquared(vector(g.nodes.SA.p));if(d<distance){distance=d;saFraction=u}}}
    for(let i=0;i<geometry.attributes.position.count;i++){
      const u=Math.floor(i/(radial+1))/segments,p=curve.getPointAt(u),P=geometry.attributes.position;
      const r=T.MathUtils.lerp(rA,rB,u);P.setXYZ(i,p.x+(P.getX(i)-p.x)*r,p.y+(P.getY(i)-p.y)*r,p.z+(P.getZ(i)-p.z)*r);centres.push(p.x,p.y,p.z);
      uu.push(edge||info.illustrative?u:u<=saFraction?8*(saFraction-u)/saFraction:10*(u-saFraction)/(1-saFraction));
    }
    geometry.computeVertexNormals();
    return addPart(id,geometry,centres,uu,{edge,curve,radius,radii:[rA,rB],
      samples:curve.getSpacedPoints(info.illustrative?Math.max(segments*2,Math.ceil(length/.15)):segments*2),anchor:curve.getPointAt(.5),...info});
  }
  const displayEdges=g.edges.filter(e=>e.kind!=='sa');
  const chains=new Map();
  for(const e of displayEdges){const key=e.tap+':'+e.kind;if(!chains.has(key))chains.set(key,[]);chains.get(key).push(e)}
  const continuous=[];
  for(const edges of chains.values()){
    const incoming=id=>edges.filter(e=>e.b===id),outgoing=id=>edges.filter(e=>e.a===id),used=new Set();
    const walk=first=>{const chain=[];let edge=first;while(edge&&!used.has(edge)){used.add(edge);chain.push(edge);edge=incoming(edge.b).length===1&&outgoing(edge.b).length===1?outgoing(edge.b)[0]:null}if(chain.length)continuous.push(chain)};
    for(const edge of edges)if(incoming(edge.a).length!==1||outgoing(edge.a).length!==1)walk(edge);
    for(const edge of edges)walk(edge);
  }
  for(const edges of continuous){
    const first=edges[0],profile=first.tap==='rbb'?[.12,.10]:first.id==='AVN-HIS'?[.24,.20]:redesign.tubes.radiusCm[first.kind]||[.1,.08];
    const curves=edges.map(e=>new T.CatmullRomCurve3(e.points.map(vector),false,'centripetal'));
    const lengths=curves.map(c=>c.getLength()),total=lengths.reduce((a,b)=>a+b,0);let travelled=0;
    edges.forEach((edge,i)=>{
      const radii=[travelled/total,(travelled+lengths[i])/total].map(u=>T.MathUtils.lerp(...profile,u));
      tube(edge,curves[i],radii);travelled+=lengths[i];
      for(const [u,id,r] of [[0,edge.a,radii[0]],[1,edge.b,radii[1]]]){
        const degree=displayEdges.filter(e=>e.a===id||e.b===id).length;
        if(degree===1)cap(edge,curves[i].getPointAt(u),r,u,curves[i].getTangentAt(u).multiplyScalar(u===0?-1:1));
      }
    });
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
    const samples=[centre];
    addPart(id,geometry,centres,new Float32Array(n),{nodeId,radius:radii[0],anchor:centre,samples,picker,alpha:['SA','AVN'].includes(nodeId)?1:0});
  }
  function cap(edge,p,r,u,tangent){const geometry=new T.SphereGeometry(r,phone?8:12,6,0,Math.PI*2,0,Math.PI/2).applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),tangent)).translate(...p.toArray()),n=geometry.attributes.position.count;
    addPart(edge.tap,geometry,Array.from({length:n},()=>p.toArray()).flat(),new Float32Array(n).fill(u),{edge,radius:r,anchor:p,samples:[p],cap:true});}
  node('SA',[.45,.24,.22],'sa');node('AVN',[.24,.24,.24],'avn');node('HIS',[.16,.16,.16],'his');node('BIF',[.14,.14,.14],'his');
  // Align the SA bulge with the exported crista axis, with its epicardial proudness.
  const sa=parts.find(p=>p.nodeId==='SA'),saAt=vector(g.nodes.SA.p),saAxis=vector(g.nodes.SA_T.p).sub(vector(g.nodes.SA_H.p)).normalize();
  const saRotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(1,0,0),saAxis);
  sa.geometry.translate(...saAt.clone().negate().toArray()).applyQuaternion(saRotation).translate(...saAt.toArray());
  if(o.epicardium){const P=o.epicardium.attributes.position,N=o.epicardium.attributes.normal;let closest=0,dd=Infinity;
    for(let i=0;i<P.count;i++){const distance=new T.Vector3().fromBufferAttribute(P,i).distanceToSquared(saAt);if(distance<dd){dd=distance;closest=i}}
    sa.geometry.translate(...new T.Vector3().fromBufferAttribute(N,closest).multiplyScalar(.22*.2).toArray());}
  function buildFan(){
    const fascicles=redesign.lbbFan.fascicles.map(id=>parts.find(p=>p.edge?.tap===id&&p.curve)).filter(Boolean);
    for(let k=0;k<fascicles.length-1;k++){
      const a=fascicles[k],b=fascicles[k+1],pos=[],centres=[],uu=[],idx=[];
      for(let j=0;j<=16;j++)for(const p of [a,b]){const u=j/16,q=p.curve.getPointAt(u);pos.push(...q.toArray());centres.push(...q.toArray());uu.push(u)}
      for(let j=0;j<16;j++){const i=j*2;idx.push(i,i+1,i+2,i+1,i+3,i+2)}
      // Give only the flat ribbon a reverse face; making the whole transparent
      // batch DoubleSide would add back/front passes for every tube and halo.
      for(const [a,b,c] of Array.from({length:idx.length/3},(_,i)=>idx.slice(i*3,i*3+3)))idx.push(c,b,a);
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(pos,3));geometry.setIndex(idx);geometry.computeVertexNormals();
      const samples=[];for(let j=3;j<=13;j++){const u=j/16;samples.push(a.curve.getPointAt(u).lerp(b.curve.getPointAt(u),.5))}
      addPart('lbb',geometry,centres,uu,{edge:a.edge,anchor:vector(g.nodes.LB1.p),samples,radius:redesign.tubes.radiusCm.fasc[0],alpha:.35,ribbon:true});
    }
  }
  function buildTree(emit=tube){
    const surface=o.endocardium;if(!surface)return;
    const {geometry,names}=surface,P=geometry.attributes.position,N=geometry.attributes.normal,C=geometry.attributes.aCavity,L=geometry.attributes.aLabel;
    let seed=0x62c2026;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
    const pools={LV:[],RV:[]};
    for(let i=0;i<P.count;i++){
      const cavity=names[C.getX(i)],label=names[L.getX(i)],side=cavity==='LV_cavity'?'LV':cavity==='RV_cavity'?'RV':null;
      if(!side||!s.regions.ventricularMuscle.labels.includes(label)||side==='LV'&&P.getZ(i)<1.8&&label!=='IVS'||side==='RV'&&P.getZ(i)<1.5)continue;
      pools[side].push({p:new T.Vector3().fromBufferAttribute(P,i),n:new T.Vector3().fromBufferAttribute(N,i),label,index:i});
    }
    const terminals=Object.entries(g.nodes).filter(([,n])=>n.purkinje);
    const adjacency=new Map(),index=geometry.index.array;
    for(let j=0;j<index.length;j+=3)for(let k=0;k<3;k++){const i=index[j+k];if(!adjacency.has(i))adjacency.set(i,[]);adjacency.get(i).push(j)}
    const snap=(p,pool)=>{
      let nearest,dd=Infinity;for(const q of pool){const d=q.p.distanceToSquared(p);if(d<dd){dd=d;nearest=q}}
      const allowed=pool.allowed||(pool.allowed=new Set(pool.map(q=>q.index)));let best=nearest.p.clone(),normal=nearest.n.clone();dd=Infinity;
      for(const j of adjacency.get(nearest.index)||[]){const ids=[index[j],index[j+1],index[j+2]];if(!ids.every(i=>allowed.has(i)))continue;
        const vertices=ids.map(i=>new T.Vector3().fromBufferAttribute(P,i)),triangle=new T.Triangle(...vertices),q=triangle.closestPointToPoint(p,new T.Vector3()),d=q.distanceToSquared(p);
        if(d<dd){dd=d;best=q;const bary=triangle.getBarycoord(q,new T.Vector3());normal=new T.Vector3();ids.forEach((id,k)=>normal.addScaledVector(new T.Vector3().fromBufferAttribute(N,id),bary.getComponent(k)));if(normal.dot(nearest.n)<0)normal.negate()}}
      return {p:best,n:normal.normalize(),index:nearest.index};
    };
    for(const side of ['LV','RV']){
      const pool=pools[side],limit=Math.round((side==='LV'?120:60)*(phone?.4:1));if(!pool.length)continue;
      const own=terminals.filter(([id])=>(/^(RB|MOD)/.test(id)?'RV':'LV')===side);
      const roots=own.map(([id,n])=>({p:vector(n.p),terminalId:id}));
      if(side==='LV')for(const p of parts.filter(p=>p.edge?.kind==='fasc'&&p.curve))for(const u of [.5,.8])roots.push({p:p.curve.getPointAt(u),terminalId:own.reduce((a,b)=>vector(a[1].p).distanceToSquared(p.curve.getPointAt(u))<vector(b[1].p).distanceToSquared(p.curve.getPointAt(u))?a:b)[0]});
      let count=0;
      function branch(start,direction,level,terminalId){
        if(level===3||count>=limit)return;
        for(let k=0,n=2+(random()>.55?1:0);k<n&&count<limit;k++){
          const q=snap(start,pool),normal=q.n.clone().normalize(),angle=(25+15*random())*Math.PI/180*(k%2?1:-1);
          let dir=direction.clone().addScaledVector(normal,-direction.dot(normal));if(dir.lengthSq()<.01)dir.set(1,0,-.5);
          dir.normalize().applyAxisAngle(normal,angle);const length=[.8,.5,.3][level],points=[],surfaceIndices=[],depth=.08+.04*random();
          const surfaces=[];
          for(let j=0;j<=8;j++){const target=start.clone().addScaledVector(dir,length*j/8),hit=snap(target,pool);points.push(j===0?start.clone():hit.p.clone().addScaledVector(hit.n,-depth));surfaceIndices.push(hit.index);surfaces.push(hit.p.toArray())}
          if(points[0].distanceTo(points[8])<.1)continue;
          for(let pass=0;pass<3;pass++)for(let j=1;j<8;j++){const q=points[j-1].clone().add(points[j+1]).multiplyScalar(.5),hit=snap(q,pool);points[j].copy(hit.p).addScaledVector(hit.n,-depth);surfaces[j]=hit.p.toArray()}
          const curve=new T.CatmullRomCurve3(points,false,'centripetal');
          const nearest=own.reduce((a,b)=>vector(a[1].p).distanceToSquared(points[4])<vector(b[1].p).distanceToSquared(points[4])?a:b)[0];
          emit(null,curve,redesign.purkinjeTree.radiusCm,'purk',{illustrative:true,terminalId:nearest,rootTerminal:terminalId,ventricle:side,depthCm:depth,surfaceIndices,surfacePoints:surfaces,controlPoints:points.map(p=>p.toArray()),seed:false,tappable:false});count++;
          branch(points[8],dir,level+1,terminalId);
        }
      }
      for(const root of roots)branch(root.p,new T.Vector3(random()-.5,random()-.5,-1),0,root.terminalId);
    }
  }
  buildFan();buildTree();
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
  function isVisible(part){
    if(o.cutMode?.()&&['SA','AVN'].includes(part.nodeId)){const P=part.geometry.attributes.position;let kept=false;for(let i=0;i<P.count&&!kept;i++)kept=!removed(project(new T.Vector3().fromBufferAttribute(P,i)).w);if(!kept)return false}
    if(part.illustrative&&o.cutMode?.()&&!part.samples.every(p=>!removed(project(p).w)&&o.keptTissue?.(project(p).w)))return false;
    return !o.partHidden?.(part.id)&&!part.edge?.circuitOnly&&(part.edge?.kind!=='ap'||!!s.modes.ventricular[state.mode.ventricular].ap)
  }
  function update(ms,wall=performance.now()){
    state.ms=ms;const rr=cycleMs(),phase=((ms%rr)+rr)%rr;
    const clocks=o.clocks?o.clocks(ms):{a:phase,v:phase-g.constants.TA_AVN-state.mode.avDelay};
    waveUniforms.uNowA.value=clocks.a;waveUniforms.uNowV.value=clocks.v;
    waveUniforms.uSelectedId.value=tapIds.indexOf(state.selected);
    const cut=!!(o.cutMode?.()??o.cutView?.());waveUniforms.uPull.value=cut?(d.cutPullCm??.45):0;waveUniforms.uWidth.value=cut?.8:1;
    waveUniforms.uRest.value=T.MathUtils.lerp(fadeFrom,fadeTo,Math.min(1,Math.max(0,(wall-fadeStart)/300)));
    if(batch){const external=!!o.externalMode?.();
      // External explicitly overlays the wiring on its translucent shell: one
      // core pass suffices. Only See-through needs front/behind classification.
      batch.pair[0].visible=!cut&&!external;batch.pair[1].material.depthTest=!external;
      batch.glow.visible=!cut;batch.glow.material.depthTest=!external;
    }
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
  let pickCacheKey='',pickCache=new Map();
  function pick(x,y,ray){
    const rect=host.getBoundingClientRect();
    const key=[rect.left,rect.top,rect.width,rect.height].join(',')+'|'+cam.matrixWorld.elements.join(',')+'|'+cam.projectionMatrix.elements.join(',')+'|'+state.ms+'|'+deform(vector(g.nodes.AVN.p)).toArray().join(',')+'|'+clips.map(p=>p.constant).join(',');
    if(key!==pickCacheKey){pickCacheKey=key;pickCache.clear()}
    if(!state.enabled)return null;const hits=[];
    for(const p of parts){if(p.illustrative||p.cap||!isVisible(p))continue;let px=Infinity,hit3d=false,point=null;
      if(!pickCache.has(p))pickCache.set(p,p.samples.map(sample=>project(sample)).filter(q=>q.z>=-1&&q.z<=1&&!removed(q.w)));
      for(const q of pickCache.get(p)){
        const distance=Math.hypot(q.x-x,q.y-y);if(distance<px){px=distance;point=q.w}
        if(ray.distanceToPoint(q.w)<(p.nodeId?(['SA','AVN'].includes(p.nodeId)?.45:.35):Math.max(.35,2.5*p.radius)))hit3d=true;
      }
      if(point&&Number.isFinite(px))px=Math.max(0,px-(p.radius||0)*cam.projectionMatrix.elements[5]*rect.height/(2*point.distanceTo(cam.position)));
      // The visible AV bead owns its projected footprint, including when its
      // centre is just behind the cut plane but its round surface is exposed.
      if(p.nodeId==='AVN'){
        const c=project(p.anchor),r=host.getBoundingClientRect(),radiusPx=p.radius*cam.projectionMatrix.elements[5]*r.height/(2*c.w.distanceTo(cam.position));
        px=Math.max(0,Math.hypot(c.x-x,c.y-y)-radiusPx);hit3d=px===0;point=c.w;
      }
      const rank=p.nodeId==='AVN'?(px===0?-2:0):p.id==='his'?-1:p.nodeId==='SA'?0:p.id==='avn'?2:priority(p.id);
      if(hit3d||px<=d.pick.minScreenPx)hits.push({id:p.id,px,hit3d,point,priority:rank});
    }
    if(!hits.length)return null;
    // A directly targeted centre stays selectable in the tightly packed His/LBB region;
    // contract priority resolves equally close hits and the wider finger fallback.
    const direct=hits.filter(h=>h.px<=3),pool=direct.length?direct:hits;
    pool.sort((a,b)=>Math.abs(a.px-b.px)>1?a.px-b.px:a.priority-b.priority||a.px-b.px||a.id.localeCompare(b.id));return pool[0];
  }
  function select(id){if(!(id in d.shortNames))return false;state.selected=id;update(state.ms);onSelect(id);onChange?.();return true;}
  function enable(on){state.enabled=!!on;group.visible=state.enabled;update(state.ms);placeLabels();onChange?.()}
  function seek(ms){if(!Number.isFinite(ms))throw new TypeError('Seek requires milliseconds');anchor(ms);update(state.ms);onChange?.();return state.ms}
  function advance(){const ms=current();state.ms=ms%(cycleMs()*120);if(ms>=cycleMs()*120)anchor(state.ms);return state.ms}
  function playback({playing=state.playing,speed=state.speed}={}){if(![1,.25,.1].includes(speed))throw new Error('Invalid speed');anchor();update(state.ms);
    if(!!playing!==state.playing){fadeFrom=waveUniforms.uRest.value;fadeTo=playing?0:1;fadeStart=performance.now()}
    state.playing=!!playing;state.speed=speed;onChange?.();
    // Paused viewers still render the complete fade, then return to idle.
    if(!playing){const tick=()=>{update(state.ms);onChange?.();if(performance.now()-fadeStart<300)requestAnimationFrame(tick)};requestAnimationFrame(tick)}
  }
  function visibility(active){if(suspended===!active)return;anchor();suspended=!active;onChange?.()}
  const clockState=()=>({ms:anchorMs,wall:anchorWall,rate:state.speed,running:state.playing&&!suspended});
  function midpoint(id,rest=false){const l=labels.find(l=>l.id===id);if(!l)return null;const p=project(l.part.anchor,!rest);return {x:p.x,y:p.y,visible:state.enabled&&isVisible(l.part)&&!removed(p.w),point:l.part.anchor.toArray()};}
  setMode({});
  return {state,group,parts,labels,rings,enable,update,refreshVisibility:()=>{if(batch&&timing)refreshTiming()},placeLabels,pick,select,seek,advance,playback,setMode,midpoint,cycleMs,visibility,clockState,now:()=>current()%(cycleMs()*120),
    fadeState:()=>({from:fadeFrom,to:fadeTo,start:fadeStart,durationMs:300}),
    treeRecipe(){const out=[];buildTree((edge,curve,radii,id,info)=>out.push(info));return out},
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
