import {guideFor,guideId,sameGuide} from './place-guide.js';
import {allowedMapsUrl} from './location.js';
export const FULL_FORMAT='agenda-viajera-pin-records-v2';
export const PLACE_FIELDS=['name','description','label','importance','priority','google_maps_url','assignment_mode','assigned_dates','assigned_areas','visited'];
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=m=>{throw Error(m);};
const secret=k=>/^(?:__proto__|constructor|prototype|password|passwd|secret|token|access_token|refresh_token|authorization|credentials|api_key|service[_-]?role)$/i.test(k);
const protectedGuide=k=>secret(k)||/^(?:geo|lat|lng|latitude|longitude|owner|permissions|voice|voice_preferences|speech_rate)$/i.test(k);
function clean(v){if(Array.isArray(v))return v.map(clean);if(obj(v))return Object.fromEntries(Object.entries(v).filter(([k])=>!secret(k)&&!/^(voice|voice_preferences|speech_rate)$/i.test(k)).map(([k,x])=>[k,clean(x)]));return v;}
export function mergeContent(base,patch){if(!obj(patch))return structuredClone(patch);const out=obj(base)?structuredClone(base):{};for(const[k,v]of Object.entries(patch))out[k]=obj(v)?mergeContent(out[k],v):structuredClone(v);return out;}
function delta(before,after,prefix,changes,guide=false,depth=0){
 if(!obj(after)||depth>12)fail('Estructura de contenido no válida.');const out={};
 for(const[k,v]of Object.entries(after)){
  if(sameGuide(v,before?.[k]))continue;
  if(secret(k)||guide&&protectedGuide(k))fail('Campo protegido: '+prefix+'.'+k);
  if(obj(v)){const part=delta(before?.[k],v,prefix+'.'+k,changes,guide,depth+1);if(Object.keys(part).length)out[k]=part;}
  else{if(guide&&!safeTree(v))fail('Campo protegido en contenido.');out[k]=v;changes.push({field:prefix+'.'+k,before:before?.[k],after:v});}
 }return out;
}
function safeTree(v,depth=0){return depth<=12&&(Array.isArray(v)?v.every(x=>safeTree(x,depth+1)):!obj(v)||Object.entries(v).every(([k,x])=>!protectedGuide(k)&&safeTree(x,depth+1)));}
function validateGuide(g){
 if(Object.hasOwn(g,'audio_guide')&&(typeof g.audio_guide!=='string'||g.audio_guide.length>80000))fail('audio_guide debe ser texto de hasta 80.000 caracteres.');
 for(const k of['reviewed_at','checked_at'])if(g[k]!=null&&(typeof g[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(g[k])||Number.isNaN(Date.parse(g[k]))||new Date(g[k]).toISOString().slice(0,10)!==g[k]))fail('Fecha no válida.');
 if(g.sources!=null){if(!Array.isArray(g.sources))fail('sources debe ser una lista.');for(const s of g.sources){let u;try{u=new URL(typeof s==='string'?s:s.url);}catch{fail('Fuente HTTPS no válida.');}if(u.protocol!=='https:'||u.username||u.password||[...u.searchParams.keys()].some(secret))fail('Fuente HTTPS no válida.');}}
}
export function fullSnapshot({pin,records=[],pending=[],conflicts=[],canEdit=false,serverReady=false}){
 if(!pin||pin.kind!=='places_of_interest'||pin.deleted_at)fail('El lugar no está disponible.');
 const found=records.filter(r=>r.kind==='app_settings'&&r.data?.type==='place_guide'&&r.data.place_id===pin.id);if(found.length>1||found[0]?.deleted_at)fail('Asociación de guía inválida.');
 const g=guideFor(records,pin.id),project=r=>({id:r.id,trip_id:r.trip_id,kind:r.kind,version:r.version||0,data:clean(r.data)});
 const value={format:FULL_FORMAT,pin:project(pin),guide:g?project(g):{id:null,trip_id:pin.trip_id,kind:'app_settings',version:0,data:{type:'place_guide',place_id:pin.id,poi_code:pin.data.poi_code||null,name:pin.data.name,guide:{}}}};
 const ids=new Set([pin.id,g?.id]);return{value,text:JSON.stringify(value,null,2),fingerprint:JSON.stringify([pin,g||null]),guideId:g?.id||null,canEdit,serverReady,pending:pending.some(r=>ids.has(r.record_id)),conflicts:conflicts.some(r=>ids.has(r.record_id)&&!r.deleted_at&&!r.resolved_at)};
}
export function validateFull(text,base,current=base){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>400000)fail('JSON demasiado grande (400 KB).');let p;try{p=JSON.parse(text);}catch{fail('JSON inválido.');}
 if(!obj(p)||p.format!==FULL_FORMAT||Object.keys(p).some(k=>!['format','pin','guide'].includes(k)))fail('Formato no válido.');
 const changes=[],place={},guide={};
 for(const group of['pin','guide']){
  if(!Object.hasOwn(p,group))continue;const r=p[group],old=base.value[group];
  if(!obj(r)||Object.keys(r).some(k=>!['id','trip_id','kind','version','data'].includes(k)))fail('Registro no válido.');
  for(const k of['id','trip_id','kind','version'])if(!Object.hasOwn(r,k)||!sameGuide(r[k],old[k]))fail('Identidad o versión protegida: '+group+'.'+k);
  if(!obj(r.data))fail('data debe ser un objeto.');
  if(group==='pin')for(const[k,v]of Object.entries(r.data)){if(sameGuide(v,old.data[k]))continue;if(!PLACE_FIELDS.includes(k))fail('Campo del lugar protegido: '+k);place[k]=v;changes.push({field:'pin.data.'+k,before:old.data[k],after:v});}
  else{for(const[k,v]of Object.entries(r.data))if(k!=='guide'&&!sameGuide(v,old.data[k]))fail('Identidad de guía protegida.');if(Object.hasOwn(r.data,'guide'))Object.assign(guide,delta(old.data.guide,r.data.guide,'guide.data.guide',changes,true));}
 }
 for(const[k,v]of Object.entries(place)){
  if(['assigned_dates','assigned_areas'].includes(k)){if(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string'||x.length>250))fail('Asignación inválida.');if(k==='assigned_dates'&&v.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||Number.isNaN(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x))fail('Fecha de asignación inválida.');}
  else if(k==='visited'){if(typeof v!=='boolean')fail('visited debe ser booleano.');}
  else if(k==='google_maps_url'){if(v!==null&&(!allowedMapsUrl(v)))fail('Enlace Google Maps inválido.');}
  else if(typeof v!=='string'||v.length>({name:250,description:4000,label:100}[k]||100))fail('Texto del lugar inválido: '+k);
  if(k==='name'&&!v.trim())fail('Nombre obligatorio.');
  if(({importance:['optional','itinerary'],priority:['normal','important','reference'],assignment_mode:['auto','manual']}[k]||[v]).includes(v)===false)fail('Opción no válida: '+k);
 }
 validateGuide(mergeContent(base.value.guide.data.guide,guide));
 if(base.fingerprint!==current.fingerprint)fail('El lugar o la guía cambió. Restaura el original.');
 if(changes.length&&!current.canEdit)fail('Solo lectura.');if(changes.length&&(current.pending||current.conflicts))fail('Hay cambios pendientes o conflictos.');
 return{changes,unchanged:['Identificadores, viaje y controles internos','Campos omitidos','Preferencias de voz del dispositivo'],patch:{place,guide}};
}
export async function fullAccess(remote,id){try{const a=await remote.rpc('av2_pin_json_full_access',{...remote.credentials(),p_place:id});return a?.contract===2&&a.can_edit===true;}catch{return false;}}
export async function saveFull({text,base,load,remote,store,requestId,online=globalThis.navigator?.onLine!==false}){
 if(!online)fail('Sin conexión. Conserva el JSON; no se ha enviado.');const current=await load(),plan=validateFull(text,base,current);if(!plan.changes.length)return{state:'unchanged'};if(!current.serverReady)fail('Contrato de guardado no disponible.');
 const actor=store.activeUser?.id;let result;try{await remote.check();result=await remote.rpc('av2_pin_json_full_save',{...remote.credentials(),p_place:base.value.pin.id,p_pin_version:base.value.pin.version,p_guide_version:base.value.guide.version,p_patch:plan.patch,p_request_id:requestId});}catch(e){fail(/CONFLICT/.test(e.message)?'Conflicto: carga la versión actual y compara de nuevo.':'Error de sincronización. No se confirmó el guardado; conserva el JSON y reintenta.');}
 const [oldPin,oldGuide]=JSON.parse(base.fingerprint),pin=result?.pin,g=result?.record,changedPlace=Object.keys(plan.patch.place).length>0;
 if(!result?.persisted||!pin||pin.id!==oldPin.id||pin.trip_id!==oldPin.trip_id||pin.kind!=='places_of_interest'||pin.deleted_at||pin.version!==oldPin.version+(changedPlace?1:0)||Object.entries({...oldPin.data,...plan.patch.place}).some(([k,v])=>!['updated_at','updated_by','updated_source','updated_external_actor'].includes(k)&&!sameGuide(pin.data[k],v)))fail('Respuesta del lugar no confirmada.');
 if(g){const expected=base.guideId||await guideId(pin.trip_id,pin.id);if(g.id!==expected||g.trip_id!==pin.trip_id||g.kind!=='app_settings'||g.deleted_at||g.data?.place_id!==pin.id||g.data.name!==pin.data.name||g.data.poi_code!==pin.data.poi_code||!sameGuide(g.data.guide,mergeContent(oldGuide?.data.guide||{},plan.patch.guide))||g.version<(oldGuide?.version||0))fail('Respuesta de guía no confirmada.');}else if(oldGuide||Object.keys(plan.patch.guide).length)fail('Guía no confirmada.');
 if(store.activeUser?.id!==actor)fail('Guardado confirmado por servidor; cambió la sesión local. Actualiza.');
 let state;try{state=await store.ingestPinJsonFull(pin,g);}catch{fail('Servidor confirmó el guardado; falló la caché. Actualiza para recuperar el contenido.');}return{state,record:g,pin};
}

export function collapsePinSections(root){for(const node of [...root.children]){if(node.tagName!=='SECTION'&&!node.hasAttribute('data-pin-audio'))continue;const title=node.querySelector('h2,h3'),details=document.createElement('details'),summary=document.createElement('summary');details.className=node.className||'card section';summary.textContent=title?.textContent||'Escuchar este lugar';title?.remove();details.append(summary);node.replaceWith(details);details.append(node);}}
