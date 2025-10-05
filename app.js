// ===========================================================
// CAE Results Viewer (Three.js r160 + ES Modules)
// - カメラ：計算モデルのみを基準に画面占有率 70% を維持（Sun/Earth に依存しない）
// - 素材/厚み/モード変更時、カメラの拡大縮小・アングルを保持
// - Sun/Earth は UI 撤去。固定初期値で配置（Sun: 0,0,191176 / 10.4, Earth: 0,0,-6980 / 10）
// - 地球の自転なし + 「地球がわずかに自発光」 + 「現在角度からヨー +90°」を一度だけ適用
// - Eclipse モード時、地球側からのフィルライトを自動点灯
// - 既存機能（i18n / results.json / colormap 404抑止 / プリロード / ローディング / 環境ON/OFF・ロック / Fキー）維持
// ===========================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------- 環境GLB探索候補 ---------- */
const ENV_URLS = {
  Sun:   ['assets/env/Sun.glb','Sun.glb','Sun_1_1391000.glb','Sun_1_1391000 (1).glb','assets/env/sun.glb'],
  Earth: ['assets/env/Earth.glb','Earth.glb','Earth_1_12756.glb','assets/env/earth.glb']
};

/* ---------- i18n（要素が無ければスキップ） ---------- */
const I18N = {
  JP: { mode:'モード', lang:'言語', material:'素材', thickness:'厚み (mm)',
    kpi:{ mass:'質量', tmax:'Tmax', tmin:'Tmin', dt:'ΔT', disp:'変位U' },
    envTitle:'環境条件',
    env:{ solar:'太陽定数 (W/m²)', albedo_ratio:'地球アルベド比率 (–)', albedo_flux:'アルベド入射強度 (W/m²)', earth_ir:'地球赤外線放射 (W/m²)', sinkT:'宇宙シンク温度 (K)' },
    propsTitle:'物性値',
    labels:{ alpha:'吸収率 α (-)', epsilon:'放射率 ε (-)', rho:'密度 ρ (g/cm³)', E:'ヤング率 E (GPa)', nu:'ポアソン比 ν (–)', cte:'線膨張係数 α (×10⁻⁶/K)', T0:'基準温度 T₀ (°C)', k:'熱伝導率 k (W/m·K)', cp:'比熱 cₚ (J/kg·K)' },
    figureTitle:'シミュレーション環境', figureCaptionHTML:'S: 太陽放射, Salb: アルベド入射,<br>qIR: 地球赤外, Ts: 宇宙シンク温度',
    title:'NASA Open Data × CAE for CubeSat', envObjTitle:'環境オブジェクト', envShowLbl:'太陽・地球を表示', envLockLbl:'モデルの回転に同期' },
  EN: { mode:'Mode', lang:'Lang', material:'Material', thickness:'Thickness (mm)',
    kpi:{ mass:'Mass', tmax:'Tmax', tmin:'Tmin', dt:'ΔT', disp:'Disp. U' },
    envTitle:'Environment',
    env:{ solar:'Solar constant (W/m²)', albedo_ratio:'Earth albedo ratio (–)', albedo_flux:'Albedo flux (W/m²)', earth_ir:'Earth IR flux (W/m²)', sinkT:'Deep space sink T (K)' },
    propsTitle:'Material Properties',
    labels:{ alpha:'Absorptivity α (-)', epsilon:'Emissivity ε (-)', rho:'Density ρ (g/cm³)', E:"Young's E (GPa)", nu:'Poisson ν (–)', cte:'CTE α (×10⁻⁶/K)', T0:'Reference T₀ (°C)', k:'Thermal k (W/m·K)', cp:'Specific cₚ (J/kg·K)' },
    figureTitle:'Simulation Environment', figureCaption:'S: Solar flux, Salb: Albedo flux, qIR: Earth IR, Ts: Deep space sink temperature',
    title:'NASA Open Data × CAE for CubeSat', envObjTitle:'Environment Objects', envShowLbl:'Show Sun & Earth', envLockLbl:'Sync to model rotation' }
};
let currentLang = 'EN';
function setText(id, text){ const el=document.getElementById(id); if(el) el.textContent = text; }
function applyLang(lang){
  currentLang = lang; const t = I18N[lang] || I18N.EN;
  setText('label-mode', t.mode);
  setText('label-lang', t.lang);
  setText('label-material', t.material);
  setText('label-thickness', t.thickness);
  setText('massTitle', t.kpi.mass);
  setText('tmaxTitle', t.kpi.tmax);
  setText('tminTitle', t.kpi.tmin);
  setText('dtTitle', t.kpi.dt);
  setText('dispTitle', t.kpi.disp);
  setText('appTitle', t.title);
  setText('envTitle', t.envTitle);
  setText('lbl-solar', t.env.solar);
  setText('lbl-albR', t.env.albedo_ratio);
  setText('lbl-albF', t.env.albedo_flux);
  setText('lbl-earthIR', t.env.earth_ir);
  setText('lbl-sinkT', t.env.sinkT);
  setText('propsTitle', t.propsTitle);
  const capEl=document.getElementById('figureCaption');
  if(capEl){ if(t.figureCaptionHTML){ capEl.innerHTML=t.figureCaptionHTML; } else { capEl.textContent=t.figureCaption||''; } }
  setText('envObjTitle', t.envObjTitle);
  setText('envShowLbl', t.envShowLbl);
  setText('envLockLbl', t.envLockLbl);
  try{ localStorage.setItem('lang', lang); }catch{}
  renderEnvironment(); renderMaterialProps(document.getElementById('material')?.value);
}

