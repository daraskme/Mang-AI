window.__ModuleLoader__.load({id:'@mang-ai/local-runtime',factory:require=>{
  const {jsx,jsxs}=require('react/jsx-runtime');
  const {useEffect,useRef,useState}=require('react');
  const {SettingsFormModel,settingsTextField,settingsNumberField,SettingsForm,SettingsValueField}=require('@deepseek-ai/dsh-client-ui-primitives');
  function SearchCard(props){
    const state=props.useSearchCard(s=>s);
    if(props.view==='summary')return 'Bing RSS / SearXNGで検索し、常駐A1が結果を読み取ります。APIキーは不要です。';
    return jsxs(SettingsForm,{labels:{unavailable:'検索機能を利用できません',readOnly:'設定は読み取り専用です',saveFailed:'設定を保存できませんでした',save:'保存',saving:'保存中…'},state,onSave:props.save,onDiscard:props.discard,children:[
      jsx('p',{children:'検索語は選択した検索サービスへ送信されます。回答の作成はローカルモデルが行います。'}),
      ...[['engine','検索サービス','bing または searxng'],['baseURL','検索URL','Bingの既定値は空欄。SearXNGは http://localhost:8080/search など'],['timeoutMs','タイムアウト（ミリ秒）','1000〜120000']].map(([field,label,hint])=>jsx(SettingsValueField,{id:`mang-ai-search-${field}`,label,hint,overriddenLabel:'変更済み',resetLabel:'既定値に戻す',invalidLabel:'有効な値を入力してください',disabled:!state.writable,numeric:field==='timeoutMs',...state[field],onEdit:text=>props.edit(field,text),onReset:()=>props.resetField(field)},field))
    ]});
  }
  function Mark({size=30}){return jsx('span',{style:{fontSize:size,color:'#10b981',lineHeight:1},children:'▣'});}
  function workspaceURL(){const url=new URL(window.__MANGAI_WORKSPACE__),result=window.__MANGAI_MOUNT__?new URL(window.__MANGAI_MOUNT__+'/workspace.html'+url.hash,location.origin):url;const p=new URLSearchParams(result.hash.slice(1)),color=getComputedStyle(document.body).color.match(/\d+/g);p.set('theme',color&&Number(color[0])>160?'dark':'light');result.hash=p.toString();return result;}
  function WorkspaceFrame({sessionId,view='gallery'}){
    const ref=useRef(null),initial=useRef(null);
    if(!initial.current){const url=workspaceURL();const p=new URLSearchParams(url.hash.slice(1));if(sessionId)p.set('session',sessionId);p.set('view',view);p.set('host',location.origin);url.hash=p.toString();initial.current=url.href;}
    const navigate=()=>ref.current?.contentWindow?.postMessage({type:'mang-ai:view',view},new URL(initial.current).origin);
    useEffect(navigate,[view]);
    return jsx('iframe',{ref,src:initial.current,title:'制作スペース',onLoad:navigate,style:{border:0,width:'100%',height:'100%',minHeight:0,display:'block'},sandbox:'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups'});
  }
  function MediaDock({sessionId,useTabInfo}){const {tab}=useTabInfo();return jsx(WorkspaceFrame,{sessionId,view:tab.navigation?.params?.view||'gallery'});}
  function ConversationMedia({session,onOpen}){
    const sessionId=session?.sessionId,ref=useRef(null),[height,setHeight]=useState(38);
    const url=workspaceURL();url.pathname=url.pathname.replace('workspace.html','session-media.html');const p=new URLSearchParams(url.hash.slice(1));p.set('session',sessionId||'');p.set('host',location.origin);url.hash=p.toString();
    useEffect(()=>{setHeight(38);const receive=event=>{if(event.source!==ref.current?.contentWindow||event.origin!==url.origin||event.data?.session!==sessionId)return;if(event.data.type==='mang-ai:strip-size')setHeight(Math.max(36,Math.min(150,Number(event.data.height)||36)));if(event.data.type==='mang-ai:open-media')onOpen('gallery');};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[sessionId]);
    if(!sessionId)return null;
    return jsx('iframe',{key:sessionId,ref,src:url.href,title:'この会話のメディア',allow:'clipboard-write',style:{border:0,width:'100%',height,display:'block'},sandbox:'allow-scripts allow-same-origin'});
  }
  function apply(ctx){
    ctx.effect(()=>ctx.locale.addLanguage({id:'ja',label:'日本語',fallback:'en'}));
    for(const [ns,dict]of Object.entries(window.__MANGAI_LOCALES__||{}))if(!ns.startsWith('package:'))ctx.effect(()=>ctx.locale.register(ns,'ja',dict));
    document.title='Mang-AI';
    const mediaId='@mang-ai/local-runtime/media';
    ctx.effect(()=>ctx.sidebarRightTabs.register({id:mediaId,kind:'mang-ai-media',title:()=> '制作スペース',keepMounted:true,guide:[{id:'media',title:()=> 'メディア・制作進捗',description:()=> 'このセッションの漫画・画像・素材を開く',order:5}]}));
    ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:mediaId},MediaDock));
    for(const view of ['gallery','progress'])ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'mang-ai-'+view},()=>jsxs('section',{style:{display:'flex',flexDirection:'column',height:'100%',minHeight:0},children:[jsx('button',{onClick:()=>ctx.layout.selectPanel(null),style:{alignSelf:'flex-start',padding:'10px'},children:'← セッションへ戻る'}),jsx('div',{style:{flex:1,minHeight:0},children:jsx(WorkspaceFrame,{view})})]})));
    const open=view=>{if(ctx.sidebarRight.mounted.getSnapshot())ctx.sidebarRight.openTab('mang-ai-media',{params:{view}});else ctx.layout.selectPanel('mang-ai-'+view);};
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'mang-ai-session-media',order:10,label:'この会話のメディア'},props=>jsx(ConversationMedia,{...props,onOpen:open})));
    const button=(view,label)=>jsx('button',{type:'button',onClick:()=>open(view),title:label,style:{display:'inline-flex',padding:'8px',color:'#93ddb7',fontSize:'12px',background:'transparent',border:0,cursor:'pointer'},children:label});
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mang-ai-progress',order:4,label:'制作の進捗'},()=>button('progress','◷ 制作の進捗')));
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mang-ai-gallery',order:5,label:'メディアギャラリー'},()=>button('gallery','▧ ギャラリー')));
    ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'mang-ai-media',order:5,label:'メディア'},()=>button('gallery','メディア')));
    ctx.slots.inject('sidebar.brand.mark',()=>ctx.slots.register({name:'sidebar.brand.mark'},Mark));
    ctx.slots.inject('sidebar.brand.name',()=>ctx.slots.register({name:'sidebar.brand.name'},()=>jsx('strong',{children:'Mang-AI'})));
    ctx.slots.inject('conversation.hero.brand.mark',()=>ctx.slots.register({name:'conversation.hero.brand.mark'},()=>jsx(Mark,{size:70})));
    const form=new SettingsFormModel(ctx.configForms.get('mang-ai-local-runtime'),[settingsTextField('engine'),settingsTextField('baseURL'),settingsNumberField('timeoutMs')]);
    const store=form.bind(()=>({...form.shell(),engine:form.field('engine'),baseURL:form.field('baseURL'),timeoutMs:form.field('timeoutMs')}));
    ctx.effect(()=>()=>form.dispose());
    ctx.effect(()=>ctx.configForms.whileServed(['mang-ai-local-runtime'],()=>ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'web-search',order:40,label:'Web検索',inject:()=>({hooks:{searchCard:store},...form.actions()})},SearchCard))));
  }
  return {inject:['locale','slots','configForms','layout','sidebarRight','sidebarRightTabs'],apply};
}});
