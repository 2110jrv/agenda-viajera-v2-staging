import {GUIDE_SECTIONS,guideFor,guideId,sameGuide} from './place-guide.js';

export const PIN_JSON_FORMAT='agenda-viajera-pin-json-v1';
export const PIN_JSON_FIELDS=[...GUIDE_SECTIONS.map(([key])=>key),'sources','reviewed_at','checked_at','price','price_status','reviews','fit','fit_reason','effort','food','safety_label','audio_guide'];
export const PIN_JSON_SAVE_BLOCKED='El guardado por JSON aún no está habilitado de forma segura. Puedes copiar y validar; no se han guardado cambios.';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const protectedKey=key=>/^(?:__proto__|constructor|prototype|password|passwd|secret|token|access_token|refresh_token|authorization|credentials|api_key|service[_-]?role|owner|permissions|geo|lat|lng|latitude|longitude)$/i.test(key);
const fail=message=>{throw Error(message);};
function safeValue(value,depth=0,exporting=false){
 if(depth>12)fail('El JSON tiene demasiados niveles.');
 if(typeof value==='number'&&!Number.isFinite(value))fail('Los números deben ser finitos.');
 if(value===null||['string','boolean','number'].includes(typeof value))return value;
 if(Array.isArray(value))return value.map(item=>safeValue(item,depth+1,exporting));
 if(!object(value))fail('Valor no permitido en la guía.');
 const entries=[];
 for(const [key,item]of Object.entries(value)){
  if(protectedKey(key)){if(exporting)continue;fail('Campo protegido: '+key);}
  entries.push([key,safeValue(item,depth+1,exporting)]);
 }
 return Object.fromEntries(entries);
}
function sourcesValid(sources){
 if(!Array.isArray(sources))fail('guide.sources debe ser una lista de fuentes HTTPS.');
 for(const source of sources){
  const value=typeof source==='string'?source:source?.url;
  let url;try{url=new URL(value);}catch{fail('Cada fuente debe incluir una URL HTTPS válida.');}
  if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(protectedKey))fail('Las fuentes no pueden contener credenciales y deben usar HTTPS.');
 }
}
const fingerprint=(pin,guide)=>JSON.stringify([pin,guide||null]);
export function pinJsonSnapshot({pin,records=[],pending=[],conflicts=[],canEdit=false,serverReady=false}){
 if(!pin||pin.kind!=='places_of_interest'||pin.deleted_at)fail('El pin ya no está disponible.');
 const guides=records.filter(row=>row.kind==='app_settings'&&row.data?.type==='place_guide'&&row.data.place_id===pin.id);
 if(guides.length>1||guides[0]?.deleted_at)fail('La guía tiene una asociación duplicada o eliminada. Revisa la sincronización.');
 const record=guideFor(records,pin.id),guide={};
 for(const key of PIN_JSON_FIELDS)if(Object.hasOwn(record?.data.guide||{},key)){
  if(key==='sources'){try{sourcesValid(record.data.guide[key]);}catch{continue;}}
  guide[key]=safeValue(record.data.guide[key],0,true);
 }
 const value={format:PIN_JSON_FORMAT,pin:{id:pin.id,poi_code:pin.data.poi_code||null,name:pin.data.name},revision:{pin:pin.version||0,guide:record?.version||0},notes:pin.data.description||'',guide};
 const ids=new Set([pin.id,record?.id]);
 return{value,text:JSON.stringify(value,null,2),fingerprint:fingerprint(pin,record),guideId:record?.id||null,canEdit,serverReady,
  pending:pending.some(row=>ids.has(row.record_id)),conflicts:conflicts.some(row=>ids.has(row.record_id)&&!row.resolved_at&&!row.deleted_at)};
}
export function validatePinJson(text,base,current=base){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>120000)fail('El JSON supera el límite de 120 KB.');
 let proposed;try{proposed=JSON.parse(text);}catch{fail('JSON inválido: revisa comas, comillas y llaves.');}
 if(!object(proposed)||Object.keys(proposed).some(key=>!['format','pin','revision','notes','guide'].includes(key)))fail('Estructura inválida o campo desconocido.');
 if(proposed.format!==PIN_JSON_FORMAT||!sameGuide(proposed.pin,base.value.pin)||!sameGuide(proposed.revision,base.value.revision))fail('No cambies el ID, nombre, POI ni revisión del pin abierto.');
 if(Object.hasOwn(proposed,'notes')&&proposed.notes!==base.value.notes)fail('Mis notas están protegidas. Este editor no las modifica.');
 if(!object(proposed.guide))fail('guide debe ser un objeto JSON.');
 if(Object.keys(proposed.guide).some(key=>!PIN_JSON_FIELDS.includes(key)))fail('La guía contiene campos desconocidos o protegidos; no se admite ubicación, GPS ni configuración de voz.');
 safeValue(proposed.guide);
 for(const [key,value]of Object.entries(proposed.guide)){
  if(key==='audio_guide'&&(typeof value!=='string'||value.length>80000))fail('guide.audio_guide debe ser texto de hasta 80.000 caracteres.');
  if(['reviewed_at','checked_at'].includes(key)&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail('La fecha de revisión debe ser una fecha real YYYY-MM-DD.');
  if(key==='sources')sourcesValid(value);
 }
 if(base.fingerprint!==current.fingerprint)fail('El pin o la guía cambió desde que abriste el editor. Restaura el original y revisa de nuevo.');
 const changes=Object.entries(proposed.guide).filter(([key,value])=>!sameGuide(value,base.value.guide[key])).map(([key,value])=>({field:'guide.'+key,before:base.value.guide[key],after:value}));
 if(changes.length&&!current.canEdit)fail('Solo lectura: tu acceso no permite editar este pin.');
 if(changes.length&&(current.pending||current.conflicts))fail('Hay cambios locales pendientes o conflictos de este pin. Resuélvelos antes de importar.');
 return{changes,unchanged:['pin','revision','Mis notas',...Object.keys(base.value.guide).filter(key=>!changes.some(change=>change.field==='guide.'+key)).map(key=>'guide.'+key)],patch:Object.fromEntries(changes.map(change=>[change.field.slice(6),change.after])),notes:base.value.notes};
}
export async function pinJsonAccess(remote,placeId){
 try{const access=await remote.rpc('av2_pin_json_access',{...remote.credentials(),p_place:placeId});return access?.contract===1&&access.can_edit===true;}catch{return false;}
}
export async function savePinJson({text,base,load,remote,store,requestId,online=globalThis.navigator?.onLine!==false}={}){
 if(!base||!load||!remote||!store?.ingestPinJson)fail(PIN_JSON_SAVE_BLOCKED);
 if(!online)fail('Sin conexión. El JSON se conserva en el editor; no se ha enviado al servidor.');
 const current=await load(),plan=validatePinJson(text,base,current);
 if(!current.serverReady)fail(PIN_JSON_SAVE_BLOCKED);
 if(!plan.changes.length)return{state:'unchanged'};
 if(typeof requestId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))fail('Solicitud de guardado no válida.');
 const actor=store.activeUser?.id;let result;
 try{
  await remote.check();
  result=await remote.rpc('av2_pin_json_save',{...remote.credentials(),p_place:base.value.pin.id,p_pin_version:base.value.revision.pin,p_guide_version:base.value.revision.guide,p_patch:plan.patch,p_request_id:requestId});
 }catch(error){
  if(/VERSION_CONFLICT|SYNC_CONFLICT/.test(error.message))fail('Conflicto de sincronización. Hay una versión más reciente o cambios sin resolver; carga el original y revisa.');
  if(/READ_ONLY|AUTH_REQUIRED|REVOKED|PIN_CHANGED|FIRST_PARTY_REQUIRED/.test(error.message))fail('Tu sesión o permiso de edición cambió. No se confirmó el guardado.');
  if(/PGRST202|function.*not.*found|schema cache/i.test(error.message))fail(PIN_JSON_SAVE_BLOCKED);
  fail('Error de sincronización. No se confirmó el guardado. Conserva el JSON y reintenta la misma propuesta.');
 }
 const record=result?.record,credentials=remote.credentials(),expectedId=base.guideId||await guideId(credentials.p_trip,base.value.pin.id),previous=JSON.parse(base.fingerprint)[1];
 if(result?.persisted!==true||!record||record.id!==expectedId||record.trip_id!==credentials.p_trip||record.kind!=='app_settings'||record.deleted_at||record.data?.type!=='place_guide'||record.data.place_id!==base.value.pin.id||record.data.name!==base.value.pin.name||record.data.poi_code!==base.value.pin.poi_code||!Number.isSafeInteger(record.version)||record.version<=base.value.revision.guide||(result.conflicts||[]).length||!sameGuide(record.data.guide,{...previous?.data.guide,...plan.patch}))fail('El servidor no confirmó íntegramente la guía. Conserva el JSON y revisa la sincronización.');
 if(store.activeUser?.id!==actor)fail('El servidor confirmó el guardado, pero cambió la sesión local. Actualiza tras verificar tu acceso.');
 let state;try{state=await store.ingestPinJson(record,base.value.pin.id);}catch{fail('El servidor confirmó el guardado, pero no se pudo actualizar la copia local. Actualiza para recuperar el contenido.');}
 return{state,record};
}

