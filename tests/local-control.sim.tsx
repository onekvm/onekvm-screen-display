import assert from "node:assert/strict";
import { nextTick } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { rootMirror } from "@pocketjs/framework/renderer";
import VirtualMedia from "../apps/virtual-media/src/VirtualMedia";
import KeyboardApp from "../apps/keyboard/src/KeyboardApp";
import { __packTouch } from "../../tmp/pocketjs/framework/src/touch";

const scene = process.argv[2];
const [w, h] = (process.env.SCREEN_SIM_SIZE || "320x172").split("x").map(Number);
const language = process.env.SCREEN_SIM_LANG || "en";
const labels = {
  en: { iso:"CD-ROM", sources:"Extension paths", mount:"Mount", connectAndMount:"Connect & mount", connectFailed:"USB connection failed; retry", disconnected:"USB disconnected; retry mount", eject:"Eject", cancel:"Cancel", refresh:"Refresh", text:"Type text", keys:"Common keys", locks:"Lock keys", caps:"Caps Lock", edit:"Edit", send:"Send" },
  zh: { iso:"虚拟光驱", sources:"扩展路径", mount:"挂载", connectAndMount:"连接并挂载", connectFailed:"USB 连接失败，请重试", disconnected:"USB 未连接，请重试挂载", eject:"弹出", cancel:"取消", refresh:"刷新", text:"文本输入", keys:"常用按键", locks:"锁定键", caps:"大写锁定", edit:"编辑", send:"发送" },
  zh_tw: { iso:"虛擬光碟機", sources:"擴充路徑", mount:"掛載", connectAndMount:"連線並掛載", connectFailed:"USB 連線失敗，請重試", disconnected:"USB 未連線，請重試掛載", eject:"退出", cancel:"取消", refresh:"重新整理", text:"文字輸入", keys:"常用按鍵", locks:"鎖定鍵", caps:"大寫鎖定", edit:"編輯", send:"傳送" },
}[language as "en"|"zh"|"zh_tw"];
const keys = new Map(Object.entries({ screenW:String(w),screenH:String(h),controls:'["touch","rotary"]',knobSeq:"0",language,appStateGeneration:"1" }));
const requests: any[] = [];
(globalThis as any).onekvm = { get:(key:string)=>keys.get(key)||"",set:(key:string,value:string)=>{keys.set(key,value);if(key==="appRequest")requests.push(JSON.parse(value));} };
let nodeId=2;
const noop=()=>{};
const ops={createNode:()=>nodeId++,destroyNode:noop,insertBefore:noop,removeChild:noop,setStyle:noop,setProp:noop,setText:noop,replaceText:noop,setImage:noop,setSprite:noop,uploadTexture:()=>1,setFocus:noop,setActive:noop,measureText:()=>8,__textures:{}};
(globalThis as any).ui=ops;
type Node={text?:string;children:Node[];onPress?():void};
const root=rootMirror as unknown as Node;
function texts(node=root):string[]{return [...(node.text?[node.text]:[]),...node.children.flatMap(texts)];}
function button(text:string,node=root):Node|undefined{return node.onPress&&texts(node).includes(text)?node:node.children.map(child=>button(text,child)).find(Boolean);}
async function frame(touches:number[]=[]){(globalThis as any).frame(0,0,touches);await nextTick();}
async function tap(text:string){assert.ok(button(text),`missing ${text}: ${texts().join('|')}`);button(text)!.onPress!();await frame();await frame();}
async function back(){await frame([__packTouch(0,28,20)]);await frame();await frame();}
async function reply(response:unknown,ok=true,requestId=requests.at(-1).requestId,error="test error"){keys.set("appResponse",JSON.stringify({requestId,ok,response,error:ok?"":error}));await frame();await frame();}
let sequence=0;
async function rotary(step:number,click=false){keys.set("knobSeq",String(++sequence));keys.set("knob",String(step));keys.set("knobClick",click?"1":"0");keys.set("knobHold","0");await frame();await frame();}
mount(()=>scene==="media"?<VirtualMedia/>:<KeyboardApp/>,{ops});await frame();await frame();
assert.equal(requests.length,1);assert.equal(requests[0].method,"get");
if(scene==="media"){
  const snapshot={status:{available:true,connected:false,iso_mounted:undefined as string|undefined},media:[{id:"local-iso",kind:"iso",name:"Local.iso",size:1048576}],sources:[{extension:"samba",directory:"library",name:"NAS images",available:true},{extension:"samba",directory:"offline",name:"Offline",available:false}]};
  await reply(snapshot,true,"another-guest");assert.equal(requests.length,1);
  await reply(snapshot);
  for(let n=0;n<100;n++)await frame();assert.equal(requests.length,1,"idle media App polled");
  await tap(labels.iso);await tap("Local.iso");
  const beforeCancel=requests.length;await tap(labels.cancel);assert.equal(requests.length,beforeCancel,"cancel mounted media");
  await tap("Local.iso");await tap(labels.connectAndMount);
  assert.equal(requests.at(-1).method,"connect","disconnected mount did not connect first");
  const connecting=requests.length;await tap(labels.connectAndMount);assert.equal(requests.length,connecting,"duplicate connection while busy");
  await reply({},false);assert.equal(requests.length,connecting,"failed connection proceeded to mount");
  assert.ok(texts().includes(labels.connectFailed),"connection failure was not explained");
  await tap(labels.connectAndMount);assert.equal(requests.at(-1).method,"connect");
  const cancelledConnect=requests.length;await back();await reply({connected:true});
  assert.equal(requests.at(-1).method,"get","cancelled connection did not refresh state");
  assert.equal(requests.length,cancelledConnect+1,"Back during connection mounted image");
  await reply(snapshot); // USB may have been disconnected by another client.
  await tap("Local.iso");await tap(labels.connectAndMount);const connectedRequest=requests.length;
  await reply({connected:true});assert.equal(requests.length,connectedRequest+1);
  assert.equal(requests.at(-1).method,"mount","connection completion did not mount before refreshing");
  assert.deepEqual(requests.at(-1).request,{id:"local-iso"});
  await tap(labels.connectAndMount);assert.equal(requests.length,connectedRequest+1,"duplicate mount while busy");
  await reply({});assert.equal(requests.at(-1).method,"get");
  snapshot.status.connected=true;snapshot.status.iso_mounted="local-iso";await reply(snapshot);
  await tap("Local.iso");await tap(labels.eject);assert.equal(requests.at(-1).method,"eject");
  await reply({});snapshot.status.iso_mounted=undefined;await reply(snapshot);
  // A later external disconnect must show an actionable failure and keep selection.
  await tap("Local.iso");await tap(labels.mount);assert.equal(requests.at(-1).method,"connect");await reply({connected:true});
  await reply({},false,requests.at(-1).requestId,"virtual media is disconnected");
  assert.ok(texts().includes(labels.disconnected));
  await tap(labels.mount);assert.equal(requests.at(-1).method,"connect","retry trusted stale USB state");
  const retryConnection=requests.length;await tap(labels.cancel);await reply({connected:true});
  assert.equal(requests.length,retryConnection+1);assert.equal(requests.at(-1).method,"get","Cancel during retry mounted image");await reply(snapshot);
  const beforeSources=requests.length;
  await tap(labels.sources);await tap("Offline");assert.equal(requests.length,beforeSources,"offline source browsed");
  await tap("NAS images");assert.equal(requests.at(-1).method,"browse");assert.deepEqual(requests.at(-1).request,{extension:"samba",directory:"library",path:"",kind:"iso"});
  await reply({entries:[{name:"nested",path:"nested",directory:true}]});await tap("nested");assert.equal(requests.at(-1).request.path,"nested");
  const pendingFolder=requests.at(-1).requestId;
  await back();
  await reply({entries:[{name:"late.iso",path:"nested/late.iso",directory:false,media:{id:"late",kind:"iso",name:"late.iso",size:1}}]},true,pendingFolder);
  assert.equal(requests.at(-1).request.path,"","late folder response did not reload parent");
  assert.ok(!texts().includes("late.iso"),"late child contents appeared in parent");
  await reply({entries:[{name:"parent",path:"parent",directory:true}]});await tap("parent");
  assert.equal(requests.at(-1).request.path,"parent","folder named parent was mistaken for navigation");
  await reply({entries:[]});await back();await reply({entries:[{name:"nested",path:"nested",directory:true}]});await tap("nested");
  const image={id:"external-abcdef",kind:"iso",name:"安装.iso",size:2097152};
  await reply({entries:[{name:image.name,path:"nested/安装.iso",directory:false,media:image}]});await tap(image.name);await tap(labels.mount);
  assert.equal(requests.at(-1).method,"connect");await reply({connected:true});
  assert.equal(requests.at(-1).method,"mount");assert.equal(requests.at(-1).request.id,image.id);
  await reply({status:"ok"});assert.equal(requests.at(-1).method,"get","mount did not re-read actual state");
  await reply(snapshot);assert.equal(requests.at(-1).method,"browse","visible folder was not refreshed");
  await reply({},false);const retry=requests.length;await tap(labels.refresh);assert.equal(requests.length,retry+1,"failed browse could not retry");
  await reply({entries:[]});await back();assert.equal(requests.at(-1).request.path,"");await reply({entries:[]});
  await back();await back();await back();
  await rotary(1);await rotary(0,true);assert.ok(texts().includes(labels.sources),"rotary did not open drive list");
}else{
  await reply({known:false,num_lock:false,caps_lock:false,scroll_lock:false});
  for(let n=0;n<100;n++)await frame();assert.equal(requests.length,1,"idle keyboard App polled");
  await tap(labels.locks);assert.ok(texts().includes(language==="en"?"Unknown":"未知"),"unknown HID LEDs appeared off");await back();
  await tap(labels.keys);await tap("F12");assert.deepEqual(requests.at(-1).request,{modifiers:0,keys:[0x45]});await reply({status:"ok"});await reply({known:true,caps_lock:false});
  await back();await tap(labels.locks);await tap(labels.caps);assert.deepEqual(requests.at(-1).request.keys,[0x39]);await reply({status:"ok"});await reply({known:true,caps_lock:true});
  keys.set("system",JSON.stringify({hid:{caps_lock:false}}));await frame();await back();await tap(labels.text);await tap(labels.edit);
  // Real touch presses use the existing soft-keyboard hit regions.
  const { layoutKeys }=await import("../src/shell/keypad");
  for(const token of ["a","d","OK"]){const cap=layoutKeys("text",0,{w,h}).caps.find(cap=>cap.token===token);assert.ok(cap,`missing cap ${token}`);await frame([__packTouch(0,Math.round(cap.x+cap.w/2),Math.round(cap.y+cap.h/2))]);await frame();await frame();}
  const beforeSend=requests.length;await tap(labels.send);assert.equal(requests.length,beforeSend+1);assert.deepEqual(requests.at(-1).request,{text:"ad"});
  await reply({},false);assert.ok(texts().includes("ad"),"failed send discarded text");await back();
  keys.set("knobSeq",String(++sequence));keys.set("knobHold","1");await frame();assert.equal(keys.get("launch"),"shell");
}
console.log(`${scene} ${w}x${h}/${language}: passed`);
