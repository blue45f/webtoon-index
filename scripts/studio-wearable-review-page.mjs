/** Review-only page. runtime.mjs is built from the exact checkout's production components. */
import * as R from "./runtime/runtime.mjs";

const { THREE: T, React, createRoot, Canvas, useFrame, useThree } = R;
const h = React.createElement;
const root = createRoot(document.getElementById("root"));
const cache = new Map();
let selectState = null;
let generation = 0;
let active = null;
const api = {
  status: "initializing", frames: 0, receipt: null, errors: [],
  catalogue: { wardrobe: R.WARDROBE_ITEMS.map(({id,slot,geometrySource})=>({id,slot,geometrySource})), props: R.VRM_PROPS.map(({id,category,geometrySource})=>({id,category,geometrySource})) },
};
window.studioWearableQA = api;
window.addEventListener("error", (event)=>api.errors.push(event.message));
window.addEventListener("unhandledrejection", (event)=>api.errors.push(String(event.reason)));

async function avatar(url) {
  if (cache.has(url)) return cache.get(url);
  const loader = new R.GLTFLoader(); loader.register((parser)=>new R.VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url); const vrm = gltf.userData.vrm;
  if (!vrm?.humanoid) throw new Error(`No humanoid in ${url}`);
  if (vrm.meta.metaVersion === "0") R.VRMUtils.rotateVRM0(vrm);
  vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const value = { vrm, costume: R.collectStudioVrmCostumeMeshes(vrm), rest: vrm.humanoid.getNormalizedPose() };
  cache.set(url, value); return value;
}
const tick = ()=>new Promise((resolve)=>requestAnimationFrame(resolve));
function propInstance(def, color) {
  const anchor = def.anchors.find((item)=>item.role==="primary") ?? def.anchors.find((item)=>item.role==="surface") ?? def.anchors[0];
  return { uid:`review-${generation}-${def.id}`, propId:def.id, bone:def.defaultBone, position:[...def.defaultPosition], rotationDeg:[...def.defaultRotationDeg], scale:def.defaultScale, color:color??def.defaultColor,
    rig:{version:2,mode:"auto",anchorId:anchor.id,autoScale:true,autoFingerPose:Boolean(def.grip),gripFit:1,deltaPosition:[0,0,0],deltaRotationDeg:[0,0,0],deltaScale:1} };
}

api.select = async ({ type="wardrobe", id, model="sample", angle=30, crop="full", color=null, assetUrl=null }={})=>{ // NOSONAR javascript:S3776
  if (!selectState) throw new Error("Review root not ready");
  const token = ++generation; api.status="loading"; api.frames=0; api.receipt=null;
  selectState(null); await tick(); await tick();
  if(type==="asset") {
    if(!assetUrl?.startsWith("/assets/3d/"))throw new Error("Only same-origin review assets are accepted");
    const object=(await new R.GLTFLoader().loadAsync(assetUrl)).scene;
    active={type,id,object,angle,crop,token}; selectState(active);return;
  }
  const url=model==="sample"?"/vrm/sample.vrm":"/vrm/AvatarSample_B.vrm";
  const entry=await avatar(url); const {vrm,costume}=entry;
  vrm.humanoid.setNormalizedPose(entry.rest); vrm.update(0); vrm.scene.updateMatrixWorld(true);
  R.applyStudioVrmCostumeState(costume,{hidden:[],recolor:{}});
  const wardrobeMetrics=R.measureStudioVrmWardrobeMetrics(vrm);
  const idle=R.pickNaturalIdlePose(model==="sample"?"sample-vrm":"avatar-b");
  R.applyPoseToVrm(vrm,R.stripFingerBones(idle.bones),idle.yOffset??0,undefined,{skipPalmCorrect:true});
  const metrics=R.measureVrmPropRigMetrics(vrm);
  let instance=null; let equip=null; let slot=null; let effectiveFit=1;
  if(type==="prop") {
    const def=R.propDefById(id); if(!def)throw new Error(`Unknown prop ${id}`);
    instance=propInstance(def,color);
    const fingers=R.createAutoGripFingerOverrides([instance],R.propDefById,metrics);
    R.applyFingerRotations(vrm,fingers);
  } else if(type==="wardrobe") {
    const def=R.wardrobeItemById(id); if(!def)throw new Error(`Unknown garment ${id}`);
    equip=R.createWardrobeEquip(id);slot=def.slot;
    if(color)equip={...equip,color};
    const state=R.mergeWardrobeCostumeVisibility({hidden:[],recolor:{}},{[slot]:equip},costume,true);
    R.applyStudioVrmCostumeState(costume,state);
    effectiveFit=R.inspectStudioVrmGarmentFit({[slot]:equip},wardrobeMetrics).slots[slot]?.effectiveFit??equip.fit;
  }
  R.correctVrmHangingHandPalmTwist(vrm);vrm.humanoid.update();vrm.update(0);vrm.scene.updateMatrixWorld(true);
  active={type,id,model,vrm,instance,equip,slot,metrics,wardrobeMetrics,effectiveFit,angle,crop,token,idlePose:vrm.humanoid.getNormalizedPose()};
  selectState(active);
};
api.view = (angle,crop=active?.crop??"full")=>{
  if (!active) return;
  active = {...active, angle, crop};
  api.frames = 0;
  selectState(active);
};
api.pose = (kind)=>{
  const vrm = active?.vrm;
  if (!vrm) return;
  if (kind === "arms-up") {
    const leftArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftArm) leftArm.rotation.z = 0.40;
    if (rightArm) rightArm.rotation.z = -0.40;
  } else if (kind === "bent-knees") {
    for (const side of ["left", "right"]) {
      const thigh = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`);
      const knee = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`);
      if (thigh) thigh.rotation.x = -1.05;
      if (knee) knee.rotation.x = 1.35;
    }
  }
  vrm.humanoid.update();
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  api.frames = 0;
};

