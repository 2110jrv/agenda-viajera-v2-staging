import {dayCityData} from './day-cities.js';
import {dayPlan} from './day-pin-schedule.js';
import {cityKey} from './event-cities.js';
import {pinLocality,pointKey} from './pin-identity.js';
import {days} from './domain.js';
import {metres,tripDay,ACTIVITY} from './travel-gps.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
// Only a fresh, precise fix beside a locality-bearing pin can reorder today's known cities.
export function gpsCity(cities,pins,position,status,now){
 if(status!=='live'||!pointKey(position)||!Number.isFinite(position?.t)||now-position.t>30000||position.t>now+5000||!Number.isFinite(position.accuracy)||position.accuracy<0||position.accuracy>30)return null;
 const keys=new Set(cities.map(cityKey)),near=new Set(),certain=new Set();
 for(const p of pins){const name=pinLocality(p.data),key=cityKey(name);if(!keys.has(key)||!pointKey(p.data))continue;const d=metres(position,p.data);if(d-position.accuracy<=150)near.add(key);if(d+position.accuracy<=100)certain.add(key);}
 return near.size===1&&certain.size===1?[...certain][0]:null;
}
export function audioLibrary({features=[],events=[],records=[],day,locations={},position=null,status='off',now=Date.now(),zone='Europe/Rome',tripDays=days()}){
 day=day||tripDay(now,zone);const pins=records.filter(r=>r.kind==='places_of_interest'&&!r.deleted_at),byId=new Map(pins.map(r=>[r.id,r]));
 const dates=[...new Set([...tripDays,day,...pins.flatMap(p=>p.data.assigned_dates||[]),...records.filter(r=>r.kind==='day_pin_schedule'&&!r.deleted_at&&r.data.active).map(r=>r.data.date)])].filter(date).sort();
 const schedules=new Map();for(const r of records)if(r.kind==='day_pin_schedule'&&!r.deleted_at&&r.data.active){if(!schedules.has(r.data.pin_id))schedules.set(r.data.pin_id,[]);schedules.get(r.data.pin_id).push(r.data.date);}
 const cache=new Map(),info=d=>{if(cache.has(d))return cache.get(d);const visit=dayCityData(events,records,d,locations),plan=dayPlan(events,records,d,locations),eligible=new Set(),options=new Set(plan.options.map(p=>p.id));for(const p of pins){const schedule=schedules.get(p.id)||[];if(schedule.length?schedule.includes(d):plan.calendarPins.has(p.id)||(p.data.assigned_dates?.length?p.data.assigned_dates.includes(d):options.has(p.id)))eligible.add(p.id);}const value={cities:visit.cities,eligible,order:new Map(plan.pinOrder.map((id,i)=>[id,i]))};cache.set(d,value);return value;};
 const today=info(day),priority=day===tripDay(now,zone)?gpsCity(today.cities,pins,position,status,now):null;
 const cityOrder=priority?[...today.cities.filter(c=>cityKey(c)===priority),...today.cities.filter(c=>cityKey(c)!==priority)]:today.cities;
 const primary=[],secondary=[],unassigned=[],seen=new Set();
 for(const f of features){if(!f?.id||seen.has(f.id)||!String(f.text||f.audio_url||'').trim())continue;seen.add(f.id);const pin=byId.get(f.pin_id||f.id),transport=!!(f.transportNotice||f.transportTypes?.length||f.routeKeys?.length||/transporte|estaci[oó]n/i.test(pin?.data.label||''));
  const item={feature:f,pin,city:pinLocality(pin?.data||{}),transport};
  if(pin&&today.eligible.has(pin.id)){primary.push(item);continue;}
  const other=pin&&dates.find(d=>d!==day&&info(d).eligible.has(pin.id));if(other){secondary.push({...item,day:other});continue;}unassigned.push(item);
 }
 const stable=(a,b)=>String(a.pin?.data.poi_code||a.pin?.id||a.feature.id).localeCompare(String(b.pin?.data.poi_code||b.pin?.id||b.feature.id),undefined,{numeric:true})||String(a.feature.id).localeCompare(String(b.feature.id));
 const groups=(items,d,orderedCities)=>{const order=d?info(d).order:new Map(),sorted=items.slice().sort((a,b)=>(order.get(a.pin?.id)??Infinity)-(order.get(b.pin?.id)??Infinity)||stable(a,b)),names=[...orderedCities];for(const x of sorted)if(!names.some(c=>cityKey(c)===cityKey(x.city)))names.push(x.city);return names.flatMap(city=>{const list=sorted.filter(x=>cityKey(x.city)===cityKey(city));return list.length?[{day:d,city:city||'Localidad pendiente',items:list}]:[];});};
 return{day,cities:today.cities,priority,primary:groups(primary,day,cityOrder),secondary:dates.filter(d=>d!==day).flatMap(d=>groups(secondary.filter(x=>x.day===d),d,info(d).cities)),unassigned:groups(unassigned,null,[])};
}
export function audioLibrarySelect(model,selected){
 const options=(groups,kind)=>groups.map(g=>'<optgroup label="'+esc((kind==='other'?g.day+' · ':'')+g.city+(kind==='unassigned'?' · Sin asignación de día':''))+'">'+g.items.map(({feature:f,transport})=>'<option value="'+esc(f.id)+'" '+(f.id===selected?'selected':'')+'>'+esc(f.name)+(transport?' · Transporte'+(f.transportTypes?.length?' · '+esc(f.transportTypes.map(t=>ACTIVITY[t]||t).join(', ')):''):'')+'</option>').join('')+'</optgroup>').join('');
 const select=(groups,kind)=>'<select data-tour-select aria-label="'+(kind==='day'?'Narraciones del día':'Narraciones de otros días y sin asignación')+'"><option value="">Selecciona una narración</option>'+options(groups,kind)+'</select>';
 return '<p class="muted">Narraciones · '+esc(model.day)+'</p><label>Ciudades y lugares del día'+select(model.primary,'day')+'</label><details class="audio-other-days"><summary>Otros días y lugares sin asignación</summary><label>Otros días<select data-tour-select aria-label="Narraciones de otros días y sin asignación"><option value="">Selecciona una narración</option>'+options(model.secondary,'other')+options(model.unassigned,'unassigned')+'</select></label></details>';
}

export function prioritizeLibrary(model,pins,position,status,now=Date.now(),zone='Europe/Rome'){const priority=model.day===tripDay(now,zone)?gpsCity(model.cities,pins,position,status,now):null;return priority?{...model,priority,primary:[...model.primary.filter(g=>cityKey(g.city)===priority),...model.primary.filter(g=>cityKey(g.city)!==priority)]}:model;}
