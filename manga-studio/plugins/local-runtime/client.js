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
  function currentTheme(){const color=getComputedStyle(document.body).color.match(/\d+/g);return color&&Number(color[0])>160?'dark':'light';}
  function useFrameTheme(ref){
    const send=()=>{const frame=ref.current;if(!frame)return;try{const url=new URL(frame.src);frame.contentWindow?.postMessage({type:'mang-ai:theme',theme:currentTheme()},url.origin);}catch{}};
    useEffect(()=>{const observer=new MutationObserver(send);for(const node of [document.documentElement,document.body])observer.observe(node,{attributes:true,attributeFilter:['class','style','data-theme']});const preference=matchMedia('(prefers-color-scheme: dark)');preference.addEventListener('change',send);send();return()=>{observer.disconnect();preference.removeEventListener('change',send);};},[]);
    return send;
  }
  function workspaceURL(){const url=new URL(window.__MANGAI_WORKSPACE__),result=window.__MANGAI_MOUNT__?new URL(window.__MANGAI_MOUNT__+'/workspace.html'+url.hash,location.origin):url;const p=new URLSearchParams(result.hash.slice(1)),color=getComputedStyle(document.body).color.match(/\d+/g);p.set('theme',color&&Number(color[0])>160?'dark':'light');if(window.__MANGAI_ACCOUNTS__)p.set('accountToken',new URLSearchParams(new URL(window.__MANGAI_ACCOUNTS__).hash.slice(1)).get('token'));result.hash=p.toString();return result;}
  function WorkspaceFrame({sessionId,view='gallery'}){
    const ref=useRef(null),initial=useRef(null),sendTheme=useFrameTheme(ref);
    if(!initial.current){const url=workspaceURL();const p=new URLSearchParams(url.hash.slice(1));if(sessionId||window.__mangaiActiveSession)p.set('session',sessionId||window.__mangaiActiveSession);p.set('view',view);p.set('host',location.origin);url.hash=p.toString();initial.current=url.href;}
    const navigate=()=>ref.current?.contentWindow?.postMessage({type:'mang-ai:view',view},new URL(initial.current).origin);
    useEffect(navigate,[view]);
    return jsx('iframe',{ref,src:initial.current,title:'制作スペース',onLoad:()=>{navigate();sendTheme();},style:{border:0,width:'100%',height:'100%',minHeight:0,display:'block'},sandbox:'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups'});
  }
  function MediaDock({sessionId,useTabInfo}){const {tab}=useTabInfo();return jsx(WorkspaceFrame,{sessionId,view:tab.navigation?.params?.view||'gallery'});}
  function AccountFrame({view='settings',sessionId}){
    const ref=useRef(null),source=useRef(null),[height,setHeight]=useState(view==='quota'?38:view==='session'?42:720),sendTheme=useFrameTheme(ref);
    if(!window.__MANGAI_ACCOUNTS__)return null;
    const url=new URL(window.__MANGAI_ACCOUNTS__);if(window.__MANGAI_MOUNT__){url.protocol=location.protocol;url.host=location.host;url.pathname=window.__MANGAI_MOUNT__+'/accounts.html';}
    const p=new URLSearchParams(url.hash.slice(1));p.set('view',view);p.set('host',location.origin);if(sessionId)p.set('session',sessionId);const color=getComputedStyle(document.body).color.match(/\d+/g);p.set('theme',color&&Number(color[0])>160?'dark':'light');url.hash=p.toString();
    const key=view+':'+(sessionId||'');if(source.current?.key!==key)source.current={key,url:url.href};
    useEffect(()=>{const receive=e=>{if(e.source!==ref.current?.contentWindow||e.origin!==url.origin)return;if(e.data?.type==='mang-ai:accounts-size')setHeight(Math.max(32,Math.min(view==='settings'?1200:view==='agent'?720:380,e.data.height||40)));if(e.data?.type==='mang-ai:open-agent'&&e.data.session===sessionId)window.dispatchEvent(new CustomEvent('mang-ai:open-agent',{detail:sessionId}));};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[view,sessionId]);
    return jsx('iframe',{key,ref,src:source.current.url,onLoad:sendTheme,title:view==='quota'?'AIの残り使用量':view==='session'?'このセッションのAI担当':view==='agent'?'コーディング担当との会話':'AIアカウント設定',style:{width:'100%',height,border:0,display:'block'},sandbox:'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals'});
  }
  function AgentDock({sessionId}){return jsx(AccountFrame,{view:'agent',sessionId});}
  function AgentPanel(){const [session,setSession]=useState(window.__mangaiActiveSession||null);useEffect(()=>{const fn=e=>setSession(e.detail);window.addEventListener('mang-ai:active-session',fn);return()=>window.removeEventListener('mang-ai:active-session',fn);},[]);return jsx(AgentDock,{sessionId:session});}
  function SessionAccount({session}){const id=session?.sessionId;useEffect(()=>{window.__mangaiActiveSession=id||null;window.dispatchEvent(new CustomEvent('mang-ai:active-session',{detail:id||null}));},[id]);return id?jsx(AccountFrame,{view:'session',sessionId:id}):null;}
  function ConversationMedia({session,onOpen,compact=false}){
    const sessionId=session?.sessionId,ref=useRef(null),source=useRef(null),[height,setHeight]=useState(32),sendTheme=useFrameTheme(ref);
    const url=workspaceURL();url.pathname=url.pathname.replace('workspace.html','session-media.html');const p=new URLSearchParams(url.hash.slice(1));p.set('session',sessionId||'');p.set('host',location.origin);if(compact)p.set('overview','1');url.hash=p.toString();
    useEffect(()=>{setHeight(32);const receive=event=>{if(event.source!==ref.current?.contentWindow||event.origin!==url.origin||event.data?.session!==sessionId)return;if(event.data.type==='mang-ai:strip-size')setHeight(Math.max(0,Math.min(compact?340:150,Number(event.data.height)||0)));if(event.data.type==='mang-ai:open-media')onOpen('gallery');};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[sessionId,compact]);
    const key=sessionId+':'+compact;if(source.current?.key!==key)source.current={key,url:url.href};
    if(!sessionId)return null;
    return jsx('iframe',{key,ref,src:source.current.url,onLoad:sendTheme,title:'この会話のメディア',allow:'clipboard-write',style:{border:0,width:'100%',height,display:'block'},sandbox:'allow-scripts allow-same-origin'});
  }
  function apply(ctx){
    ctx.effect(()=>ctx.locale.addLanguage({id:'ja',label:'日本語',fallback:'en'}));
    for(const [ns,dict]of Object.entries(window.__MANGAI_LOCALES__||{}))if(!ns.startsWith('package:'))ctx.effect(()=>ctx.locale.register(ns,'ja',dict));
    document.title='Mang-AI';
    const mediaId='@mang-ai/local-runtime/media';
    const agentId='@mang-ai/local-runtime/agent';
    ctx.effect(()=>ctx.sidebarRightTabs.register({id:agentId,kind:'mang-ai-agent',title:()=> 'コーディング担当',keepMounted:true}));
    ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:agentId},AgentDock));
    ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'mang-ai-agent'},()=>jsxs('section',{children:[jsx('button',{onClick:()=>ctx.layout.selectPanel(null),children:'← セッションへ戻る'}),jsx(AgentPanel,{})]})));
    ctx.effect(()=>{const openAgent=()=>{if(ctx.sidebarRight.mounted.getSnapshot())ctx.sidebarRight.openTab('mang-ai-agent');else ctx.layout.selectPanel('mang-ai-agent');};window.addEventListener('mang-ai:open-agent',openAgent);return()=>window.removeEventListener('mang-ai:open-agent',openAgent);});
    ctx.effect(()=>ctx.sidebarRightTabs.register({id:mediaId,kind:'mang-ai-media',title:()=> '制作スペース',keepMounted:true,guide:[{id:'media',title:()=> 'メディア・制作進捗',description:()=> 'このセッションの漫画・画像・素材を開く',order:5}]}));
    ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:mediaId},MediaDock));
    for(const view of ['gallery','progress'])ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'mang-ai-'+view},()=>jsxs('section',{style:{display:'flex',flexDirection:'column',height:'100%',minHeight:0},children:[jsx('button',{onClick:()=>ctx.layout.selectPanel(null),style:{alignSelf:'flex-start',padding:'10px'},children:'← セッションへ戻る'}),jsx('div',{style:{flex:1,minHeight:0},children:jsx(WorkspaceFrame,{view})})]})));
    const open=view=>{if(ctx.sidebarRight.mounted.getSnapshot())ctx.sidebarRight.openTab('mang-ai-media',{params:{view}});else ctx.layout.selectPanel('mang-ai-'+view);};
    const opened=new Set(),responsiveCollapsed=new Set();
    function SessionMedia(props){
      const id=props.session?.sessionId,mounted=props.useSidebarMounted(value=>value===id);
      const [compact,setCompact]=useState(()=>matchMedia('(max-width: 1023px)').matches);
      useEffect(()=>{const query=matchMedia('(max-width: 1023px)'),change=()=>setCompact(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
      useEffect(()=>{
        if(!id||!mounted)return;
        if(compact){
          // The host makes a narrow right pane fullscreen. Keep the conversation
          // visible, with its media and progress inline; retain the editor iframe.
          if(ctx.sidebarRight.isExpanded()&&ctx.sidebarRight.active()?.kind==='mang-ai-media'){ctx.sidebarRight.toggleExpanded();responsiveCollapsed.add(id);}
          return;
        }
        if(responsiveCollapsed.delete(id)){if(!ctx.sidebarRight.isExpanded())ctx.sidebarRight.toggleExpanded();return;}
        if(opened.has(id))return;opened.add(id);
        // Do not navigate a restored tab: it may contain unsaved editor work.
        if(!ctx.sidebarRight.tabsIn(id).some(tab=>tab.kind==='mang-ai-media'))open('gallery');
      },[id,mounted,compact]);
      return jsxs('div',{children:[compact?jsx(AccountFrame,{view:'quota',sessionId:id}):null,jsx(ConversationMedia,{...props,onOpen:open,compact})]});
    }
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'mang-ai-session-media',order:10,label:'この会話のメディア',inject:()=>({hooks:{sidebarMounted:ctx.sidebarRight.mounted}})},SessionMedia));
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'mang-ai-session-account',order:9,label:'コーディング担当'},SessionAccount));
    ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'mang-ai-accounts',order:15,label:'AIアカウント'},props=>props.view==='summary'?'Codex・Devinの複数アカウント、DeepSeek APIキーを登録します。':jsx(AccountFrame,{})));
    const button=(view,label)=>jsx('button',{type:'button',onClick:()=>open(view),title:label,style:{display:'inline-flex',padding:'8px',color:'#58b38b',fontSize:'12px',background:'transparent',border:0,cursor:'pointer',maxWidth:'100%',whiteSpace:'nowrap',overflow:'hidden'},children:label});
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mang-ai-gallery',order:5,label:'制作スペース'},()=>button('gallery','▧ 制作スペース')));
    ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'mang-ai-media',order:5,label:'制作スペース'},()=>button('gallery','制作スペース')));
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
