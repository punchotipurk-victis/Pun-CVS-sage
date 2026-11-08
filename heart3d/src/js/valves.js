/* ===== VALVES: animated leaflets, cusps and chordae for the cut (internal) view ===== */
function HeartValves(S){
  const T=S.T,{add,sub,mul,norm,dot,cross}=H3;
  const grp=new T.Group();grp.visible=false;S.root.add(grp);
  const leafMat=new T.MeshStandardMaterial({color:0xf3e6d2,roughness:.55,metalness:0,side:T.DoubleSide,emissive:0x2a2018});
  const cuspMat=new T.MeshStandardMaterial({color:0xf6ead8,roughness:.5,side:T.DoubleSide,emissive:0x2a2018,transparent:true,opacity:.96});
  const chordMat=new T.LineBasicMaterial({color:0xfff6e6,transparent:true,opacity:.95});
  const basis=n=>{const a=Math.abs(n[1])<.9?[0,1,0]:[1,0,0],e1=norm(cross(n,a)),e2=cross(n,e1);return[e1,e2]};
  const lerp=(a,b,u)=>add(a,mul(sub(b,a),u));
  const NU=14,NV=8,parts=[],pickers=[];
  function surface(name,label,fn,mat){const g=new T.BufferGeometry(),pos=new Float32Array((NU+1)*(NV+1)*3),idx=[];
    for(let j=0;j<NV;j++)for(let i=0;i<NU;i++){const a=j*(NU+1)+i,b=a+1,c=a+NU+1,d=c+1;idx.push(a,c,b,b,c,d)}
    g.setAttribute("position",new T.BufferAttribute(pos,3));g.setIndex(idx);const m=new T.Mesh(g,mat);m.userData={valve:name,label};m.renderOrder=3;grp.add(m);
    const P={g,pos,fn,m};parts.push(P);pickers.push(m);return P}
  function evalPart(P,st){const pos=P.pos;let k=0;for(let j=0;j<=NV;j++)for(let i=0;i<=NU;i++){const p=P.fn(i/NU,j/NV,st);pos[k++]=p[0];pos[k++]=p[1];pos[k++]=p[2]}
    P.g.attributes.position.needsUpdate=true;P.g.computeVertexNormals();P.g.computeBoundingSphere()}
  /* ---------- atrioventricular valve ---------- */
  function avValve(key,C,n,R,leaflets,pms){const[e1,e2]=basis(n),out=[];
    for(const L of leaflets){const span=L.a1-L.a0;
      const fn=(u,v,st)=>{const th=(L.a0+u*span)*Math.PI/180,r=add(mul(e1,Math.cos(th)),mul(e2,Math.sin(th))),edge=Math.sin(Math.PI*u),len=L.len*(.8+.2*edge);
        const tongue=(.3+.7*edge)*(L.sc?(.86+.14*Math.abs(Math.sin(3*Math.PI*u))):1),open=add(add(C,mul(r,R*(1+.38*v*v))),mul(n,len*v*tongue));
        const cl=add(add(C,mul(r,R*(1-.96*v*Math.min(1,.4+.6*tongue)))),mul(n,-.035*Math.sin(Math.PI*v)*edge+.02*v));
        let p=lerp(open,cl,st.close);
        if(L.sam&&st.sam>0){const tgt=st.samTarget;p=lerp(p,tgt,st.sam*v*v*edge*.85)}
        return p};
      const P=surface(key,L.name,fn,leafMat);P.chords=[];
      for(const uu of [.2,.5,.8]){const pm=pms[L.pm];P.chords.push({u:uu,pm})}
      out.push(P)}
    return out}
  /* ---------- semilunar valve ---------- */
  function slValve(key,C,A,R,names){const[e1,e2]=basis(A),out=[];
    names.forEach((nm,k)=>{const a0=k*120+10;
      const fn=(u,v,st)=>{const th=(a0+u*120)*Math.PI/180,r=add(mul(e1,Math.cos(th)),mul(e2,Math.sin(th))),bel=Math.sin(Math.PI*u);
        const hinge=-.085*bel;
        const closed=add(add(C,mul(r,R*(1-.97*v))),mul(A,hinge*(1-v)+.0*v-.03*bel*Math.sin(Math.PI*v)));
        const open=add(add(C,mul(r,R*(1-.14*v*bel))),mul(A,hinge*(1-v)+.15*v));
        return lerp(closed,open,st.open)};
      out.push(surface(key,nm,fn,cuspMat))});
    return out}
  /* geometry from the heart model */
  const MC=[.285,.63,-.405],MN=norm([.037,-.862,.506]);
  const AOC=[-.088,.6,.003],AOA=norm([-.066,1,.022]);
  const aoDir=norm(sub(AOC,MC)),[me1,me2]=basis(MN),aoAng=Math.atan2(dot(aoDir,me2),dot(aoDir,me1))*180/Math.PI;
  const mitral=avValve("mitral",MC,MN,.2,[{name:"Mitral valve — anterior (aortic) leaflet",a0:aoAng-62,a1:aoAng+62,len:.3,pm:0,sam:true},
    {name:"Mitral valve — posterior (mural) leaflet",a0:aoAng+66,a1:aoAng+294,len:.2,pm:1,sc:true}],[H3.PM_AL[1],H3.PM_PM[1]]);
  const mitralChordPMs=[H3.PM_AL[1],H3.PM_PM[1]];
  const TC=[-.53,.44,.09],TN=norm([.544,-.762,.353]);const[te1,te2]=basis(TN),sd=norm(sub(H3.sR(.1),TC)),sAng=Math.atan2(dot(sd,te2),dot(sd,te1))*180/Math.PI;
  const RP=H3.RPM();
  const tric=avValve("tricuspid",TC,TN,.2,[{name:"Tricuspid valve — septal leaflet",a0:sAng-55,a1:sAng+55,len:.18,pm:2},{name:"Tricuspid valve — anterior leaflet",a0:sAng+60,a1:sAng+185,len:.25,pm:0},{name:"Tricuspid valve — posterior leaflet",a0:sAng+190,a1:sAng+300,len:.2,pm:1}],[RP[1],RP[3],RP[5]]);
  const aortic=slValve("aortic",AOC,AOA,.16,["Aortic valve — right coronary cusp","Aortic valve — left coronary cusp","Aortic valve — posterior (non-coronary) cusp"]);
  const PAC=[.035,.7,.37],PAA=norm([.38,.85,-.38]);
  const pulm=slValve("pulmonary",PAC,PAA,.17,["Pulmonary valve — anterior cusp","Pulmonary valve — left cusp","Pulmonary valve — right cusp"]);
  /* annulus rings */
  const ringMat=new T.MeshStandardMaterial({color:0xe9d2b4,roughness:.7});
  for(const[C,n,R]of[[MC,MN,.2],[TC,TN,.2],[AOC,AOA,.16],[PAC,PAA,.17]]){const r=new T.Mesh(new T.TorusGeometry(R,.012,6,40),ringMat);r.position.set(...C);r.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...n));grp.add(r)}
  /* ghost of the pulmonary trunk (lies in front of the cut) */
  const paCurve=new T.CatmullRomCurve3([[-.04,.5,.44],[.03,.7,.37],[.26,1.2,.14],[.6,1.27,-.04]].map(p=>new T.Vector3(...p)));
  const ghost=new T.Mesh(new T.TubeGeometry(paCurve,30,.2,20,false),new T.MeshStandardMaterial({color:0x6d8fd6,transparent:true,opacity:.09,depthWrite:false,side:T.DoubleSide,roughness:.4}));
  ghost.renderOrder=2;ghost.userData={valve:"pulmonary",label:"Pulmonary trunk (ghosted: it lies in front of the cut)"};grp.add(ghost);
  /* chordae */
  const chordParts=[...mitral,...tric],nCh=chordParts.length*3,chGeo=new T.BufferGeometry(),chPos=new Float32Array(nCh*2*3);
  chGeo.setAttribute("position",new T.BufferAttribute(chPos,3));const chords=new T.LineSegments(chGeo,chordMat);grp.add(chords);
  let state={close:0,open:0,sam:0,samTarget:add(H3.sL(.14),mul(H3.SEPT,-.12))};
  function update(st){Object.assign(state,st);for(const P of parts)evalPart(P,state);
    let k=0;for(const P of chordParts)for(const c of P.chords){const p=P.fn(c.u,1,state);chPos[k++]=p[0];chPos[k++]=p[1];chPos[k++]=p[2];chPos[k++]=c.pm[0];chPos[k++]=c.pm[1];chPos[k++]=c.pm[2]}
    chGeo.attributes.position.needsUpdate=true;chGeo.computeBoundingSphere()}
  update({});
  /* phase → valve state. tv = ms since QRS onset (or null) */
  function fromCycle(tv,sam){let close=0,open=0;if(tv!=null){close=tv<10?Math.max(0,tv+30)/40:tv<380?1:Math.max(0,1-(tv-380)/60);
      open=tv<55?0:tv<85?(tv-55)/30:tv<330?1:tv<370?1-(tv-330)/40:0}
    update({close:Math.max(0,Math.min(1,close)),open:Math.max(0,Math.min(1,open)),sam:sam?Math.max(0,Math.min(1,(tv==null?0:(tv>90&&tv<330?Math.min(1,(tv-90)/80):tv>=330?Math.max(0,1-(tv-330)/50):0)))):0})}
  return{grp,pickers,update,fromCycle,setVisible(v){grp.visible=v},ghost,MC,AOC,TC,PAC}
}