export function pinJsonSection(){return '<details class="card section pin-json-editor"><summary>Editor JSON</summary><div class="pin-json-body"><p>Solo este pin. Guía y narración usan los campos reales de la aplicación. Mis notas, identidad, ubicación y preferencias de voz están protegidas. Los campos ausentes se conservan.</p><p class="warning pin-json-availability">'+PIN_JSON_SAVE_BLOCKED+'</p><label>JSON del pin<textarea class="pin-json-input" rows="18" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JSON del pin"></textarea></label><div class="actions"><button type="button" data-json="copy">Copiar JSON</button><button type="button" data-json="validate">Validar JSON</button><button type="button" data-json="save" disabled>Guardar cambios</button><button type="button" data-json="restore">Restaurar original</button></div><p class="pin-json-status" role="status" aria-live="polite"></p><div class="pin-json-diff"></div></div></details>';}
export function mountPinJson(root,load,persist=null){
 const details=root.querySelector('.pin-json-editor');if(!details)return;
 const input=details.querySelector('textarea'),status=details.querySelector('.pin-json-status'),diff=details.querySelector('.pin-json-diff'),save=details.querySelector('[data-json=save]');let base,loading,validatedText=null,requestId=null,saving=false;
 const update=async()=>{const current=await load();if(!details.isConnected)return;base=current;input.value=base.text;diff.replaceChildren();save.disabled=true;validatedText=null;requestId=null;details.querySelector('.pin-json-availability').hidden=base.serverReady;status.textContent=base.pending||base.conflicts?'Hay cambios pendientes o conflictos de sincronización. Se permite copiar, sin guardar.':base.canEdit?base.serverReady?'JSON válido. Valida los cambios antes de guardar.':'JSON válido. Copia o valida una propuesta; el guardado sigue bloqueado.':'Solo lectura. Puedes copiar el JSON.';};
 details.addEventListener('toggle',()=>{if(details.open&&!base&&!loading){loading=update().catch(error=>{status.textContent=error.message;}).finally(()=>loading=null);}});
 input.addEventListener('input',()=>{diff.replaceChildren();save.disabled=true;validatedText=null;requestId=null;status.textContent='Cambios pendientes en el texto. Valida el JSON; aún no se ha guardado.';});
 details.addEventListener('click',async event=>{
  const button=event.target.closest('[data-json]');if(!button||saving)return;
  try{
   if(!base){await loading;if(!base)await update();if(!base)return;}
   if(button.dataset.json==='restore'){if(input.value!==base.text&&!globalThis.confirm('¿Descartar la propuesta JSON y cargar el contenido guardado actual?'))return;await update();return;}
   if(button.dataset.json==='save'){
    if(!persist||validatedText!==input.value||!base.serverReady)fail(PIN_JSON_SAVE_BLOCKED);
    const reviewedText=input.value,current=await load();if(input.value!==reviewedText||validatedText!==reviewedText)fail('El texto cambió. Valida de nuevo antes de guardar.');validatePinJson(reviewedText,base,current);
    if(!globalThis.confirm('¿Guardar estos cambios en la guía y narración de este pin? Mis notas y ubicación se conservarán.'))return;
    requestId ||= crypto.randomUUID();saving=true;save.disabled=true;input.disabled=true;status.textContent='Guardando…';
    const result=await persist({text:input.value,base,load,requestId});
    if(result.state==='pending')fail('El servidor confirmó el guardado; hay cambios locales posteriores que se conservaron. Revisa la sincronización.');
    await update();status.textContent=result.state==='newer'?'Guardado confirmado. Hay una versión posterior; se conserva la más reciente.':'Guardado correctamente y confirmado por el servidor.';return;
   }
   if(button.dataset.json==='copy'){
    try{await navigator.clipboard.writeText(input.value);status.textContent='JSON copiado.';}catch{input.focus();input.select();const copied=document.execCommand?.('copy');status.textContent=copied?'JSON copiado.':'Texto seleccionado. Mantén pulsado y elige Copiar.';}return;
   }
   const current=await load(),plan=validatePinJson(input.value,base,current);diff.replaceChildren();validatedText=input.value;save.disabled=!(plan.changes.length&&current.serverReady&&persist&&current.canEdit);base.serverReady=current.serverReady;
   const title=document.createElement('h3');title.textContent='Estos son los cambios que se realizarán';diff.append(title);
   for(const change of plan.changes){const item=document.createElement('section'),label=document.createElement('h4');label.textContent=change.field;item.append(label);for(const [name,value]of[['Contenido anterior',change.before],['Contenido nuevo',change.after]]){const caption=document.createElement('p'),pre=document.createElement('pre');caption.textContent=name;pre.textContent=value===undefined?'Campo ausente':JSON.stringify(value,null,2);item.append(caption,pre);}diff.append(item);}
   const same=document.createElement('p');same.textContent='Permanecerán iguales: '+plan.unchanged.join(', ')+'. Los demás campos del pin y de la guía se conservan.';diff.append(same);
   status.textContent=plan.changes.length?'JSON válido. '+plan.changes.length+' campos propuestos; sin guardar. '+(current.serverReady?'Revisa la comparación y pulsa Guardar cambios.':PIN_JSON_SAVE_BLOCKED):'JSON válido. Sin cambios.';
  }catch(error){status.textContent=error.message;if(button.dataset.json!=='save'){diff.replaceChildren();validatedText=null;save.disabled=true;}else save.disabled=!(validatedText===input.value&&base?.serverReady&&persist);}
  finally{saving=false;input.disabled=false;}
 });
}
