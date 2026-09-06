/** pnpm exec tsx scripts/verify-studio-wearable-v5.mts [--assets-only] */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { chromium } from "playwright";
import { build } from "vite";

const directory=resolve(".artifacts/studio-wearable-v5");
await rm(directory,{recursive:true,force:true});await mkdir(join(directory,"screenshots"),{recursive:true});
const entry=join(directory,"entry.ts");
const domain=resolve("apps/web/src/domains/creator");
const source=[
  "export * as THREE from 'three';",
  "export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';",
  "export {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';",
  "export {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';",
  "export * as React from 'react';",
  "export {createRoot} from 'react-dom/client';",
  "export {Canvas,useFrame,useThree} from '@react-three/fiber';",
  ...["studio-vrm-wardrobe","studio-vrm-garment-fit","studio-vrm-props","studio-vrm-prop-rig","studio-vrm-poser-utils","studio-vrm-costume-runtime","StudioVrmWardrobePropsProjection"].map((name)=>`export * from ${JSON.stringify(join(domain,"vrm",name))};`),
  `export * from ${JSON.stringify(join(domain,"studio-pose-presets"))};`,
].join("\n");
await writeFile(entry,source);
await build({configFile:false,publicDir:false,resolve:{alias:{"@":process.cwd()}},define:{"process.env.NODE_ENV":JSON.stringify("production")},build:{outDir:join(directory,"runtime"),lib:{entry,formats:["es"],fileName:()=>"runtime.mjs"},minify:false,sourcemap:false}});
await copyFile("scripts/studio-wearable-review-page.mjs",join(directory,"page.mjs"));
await copyFile("scripts/studio-wearable-frame-evidence.mjs",join(directory,"runtime/frame-evidence.mjs"));
await writeFile(join(directory,"index.html"),'<!doctype html><html lang="en"><meta charset="utf-8"><title>Wearable production-renderer review</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}</style><div id="root"></div><script type="module" src="/page.mjs"></script></html>');
await symlink(resolve("apps/web/public/assets"),join(directory,"assets"),"dir");
await symlink(resolve("apps/web/public/vrm"),join(directory,"vrm"),"dir");
const mime:Record<string,string>={".html":"text/html",".js":"application/javascript",".mjs":"application/javascript",".json":"application/json",".glb":"model/gltf-binary",".vrm":"model/gltf-binary",".png":"image/png",".jpg":"image/jpeg",".wasm":"application/wasm"};
const server=createServer((req,res)=>{
  let file:string;
  try{file=resolve(directory,`.${decodeURIComponent(new URL(req.url??"/","http://localhost").pathname)}`);}catch{res.writeHead(400);res.end();return;}
  if(file===directory)file=join(directory,"index.html");
  if(!file.startsWith(directory+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader("Content-Type",mime[extname(file)]??"application/octet-stream");
  const stream=createReadStream(file);stream.on("error",()=>{if(!res.headersSent)res.writeHead(500);res.end();});stream.pipe(res);
});
await new Promise<void>((done)=>server.listen(5278,"127.0.0.1",done));
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"],...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
const page=await browser.newPage({viewport:{width:800,height:800},deviceScaleFactor:1});
const pageErrors:string[]=[];page.on("pageerror",(error)=>pageErrors.push(error.message));
interface Frame {title:string;file:string;status:string;receipt:unknown;error?:string;distinctColors?:number;nonblank?:boolean;foregroundPixels?:number;largestComponent?:number;occupiedWidth?:number;occupiedHeight?:number}
const frames:Frame[]=[];
const assets=JSON.parse(readFileSync("apps/web/public/assets/3d/wearable-v5-manifest.json","utf8")) as {assets:{id:string;file:string;sha256:string}[]};
let fatal:unknown=null;
async function inspect(){return page.evaluate(async()=>{
  // Keep pixel analysis in the browser: sending 102,400 numeric values per frame through
  // Playwright is unnecessary. This imports the exact module used by the Node controls.
  const moduleUrl="/runtime/frame-evidence.mjs";
  const {measureWearableFramePixels}=await import(moduleUrl) as {
    measureWearableFramePixels:(rgba:Uint8ClampedArray,width:number,height:number)=>{
      nonblank:boolean;foregroundPixels:number;largestComponent:number;occupiedWidth:number;occupiedHeight:number;
    };
  };
  const api=(window as unknown as {studioWearableQA:{status:string;frames:number;receipt:unknown}}).studioWearableQA;
  const canvas=document.querySelector("canvas");
  if(!canvas)return {status:api.status,receipt:api.receipt,distinctColors:0,...measureWearableFramePixels(new Uint8ClampedArray(),160,160)};
  const copy=document.createElement("canvas");copy.width=160;copy.height=160;
  const ctx=copy.getContext("2d")!;ctx.drawImage(canvas,0,0,160,160);
  const data=ctx.getImageData(0,0,160,160).data;const colors=new Set<string>();
  for(let i=0;i<data.length;i+=16)colors.add(`${data[i]!>>4},${data[i+1]!>>4},${data[i+2]!>>4}`);
  return {status:api.status,receipt:api.receipt,distinctColors:colors.size,...measureWearableFramePixels(data,160,160)};
});}
async function capture(title:string){
  await page.waitForFunction(()=>{
    const qa=(window as unknown as {studioWearableQA:{frames:number;status:string}}).studioWearableQA;
    return qa.frames>=4&&(qa.status==="ready"||qa.status==="unavailable");
  },{},{timeout:45_000});
  const info=await inspect();
  const file=`screenshots/${title.replace(/[^a-zA-Z0-9_-]/gu,"_")}.png`;
  await page.locator("canvas").first().screenshot({path:join(directory,file)});
  frames.push({title,file,...info});
  console.log(`FRAME ${title}: ${info.status}, ${info.distinctColors} colors`);
}
async function select(options:Record<string,unknown>){await page.evaluate(async (value)=>{
  await (window as unknown as {studioWearableQA:{select:(input:unknown)=>Promise<void>}}).studioWearableQA.select(value);
},options);}
async function view(angle:number,crop:string){await page.evaluate(({angle,crop})=>{
  (window as unknown as {studioWearableQA:{view:(angle:number,crop:string)=>void}}).studioWearableQA.view(angle,crop);
},{angle,crop});}
try{
  await page.goto("http://127.0.0.1:5278",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>(window as unknown as {studioWearableQA?:{status:string}}).studioWearableQA?.status==="idle",{},{timeout:60_000});
  for(const asset of assets.assets){
    try{
      await select({type:"asset",id:asset.id,assetUrl:`/assets/3d/${asset.file}`,angle:30});
      for(const angle of [30,90,180]){await view(angle,"full");await capture(`asset-${asset.id}-${angle}`);}
    }catch(error){frames.push({title:`asset-${asset.id}`,file:"",status:"error",receipt:null,error:String(error)});}
  }
  if(!process.argv.includes("--assets-only")){
    const catalogue=await page.evaluate(()=>(window as unknown as {studioWearableQA:{catalogue:{wardrobe:{id:string;slot:string}[]}}}).studioWearableQA.catalogue.wardrobe);
    for(const model of ["sample","avatar-b"]){
      await select({type:"native",id:"native",model});await capture(`${model}-native`);
      for(const garment of catalogue){
        try{
          await select({type:"wardrobe",id:garment.id,model,angle:30});
          for(const angle of [30,90,180]){await view(angle,"full");await capture(`${model}-wardrobe-${garment.id}-${angle}`);}
          const pose=garment.slot==="top"||garment.slot==="outer"?"arms-up":"bent-knees";
          await page.evaluate((kind)=>(window as unknown as {studioWearableQA:{pose:(name:string)=>void}}).studioWearableQA.pose(kind),pose);
          await view(30,"full");await capture(`${model}-wardrobe-${garment.id}-${pose}`);
        }catch(error){frames.push({title:`${model}-wardrobe-${garment.id}`,file:"",status:"error",receipt:null,error:String(error)});}
      }
      for(const asset of assets.assets){
        try{
          const head=["cap","beret","sunglasses","headphones","ribbon","beanie","blender_wizard_hat"].includes(asset.id);
          const crop=head?"head":asset.id==="shoulderbag"?"torso":"hand";
          await select({type:"prop",id:asset.id,model,angle:30,crop});
          for(const angle of [30,90,180]){await view(angle,crop);await capture(`${model}-prop-${asset.id}-${angle}`);}
          await view(30,"full");await capture(`${model}-prop-${asset.id}-full`);
        }catch(error){frames.push({title:`${model}-prop-${asset.id}`,file:"",status:"error",receipt:null,error:String(error)});}
      }
    }
  }
}catch(error){fatal=String(error);}
try{
  const pictured=frames.filter((frame)=>frame.file);
  for(let start=0;start<pictured.length;start+=12){
    const subset=pictured.slice(start,start+12).map((frame)=>({title:frame.title,status:frame.status,image:readFileSync(join(directory,frame.file)).toString("base64")}));
    const data=await page.evaluate(async (items)=>{
      const width=320,height=352;const canvas=document.createElement("canvas");canvas.width=width*4;canvas.height=height*Math.ceil(items.length/4);
      const ctx=canvas.getContext("2d")!;ctx.fillStyle="#17202b";ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let i=0;i<items.length;i++){
        const item=items[i]!;const image=new Image();image.src=`data:image/png;base64,${item.image}`;await image.decode();
        const x=i%4*width,y=Math.floor(i/4)*height;ctx.drawImage(image,x,y,width,width);
        ctx.fillStyle=item.status==="ready"?"#ffffff":"#ffb4a8";ctx.font="12px sans-serif";ctx.fillText(`${item.title} [${item.status}]`,x+5,y+339,width-10);
      }
      return canvas.toDataURL("image/jpeg",.94).split(",")[1]!;
    },subset);
    await writeFile(join(directory,`contact-sheet-${String(start/12+1).padStart(2,"0")}.jpg`),Buffer.from(data,"base64"));
  }
}finally{
  await writeFile(join(directory,"review.json"),JSON.stringify({sourceCommit:process.env.GITHUB_SHA??"local",assets:assets.assets,frames,pageErrors,fatal,note:"Ready means loaded/rendered, not human aesthetic approval. Inspect the PNGs, worn views and deformation frames."},null,2));
  await browser.close();await new Promise<void>((done)=>server.close(()=>done()));
}
const failingAssets=frames.filter((frame)=>(frame.title.startsWith("asset-")||frame.title.includes("-prop-"))&&(frame.status!=="ready"||!frame.nonblank));
if(fatal||pageErrors.length||failingAssets.length)throw new Error(JSON.stringify({fatal,pageErrors,failingAssets},null,2));
console.log(`Saved ${frames.filter((frame)=>frame.file).length} real rendered frames in ${directory}`);
