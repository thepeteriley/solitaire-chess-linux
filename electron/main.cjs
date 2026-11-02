const {app,BrowserWindow,ipcMain,Menu,dialog,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {Engine}=require('./engine.cjs');
let mainWindow,analysis,opponent,currentAnalysis=0;
const binary=require('./engine-path.cjs').enginePath();
function ownWindow(event){if(!mainWindow||event.sender!==mainWindow.webContents)throw Error('Invalid window.');}
app.setName('Solitaire Chess');
async function showPrivacy(){
 const policy=fs.readFileSync(path.join(__dirname,'..','resources','privacy-policy.txt'),'utf8');
 const options={type:'info',title:'Solitaire Chess Privacy Policy',message:'Privacy Policy',detail:policy,buttons:['Done','Read Online'],cancelId:0};
 const result=await (mainWindow?dialog.showMessageBox(mainWindow,options):dialog.showMessageBox(options));
 if(result.response===1)await shell.openExternal('https://thepeteriley.github.io/solitaire-chess-support/privacy.html');
}
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
else{
 app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
 app.whenReady().then(()=>{
  analysis=new Engine(binary,{threads:1,hash:48});opponent=new Engine(binary,{threads:1,hash:32});
  ipcMain.handle('engine:metadata',async event=>{ownWindow(event);return analysis.init()});
  ipcMain.handle('engine:analyze',async(event,{position,id})=>{ownWindow(event);const generation=++currentAnalysis;
   const send=data=>{if(currentAnalysis===generation&&!event.sender.isDestroyed())event.sender.send('engine:analysis',{...data,id});};
   const result=await analysis.analyze(position,data=>send({...data,status:'Analysing'}));
   if(!result.cancelled)send({...result,status:result.extended?'Ready · extended':'Ready'});return {cancelled:result.cancelled};
  });
  ipcMain.handle('engine:stop',event=>{ownWindow(event);currentAnalysis++;return analysis.stop()});
  ipcMain.handle('engine:play',async(event,{position,elo})=>{ownWindow(event);return opponent.play(position,{elo,movetimeMs:650})});
  ipcMain.handle('engine:stop-play',event=>{ownWindow(event);return opponent.stop()});
  const create=()=>{
   mainWindow=new BrowserWindow({title:'Solitaire Chess',width:1280,height:1020,minWidth:920,minHeight:740,backgroundColor:'#f7f7f2',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
   mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
   mainWindow.once('ready-to-show',()=>mainWindow.show());
   mainWindow.on('closed',()=>{mainWindow=null;currentAnalysis++;analysis.stop();opponent.stop()});
   if(process.env.SOLITAIRE_DEV_URL)mainWindow.loadURL(process.env.SOLITAIRE_DEV_URL);else mainWindow.loadFile(path.join(__dirname,'..','dist','index.html'));
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'Solitaire Chess',submenu:[{role:'about'},{label:'Get Support…',click:()=>shell.openExternal('https://thepeteriley.github.io/solitaire-chess-support/')},{label:'Privacy Policy…',click:showPrivacy},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
   {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},...(process.env.SOLITAIRE_DEV_URL?[{role:'toggleDevTools'}]:[])]},
   {label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}
  ]));
  create();app.on('activate',()=>{if(!mainWindow)create()});
 });
 app.on('before-quit',()=>{analysis?.close();opponent?.close()});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
}
