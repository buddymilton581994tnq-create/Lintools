'use strict'
// 开屏动画窗口与主进程之间的桥。只用来选模型和回传状态。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('splashApi', {
  /** 主进程要求显示模型选择面板 */
  onShowPicker: (cb) => ipcRenderer.on('splash:show-picker', (_e, data) => cb(data)),
  /** 用户点了某一档 */
  choose: (id) => ipcRenderer.send('splash:model-choice', id),
})