function Camera({selection}) {
  const {camera,scene,gl}=useThree();
  React.useLayoutEffect(()=>{
    if(!selection)return;
    const object=selection.vrm?.scene??selection.object;
    object.updateMatrixWorld(true);
    const bounds=new T.Box3().setFromObject(object);const size=bounds.getSize(new T.Vector3());const center=bounds.getCenter(new T.Vector3());
    let radius=Math.max(size.y,size.x,size.z)*.5;
    if(selection.vrm&&selection.crop!=="full") {
      const humanoid=selection.vrm.humanoid;
      const head=humanoid.getNormalizedBoneNode("head").getWorldPosition(new T.Vector3());
      const hips=humanoid.getNormalizedBoneNode("hips").getWorldPosition(new T.Vector3());
      if(selection.crop==="head"){center.copy(head).add(new T.Vector3(0,.05,0));radius=.25;}
      if(selection.crop==="torso"){center.copy(hips).lerp(head,.55);radius=.39;}
      if(selection.crop==="shoes"){const foot=humanoid.getNormalizedBoneNode("leftFoot").getWorldPosition(new T.Vector3());center.set(0,foot.y+.035,foot.z);radius=.25;}
      if(selection.crop==="hand"){
        const bone=selection.instance?.bone??"rightHand";
        center.copy(humanoid.getNormalizedBoneNode(bone).getWorldPosition(new T.Vector3()));radius=.23;
      }
    }
    const angle=selection.angle*Math.PI/180;const distance=radius/Math.tan(T.MathUtils.degToRad(camera.fov/2))*1.22;
    camera.position.set(center.x+Math.sin(angle)*distance,center.y+distance*.09,center.z+Math.cos(angle)*distance);
    camera.lookAt(center);camera.near=Math.max(.001,radius/100);camera.far=100;camera.updateProjectionMatrix();
    scene.background=new T.Color("#e4e6ea");gl.outputColorSpace=T.SRGBColorSpace;gl.toneMapping=T.ACESFilmicToneMapping;gl.toneMappingExposure=1;
    api.camera={position:camera.position.toArray(),target:center.toArray(),crop:selection.crop};
  },[camera,gl,scene,selection]);
  useFrame(()=>{if(selection)api.frames++;});
  return null;
}

function Subject({selection}) {
  const token=selection.token;
  const status=React.useCallback((uid,id,value)=>{if(generation===token)api.status=value;},[token]);
  const receipt=React.useCallback((slot,value)=>{if(generation===token)api.receipt=value;},[token]);
  React.useEffect(()=>{if(selection.type==="asset"||selection.type==="native")api.status="ready";},[selection]);
  const children=[h("primitive",{key:"model",object:selection.vrm?.scene??selection.object,dispose:null})];
  if(selection.type==="wardrobe")children.push(h(R.StudioVrmWardrobeAttachment,{key:`garment-${token}`,vrm:selection.vrm,slot:selection.slot,equip:selection.equip,metrics:selection.wardrobeMetrics,effectiveFit:selection.effectiveFit,onSurfaceReceipt:receipt,onAttachmentStatus:status}));
  if(selection.type==="prop")children.push(h(R.StudioVrmPropAttachment,{key:`prop-${token}`,vrm:selection.vrm,instance:selection.instance,metrics:selection.metrics,onAttachmentStatus:status}));
  if(selection.instance)children.push(h(R.StudioVrmGripContactRefine,{key:`grip-${token}`,vrm:selection.vrm,items:[selection.instance],metrics:selection.metrics}));
  if(selection.vrm)children.push(h(R.StudioVrmRuntimeCommit,{key:"commit",vrm:selection.vrm,physicsPreview:false,webcamActive:false}));
  children.push(h(Camera,{key:"camera",selection}));
  return h(React.Fragment,null,...children);
}
function App(){
  const [selection,setSelection]=React.useState(null);
  React.useLayoutEffect(()=>{selectState=setSelection;api.status="idle";return()=>{selectState=null;};},[]);
  return h(Canvas,{dpr:1,camera:{fov:35,position:[0,1,3]},gl:{antialias:true,preserveDrawingBuffer:true},style:{width:"100vw",height:"100vh"}},
    h("hemisphereLight",{args:["#ffffff","#747b85",1.5]}),
    h("directionalLight",{position:[2,4,4],intensity:2.1}),
    h("directionalLight",{position:[-3,2,-3],intensity:1.4}),
    selection?h(Subject,{key:selection.token,selection}):null);
}
root.render(h(App));
