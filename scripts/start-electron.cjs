// 稳健启动 Electron：
// 某些宿主环境（例如本身基于 Electron 的 IDE）会注入 ELECTRON_RUN_AS_NODE=1，
// 导致子进程 electron 被当成纯 Node 运行、app 模块为空。这里显式清除它。
const { spawn } = require('child_process')
const path = require('path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS // 去掉宿主的 --require shim，避免污染子进程

const electronBin = require('electron')
const child = spawn(electronBin, [path.join(__dirname, '..')], {
  env,
  stdio: 'inherit',
  windowsHide: false,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
