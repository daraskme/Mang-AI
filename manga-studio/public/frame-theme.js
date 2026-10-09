// Keep embedded screens in the host theme without navigating their iframes.
const parameters=new URLSearchParams(location.hash.slice(1));
document.body.classList.toggle('embedded',parameters.get('embedded')==='1');
document.body.dataset.screen=location.pathname.split('/').pop()?.replace('.html','')||'index';
const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./embedded.css',import.meta.url).href;document.head.append(style);
const host=parameters.get('host')||(document.referrer?new URL(document.referrer).origin:location.origin);
const color=getComputedStyle(document.body).color.match(/\d+/g);
let current=['light','dark'].includes(parameters.get('theme'))?parameters.get('theme'):color&&Number(color[0])>160?'dark':'light';
function forward(frame){try{const target=new URL(frame.getAttribute('src')||'',location.href);if(target.origin===location.origin)frame.contentWindow?.postMessage({type:'mang-ai:theme',theme:current},location.origin);}catch{}}
function apply(theme){current=theme;document.documentElement.dataset.theme=theme;document.body.classList.toggle('light',theme==='light');for(const frame of document.querySelectorAll('iframe'))forward(frame);}
window.addEventListener('message',event=>{if(parent!==window&&event.source===parent&&event.origin===host&&event.data?.type==='mang-ai:theme'&&['light','dark'].includes(event.data.theme))apply(event.data.theme);});
document.addEventListener('load',event=>{if(event.target instanceof HTMLIFrameElement)forward(event.target);},true);
apply(current);