/* ---------- results.json（存在しなければデフォルト） ---------- */
const DEFAULT_ENV = { solar_W_m2:1361, albedo_ratio:0.3, albedo_flux_W_m2:408.3, earth_ir_W_m2:241, sinkT_K:3 };
const EMBEDDED_RESULTS = { "_env": DEFAULT_ENV };
const DEFAULT_PROPS = {};
let results = {};

async function loadResults(){
  try{
    const res = await fetch('results.json', { cache:'no-cache' });
    if(res.ok){ const j=await res.json(); if(j && Object.keys(j).length) results=j; }
  }catch{}
  if(!results || !Object.keys(results).length) results=EMBEDDED_RESULTS;

  const matSel = document.getElementById('material');
  if(!matSel) return; // 最小HTMLでは無し
  const mats = Object.keys(results).filter(k=>k!=='_env');
  matSel.innerHTML = mats.map(m=>`<option value="${m}">${m}</option>`).join('');
  if(!matSel.value && mats.length) matSel.value=mats[0];
  updateThicknessOptions();
}
function getEnv(){ return results?._env || DEFAULT_ENV; }
function getProps(material){
  const m=results?.[material];
  const p=m && typeof m._props==='object' ? m._props : null;
  return p || DEFAULT_PROPS[material] || null;
}

/* ---------- 厚みセレクタ（最小HTMLではスキップ） ---------- */
function updateThicknessOptions(){
  const mat=document.getElementById('material')?.value;
  const thSel=document.getElementById('thickness');
  if(!thSel || !mat || !results[mat]){ if(thSel){ thSel.innerHTML=''; thSel.disabled=true; } return; }
  const prev=thSel.value;
  const ths=Object.keys(results[mat]).filter(k=>k!=='_props').sort((a,b)=>Number(a)-Number(b));
  thSel.innerHTML=ths.map(t=>`<option value="${t}">${t}</option>`).join('');
  thSel.disabled=ths.length===0;
  if(prev && ths.includes(prev)) thSel.value=prev; else if(ths.length) thSel.value=ths[0];
  renderMaterialProps(mat);
}

/* ---------- three.js 基本 ---------- */
let scene, camera, renderer, controls, loader;
let frameGroup, modelGroup, envGroup;
let currentModel;

const MODEL_OCCUPANCY = 0.70; // モデルを画面の 70% に見せる
let haveInitialView = false;  // 初回のみデフォルト方向にする

function initThree(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const viewer=document.getElementById('viewer'); viewer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  frameGroup = new THREE.Group(); modelGroup = new THREE.Group(); envGroup = new THREE.Group();
  frameGroup.add(modelGroup); frameGroup.add(envGroup); scene.add(frameGroup);

  const resize=()=>{ 
    const w=viewer.clientWidth||640, h=viewer.clientHeight||480;
    renderer.setSize(w,h,false); 
    camera.aspect=Math.max(1e-6,w/h); 
    camera.updateProjectionMatrix(); 
    if(currentModel) maintainCameraToModel(); // リサイズ時も 70% 維持
  };
  new ResizeObserver(resize).observe(viewer); 
  resize();

  animate();
}
function animate(){ 
  requestAnimationFrame(animate); 
  // 地球の自転は停止（回さない）
  controls.update(); 
  renderer.render(scene,camera); 
}

