import {captureScreenState,restoreScreenState} from './manual-refresh.js';
const placeRoute=hash=>/^#place(?:-edit)?\//.test(hash);
const hash=()=>location.hash;
// Only entry IDs go into browser history. Screen state and drafts stay in memory.
export class PlaceNavigation {
 constructor(root,{capture=()=>null,restore=()=>{}}={}){
  this.root=root;this.capture=capture;this.restore=restore;this.entries=new Map();this.forms=new WeakMap();
  this.current=this.entry(hash(),0,null);this.write(this.current);history.scrollRestoration='manual';
  document.addEventListener('click',e=>this.click(e),true);
  root.addEventListener('input',()=>{this.approved=false;this.capturedLink=false;});
  addEventListener('hashchange',e=>this.change(e),true);
  addEventListener('beforeunload',e=>{if(placeRoute(this.current.hash)&&this.dirty()){e.preventDefault();e.returnValue='';}});
 }
 entry(route,index,parent){const e={id:crypto.randomUUID(),hash:route,index,parent,context:null};this.entries.set(e.id,e);return e;}
 write(e){history.replaceState({...history.state,av2PlaceEntry:e.id},'',location.href);}
 remember(){
  const screen=captureScreenState(this.root);screen.route=this.current.hash;
  // Discarded edits must not reappear on browser Forward. Same-screen renders retain drafts separately.
  if(placeRoute(this.current.hash))screen.fields=[];
  this.current.context={screen,view:this.capture()};
 }
 fields(form){return JSON.stringify([...form.querySelectorAll('input,textarea,select')].filter(n=>n.type!=='password').map(n=>[n.name,n.value,n.checked]));}
 dirty(){
  const json=this.root.querySelector('.pin-json-editor');if(json?.isBusy?.()||json?.hasUnsavedChanges?.())return true;
  return [...this.root.querySelectorAll('#place-form,#pin-narration-form,#item-times-form,#day-pin-form')].some(f=>this.forms.has(f)&&this.forms.get(f)!==this.fields(f));
 }
 allowed(){return !placeRoute(this.current.hash)||!this.dirty()||confirm('Hay cambios sin guardar en este lugar. ¿Descartarlos y salir?');}
 click(event){
  const link=event.target.closest('a[href]');if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.target==='_blank'||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.pathname!==location.pathname||url.search!==location.search)return;
  if(placeRoute(this.current.hash)&&link.matches('.back,[data-place-back]')){event.preventDefault();event.stopImmediatePropagation();this.back();return;}
  if(this.current.hash.startsWith('#place-edit/')&&url.hash===this.entries.get(this.current.parent)?.hash){event.preventDefault();event.stopImmediatePropagation();this.back();return;}
  if(url.hash===location.hash)return;
  if(!this.allowed()){event.preventDefault();event.stopImmediatePropagation();return;}
  this.approved=true;this.remember();this.capturedLink=true;
 }
 change(event){
  const targetId=history.state?.av2PlaceEntry;let target=this.entries.get(targetId);
  if(this.reverting&&target?.id===this.current.id){this.reverting=false;event.stopImmediatePropagation();return;}
  if(!target||target.id===this.current.id){target=this.entry(hash(),this.current.index+1,this.current.id);this.write(target);}
  if(!this.approved&&!this.allowed()){
   this.reverting=true;event.stopImmediatePropagation();history.go(this.current.index-target.index);return;
  }
  this.approved=false;
  // A captured link preserves pre-navigation scroll, before native anchor scrolling can run.
  if(!this.capturedLink)this.remember();this.capturedLink=false;
  this.current=target;this.pending=target.context;this.prepared=false;this.entering=true;
 }
 back(){
  if(!this.allowed())return;this.remember();this.approved=true;this.capturedLink=true;
  const parent=this.entries.get(this.current.parent);
  if(parent){history.go(parent.index-this.current.index);return;}
  location.hash='#home';
 }
 saved(){for(const f of this.root.querySelectorAll('form'))this.forms.set(f,this.fields(f));}
 baseline(){for(const f of this.root.querySelectorAll('form'))if(!this.forms.has(f))this.forms.set(f,this.fields(f));}
 beforeRender(){if(this.pending&&!this.prepared){this.restore(this.pending.view);this.prepared=true;}}
 afterRender(){
  this.baseline();
  if(placeRoute(this.current.hash))for(const a of this.root.querySelectorAll('a.back,a[data-place-back]')){a.href=this.entries.get(this.current.parent)?.hash||'#home';a.setAttribute('data-place-back','');a.setAttribute('aria-label','Regresar');}
  if(this.pending){const pending=this.pending;this.pending=null;restoreScreenState(this.root,pending.screen);}
  else if(this.entering)scrollTo({left:0,top:0,behavior:'instant'});this.entering=false;
 }
}
