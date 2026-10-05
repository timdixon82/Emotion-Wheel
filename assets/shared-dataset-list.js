/* Shared-file references only. Records and Google tokens never belong here. */
(function(root){
  'use strict';
  const kind='emotion-wheel-shared-datasets';
  function validate(value){
    if(!value || value.kind!==kind || value.version!==1 || !Array.isArray(value.items) || value.items.length>10000)throw new Error('The shared-file list needs a supported version. Both copies are kept.');
    const ids=new Set();
    const items=value.items.map(item=>{
      if(!item || typeof item.id!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.revision) || item.revision<1 || typeof item.device!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.device) || typeof item.deleted!=='boolean' || typeof item.label!=='string' || item.label.length>120 || (!item.deleted && !item.label.trim()))throw new Error('The shared-file list contains an invalid reference. Both copies are kept.');
      ids.add(item.id);return {id:item.id,label:item.deleted?'':item.label,revision:item.revision,device:item.device,deleted:item.deleted};
    });
    return {kind,version:1,items:items.sort((a,b)=>a.id.localeCompare(b.id))};
  }
  function empty(){return {kind,version:1,items:[]};}
  function merge(...copies){
    const winners=new Map();
    for(const copy of copies)for(const item of validate(copy).items){
      const old=winners.get(item.id);
      if(!old || item.revision>old.revision || (item.revision===old.revision && (Number(item.deleted)>Number(old.deleted) || (item.deleted===old.deleted && `${item.device}\n${item.label}`>`${old.device}\n${old.label}`))))winners.set(item.id,item);
    }
    return validate({...empty(),items:[...winners.values()]});
  }
  function change(copy,id,label,device){
    const result=validate(copy),old=result.items.find(item=>item.id===id);
    const item={id,label:label===null?'':label,device,deleted:label===null,revision:(old?.revision||0)+1};
    return validate({...result,items:[...result.items.filter(item=>item.id!==id),item]});
  }
  const api=Object.freeze({empty,validate,merge,change});
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.EmotionWheelSharedList=api;
})(typeof globalThis==='undefined'?window:globalThis);
