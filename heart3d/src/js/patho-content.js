/* ===== PATHOLOGY SIMULATOR CONTENT: extra conditions, 3D cues, valve notes ===== */
const SIMC=(()=>{
const EXTRA={
 peri:{name:"Acute pericarditis",rh:{type:"sinus",rate:98},lead:"II",block:[],peri:true,hl:["I","II","aVL","aVF","V2","V3","V4","V5","V6","aVR"],
  find:["Diffuse concave ST elevation (I, II, aVL, aVF, V2–V6), not confined to one coronary territory","PR depression in II and the precordial leads; PR elevation with ST depression in aVR","No reciprocal ST depression except aVR (± V1); no Q waves","Sinus tachycardia is common"],
  mech:"Inflammation of the epicardium injures a thin rim of superficial myocardium everywhere at once. The injury current points toward the whole ventricular mass (toward the apex), so ST rises in almost every lead and falls only in aVR. Atrial epicardial injury shifts atrial repolarisation (Ta), which pulls the PR segment down.",
  mgmt:"NSAID (e.g. ibuprofen) or high-dose aspirin plus colchicine for 3 months; restrict exercise. Look for high-risk features (fever > 38 °C, large effusion, tamponade, troponin rise, immunosuppression, anticoagulation). Avoid steroids early (more recurrence).",
  mean:"Diffuse ST elevation + PR depression without reciprocity = pericarditis. Regional ST elevation with reciprocal depression = STEMI until proven otherwise.",
  see:"The red, pulsing shell is the inflamed pericardium. Sparks mark the friction rub. The activation wave is normal: the problem is on the surface, not in the conduction system."},
 tamp:{name:"Cardiac tamponade",rh:{type:"sinus",rate:118},lead:"II",block:[],tamp:true,hl:["II","V2","V3","V4"],
  find:["Sinus tachycardia","Low QRS voltage (limb leads < 5 mm, precordial < 10 mm)","Electrical alternans: QRS height alternates beat to beat","± diffuse ST elevation / PR depression if pericarditis is the cause"],
  mech:"Fluid in a stiff pericardial sac raises pressure around the heart. The chambers can only fill when that pressure is overcome, so stroke volume falls and the heart rate rises to compensate. Fluid insulates the electrical signal (low voltage), and the heart swings back and forth inside the effusion, so its electrical axis changes every other beat (alternans).",
  mgmt:"Emergency pericardiocentesis (echo-guided) or surgical drainage. Give IV fluid as a bridge; avoid diuretics, vasodilators and positive-pressure ventilation where possible.",
  mean:"Beck's triad (hypotension, raised JVP, muffled heart sounds) + pulsus paradoxus + alternans. Echo shows RA/RV diastolic collapse.",
  see:"The yellow layer is the effusion. Watch the heart swing side to side on alternate beats, which is exactly what electrical alternans records. Contraction is small because filling is restricted."},
 hocm:{name:"Hypertrophic obstructive cardiomyopathy",rh:{type:"sinus",rate:72,vmode:"hocm"},lead:"V5",block:[],hl:["I","aVL","V4","V5","V6","II","III","aVF"],
  find:["LVH voltage (tall R in V5–V6, deep S in V1–V2)","Deep, narrow 'dagger' Q waves in I, aVL, V5–V6 and the inferior leads (septal hypertrophy)","Lateral T-wave inversion / strain pattern","Often left atrial enlargement"],
  mech:"A sarcomere gene mutation (most often MYH7 or MYBPC3) makes the septum thicken asymmetrically. In systole the narrowed outflow tract speeds blood up; the Venturi and drag forces pull the anterior mitral leaflet toward the septum (systolic anterior motion, SAM). This obstructs the LVOT and makes the mitral valve leak backward into the LA.",
  mgmt:"β-blocker or non-dihydropyridine CCB (more filling time, less contractility), then disopyramide or a cardiac myosin inhibitor (mavacamten). Septal myectomy or alcohol septal ablation for refractory obstruction. ICD by sudden-death risk score. Avoid dehydration, nitrates and pure vasodilators.",
  mean:"Anything that empties the LV more (Valsalva, standing, nitrates, dehydration) worsens the murmur; anything that fills it (squatting, leg raise, handgrip) softens it.",
  see:"Switch to the cut view: the basal septum bulges into the outflow tract. In systole the anterior mitral leaflet swings into the LVOT (SAM). Red particles show the fast, turbulent jet into the aorta and the mitral regurgitant jet back into the LA."}
};
const SEE={
 normal:"The gold wave starts at the SA node, crosses the atria (P), pauses in the AV node (PR), then flashes down the His–Purkinje system (QRS). Valves open and close in time with it in the cut view.",
 af:"Many independent wavelets wander over the atria; sparks at the pulmonary-vein openings are the triggers. Only some reach the AV node, so the ventricles fire irregularly.",
 flutter:"One large wave circles the tricuspid annulus (orange particles), counter-clockwise through the cavotricuspid isthmus. The AV node passes every second lap.",
 avb1:"Each impulse crawls through the AV node for longer before the His fires: a long PR, no dropped beats.",
 wenck:"The AV-node glow takes longer each beat, then dies halfway (red). The next impulse starts fresh.",
 mobitz2:"The AV node conducts normally every time; the impulse dies below it, in the His (red ring). PR never changes.",
 chbJ:"Atrial impulses die in the AV node. A separate junctional pacemaker fires the His on its own schedule, so P waves and QRS are dissociated.",
 chbV:"Atrial impulses cross the node but die in the His. The ventricles are activated from a slow focus in the muscle, so the wave spreads cell-to-cell and the QRS is wide.",
 rbbb:"Red right bundle: the LV and septum light first; the RV free wall lights late through slow muscle conduction.",
 lbbb:"Red left bundle: the septum is activated right-to-left from the RV, then the LV free wall lights last and slowly.",
 lafb:"Red anterior fascicle: the LV is entered inferiorly through the posterior fascicle, then activation sweeps up to the anterosuperior wall.",
 lpfb:"Red posterior fascicle: activation enters superiorly and sweeps down to the inferoposterior wall last.",
 bifasc:"Only the left posterior fascicle conducts. One more failure and the heart is in complete block.",
 wpw:"Purple particles cross the accessory pathway. Watch the lateral LV light before the septum: that early, slow muscle spread is the delta wave.",
 pvc:"Every second beat starts in the LV muscle, not the conduction system: a slow, wide wave. The next sinus impulse dies in the refractory AV node.",
 rvot:"Short runs start in the outflow tract just under the pulmonary valve and spread downward (inferior axis, LBBB-like).",
 mi:"Red particles flow down the culprit artery and stop at the clot. The grey wall beyond it has lost blood supply and no longer depolarises."
};
const VALVENOTE={
 mitral:{name:"Mitral (bicuspid) valve",note:"Two leaflets. The large anterior (aortic) leaflet is in fibrous continuity with the aortic valve, so it forms one wall of the LV outflow tract. Chordae tendineae tie both leaflets to the anterolateral and posteromedial papillary muscles, which contract in systole to stop the leaflets prolapsing. Closure gives the M1 part of S1."},
 tricuspid:{name:"Tricuspid valve",note:"Three leaflets (anterior, posterior, septal), tethered to the anterior, posterior and septal papillary muscles. The septal leaflet hinges slightly more apically than the mitral valve. The AV node sits just above its septal leaflet at the apex of Koch's triangle."},
 aortic:{name:"Aortic valve",note:"Three semilunar cusps (right coronary, left coronary, posterior/non-coronary). The coronary arteries arise from the sinuses above the right and left cusps and fill mainly in diastole. Opens in systole; its closure is A2 of the second heart sound. Auscultate at the right 2nd intercostal space."},
 pulmonary:{name:"Pulmonary valve",note:"Three semilunar cusps (anterior, left, right) at the top of the conus arteriosus (infundibulum). The pulmonary trunk is shown ghosted because it lies in front of this cut. Closure is P2; auscultate at the left 2nd intercostal space."},
 laa:{name:"Left atrial appendage (auricle)",note:"A finger-like pouch lined by pectinate muscles. Blood stagnates here in atrial fibrillation, so it is where >90% of non-valvular AF thrombi form, the target of LAA occlusion devices."},
 lvot:{name:"Left ventricular outflow tract",note:"The channel between the interventricular septum and the anterior mitral leaflet leading to the aortic valve. In HOCM the septal bulge and systolic anterior motion of the mitral leaflet narrow it."}
};
const GROUPS=[["Atria",["af","flutter"]],["AV node & His",["avb1","wenck","mobitz2","chbJ","chbV"]],["Bundle branches",["rbbb","lbbb"]],["Fascicles",["lafb","lpfb","bifasc"]],["Pre-excitation",["wpw"]],["Myocardial infarction",["miAnt","miInf","miLat","miPost","miLM"]],["Pericardium",["peri","tamp"]],["Cardiomyopathy",["hocm"]],["Ectopy",["pvc","rvot"]]];
const MIS={miAnt:["ANT","LADm","Anterior STEMI (LAD)"],miInf:["RV","RCAp","Inferior + RV STEMI (proximal RCA)"],miLat:["LAT","OM","Lateral STEMI (circumflex / OM)"],miPost:["POST","LCxd","Posterior MI (distal LCx)"],miLM:["LM","LM","Left main / diffuse ischaemia"]};
const LOOK={ANT:[.15,.1,1],RV:[-.35,-.75,.6],INF:[.05,-1,.2],LAT:[1,.15,.05],POST:[.3,-.45,-.9],LM:[.25,.3,1],ANTSEP:[.0,.1,1],APEX:[.6,-.3,.8],HILAT:[.8,.4,.4]};
const FX={normal:{view:"ext"},sinusBrady:{view:"ext"},af:{view:"ext",look:[-.3,.2,-1],flow:"pv"},flutter:{view:"int",flow:"flutterLoop"},
 avb1:{view:"int"},wenck:{view:"int"},mobitz2:{view:"int"},chbJ:{view:"int"},chbV:{view:"int"},rbbb:{view:"int"},lbbb:{view:"int"},lafb:{view:"int"},lpfb:{view:"int"},bifasc:{view:"int"},
 wpw:{view:"ext",look:[1,.25,.1],flow:"ap"},pvc:{view:"ext"},rvot:{view:"ext",look:[-.15,.35,1]},
 peri:{view:"ext",look:[.25,.1,1],shell:"peri",flow:"peri",cond:false},tamp:{view:"ext",look:[.25,.1,1],shell:"eff",swing:true,flow:"eff",cond:false},hocm:{view:"int",hocm:true,sam:true,flow:"lvot",cond:false}};
return{EXTRA,SEE,VALVENOTE,GROUPS,MIS,LOOK,FX}
})();
