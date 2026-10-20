const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DEFAULTS,validateSettings,SettingsStore,ShortcutRegistry}=require('../settings.cjs');
const {visibleBounds}=require('../settings-runtime.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
test('settings normalize accelerators and reject aliases, reserved keys and invalid ranges',()=>{
  const settings=clone(DEFAULTS);settings.shortcuts.run='alt+ctrl+w';settings.shortcuts.pick='';
  assert.equal(validateSettings(settings).shortcuts.run,'Ctrl+Alt+W');
  for(const key of ['F12','Ctrl+S','Ctrl+Shift+S','F1','W','Ctrl+Ctrl+W','Shift+W','Ctrl+Alt+E']){
    const next=clone(DEFAULTS);next.shortcuts.run=key;assert.throws(()=>validateSettings(next),undefined,key);
  }
  for(const value of [{mcp:{explorationTimeout:31}},{startup:{admin:'true'}},{target:{refreshSeconds:1}},{history:{retentionDays:0}},{startup:{closeAction:'kill'}},{unknown:{}},JSON.parse('{"__proto__":{}}')])assert.throws(()=>validateSettings(value));
  assert.deepEqual(validateSettings({}),DEFAULTS);
});
test('settings save atomically and survive reload; corrupt input preserves source and uses defaults',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'echo-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new SettingsStore(root);assert.deepEqual(store.value,DEFAULTS);
  const next=clone(DEFAULTS);next.startup.admin=false;next.mcp.enabled=false;
  store.save(next);assert.deepEqual(new SettingsStore(root).value,next);
  const before=fs.readFileSync(store.file);assert.throws(()=>store.save({mcp:{explorationTimeout:-2}}));assert.deepEqual(fs.readFileSync(store.file),before);
  fs.writeFileSync(store.file,'broken');const corrupt=new SettingsStore(root);assert.deepEqual(corrupt.value,DEFAULTS);assert.ok(corrupt.warning);assert.equal(fs.readFileSync(store.file,'utf8'),'broken');
});
test('shortcut registration restores previous bindings when another app occupies a key',()=>{
  const keys=new Map(),events=[];let blocked='';
  const api={register(key,callback){events.push(key);if(key===blocked)return false;keys.set(key,callback);return true;},unregister(key){keys.delete(key);}};
  const actions=[],registry=new ShortcutRegistry(api,action=>actions.push(action));registry.replace(DEFAULTS.shortcuts);
  keys.get('F6')();assert.deepEqual(actions,['run']);assert.equal(keys.has('F12'),false);
  const previous=[...keys.keys()];blocked='Ctrl+Alt+R';assert.throws(()=>registry.replace({...DEFAULTS.shortcuts,run:blocked}),/占用/);
  assert.deepEqual([...keys.keys()],previous);keys.get('F7')();assert.equal(actions.at(-1),'record');
});
test('window bounds recover across changed monitor layouts and reject malformed geometry',()=>{
  const displays=[{workArea:{x:0,y:0,width:1920,height:1080}}];
  assert.equal(visibleBounds({x:4000,y:0,width:1440,height:1000},displays),null);
  assert.equal(visibleBounds({x:0,y:0,width:-1,height:1000},displays),null);
  assert.deepEqual(visibleBounds({x:1800,y:0,width:1440,height:1000},displays),null);
  assert.deepEqual(visibleBounds({x:1500,y:500,width:1440,height:1000},displays),{x:480,y:80,width:1440,height:1000});
});
