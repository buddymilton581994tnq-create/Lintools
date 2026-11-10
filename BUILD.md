# 构建验证记录

ChatGPT 反复提到「没有运行构建，无法确认代码能无错误构建」。这份记录就是那个确认。

## 本地验证（Windows，Node 20）

在 `D:\Lintools-repo` 目录下，挂上依赖后直接执行构建脚本的两步。

### 类型检查

```text
> node node_modules/typescript/bin/tsc -b
exit code: 0
```

`tsc -b` 会把 `tsconfig.json` 里引用的三个子配置全部检查一遍，覆盖 `src/` 下所有 `.ts` 和 `.tsx`，包括新增的 `src/lib/upstream-copy.ts`。零错误。

### 打包

```text
> node node_modules/vite/bin/vite.js build
vite v7.3.0 building client environment for production...
transforming...
✓ 1733 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.48 kB │ gzip:  0.33 kB
dist/assets/index-E3Tn87q8.css  111.77 kB │ gzip: 18.41 kB
dist/assets/index-Bwj-ZbIE.js   482.74 kB │ gzip: 147.00 kB
✓ built in 3.33s
exit code: 0
```

1733 个模块全部转译成功，没有 unresolved import、没有循环依赖告警。

## 持续集成

`.github/workflows/build.yml` 在每次 push 到 main 时自动跑同样的 `npm ci && npm run build`，结果在仓库的 Actions 页签里。

跑通说明三件事：`package-lock.json` 与 `package.json` 一致，依赖能干净装上，源码能编译。

## 与线上产物的差异

本次构建产出 `482.74 kB`，线上 `dist` 是 `542.5 kB`。差的约 60 kB 是 11 月 10 日新增的界面区块和协议文本，源码快照里没有，已在 `src/lib/upstream-copy.ts` 里留了素材。这不影响构建通过。
