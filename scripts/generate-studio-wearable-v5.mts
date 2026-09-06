/**
 * Original, metre-scale wearable meshes. No downloaded models or textures.
 * pnpm exec tsx scripts/generate-studio-wearable-v5.mts [output directory]
 * Stable origins/anchors are intentional: never centre/normalize these GLBs.
 * All generated geometry is dedicated to CC0-1.0; source code follows the repository licence.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as T from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Point = readonly [number, number, number];
type Material = T.MeshStandardMaterial;
const PI = Math.PI;
const output = resolve(process.argv[2] ?? "apps/web/public/assets/3d");

// GLTFExporter only needs these two asynchronous Blob reads in the texture-free Node path.
class BlobReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.(); }, (e: unknown) => this.onerror?.(e));
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString("base64")}`;
      this.onloadend?.();
    }, (e: unknown) => this.onerror?.(e));
  }
}
Object.defineProperty(globalThis, "FileReader", { value: BlobReader, configurable: true });

function material(name: string, color: string, roughness = 0.7, metalness = 0, tintable = false): Material {
  const result = new T.MeshStandardMaterial({ name, color, roughness, metalness, side: T.DoubleSide });
  result.userData = { toonspectrum_pbr: true, toonspectrum_tintable: tintable };
  return result;
}
const steel = material("Atelier_BrushedSteel", "#9faab5", 0.29, 0.82);
const darkMetal = material("Atelier_AnodizedMetal", "#242c36", 0.32, 0.72);
const brass = material("Atelier_BrushedBrass", "#bca16a", 0.35, 0.78);
const rubber = material("Atelier_SoftRubber", "#181e25", 0.88);
const thread = material("Atelier_TonalStitch", "#89909b", 0.96);
const glass = material("Atelier_OpticalGlass", "#172b3b", 0.12, 0.22);
const v = (p: Point) => new T.Vector3(...p);

class Asset {
  private readonly parts = new Map<Material, T.BufferGeometry[]>();
  constructor(readonly id: string, readonly file: string, readonly anchor: Point) {}
  add(geometry: T.BufferGeometry, mat: Material, position: Point = [0, 0, 0], rotation: Point = [0, 0, 0], scale: Point = [1, 1, 1]) {
    const matrix = new T.Matrix4().compose(v(position), new T.Quaternion().setFromEuler(new T.Euler(...rotation)), v(scale));
    const transformed = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    if (!transformed.getAttribute("normal")) transformed.computeVertexNormals();
    if (!transformed.getAttribute("uv")) transformed.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(transformed.getAttribute("position").count * 2), 2));
    const collection = this.parts.get(mat) ?? [];
    collection.push(transformed); this.parts.set(mat, collection); geometry.dispose();
  }
  box(size: Point, position: Point, mat: Material, radius = 0.003, rotation: Point = [0, 0, 0]) {
    this.add(new RoundedBoxGeometry(...size, 4, Math.min(radius, ...size.map((x) => x * 0.45))), mat, position, rotation);
  }
  plate(size: Point, position: Point, mat: Material, radius: number) {
    const [width, height, depth] = size;
    const r = Math.min(radius, width / 2, height / 2);
    const x = -width / 2, y = -height / 2;
    const shape = new T.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r);
    shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    shape.lineTo(x + r, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const geometry = new T.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false, curveSegments: 12 });
    geometry.translate(0, 0, -depth / 2);
    this.add(geometry, mat, position);
  }
  sphere(radius: number, position: Point, mat: Material, scale: Point = [1, 1, 1]) {
    this.add(new T.SphereGeometry(radius, 40, 24), mat, position, [0, 0, 0], scale);
  }
  tube(points: readonly Point[], radius: number, mat: Material, closed = false, segments = 64) {
    const curve = new T.CatmullRomCurve3(points.map(v), closed, "centripetal");
    this.add(new T.TubeGeometry(curve, segments, radius, 8, closed), mat);
  }
  ring(radius: number, tube: number, position: Point, mat: Material, rotation: Point = [PI / 2, 0, 0], scale: Point = [1, 1, 1]) {
    this.add(new T.TorusGeometry(radius, tube, 10, 64), mat, position, rotation, scale);
  }
  lathe(profile: readonly (readonly [number, number])[], mat: Material, position: Point = [0, 0, 0], scale: Point = [1, 1, 1]) {
    this.add(new T.LatheGeometry(profile.map(([x, y]) => new T.Vector2(x, y)), 64), mat, position, [0, 0, 0], scale);
  }
  scene() {
    const root = new T.Group(); root.name = `atelier:${this.id}:v5`;
    root.userData = { generator: "scripts/generate-studio-wearable-v5.mts", license: "CC0-1.0", units: "metres", up: "+Y", anchor: [...this.anchor], qualityReviewRequired: true };
    for (const [mat, parts] of this.parts) {
      let geometry = mergeGeometries(parts, false);
      if (!geometry) throw new Error(`Cannot assemble ${this.id}/${mat.name}`);
      const unindexed = geometry;
      geometry = mergeVertices(unindexed, 0.000001);
      unindexed.dispose();
      const mesh = new T.Mesh(geometry, mat); mesh.name = `${this.id}:${mat.name}`;
      mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
      for (const part of parts) part.dispose();
    }
    root.updateMatrixWorld(true); return root;
  }
}

function grid(rows: number, columns: number, sample: (u: number, w: number) => Point, flip = false) {
  const positions: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    positions.push(...sample(row / rows, col / columns)); uvs.push(col / columns, row / rows);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col; const b = a + 1; const d = a + columns + 1; const c = d + 1;
    indices.push(...(flip ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  }
  const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}
function ellipse(x: number, y: number, z: number, rx: number, rz: number, count = 64): Point[] {
  return Array.from({ length: count }, (_, i) => [x + rx * Math.cos(2 * PI * i / count), y, z + rz * Math.sin(2 * PI * i / count)] as const);
}
function roundedOutline(width: number, height: number, radius: number, z: number, xOffset = 0): Point[] {
  const points: Point[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
    const cy = (corner < 2 ? 1 : -1) * (height / 2 - radius);
    for (let j = 0; j < 10; j++) {
      const angle = (corner * PI / 2) + (j / 9) * PI / 2;
      points.push([xOffset + cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z]);
    }
  }
  return points;
}

function microphone() {
  const a = new Asset("mic", "atelier_microphone.glb", [0, -0.025, 0]);
  const body = material("MicV5_SatinBody", "#30343e", 0.48, 0.45, true);
  a.lathe([[0,-.091],[.008,-.091],[.0105,-.087],[.0117,-.06],[.012,-.025],[.0128,.03],[.014,.045],[.013,.053],[0,.053]], body);
  a.ring(.011,.001,[0,-.077,0],darkMetal); a.ring(.0135,.0014,[0,.039,0],steel);
  a.sphere(.0273,[0,.077,0],rubber,[1,1.12,1]);
  // Actual fine wire grille; not an untextured sphere standing in for a microphone head.
  for (let row = 1; row < 19; row++) {
    const phi = PI * row / 20; const r = .028 * Math.sin(phi); const y = .077 + .031 * Math.cos(phi);
    a.tube(ellipse(0,y,0,r,r,48),.00048,steel,true,48);
  }
  for (let meridian = 0; meridian < 24; meridian++) {
    const angle = 2 * PI * meridian / 24;
    a.tube(Array.from({length:27}, (_, i) => {
      const phi = .10 + (PI-.20)*i/26; return [.028*Math.sin(phi)*Math.cos(angle),.077+.031*Math.cos(phi),.028*Math.sin(phi)*Math.sin(angle)] as const;
    }),.00042,steel,false,40);
  }
  a.ring(.0285,.0012,[0,.077,0],darkMetal);
  a.box([.006,.014,.0015],[0,.010,.0128],rubber,.001);
  return a;
}

function cap() {
  const a = new Asset("cap","everyday_cap.glb",[0,0,0]);
  const fabric=material("CapV4_CottonTwill","#263e60",.9,0,true);
  const lining=material("CapV4_Sweatband","#22262b",.96);
  const y=.065;
  // Keep the established crown height, but NEVER emit the old visible HeadContact post.
  a.add(grid(28,64,(u,w)=>{
    const theta=.008+(PI/2-.008)*u; const phi=2*PI*w; const fold=1+.007*Math.cos(6*phi)*Math.sin(theta);
    return [.105*Math.sin(theta)*Math.cos(phi)*fold,y+.096*Math.cos(theta),.097*Math.sin(theta)*Math.sin(phi)*fold];
  }),fabric);
  a.tube(ellipse(0,y+.001,0,.100,.092),.0032,lining,true);
  for(let panel=0;panel<6;panel++) {
    const phi=2*PI*panel/6;
    a.tube(Array.from({length:25},(_,i)=>{const theta=.07+(PI/2-.07)*i/24;return [.1057*Math.sin(theta)*Math.cos(phi),y+.0967*Math.cos(theta),.0977*Math.sin(theta)*Math.sin(phi)] as const;}),.00045,thread,false,36);
  }
  for(const side of [-1,1]) a.add(grid(8,40,(u,w)=>{
    const theta=(w-.5)*PI; const radius=.075+.086*u;
    return [(.082+.018*u)*Math.sin(theta),y+.004-.010*Math.sin(theta)**2+side*.0016,.012+radius*Math.cos(theta)];
  },side<0),side>0?fabric:lining);
  for(const q of [.70,.85]) a.tube(Array.from({length:41},(_,i)=>{const theta=(i/40-.5)*PI;return [(.082+.018*q)*Math.sin(theta),y+.006-.010*Math.sin(theta)**2,.012+(.075+.086*q)*Math.cos(theta)] as const;}),.00042,thread,false,48);
  a.sphere(.006,[0,y+.097,0],fabric,[1,.45,1]);
  a.box([.045,.012,.004],[0,y+.008,-.094],lining,.003);
  a.box([.014,.014,.0045],[.013,y+.008,-.097],darkMetal,.002);
  return a;
}

function beret() {
  const a=new Asset("beret","atelier_beret.glb",[0,-.02,0]);
  const felt=material("BeretV5_WoolFelt","#71364e",.96,0,true);
  a.add(grid(32,72,(u,w)=>{
    const phi=w*2*PI; const radius=.098*Math.cos(u*PI/2)*(1+.15*Math.sin(u*PI));
    const droop=.013*Math.sin(phi+.5)*Math.sin(u*PI);
    return [radius*Math.cos(phi)-.032*Math.sin(u*PI/2),-.018+.075*Math.sin(u*PI/2)+droop,radius*.91*Math.sin(phi)];
  }),felt);
  a.lathe([[.090,-.026],[.096,-.026],[.098,-.02],[.095,-.008],[.090,-.01]],rubber,[0,0,0],[1,1,.91]);
  a.tube([[-.032,.053,0],[-.034,.064,.001],[-.032,.067,.004]],.0025,felt,false,12);
  a.tube(ellipse(0,-.009,0,.097,.088),.0006,thread,true);
  return a;
}

function sunglasses() {
  const a=new Asset("sunglasses","atelier_sunglasses.glb",[0,0,0]);
  const acetate=material("SunglassesV5_Acetate","#181d29",.23,.06,true);
  const lens=material("SunglassesV5_SmokeLens","#182c35",.12,.1);
  for(const sign of [-1,1]) {
    const x=sign*.034;
    a.tube(roundedOutline(.055,.039,.013,0,x),.0025,acetate,true);
    a.plate([.052,.036,.002],[x,0,-.0007],lens,.012);
    a.tube([[sign*.061,.01,0],[sign*.069,.01,-.012],[sign*.068,.007,-.069],[sign*.061,-.011,-.105]],.0023,acetate,false,40);
    a.box([.005,.004,.007],[sign*.062,.009,-.006],steel,.001);
    a.sphere(.0025,[sign*.010,-.006,-.007],rubber,[.6,1.7,.8]);
  }
  a.tube([[-.01,.002,0],[-.005,.005,.001],[.005,.005,.001],[.01,.002,0]],.002,acetate,false,18);
  return a;
}

function headphones() {
  const a=new Asset("headphones","atelier_headphones.glb",[0,-.04,0]);
  const shell=material("HeadphonesV5_SatinShell","#303644",.45,.18,true);
  const pad=material("HeadphonesV5_LeatherCushion","#191d25",.89);
  const arc=(radius:number,y:number):Point[]=>Array.from({length:49},(_,i)=>{const angle=PI*i/48;return [radius*Math.cos(angle),y+.119*Math.sin(angle),0] as const;});
  // Flat laminated headband, not a thick round hose.
  a.add(grid(48,6,(u,w)=>{const angle=PI*u;return [.097*Math.cos(angle),-.026+.119*Math.sin(angle),(.5-w)*.026];}),darkMetal);
  for(const z of [-.013,.013]) a.tube(arc(.097,-.026).map(([x,y])=>[x,y,z] as const),.0015,steel,false,48);
  a.add(grid(40,6,(u,w)=>{const angle=.22+(PI-.44)*u;return [.094*Math.cos(angle),-.027+.116*Math.sin(angle),(.5-w)*.024];}),pad);
  for(const sign of [-1,1]) {
    a.box([.023,.064,.049],[sign*.098,-.039,0],shell,.009,[0,0,sign*.06]);
    a.sphere(1,[sign*.083,-.039,.001],pad,[.010,.030,.023]);
    a.sphere(1,[sign*.074,-.039,.001],rubber,[.002,.021,.015]);
    a.tube([[sign*.094,.002,0],[sign*.107,-.012,-.022],[sign*.109,-.049,-.022],[sign*.102,-.070,0]],.0022,steel,false,28);
    a.box([.0015,.018,.011],[sign*.110,-.033,0],darkMetal,.001);
  }
  return a;
}

function ribbon() {
  const a=new Asset("ribbon","atelier_ribbon.glb",[-.05,0,0]);
  const silk=material("RibbonV5_WovenSatin","#a94664",.47,0,true);
  const edge=material("RibbonV5_Selvedge","#8a3454",.75);
  for(const sign of [-1,1]) {
    const sample=(u:number,w:number):Point=>{
      const angle=u*2*PI; const length=.010+.045*(.5-.5*Math.cos(angle));
      const width=.018+.034*Math.sin(PI*u);
      return [sign*length,(w-.5)*width+.003*Math.sin(angle),.013*Math.sin(angle)*(.45+.55*Math.sin(PI*w))];
    };
    a.add(grid(48,14,sample),silk);
    for(const w of [.03,.97]) a.tube(Array.from({length:49},(_,i)=>sample(i/48,w)),.0004,edge,false,60);
    a.add(grid(24,10,(u,w)=>[sign*(.007+.026*u)+(.5-w)*.018,-.011-.063*u+.008*Math.sin(PI*w)*u,.003+.008*Math.sin(u*PI*1.4)]),silk);
  }
  a.box([.023,.027,.021],[0,0,0],silk,.008,[0,.1,-.08]);
  return a;
}

function beanie() {
  const a=new Asset("beanie","atelier_beanie.glb",[0,0,0]);
  const knit=material("BeanieV5_RibbedWool","#667888",.96,0,true);
  a.add(grid(42,128,(u,w)=>{
    const angle=2*PI*w;const radius=.095*Math.cos(u*PI/2)*(1+.035*Math.sin(u*PI)); const rib=1+.009*Math.cos(angle*48)*Math.sin(PI*u);
    return [radius*Math.cos(angle)*rib,.006+.125*Math.sin(u*PI/2),radius*.93*Math.sin(angle)*rib];
  }),knit);
  a.lathe([[.091,-.015],[.098,-.015],[.101,-.008],[.102,.018],[.098,.026],[.091,.026]],knit,[0,0,0],[1,1,.93]);
  for(let i=0;i<56;i++) {const theta=2*PI*i/56;a.tube([[.101*Math.cos(theta),-.008,.094*Math.sin(theta)],[.1025*Math.cos(theta),.007,.0953*Math.sin(theta)],[.0995*Math.cos(theta),.021,.0925*Math.sin(theta)]],.0007,knit,false,12);}
  a.box([.023,.017,.002],[.035,.003,.088],rubber,.002,[0,.3,0]);
  return a;
}

function wizardHat() {
  const a=new Asset("blender_wizard_hat","wizard_hat.glb",[0,-.02,0]);
  const felt=material("WizardV5_Felt","#423850",.94);
  const band=material("WizardV5_LeatherBand","#3a2c2b",.72);
  // A continuous bent crown; the tip and brim belong to the same silhouette.
  const crown=(u:number,w:number):Point=>{
    const angle=2*PI*w;const radius=.093*(1-u)**.80+.0005;const fold=1+.026*Math.sin(7*angle+u)*Math.sin(PI*u);
    return [.13*u**2+radius*Math.cos(angle)*fold,-.018+.34*u-.072*u**5,radius*.96*Math.sin(angle)*fold];
  };
  a.add(grid(64,80,crown),felt);
  for(const side of [-1,1]) a.add(grid(18,80,(u,w)=>{
    const angle=2*PI*w;const radius=.091+.11*u;
    return [radius*Math.cos(angle),-.019+.010*Math.sin(2*angle+.4)*u+.008*u*u+side*.002,radius*.93*Math.sin(angle)];
  },side<0),felt);
  a.lathe([[.093,-.016],[.096,-.014],[.089,.021],[.086,.023]],band,[0,0,0],[1,1,.96]);
  a.tube(roundedOutline(.029,.025,.005,.091).map(([x,y,z])=>[x,y+.003,z] as const),.0022,brass,true,48);
  a.tube([[0,-.006,.094],[0,.013,.094]],.001,brass,false,8);
  for(const phi of [.3,3.2]) a.tube(Array.from({length:41},(_,i)=>{const p=crown(.02+.94*i/40,phi/(2*PI));return [p[0]+.0003,p[1],p[2]+.0005] as const;}),.00045,thread,false,48);
  return a;
}

function smartphone() {
  const a=new Asset("smartphone","modern_smartphone_prop.glb",[0,-.02,-.006]);
  const shell=material("PhoneV5_Aluminium","#364351",.34,.72,true);
  a.plate([.073,.149,.008],[0,0,0],shell,.007);
  a.plate([.070,.146,.001],[0,0,.0042],glass,.0065);
  a.plate([.069,.145,.001],[0,0,-.0042],rubber,.006);
  a.plate([.031,.033,.0028],[-.018,.051,-.006],shell,.007);
  for(const [x,y] of [[-.025,.057],[-.012,.045]] as const) {
    a.add(new T.CylinderGeometry(.0073,.0073,.003,48),darkMetal,[x,y,-.008],[PI/2,0,0]);
    a.add(new T.CylinderGeometry(.0054,.0054,.0034,48),glass,[x,y,-.0082],[PI/2,0,0]);
    a.ring(.0067,.00045,[x,y,-.010],steel,[0,0,0]);
  }
  a.sphere(.002,[-.012,.059,-.008],thread,[1,1,.4]);
  a.box([.0017,.018,.003],[.0365,.020,0],shell,.0008);
  a.box([.0017,.011,.003],[-.0365,.028,0],shell,.0008);
  a.box([.011,.0012,.001],[0,.065,.005],rubber,.0005);
  a.box([.010,.0015,.003],[0,-.074,0],rubber,.0006);
  for(const sign of [-1,1])for(let i=0;i<5;i++)a.sphere(.0007,[sign*(.012+i*.003),-.074,0],rubber,[1,.4,1]);
  return a;
}

function camera() {
  const a=new Asset("camera","atelier_camera.glb",[0,-.02,-.02]);
  const leather=material("CameraV5_PebbleLeather","#373b36",.91,0,true);
  a.box([.119,.075,.036],[0,0,0],leather,.008);
  a.box([.120,.013,.038],[0,.034,0],steel,.003);
  a.box([.120,.007,.037],[0,-.034,0],steel,.003);
  a.box([.032,.036,.007],[.035,.007,.021],darkMetal,.004);
  a.add(new T.CylinderGeometry(.029,.030,.034,64),darkMetal,[-.012,-.003,.031],[PI/2,0,0]);
  for(const z of [.018,.021,.028,.040,.045])a.ring(.0298,.0008,[-.012,-.003,z],steel,[0,0,0]);
  for(let i=0;i<48;i++){const theta=2*PI*i/48;a.tube([[-.012+.0305*Math.cos(theta),-.003+.0305*Math.sin(theta),.022],[-.012+.0305*Math.cos(theta),-.003+.0305*Math.sin(theta),.034]],.00045,steel,false,4);}
  a.add(new T.CylinderGeometry(.023,.023,.002,64),glass,[-.012,-.003,.049],[PI/2,0,0]);
  a.box([.020,.012,.002],[.033,.022,.021],glass,.003);
  a.box([.058,.041,.001],[0,-.003,-.0188],glass,.003);
  a.add(new T.CylinderGeometry(.010,.010,.004,40),darkMetal,[.032,.043,0]);
  a.add(new T.CylinderGeometry(.005,.005,.003,40),steel,[-.039,.043,0]);
  for(const sign of [-1,1]) a.ring(.0035,.0012,[sign*.063,.021,0],steel,[0,PI/2,0]);
  return a;
}

function medicalBag() {
  const a=new Asset("medicalBag","atelier_medical_bag.glb",[0,.155,0]);
  const canvas=material("MedicalBagV5_Cordura","#9e3a43",.93,0,true);
  a.box([.240,.162,.103],[0,0,0],canvas,.023);
  a.box([.174,.086,.018],[0,-.025,.057],canvas,.012);
  const handle:Point[]=[[-.064,.076,0],[-.062,.124,0],[-.038,.152,0],[0,.155,0],[.038,.152,0],[.062,.124,0],[.064,.076,0]];
  a.tube(handle,.012,rubber,false,64);
  for(const z of [-.032,.032])a.tube([[-.096,.051,z],[-.074,.077,z],[.074,.077,z],[.096,.051,z]],.0018,steel,false,48);
  a.box([.012,.017,.003],[.070,.078,.030],steel,.002);
  // Neutral medical plus, not a protected red-cross emblem.
  a.box([.012,.047,.002],[0,-.018,.068],thread,.002);
  a.box([.047,.012,.002],[0,-.018,.0682],thread,.002);
  for(const sign of [-1,1])a.box([.034,.009,.082],[sign*.075,-.083,0],rubber,.004);
  return a;
}

function shoulderBag() {
  const a=new Asset("shoulderbag","atelier_shoulder_bag.glb",[0,.06,0]);
  const leather=material("ShoulderBagV5_GrainLeather","#674d40",.74,0,true);
  a.box([.163,.131,.065],[0,-.115,0],leather,.023);
  a.box([.165,.083,.008],[0,-.095,.035],leather,.018);
  a.box([.022,.016,.005],[0,-.125,.041],brass,.004);
  // A flat, curved strap at the persisted shoulder contact, rather than a torus.
  const strap=(u:number,w:number):Point=>{const angle=PI*u;return [(.078+.005*(w-.5))*Math.cos(angle),-.090+.150*Math.sin(angle),(.5-w)*.016];};
  a.add(grid(60,5,strap),leather);
  for(const w of [.10,.90])a.tube(Array.from({length:61},(_,i)=>strap(i/60,w)),.00045,thread,false,64);
  for(const sign of [-1,1])a.ring(.009,.0014,[sign*.080,-.078,0],brass,[0,PI/2,0]);
  return a;
}

await mkdir(output,{recursive:true});
const manifest=[];
for(const asset of [microphone(),cap(),beret(),sunglasses(),headphones(),ribbon(),beanie(),wizardHat(),smartphone(),camera(),medicalBag(),shoulderBag()]) {
  const root=asset.scene();
  // The persisted ribbon contact is the knot, not the left edge of a loop.
  if(asset.id==="ribbon")root.position.x=-.05;
  let triangles=0;
  root.traverse((node)=>{const mesh=node as T.Mesh;if(!mesh.isMesh)return; const position=mesh.geometry.getAttribute("position");
    if(!Array.from(position.array).every(Number.isFinite))throw new Error(`Non-finite geometry in ${asset.id}`);
    triangles+=(mesh.geometry.index?.count??position.count)/3;
  });
  if(triangles>160_000)throw new Error(`Triangle budget exceeded by ${asset.id}: ${triangles}`);
  const buffer=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true});
  if(!(buffer instanceof ArrayBuffer))throw new Error("Expected embedded GLB");
  const bytes=Buffer.from(buffer);await writeFile(resolve(output,asset.file),bytes);
  const bounds=new T.Box3().setFromObject(root);
  manifest.push({id:asset.id,file:asset.file,license:"CC0-1.0",source:"original-parametric-authoring",generator:"scripts/generate-studio-wearable-v5.mts",units:"metres",anchor:asset.anchor,bounds:[bounds.min.toArray(),bounds.max.toArray()],triangles,drawCalls:root.children.length,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
  root.traverse((node)=>{if((node as T.Mesh).isMesh)(node as T.Mesh).geometry.dispose();});
}
await writeFile(resolve(output,"wearable-v5-manifest.json"),`${JSON.stringify({version:5,assets:manifest},null,2)}\n`);
// Public asset URLs are immutable for one year. Keep the request revision tied to the actual bytes.
// Alternate export directories must not mutate the application's committed revision module.
if (output === resolve("apps/web/public/assets/3d")) {
  const revisions = Object.fromEntries(manifest.map((asset) => [`/assets/3d/${asset.file}`, asset.sha256]));
  await writeFile(
    resolve("apps/web/src/domains/creator/vrm/studio-vrm-prop-asset-revisions.ts"),
    "/** Generated from wearable-v5-manifest.json; regenerate with generate-studio-wearable-v5.mts. */\n"
      + `export const STUDIO_VRM_PROP_ASSET_REVISIONS: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(revisions, null, 2)});\n`,
  );
}
console.log(JSON.stringify(manifest,null,2));