/* ---------- utils ---------- */
const fmt=(v,d=2)=>(v==null||Number.isNaN(v))?'—':String(Math.round(v*10**d)/10**d);
const fmtFixed=(v,d=2)=>(v==null||Number.isNaN(v))?'—':Number(v).toFixed(d);
function disposeModel(obj){ obj?.traverse(n=>{ if(n.isMesh){ n.geometry?.dispose?.(); if(Array.isArray(n.material)) n.material.forEach(m=>m?.dispose?.()); else n.material?.dispose?.(); } }); }

function getBounds(obj){ const box=new THREE.Box3().setFromObject(obj); const size=box.getSize(new THREE.Vector3()); const center=box.getCenter(new THREE.Vector3()); return {box,size,center,maxSize:Math.max(size.x,size.y,size.z)}; }

/** モデルのみを対象に、画面占有率 occ(=0.7) を満たす距離に設定。
 * 方向：既存カメラ→ターゲット方向を維持。初回は (3,2,4) 方向。
 */
function maintainCameraToModel(occ = MODEL_OCCUPANCY){
  if(!currentModel) return;
  const { center, maxSize } = getBounds(currentModel);
  const fitH = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const fitW = fitH / camera.aspect;
  const fitDist = Math.max(fitH, fitW);
  const distance = fitDist / Math.max(0.01, occ);

  let dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if(!haveInitialView || dir.lengthSq() === 0) dir.set(3,2,4);
  dir.normalize();

  camera.position.copy(center).add(dir.multiplyScalar(distance));
  camera.near = Math.max(0.001, distance/1000);
  camera.far  = Math.max(10,    distance*1000);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = distance * 0.1;
  controls.maxDistance = distance * 10;
  controls.update();

  haveInitialView = true;
}

/* ---------- カラーマップ（404抑制） ---------- */
const colormapNotFound=new Set();
function cmCandidates(material,mode){ const base='assets/colormaps/'; return [`${base}${material}_${mode}.png`, `${base}colorMap_${material}_${mode}.png`]; }
function updateColorMap(material,mode){
  const key=`${material}_${mode}`, img=document.getElementById('colormap');
  if(!img || !material||!mode||colormapNotFound.has(key)){ if(img) img.style.display='none'; return; }
  const cands=cmCandidates(material,mode); let i=0;
  const next=()=>{ if(i>=cands.length){ img.style.display='none'; colormapNotFound.add(key); return; }
    img.onerror=()=>{ i++; next(); }; img.onload=()=>{ img.style.display='block'; }; img.src=cands[i]; };
  next();
}

/* ---------- 環境・物性表示（要素が無ければスキップ） ---------- */
function renderEnvironment(){ const e=getEnv();
  setText('val-solar', fmt(e.solar_W_m2,0));
  setText('val-albR',  fmt(e.albedo_ratio,2));
  setText('val-albF',  fmt(e.albedo_flux_W_m2,1));
  setText('val-earthIR', fmt(e.earth_ir_W_m2,0));
  setText('val-sinkT', fmt(e.sinkT_K,0));
}
function renderMaterialProps(material){
  const p=getProps(material);
  setText('propsName', p ? ((currentLang==='JP')?(p.nameJP||material):(p.nameEN||material)) : (material||'—'));
  const set=(id,v)=>setText(id, v);
  if(!p){ ['val-alpha','val-epsilon','val-rho','val-E','val-nu','val-cte','val-T0','val-k','val-cp'].forEach(id=>set(id,'—')); return; }
  set('val-alpha',fmt(p.alpha,2)); set('val-epsilon',fmt(p.epsilon,2)); set('val-rho',fmt(p.rho_g_cm3,3));
  set('val-E',fmt(p.E_GPa,1)); set('val-nu',fmt(p.nu,2)); set('val-cte',fmt(p.cte_1e6_perK,2));
  set('val-T0',fmt(p.T0_C,0)); set('val-k',fmt(p.k_W_mK,2)); set('val-cp',fmt(p.cp_J_kgK,0));
}

