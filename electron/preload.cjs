const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('chessEngine',{
 metadata:()=>ipcRenderer.invoke('engine:metadata'),
 analyze:(position,id)=>ipcRenderer.invoke('engine:analyze',{position,id}),
 stop:()=>ipcRenderer.invoke('engine:stop'),
 play:(position,elo)=>ipcRenderer.invoke('engine:play',{position,elo}),
 stopPlay:()=>ipcRenderer.invoke('engine:stop-play'),
 onAnalysis:(callback)=>{const listener=(_,data)=>callback(data);ipcRenderer.on('engine:analysis',listener);return()=>ipcRenderer.removeListener('engine:analysis',listener);}
});
