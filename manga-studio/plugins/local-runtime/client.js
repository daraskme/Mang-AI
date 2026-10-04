window.__ModuleLoader__.load({id:'@mang-ai/local-runtime',factory:require=>{
  const {jsx,jsxs}=require('react/jsx-runtime');
  const {SettingsFormModel,settingsTextField,settingsNumberField,SettingsForm,SettingsValueField}=require('@deepseek-ai/dsh-client-ui-primitives');
  function SearchCard(props){
    const state=props.useSearchCard(s=>s);
    if(props.view==='summary')return 'Bing RSS / SearXNGで検索し、ローカルQwenが結果を読み取ります。APIキーは不要です。';
    return jsxs(SettingsForm,{labels:{unavailable:'検索機能を利用できません',readOnly:'設定は読み取り専用です',saveFailed:'設定を保存できませんでした',save:'保存',saving:'保存中…'},state,onSave:props.save,onDiscard:props.discard,children:[
      jsx('p',{children:'検索語は選択した検索サービスへ送信されます。回答の作成はローカルモデルが行います。'}),
      ...[['engine','検索サービス','bing または searxng'],['baseURL','検索URL','Bingの既定値は空欄。SearXNGは http://localhost:8080/search など'],['timeoutMs','タイムアウト（ミリ秒）','1000〜120000']].map(([field,label,hint])=>jsx(SettingsValueField,{id:`mang-ai-search-${field}`,label,hint,overriddenLabel:'変更済み',resetLabel:'既定値に戻す',invalidLabel:'有効な値を入力してください',disabled:!state.writable,numeric:field==='timeoutMs',...state[field],onEdit:text=>props.edit(field,text),onReset:()=>props.resetField(field)},field))
    ]});
  }
  function Mark({size=30}){return jsx('span',{style:{fontSize:size,color:'#10b981',lineHeight:1},children:'▣'});}
  function apply(ctx){
    ctx.effect(()=>ctx.locale.addLanguage({id:'ja',label:'日本語',fallback:'en'}));
    for(const [ns,dict]of Object.entries(window.__MANGAI_LOCALES__||{}))if(!ns.startsWith('package:'))ctx.effect(()=>ctx.locale.register(ns,'ja',dict));
    document.title='Mang-AI';
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mang-ai-gallery',order:5,label:'メディアギャラリー'},()=>jsx('a',{href:window.__MANGAI_GALLERY__,target:'_blank',rel:'noreferrer',title:'メディアギャラリー',style:{display:'inline-flex',padding:'8px',color:'#93ddb7',fontSize:'12px',textDecoration:'none'},children:'▧ ギャラリー'})));
    ctx.slots.inject('sidebar.brand.mark',()=>ctx.slots.register({name:'sidebar.brand.mark'},Mark));
    ctx.slots.inject('sidebar.brand.name',()=>ctx.slots.register({name:'sidebar.brand.name'},()=>jsx('strong',{children:'Mang-AI'})));
    ctx.slots.inject('conversation.hero.brand.mark',()=>ctx.slots.register({name:'conversation.hero.brand.mark'},()=>jsx(Mark,{size:70})));
    const form=new SettingsFormModel(ctx.configForms.get('mang-ai-local-runtime'),[settingsTextField('engine'),settingsTextField('baseURL'),settingsNumberField('timeoutMs')]);
    const store=form.bind(()=>({...form.shell(),engine:form.field('engine'),baseURL:form.field('baseURL'),timeoutMs:form.field('timeoutMs')}));
    ctx.effect(()=>()=>form.dispose());
    ctx.effect(()=>ctx.configForms.whileServed(['mang-ai-local-runtime'],()=>ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'web-search',order:40,label:'Web検索',inject:()=>({hooks:{searchCard:store},...form.actions()})},SearchCard))));
  }
  return {inject:['locale','slots','configForms'],apply};
}});