/* ---------- ビュー更新（KPIやGLTF切替） ---------- */
function updateView(){
  const matSel=document.getElementById('material');
  const thSel =document.getElementById('thickness');
  const modeSel=document.getElementById('mode');

  const mat = matSel?.value;
  const th  = thSel?.value;
  const mode= modeSel?.value || 'Sunlit';

  const data= mat && th ? (results?.[mat]?.[th]?.[mode]) : null;
  const set=(id,v)=>setText(id,(v??'—').toString());
  if(data){ set('mass',data.mass); set('tmax',fmtFixed(data.tmax,2)); set('tmin',fmtFixed(data.tmin,2));
            set('disp',data.disp); set('dt',(typeof data.tmax==='number'&&typeof data.tmin==='number')?fmtFixed(data.tmax-data.tmin,2):'—'); }
  else { ['mass','tmax','tmin','dt','disp'].forEach(id=>set(id,'—')); }

  if(mat && th){ 
    const path=(mode==='Sunlit')?`assets/DISP_${mat}_${th}mm.gltf`:`assets/Eclipse_DISP_${mat}_${th}mm.gltf`; 
    loadModel(path); // モデルロード後に maintainCameraToModel() を呼ぶ
  }
  if(mat) updateColorMap(mat,mode);

  renderEnvironment(); renderMaterialProps(mat||null);
  applyEnvVisibility(mode); // フィルライト含む
}

/* ---------- モバイル開閉（HTMLに無ければNO-OP） ---------- */
function setupOverlays(){
  const sidebar=document.getElementById('sidebar'), panel=document.getElementById('results'), overlay=document.getElementById('overlay');
  const btnSide=document.getElementById('toggleSidebar'), btnPan=document.getElementById('togglePanel');
  if(!sidebar && !panel && !overlay) return;
  const closeAll=()=>{ sidebar?.classList.remove('open'); panel?.classList.remove('open'); overlay?.classList.remove('show'); };
  const openSide=()=>{ closeAll(); sidebar?.classList.add('open'); overlay?.classList.add('show'); };
  const openPan =()=>{ closeAll(); panel?.classList.add('open'); overlay?.classList.add('show'); };
  btnSide?.addEventListener('click', openSide);
  btnPan ?.addEventListener('click', openPan);
  overlay?.addEventListener('click', closeAll);
  window.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAll(); });
}

/* ---------- プリロード ---------- */
const modelCache=new Map(); const envCache=new Map();
function enumerateAllModelPaths(){ const paths=[]; for(const mat of Object.keys(results)){ if(mat==='_env') continue;
  const ths=Object.keys(results[mat]).filter(k=>k!=='_props'); for(const th of ths){ paths.push(`assets/DISP_${mat}_${th}mm.gltf`); paths.push(`assets/Eclipse_DISP_${mat}_${th}mm.gltf`);} }
  return Array.from(new Set(paths)); }
function enumerateAllColorUrls(){ return []; }
function preloadModel(path){ if(modelCache.has(path)) return Promise.resolve(true);
  return new Promise(res=>{ loader.load(path,g=>{ modelCache.set(path,g.scene); res(true); },undefined,()=>res(false)); }); }
function preloadEnvOne(name, urls){ if(envCache.has(name)) return Promise.resolve(true);
  return new Promise(resolve=>{ const tryNext=(i=0)=>{ if(i>=urls.length) return resolve(false);
    loader.load(urls[i], g=>{ envCache.set(name,g.scene); envCache.set(urls[i],g.scene); resolve(true); },undefined,()=>tryNext(i+1)); }; tryNext(); }); }
async function preloadAllModelsWithProgress(paths,onTick){ for(const p of paths){ const ok=await preloadModel(p); onTick?.(p,ok);} }
async function preloadImagesWithProgress(urls,onTick){ for(const u of urls){ onTick?.(u,true);} }
async function preloadEnvWithProgress(onTick){ for(const [n,urls] of [['Sun',ENV_URLS.Sun],['Earth',ENV_URLS.Earth]]){ const ok=await preloadEnvOne(n,urls); onTick?.(n,ok);} }

/* ---------- モデルロード ---------- */
function getCloned(src){ return src?src.clone(true):null; }
function getClonedModel(path){ return getCloned(modelCache.get(path)); }
function loadModel(path){
  if(currentModel){ modelGroup.remove(currentModel); disposeModel(currentModel); currentModel=null; }
  const clone=getClonedModel(path);
  if(clone){ 
    currentModel=clone; modelGroup.add(currentModel); 
    frameToModelAndPlaceEnv();
    maintainCameraToModel();
    if(holdViewPending) requestAnimationFrame(()=>requestAnimationFrame(()=>applyHeldCameraIfNeeded()));
  }else{
    loader.load(path, gltf=>{ 
      currentModel=gltf.scene; modelGroup.add(currentModel); 
      frameToModelAndPlaceEnv(); 
      maintainCameraToModel();
      if(holdViewPending) requestAnimationFrame(()=>requestAnimationFrame(()=>applyHeldCameraIfNeeded()));
    }, undefined, err=>console.error('GLTF load error:', err));
  }
}

