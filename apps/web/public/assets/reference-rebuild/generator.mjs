/** Editable glTF meshes recreated from public scene references, not recovered vendor originals. */
export const VERSION = 1;
export const ASSETS = Object.freeze([
  { id: 'school-room', name: '채광 교실', kind: '환경', reference: 'https://www.acon3d.com/ko/product/1000046396', description: '24석 · 창문 · 분리형 천장 · 칠판 · 수납장', camera: [9,6.6,10], target: [0,1.4,0] },
  { id: 'school-desk', name: '책걸상 세트', kind: '소품', reference: 'https://www.acon3d.com/ko/product/2000000735', description: '라운드 상판 · 금속 프레임 · 발 보호대 · 책과 필기구', camera: [1.5,1.1,1.7], target: [0,.5,.2] },
  { id: 'library-room', name: '복층 아카이브', kind: '환경', reference: 'https://www.acon3d.com/en/product/1000008256', description: '복층 책장 · 실제 계단 · 난간 · 독서 공간 · 천장 분리', camera: [10,8,12.5], target: [0,2,0] },
  { id: 'bookcase', name: '몰딩 책장', kind: '소품', reference: 'https://www.acon3d.com/en/product/1000008256', description: '단별 서가 · 크기가 다른 책 · 금속 장식 · 하부 패널', camera: [2.4,2.25,3.6], target: [0,1.3,0] },
  { id: 'reading-table', name: '독서 테이블', kind: '소품', reference: 'https://www.acon3d.com/en/product/1000008256', description: '선반 가공 다리 · 가죽 매트 · 독서등 · 펼친 책', camera: [2.5,1.9,2.8], target: [0,.65,0] },
  { id: 'reading-chair', name: '패브릭 독서 의자', kind: '소품', reference: 'https://www.acon3d.com/en/product/1000008256', description: '곡면 쿠션 · 등받이 · 팔걸이 · 목재 다리', camera: [1.5,1.25,-1.8], target: [0,.55,0] },
].map(Object.freeze));
const TAU = Math.PI * 2;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const unit = v => { const d = Math.hypot(...v); return d ? v.map(x => x/d) : [0,1,0]; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const encoder = new TextEncoder();
const concat = arrays => { const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0)); let p=0; for(const a of arrays){out.set(a,p);p+=a.length;}return out; };
function u32be(n) { const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n);return a; }
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(kind) {
  const w=128,h=128,raw=new Uint8Array((w*3+1)*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const noise=((x*73+y*197+(x*y)%193)%97)/97;
    const v=kind==='wood' ? 211+12*Math.sin(y*.47+Math.sin(x*.08)*.6)+7*Math.sin(y*2.2+x*.015)+noise*10
      : 205+((x+y)%2)*12+Math.sin(x*1.57)*5+Math.sin(y*1.57)*5+noise*10;
    const p=y*(w*3+1)+1+x*3;raw[p]=clamp(v,0,255);raw[p+1]=clamp(v-(kind==='wood'?9:0),0,255);raw[p+2]=clamp(v-(kind==='wood'?20:0),0,255);
  }
  // A single standards-compliant stored DEFLATE block; no canvas, clock or platform-dependent encoder.
  const block=new Uint8Array(raw.length+5);block[0]=1;block[1]=raw.length&255;block[2]=raw.length>>>8;const inv=(~raw.length)&65535;block[3]=inv&255;block[4]=inv>>>8;block.set(raw,5);
  let a=1,b=0;for(const byte of raw){a=(a+byte)%65521;b=(b+a)%65521;}
  const z=concat([new Uint8Array([0x78,1]),block,u32be(((b<<16)|a)>>>0)]);
  const chunk=(type,data)=>{const typeBytes=encoder.encode(type);return concat([u32be(data.length),typeBytes,data,u32be(crc32(concat([typeBytes,data])))]);};
  const ihdr=concat([u32be(w),u32be(h),new Uint8Array([8,2,0,0,0])]);
  return concat([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',z),chunk('IEND',new Uint8Array())]);
}
const linear = hex => [1,3,5].map(i=>{const s=parseInt(hex.slice(i,i+2),16)/255;return Math.fround(s<=.04045?s/12.92:((s+.055)/1.055)**2.4);});
function material(name,color,roughness=.6,metallic=0,texture=null,emissive=null){
 const p={baseColorFactor:[...linear(color),1],roughnessFactor:roughness,metallicFactor:metallic};
 if(texture!==null)p.baseColorTexture={index:texture};
 return {name,pbrMetallicRoughness:p,...(emissive?{emissiveFactor:linear(emissive)}:{})};
}
const MATERIALS=[
 material('Walnut grain','#865b3e',.46,0,0),material('Warm oak grain','#bf9664',.48,0,0),
 material('Aged brass','#cba456',.3,.8),material('Charcoal steel','#414b52',.3,.7),
 material('Linen teal','#407977',.86,0,1),material('Chalk plaster','#e7dfd0',.9),
 material('Jade board','#386256',.8),material('Paper ivory','#ede3c9',.9),
 material('Porcelain','#edf2ee',.35),material('Daylight glazing','#b0d0df',.25,.08,null,'#587682'),
 material('Terracotta leather','#a95143',.6),material('Ink blue leather','#34465b',.65),
 material('Moss leather','#667158',.7),material('Amber leather','#b0884d',.65),
 material('Midnight bookcloth','#363b43',.85,0,1),material('Rug cloth','#875455',.94,0,1),
 material('Lamp diffuser','#f7e7b4',.5,0,null,'#ddc185'),material('Dark rubber','#282c2b',.95),
 material('Pale sage seat','#a6b99b',.48),material('Stone grout','#b8b5ad',.95),
];
class Geometry {
 constructor(){this.p=[];this.n=[];this.uv=[];this.indices=[];}
 vertex(p,n,uv){this.p.push(...p.map(Math.fround));this.n.push(...n.map(Math.fround));this.uv.push(...uv.map(Math.fround));return this.p.length/3-1;}
 tri(a,b,c){this.indices.push(a,b,c);}
}
function roundedBox(size,radius=0){
 const g=new Geometry(),h=size.map(x=>x/2),r=Math.min(radius,...h.map(x=>x*.8));
 // Face tangent bases have u cross v = outward normal. Shared edge normals agree.
 const faces=[[[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]], [[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]]];
 for(const [n,u,v]of faces){
  const hn=h[n.findIndex(x=>x!==0)],hu=h[u.findIndex(x=>x!==0)],hv=h[v.findIndex(x=>x!==0)];
  const us=r?[-hu,-hu+r,hu-r,hu]:[-hu,hu],vs=r?[-hv,-hv+r,hv-r,hv]:[-hv,hv];const start=g.p.length/3;
  for(const y of vs)for(const x of us){let p=n.map((a,i)=>a*hn+u[i]*x+v[i]*y);let normal=n;
    if(r){const q=p.map((a,i)=>clamp(a,-h[i]+r,h[i]-r));normal=unit(sub(p,q));p=q.map((a,i)=>a+normal[i]*r);}
    g.vertex(p,normal,[(x+hu)*1.8,(y+hv)*1.8]);
  }
  for(let y=0;y<vs.length-1;y++)for(let x=0;x<us.length-1;x++){const a=start+y*us.length+x,b=a+1,c=a+us.length,d=c+1;g.tri(a,b,d);g.tri(a,d,c);}
 }return g;
}
function lathe(profile,segments=24){
 const g=new Geometry();
 for(let j=0;j<profile.length;j++){
  const [r,y]=profile[j],before=profile[Math.max(0,j-1)],after=profile[Math.min(profile.length-1,j+1)],slope=after[1]===before[1]?0:(after[0]-before[0])/(after[1]-before[1]);
  for(let i=0;i<=segments;i++){const a=TAU*i/segments;g.vertex([r*Math.cos(a),y,r*Math.sin(a)],unit([Math.cos(a),-slope,Math.sin(a)]),[i/segments,y*2]);}
 }
 for(let j=0;j<profile.length-1;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+1,c=a+segments+1,d=c+1;g.tri(a,c,b);g.tri(b,c,d);}
 for(const j of [0,profile.length-1]){
  const [r,y]=profile[j],ny=j===0?-1:1,center=g.vertex([0,y,0],[0,ny,0],[.5,.5]);
  for(let i=0;i<segments;i++){const a=TAU*i/segments,b=TAU*(i+1)/segments;const ia=g.vertex([r*Math.cos(a),y,r*Math.sin(a)],[0,ny,0],[Math.cos(a)*.5+.5,Math.sin(a)*.5+.5]);const ib=g.vertex([r*Math.cos(b),y,r*Math.sin(b)],[0,ny,0],[Math.cos(b)*.5+.5,Math.sin(b)*.5+.5]);if(ny<0)g.tri(center,ia,ib);else g.tri(center,ib,ia);}
 }return g;
}
function rotation(p,angles){let[x,y,z]=p;const[a,b,c]=angles;[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];return[x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c),z];}
class Assembly {
 constructor(name){this.name=name;this.groups=new Map();this.parts=0;}
 add(geometry,position,mat,angles=[0,0,0]){
  if(!this.groups.has(mat))this.groups.set(mat,new Geometry());const out=this.groups.get(mat),start=out.p.length/3;
  for(let i=0;i<geometry.p.length;i+=3){const p=rotation(geometry.p.slice(i,i+3),angles).map((v,j)=>v+position[j]),n=rotation(geometry.n.slice(i,i+3),angles);out.vertex(p,n,geometry.uv.slice(i/3*2,i/3*2+2));}
  for(const i of geometry.indices)out.indices.push(start+i);this.parts++;
 }
 box(position,size,mat,r=0,angles=[0,0,0]){this.add(roundedBox(size,r),position,mat,angles);}
 cylinder(position,r,h,mat,angles=[0,0,0]){this.add(lathe([[r,-h/2],[r,h/2]],20),position,mat,angles);}
 rod(a,b,r,mat){const mid=a.map((v,i)=>(v+b[i])/2),d=sub(b,a),len=Math.hypot(...d);this.cylinder(mid,r,len,mat,[0,0,0]); // replaced below with an exact orthonormal rotation
  const out=this.groups.get(mat),g=lathe([[r,-len/2],[r,len/2]],20),count=g.p.length/3;
  const y=unit(d),x=unit(cross(Math.abs(y[1])<.99?[0,1,0]:[1,0,0],y)),z=cross(x,y),start=out.p.length-count*3;
  for(let i=0;i<count;i++){const p=g.p.slice(i*3,i*3+3),n=g.n.slice(i*3,i*3+3);for(let k=0;k<3;k++){out.p[start+i*3+k]=Math.fround(mid[k]+x[k]*p[0]+y[k]*p[1]+z[k]*p[2]);out.n[start+i*3+k]=Math.fround(x[k]*n[0]+y[k]*n[1]+z[k]*n[2]);}}
 }
}
function book(a,x,y,z,w,h,d,index){const m=10+index%5;
 a.box([x,y+h/2,z],[w,h,d],7);a.box([x-w/2-.002,y+h/2,z],[.009,h+.012,d+.018],m);a.box([x+w/2+.002,y+h/2,z],[.009,h+.012,d+.018],m);
 a.box([x,y+h/2,z+d/2+.005],[w+.012,h+.012,.015],m,.004);
 for(const yy of [y+.035,y+h-.035])a.box([x,yy,z+d/2+.014],[w*.78,.009,.002],2);
}
function desk(){const a=new Assembly('School desk');
 a.box([0,.73,0],[.66,.04,.46],1,.018);a.box([0,.64,0],[.54,.12,.34],3,.012);a.box([0,.653,.178],[.43,.07,.008],17);
 for(const x of [-.265,.265]){a.rod([x,.04,-.15],[x,.705,-.15],.016,3);a.rod([x,.04,.15],[x,.705,.15],.016,3);a.rod([x,.22,-.15],[x,.22,.15],.013,3);
 for(const z of [-.15,.15])a.cylinder([x,.024,z],.022,.048,17);}
 a.rod([-.265,.22,-.15],[.265,.22,-.15],.013,3);a.box([-.11,.759,-.035],[.24,.015,.29],11,.006);a.box([-.11,.77,-.035],[.228,.008,.282],7,.002);a.rod([.1,.753,-.1],[.17,.753,.085],.003,2);return a;}
function schoolChair(){const a=new Assembly('School chair');a.box([0,.445,0],[.39,.04,.4],18,.028);
 for(const x of [-.16,.16]){for(const z of [-.15,.15]){a.rod([x*1.12,.02,z*1.15],[x,.435,z],.013,3);a.cylinder([x*1.12,.022,z*1.15],.02,.04,17);}a.rod([x,.43,.15],[x,.69,.19],.014,3);}
 a.box([0,.74,.19],[.39,.23,.027],18,.025,[-.09,0,0]);for(const x of [-.16,.16])a.cylinder([x,.69,.178],.006,.004,2,[Math.PI/2,0,0]);return a;}
function bookcase(){const a=new Assembly('Moulded bookcase');a.box([0,1.31,-.225],[1.42,2.62,.055],0);
 for(const x of [-.68,.68]){a.box([x,1.3,0],[.12,2.6,.5],0,.014);a.box([x,1.36,.262],[.07,2.23,.055],1,.012);a.box([x,.12,0],[.17,.2,.57],0,.015);a.box([x,2.5,0],[.18,.16,.57],1,.01);}
 for(const y of [.045,.27,.72,1.17,1.62,2.07,2.52]){a.box([0,y,0],[1.49,.065,.56],0,.009);a.box([0,y+.016,.289],[1.5,.012,.025],2,.005);}
 a.box([0,2.635,0],[1.59,.09,.62],0,.012);a.box([0,2.69,0],[1.65,.035,.66],1,.012);a.box([0,.16,.25],[1.17,.16,.04],1,.014);
 for(let row=0;row<5;row++){let x=-.555;for(let i=0;i<13;i++){const w=.045+((i*7+row*13)%5)*.009,h=.27+((i*3+row*2)%7)*.015;book(a,x+w/2,.303+row*.45,.04,w,h,.3,(i*3+row)%11);x+=w+.017;if(x>.56)break;}}
 return a;}
function readingChair(){const a=new Assembly('Upholstered reading chair');
 a.box([0,.405,0],[.69,.12,.65],0,.028);a.box([0,.498,-.012],[.64,.13,.59],4,.057);a.box([0,.845,.245],[.64,.56,.105],0,.055,[.12,0,0]);a.box([0,.86,.178],[.57,.47,.09],4,.047,[.12,0,0]);
 for(const x of [-.278,.278]){for(const z of [-.245,.245]){a.add(lathe([[.027,0],[.036,.025],[.024,.065],[.026,.2],[.038,.28],[.029,.34],[.035,.38]],20),[x,0,z],0);a.cylinder([x,.018,z],.029,.03,2);}
 a.box([x*1.16,.68,-.02],[.07,.075,.64],0,.024);a.rod([x*1.16,.445,-.24],[x*1.16,.65,-.24],.021,0);}
 for(const x of [-.17,0,.17])a.cylinder([x,.88,.124],.009,.008,2,[Math.PI/2,0,0]);return a;}
function table(){const a=new Assembly('Reading table');
 a.box([0,.755,0],[1.9,.075,.94],0,.028);a.box([0,.796,0],[1.72,.012,.77],1,.014);a.box([0,.66,0],[1.59,.13,.68],0,.015);
 for(const x of [-.73,.73])for(const z of [-.29,.29]){a.add(lathe([[.035,0],[.048,.025],[.032,.08],[.029,.18],[.049,.27],[.034,.32],[.033,.46],[.053,.53],[.044,.68]],24),[x,0,z],0);a.cylinder([x,.025,z],.039,.042,2);}
 a.box([0,.81,.06],[.74,.014,.45],10,.014);a.box([-.42,.676,.352],[.3,.065,.019],1,.006);a.cylinder([-.42,.67,.373],.019,.015,2,[Math.PI/2,0,0]);
 a.box([0,.823,.08],[.018,.014,.255],10);
 // Open book: two explicitly angled page blocks, not a texture masquerading as 3D.
 for(const side of [-1,1]){a.box([side*.095,.84,.08],[.187,.017,.255],7,.004,[0,0,side*.12]);for(let i=0;i<7;i++)a.box([side*.095,.852,.002+i*.019],[.126,.001,.002],13,0,[0,0,side*.12]);}
 a.cylinder([.57,.832,-.16],.115,.027,2);a.rod([.57,.845,-.16],[.57,1.2,-.16],.017,2);a.rod([.57,1.18,-.16],[.48,1.26,-.16],.017,2);
 a.box([.42,1.245,-.16],[.31,.13,.2],4,.055);a.box([.42,1.183,-.16],[.275,.012,.17],16,.016);return a;
}
function schoolArchitecture(){const a=new Assembly('Classroom shell');
 a.box([0,-.12,0],[8.5,.24,8],5,.02);for(let x=0;x<12;x++)for(let z=0;z<12;z++)a.box([-3.89+x*.705,.004,-3.67+z*.665],[.69,.01,.65],(x+z)%4===0?8:5,.002);
 a.box([0,1.62,-4],[8.5,3.24,.14],5);a.box([-4.25,.57,0],[.14,1.14,8],5);
 for(const z of [-3.83,-1.28,1.28,3.83])a.box([-4.25,2.08,z],[.14,1.88,.16],5);
 a.box([-4.25,3.16,0],[.14,.16,8],5);
 for(const z of [-2.55,0,2.55]){a.box([-4.23,2.12,z],[.026,1.74,2.32],9);a.box([-4.17,2.12,z],[.055,1.76,.052],3);for(const y of [1.24,2.12,3])a.box([-4.17,y,z],[.075,.055,2.4],3);}
 a.box([0,1.82,-3.888],[5.2,1.38,.055],1,.01);a.box([0,1.82,-3.85],[5.05,1.24,.026],6,.004);a.box([0,1.14,-3.79],[5.2,.032,.13],3,.007);
 // Simple chalk geometry, with no copied page text or brands.
 a.rod([-.8,1.6,-3.83],[.1,1.6,-3.83],.004,7);a.rod([-.8,1.6,-3.83],[-.4,2.15,-3.83],.004,7);a.rod([-.4,2.15,-3.83],[.1,1.6,-3.83],.004,7);
 for(let row=0;row<4;row++)a.box([1.25,2.16-row*.15,-3.831],[1.08-row*.11,.01,.0015],7);
 for(let i=0;i<6;i++){const x=-3.3+i*1.15;a.box([x,.52,3.69],[1.12,1.04,.52],1,.012);for(const xx of [-.265,.265]){a.box([x+xx,.52,3.408],[.51,.9,.032],1,.008);a.cylinder([x+xx+.15,.56,3.383],.015,.015,3,[Math.PI/2,0,0]);}}
 return a;}
function schoolCeiling(){const a=new Assembly('Ceiling - hide for cutaway');a.box([0,3.33,0],[8.5,.08,8],5);
 for(const x of [-2.6,0,2.6])for(const z of [-2.4,0,2.4]){a.box([x,3.25,z],[1.25,.09,.29],3,.012);a.box([x,3.195,z],[1.18,.015,.24],16,.01);}return a;}
function libraryArchitecture(){const a=new Assembly('Library architectural shell');a.box([0,-.14,0],[9.5,.28,9],0,.02);
 for(let row=0;row<18;row++)for(let i=0;i<6;i++){const x=-3.95+i*1.58;a.box([x,.009,-4.235+row*.498],[1.57,.018,.491],0,.001);}
 a.box([0,2.94,-4.48],[9.5,5.88,.18],5);a.box([-4.68,2.94,0],[.18,5.88,9],5);
 // Lower wall panelling and full-height pilasters.
 for(const z of [-3.5,-1.4,.7,2.8]){a.box([-4.56,.61,z],[.055,1.18,1.75],0,.01);a.box([-4.521,.64,z],[.015,.87,1.44],1,.008);}
 for(const x of [-4.3,-2.7,0,2.7,4.3]){a.box([x,2.9,-4.33],[.17,5.8,.15],0,.014);for(const y of [.1,2.85,5.6])a.box([x,y,-4.28],[.25,.15,.25],1,.015);}
 // Mezzanine spans rear and left, with a 1.1 m deep walkable floor.
 a.box([0,2.88,-3.43],[9.2,.2,2.05],0,.013);a.box([-3.94,2.88,.7],[1.3,.2,6.2],0,.013);
 const baluster=(x,z)=>a.add(lathe([[.035,0],[.045,.06],[.025,.14],[.042,.35],[.025,.52],[.035,.69],[.035,.82]],16),[x,2.98,z],0);
 for(let i=0;i<20;i++)baluster(-4.25+i*.353,-2.44);for(let i=0;i<15;i++)baluster(-3.28,-2.1+i*.37);
 a.box([-.83,3.83,-2.44],[7.4,.075,.11],1,.025);a.box([-3.28,3.83,.55],[.11,.075,6.05],1,.025);
 // Real staircase reaches the mezzanine; risers are structural, not floating steps.
 for(let i=0;i<17;i++){const h=(i+1)*2.98/17,z=3.78-i*.32;a.box([3.61,h/2,z],[1.18,h,.324],0);a.box([3.61,h+.009,z+.006],[1.22,.019,.34],1,.007);}
 a.box([3.61,2.89,-2.06],[1.18,.18,1.19],0,.008);
 for(const x of [2.94,4.29]){a.rod([x,.91,3.93],[x,3.8,-1.59],.036,0);for(let i=0;i<9;i++){const z=3.78-i*.64,h=(i*2+1)*2.98/17;a.rod([x,h,z],[x,h+.83,z],.021,0);}}
 a.box([0,.038,.6],[3.22,.025,3.38],15,.005);for(const x of [-1.51,1.51])a.box([x,.052,.6],[.018,.003,3.18],2);for(const z of [-.99,2.19])a.box([0,.052,z],[3.04,.003,.018],2);
 // High window is visible from the open side; opaque daylight glazing is explicitly non-transmissive.
 a.box([-4.57,3.61,.3],[.032,3.58,1.96],9);for(const z of [-.71,.3,1.31])a.box([-4.525,3.61,z],[.075,3.73,.066],0,.008);for(const y of [1.75,3.0,4.3,5.47])a.box([-4.52,y,.3],[.08,.075,2.06],0,.008);
 return a;}
function libraryCeiling(){const a=new Assembly('Coffered ceiling - hide for cutaway');a.box([0,5.96,0],[9.5,.14,9],0);
 for(const x of [-3,-1,1,3])a.box([x,5.82,0],[.13,.17,9],1,.016);for(const z of [-3,-1,1,3])a.box([0,5.82,z],[9.5,.17,.13],1,.016);
 return a;}
function chandelier(){const a=new Assembly('Brass chandelier');a.rod([0,0,0],[0,1.2,0],.022,2);a.add(lathe([[.11,0],[.15,.07],[.1,.14],[.06,.26]],24),[0,0,0],2);
 for(let i=0;i<6;i++){const ang=i*TAU/6,x=Math.cos(ang)*.52,z=Math.sin(ang)*.52;a.rod([0,.1,0],[x,.08,z],.015,2);a.rod([x,.08,z],[x,.23,z],.017,2);a.cylinder([x,.24,z],.076,.035,2);a.cylinder([x,.35,z],.034,.2,16);}return a;}
export function createScene(id){
 if(!ASSETS.some(a=>a.id===id))throw new Error('Unknown reference rebuild asset');
 const assemblies=new Map(),nodes=[];
 const place=(a,p=[0,0,0],yaw=0,ceiling=false)=>{if(!assemblies.has(a.name))assemblies.set(a.name,a);nodes.push({name:a.name,assembly:a.name,translation:p,rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],extras:{role:ceiling?'removable-ceiling':'editable-assembly'}});};
 const d=()=>desk(),sc=()=>schoolChair(),bc=()=>bookcase(),rc=()=>readingChair(),tb=()=>table();
 if(id==='school-room'){place(schoolArchitecture());place(schoolCeiling(),[0,0,0],0,true);const deskModel=d(),chairModel=sc();for(let row=0;row<6;row++)for(let col=0;col<4;col++){const x=-2.48+col*1.5,z=-2.5+row*.9;place(deskModel,[x,0,z]);place(chairModel,[x,0,z+.53]);}}
 if(id==='school-desk'){place(d());place(sc(),[0,0,.55]);}
 if(id==='library-room'){place(libraryArchitecture());place(libraryCeiling(),[0,0,0],0,true);const shelves=bc(),chairModel=rc(),tableModel=tb();for(const y of [0,2.98])for(const x of [-3.3,-1.65,0,1.65,3.3])place(shelves,[x,y,-4.02]);for(const z of [-.3,1.25,2.8])place(shelves,[-4.07,0,z],Math.PI/2);place(tableModel,[0,0,.35]);place(chairModel,[-.55,0,1.27]);place(chairModel,[.55,0,1.27]);place(chairModel,[-.55,0,-.64],Math.PI);place(chairModel,[.55,0,-.64],Math.PI);place(chandelier(),[0,4.7,0]);}
 if(id==='bookcase')place(bc());if(id==='reading-table')place(tb());if(id==='reading-chair')place(rc());
 return {id,assemblies:[...assemblies.values()],nodes,materials:MATERIALS,textureBytes:[png('wood'),png('linen')]};
}
/** GLB 2.0 with named assemblies, UVs, embedded PNG textures, PBR materials, no external resource URLs. */
export function exportGlb(scene){
 const chunks=[],views=[],accessors=[],meshes=[];let length=0;
 const append=(bytes,target)=>{const padding=(4-length%4)%4;if(padding){chunks.push(new Uint8Array(padding));length+=padding;}const index=views.length;views.push({buffer:0,byteOffset:length,byteLength:bytes.length,...(target?{target}:{})});chunks.push(bytes);length+=bytes.length;return index;};
 const accessor=(values,components,indices=false)=>{const typed=indices?new Uint32Array(values):new Float32Array(values);const bytes=new Uint8Array(typed.length*4),data=new DataView(bytes.buffer);for(let i=0;i<typed.length;i++)if(indices)data.setUint32(i*4,typed[i],true);else data.setFloat32(i*4,typed[i],true);const bounds={min:Array(components).fill(Infinity),max:Array(components).fill(-Infinity)};
  for(let i=0;i<typed.length;i++){const c=i%components;bounds.min[c]=Math.min(bounds.min[c],typed[i]);bounds.max[c]=Math.max(bounds.max[c],typed[i]);}
  const n=accessors.length;accessors.push({bufferView:append(bytes,indices?34963:34962),componentType:indices?5125:5126,count:typed.length/components,type:components===1?'SCALAR':`VEC${components}`,...bounds});return n;};
 for(const assembly of scene.assemblies){const primitives=[];for(const [material,g]of assembly.groups){primitives.push({attributes:{POSITION:accessor(g.p,3),NORMAL:accessor(g.n,3),TEXCOORD_0:accessor(g.uv,2)},indices:accessor(g.indices,1,true),material});}meshes.push({name:assembly.name,primitives});}
 const images=scene.textureBytes.map((bytes,i)=>({name:i?'Woven linen':'Procedural wood',bufferView:append(bytes),mimeType:'image/png'}));
 const nodes=scene.nodes.map(n=>{const{assembly,...node}=n;return {...node,mesh:scene.assemblies.findIndex(a=>a.name===assembly)};});
 const doc={asset:{version:'2.0',generator:'ToonStudio reference-rebuild generator v1',copyright:'Preview-reference recreation. Not an ACON original; not declared CC0.'},scene:0,scenes:[{name:scene.id,nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials:scene.materials,images,textures:images.map((_,source)=>({source,sampler:0})),samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],buffers:[{byteLength:length}],bufferViews:views,accessors,extras:{provenance:{kind:'preview-reference-rebuild',referenceUrl:ASSETS.find(a=>a.id===scene.id).reference,permission:'User stated separate permission; no blanket public-domain or sublicensing claim.',sourceOriginalAvailable:false,unseenGeometry:'Newly designed; not recovered from previews'},units:'metres',version:VERSION}};
 const raw=encoder.encode(JSON.stringify(doc)),json=new Uint8Array(Math.ceil(raw.length/4)*4).fill(32);json.set(raw);const bin=new Uint8Array(Math.ceil(length/4)*4);bin.set(concat(chunks));const bytes=new Uint8Array(12+8+json.length+8+bin.length),v=new DataView(bytes.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,json.length,true);v.setUint32(16,0x4e4f534a,true);bytes.set(json,20);const p=20+json.length;v.setUint32(p,bin.length,true);v.setUint32(p+4,0x004e4942,true);bytes.set(bin,p+8);return bytes;
}
export function createAsset(id){return exportGlb(createScene(id));}
