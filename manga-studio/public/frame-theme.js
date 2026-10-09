// Share the Harness palette without reloading editors or changing image pixels.
const parameters=new URLSearchParams(location.hash.slice(1)),storageKey='mang-ai-theme-snapshot';
document.documentElement.classList.add('mang-ai-ui');
document.body.classList.toggle('embedded',parameters.get('embedded')==='1');
document.body.dataset.screen=location.pathname.split('/').pop()?.replace('.html','')||'index';
if(!document.querySelector('link[href$="embedded.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./embedded.css',import.meta.url).href;document.head.append(style);}
const host=parameters.get('host')||(document.referrer?new URL(document.referrer).origin:location.origin);
const colorTokens=['bg','panel','raised','sidebar','line','text','muted','dimmed','accent','hover','selected','primary','primary-hover','on-primary','danger'];
const properties=Object.fromEntries([...colorTokens.map(name=>['--ui-'+name,'color']),['--ui-radius','border-radius'],['--ui-radius-sm','border-radius'],['--ui-font','font-family']]);
let current;
function forward(frame){try{const target=new URL(frame.getAttribute('src')||'',location.href);if(target.origin===location.origin)frame.contentWindow?.postMessage(current,location.origin);}catch{}}
function apply(value){
  if(!value||!['light','dark'].includes(value.theme))return;
  const tokens={};for(const [name,property]of Object.entries(properties)){const token=value.tokens?.[name];if(typeof token==='string'&&token.length<400&&CSS.supports(property,token))tokens[name]=token;}
  current={type:'mang-ai:theme',theme:value.theme,tokens};
  const root=document.documentElement;root.dataset.theme=value.theme;document.body.classList.toggle('light',value.theme==='light');
  for(const name of Object.keys(properties)){if(tokens[name])root.style.setProperty(name,tokens[name]);else root.style.removeProperty(name);}
  for(const frame of document.querySelectorAll('iframe'))forward(frame);
}
window.addEventListener('message',event=>{if(parent!==window&&event.source===parent&&event.origin===host&&event.data?.type==='mang-ai:theme')apply(event.data);});
// Cached appearance for same-origin standalone tabs; Harness remains the owner.
window.addEventListener('storage',event=>{if(event.key===storageKey&&event.newValue){try{apply(JSON.parse(event.newValue));}catch{}}});
document.addEventListener('load',event=>{if(event.target instanceof HTMLIFrameElement)forward(event.target);},true);
let saved;try{saved=JSON.parse(localStorage.getItem(storageKey));}catch{}
apply(saved||{theme:parameters.get('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')});