/* ---------- Sun/Earth + Light ---------- */
let sunObj=null, earthObj=null, sunLight=null;
let sunManualOverride=true;   // 固定値を優先するため true
let earthManualOverride=true; // 固定値を優先するため true

const SUN_INIT   = { x:0, y:0, z:191176, scale:10.4 };
const EARTH_INIT = { x:0, y:0, z:-6980,  scale:10   };

function sRGBifyMaterials(root){
  root?.traverse(o=>{
    if(o.isMesh){
      const mats=Array.isArray(o.material)?o.material:[o.material];
      mats.forEach(m=>{ if(!m) return; if(m.map) m.map.colorSpace=THREE.SRGBColorSpace; if(m.emissiveMap) m.emissiveMap.colorSpace=THREE.SRGBColorSpace; });
    }
  });
}

/* --- Earth 自発光 & 90°ヨー用ユーティリティ ----------------------------- */
let __earthYawApplied = false; // 一度だけ適用

function applyEarthSelfGlow(intensity = 0.005, color = 0x6aa8ff){
  if(!earthObj) return;
  earthObj.traverse(o=>{
    if(!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m=>{
      if(!m) return;
      if (m.emissive) {
        m.emissive.setHex(color);
        m.emissiveIntensity = intensity;
      }
    });
  });
}

function yawEarthPlus90degOnce(){
  if(!earthObj) return;
  if(__earthYawApplied) return;
  earthObj.rotation.y += Math.PI * 0.6; // +90°
  __earthYawApplied = true;
}

/* ----------------------------------------------------------------------- */
function ensureEnvObjectsSync(){
  if(!sunObj){
    const src=envCache.get('Sun');
    sunObj = src? getCloned(src) : new THREE.Mesh(
      new THREE.SphereGeometry(1,48,48),
      new THREE.MeshBasicMaterial({color:0xffcc66})
    );
    sRGBifyMaterials(sunObj);
    envGroup.add(sunObj);
  }

  if(!earthObj){
    const src=envCache.get('Earth');
    earthObj = src? getCloned(src) : new THREE.Mesh(
      new THREE.SphereGeometry(1,48,48),
      new THREE.MeshPhongMaterial({color:0x4da6ff, shininess:8})
    );
    sRGBifyMaterials(earthObj);
    envGroup.add(earthObj);

    // 生成時に一度だけ自発光 & ヨー +90°
    applyEarthSelfGlow(0.005, 0x6aa8ff);
    yawEarthPlus90degOnce();
  }else{
    // 既存でも自発光は都度確実に適用しておく
    applyEarthSelfGlow(0.005, 0x6aa8ff);
  }

  if(!sunLight){
    sunLight=new THREE.DirectionalLight(0xffffff,1.0);
    scene.add(sunLight);
  }
}

function applyFixedSunEarth(){
  // 指定の初期値を適用（手動優先フラグは既に true）
  sunObj.position.set(SUN_INIT.x, SUN_INIT.y, SUN_INIT.z);
  sunObj.scale.setScalar(SUN_INIT.scale);
  earthObj.position.set(EARTH_INIT.x, EARTH_INIT.y, EARTH_INIT.z);
  earthObj.scale.setScalar(EARTH_INIT.scale);
  updateSunLight();
}

function updateSunLight(){
  if(sunLight && sunObj){
    sunLight.position.copy(sunObj.position.clone().add(new THREE.Vector3(0.5,0.7,0.4)));
    sunLight.target.position.set(0,0,0);
    scene.add(sunLight.target);
  }
}

/** 本体があれば Sun/Earth を配置（固定値優先で上書きしない） */
function frameToModelAndPlaceEnv(){
  if(!currentModel){ frameSunEarthStandalone(); return; }
  ensureEnvObjectsSync();

  if(sunManualOverride && earthManualOverride){
    applyFixedSunEarth();
  }else{
    applyFixedSunEarth();
    sunManualOverride = true; earthManualOverride = true;
  }

  // カメラは maintainCameraToModel() が担当
  applyEnvVisibility(document.getElementById('mode')?.value || 'Sunlit');
  applyEnvLock();
}

