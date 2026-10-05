// Embedded screens ask their own same-origin workspace to navigate. Standalone
// editor URLs keep working; neither arbitrary parents nor external URLs are used.
export function navigateMedia(value){
  const url=new URL(value,location.href);
  if(url.origin!==location.origin)throw Error('別の接続先には移動できません');
  if(new URLSearchParams(location.hash.slice(1)).get('embedded')==='1'&&parent!==window){
    parent.postMessage({type:'mang-ai:navigate',url:url.href},location.origin);
  }else location.href=url.href;
}