/** 本体が無い時の初期表示（固定値） */
function frameSunEarthStandalone(){
  ensureEnvObjectsSync();
  applyFixedSunEarth();

  // モデルが無い場合のみ、一度 Sun/Earth を画面に収める（見切れ防止）
  const tmpGroup = new THREE.Group();
  tmpGroup.add(sunObj.clone(true));
  tmpGroup.add(earthObj.clone(true));
  scene.add(tmpGroup);
  const box = new THREE.Box3().setFromObject(tmpGroup);
  const size = box.getSize(new THREE.Vector3());
  const centerSE = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const fitH = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const fitW = fitH / camera.aspect;
  const fitDist = Math.max(fitH, fitW) / MODEL_OCCUPANCY;
  const dir = new THREE.Vector3(3,2,4).normalize();
  camera.position.copy(centerSE).add(dir.multiplyScalar(fitDist));
  camera.near = Math.max(0.001, fitDist/1000);
  camera.far  = Math.max(10,    fitDist*1000);
  controls.target.copy(centerSE);
  controls.update();
  scene.remove(tmpGroup);

  applyEnvVisibility(document.getElementById('mode')?.value || 'Sunlit');
}

/* ---------- 表示制御（UI無しなら既定ON） + Eclipse フィルライト（再宣言対策） ---------- */
// earthFillLight は globalThis に一意格納して、HMR/再読込でも再宣言を回避
function getEarthFillLight(){
  const g = /** @type {any} */ (globalThis);
  if (!g.__earthFillLight) {
    const l = new THREE.DirectionalLight(0x88aaff, 0.28); // 少し青白い弱めの光
    l.visible = false;
    g.__earthFillLight = l;
    if (scene) {
      scene.add(l);
      scene.add(l.target);
    }
  }
  return /** @type {THREE.DirectionalLight} */ (g.__earthFillLight);
}

function updateEarthFillLight(){
  const fill = getEarthFillLight();
  if (!earthObj) return;

  // 地球位置からモデル中心へ向ける
  const targetCenter = currentModel
    ? new THREE.Box3().setFromObject(currentModel).getCenter(new THREE.Vector3())
    : new THREE.Vector3(0, 0, 0);

  // 地球の位置に少しオフセット（陰になりにくくする）
  const fromEarth = earthObj.position.clone().add(new THREE.Vector3(-200, 120, 80));
  fill.position.copy(fromEarth);
  fill.target.position.copy(targetCenter);
}

function applyEnvVisibility(mode){
  const show=document.getElementById('envShow')?.checked ?? true;

  if(!sunObj || !earthObj) { ensureEnvObjectsSync(); }
  const fill = getEarthFillLight();
  if(!sunObj || !earthObj || !sunLight || !fill) return;

  if(!show){
    sunObj.visible=false; earthObj.visible=false; sunLight.visible=false; fill.visible=false; 
    return;
  }

  if(mode==='Eclipse'){
    // 太陽は非表示（直射なし）、地球側フィルライトON
    sunObj.visible=false; sunLight.visible=false;
    earthObj.visible=true;

    updateEarthFillLight();
    fill.visible = true;
  }else{
    // Sunlit：太陽可視＋主光源、フィルライトはOFF
    sunObj.visible=true;  sunLight.visible=true;  
    earthObj.visible=true;

    fill.visible = false;
  }
}

function applyEnvLock(){
  if(!envGroup||!frameGroup) return;
  const lock=document.getElementById('envLock')?.checked ?? true;
  if(lock){ if(envGroup.parent!==frameGroup){ scene.remove(envGroup); frameGroup.add(envGroup);} }
  else    { if(envGroup.parent!==scene){ frameGroup.remove(envGroup); scene.add(envGroup);} }
}

/* ---------- カメラ保持：素材/厚み/モード変更時に角度・距離を保持 ---------- */
let holdViewPending = false;
let holdDir = new THREE.Vector3(3, 2, 4).normalize();
let holdDist = 1;

function captureCurrentView(){
  // 現在の視線方向と距離を保持
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  holdDist = Math.max(0.001, dir.length());
  if (holdDist > 0) holdDir.copy(dir.normalize());
}

function applyHeldCameraIfNeeded(){
  if (!holdViewPending || !currentModel) return;

  // モデル中心に対して、以前の方向・距離を再適用
  const center = new THREE.Box3().setFromObject(currentModel).getCenter(new THREE.Vector3());
  camera.position.copy(center).add(holdDir.clone().multiplyScalar(holdDist));

  // 近遠クリップを更新
  camera.near = Math.max(0.001, holdDist/1000);
  camera.far  = Math.max(10,    holdDist*1000);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();

  holdViewPending = false;
}

/* ---------- イベント：変更前にカメラ保持 → updateView() 後に再適用 ---------- */
['change','input'].forEach(evt=>{
  document.addEventListener(evt, e=>{
    const id = e.target?.id;
    const isViewChanging = (id==='material' || id==='thickness' || id==='mode');

    if(isViewChanging){
      captureCurrentView();
      holdViewPending = true;
    }

    if(id==='material') updateThicknessOptions();
    if(id==='lang'){ const langEl=document.getElementById('lang'); if(langEl) applyLang(langEl.value); }
    if(id==='envShow' || id==='mode') applyEnvVisibility(document.getElementById('mode')?.value || 'Sunlit');
    if(id==='envLock')  applyEnvLock();

    // モデルロードやUI更新
    updateView();

    // maintainCameraToModel() の呼び出し後に上書きするため、次フレームで適用
    if(isViewChanging){
      requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ applyHeldCameraIfNeeded(); }); });
    }
  });
});

/* ---------- Fキー：モデルのみ 70% で再フィット（保持は無視） ---------- */
window.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase() === 'f'){
    if(currentModel){
      holdViewPending = false; // 明示的フィット時は保持しない
      maintainCameraToModel(); // モデル基準で70%表示に再設定
    }else{
      frameSunEarthStandalone(); // モデル無い場合は SE を一旦収める
    }
  }
});

/* ---------- ローディングUI（要素が無ければNO-OP） ---------- */
function setLoadingTotal(n){ const el=document.getElementById('loading-total'); if(el) el.textContent=String(n); }
function setLoadingProgress(done,total,detail=''){
  const pct=total?Math.floor((done/total)*100):0;
  const c=document.getElementById('loading-count'); if(c) c.textContent=String(done);
  const p=document.getElementById('loading-percent'); if(p) p.textContent=String(pct);
  const bar=document.getElementById('loading-bar'); if(bar) bar.style.width=`${pct}%`;
  const wrap=document.querySelector('.progress-wrap'); if(wrap) wrap.setAttribute('aria-valuenow', String(pct));
  const d=document.getElementById('loading-detail'); if(d && detail) d.textContent=detail;
}
function hideLoading(){ const el=document.getElementById('loading'); if(!el) return; el.style.opacity='0'; el.style.transition='opacity 200ms'; setTimeout(()=>{ el.style.display='none'; }, 220); }

/* ---------- オーバーレイと言語 ---------- */
function setupOverlaysAndLang(){
  setupOverlays();
  const langEl=document.getElementById('lang');
  const saved=(()=>{ try{return localStorage.getItem('lang')||'EN';}catch{return 'EN';} })();
  if(langEl) langEl.value=saved;
  applyLang(saved);
}

/* ---------- エントリ ---------- */
async function main(){
  loader = new GLTFLoader();

  setupOverlaysAndLang();

  await loadResults();

  const modelPaths=enumerateAllModelPaths();
  const colorUrls =enumerateAllColorUrls();
  const totalTasks=modelPaths.length + colorUrls.length + 2;
  setLoadingTotal(totalTasks);
  let done=0; const tick=(label,ok)=>{ done++; setLoadingProgress(done,totalTasks,(ok?'Loaded: ':'Missing: ')+label); };

  await preloadAllModelsWithProgress(modelPaths,(p,ok)=>tick(p,ok));
  await preloadImagesWithProgress(colorUrls,(u,ok)=>tick(u,ok));
  await preloadEnvWithProgress((name,ok)=>tick(name,ok));

  initThree();

  // Sun/Earth 生成 → 固定値で配置 + 地球自発光 & ヨー +90°
  ensureEnvObjectsSync();
  applyFixedSunEarth();
  updateEarthFillLight();

  // ビュー更新（モデル読み込み→配置）。カメラはモデルのみ70%
  updateView();

  // モデルが無い場合でも背景を出す
  if (!currentModel) {
    frameSunEarthStandalone();
  }

  hideLoading();
}
main().catch(err=>console.error(err));

