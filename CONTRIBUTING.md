# 参与 Research Canvas 开发

Research Canvas 的文稿、画布、讨论和来源视图使用共同的对象标识与版本记录。产品要求见 [docs/prototype-scope.md](docs/prototype-scope.md)，HTTP 接口见 [docs/api.md](docs/api.md)。

## 开发环境

按 [README](README.md) 准备 Rust、Node 22.23.4、Yarn 4.7.0 和 Poppler。复制 `config/server.example.toml` 为本地 `config/server.toml`，根据实际模型服务调整配置。运行数据、依赖和缓存保存在 `.runtime/` 和 `tmp/`。

后端使用 `bash scripts/backend.sh build` 构建并安装可执行文件，`bash scripts/backend.sh start` 启动服务。前端使用 `bash scripts/web.sh dev` 启动开发服务器，`typecheck` 和 `build` 子命令执行相应检查。

## 修改范围

界面入口位于 `src/web/`；API 客户端、数据类型和编辑适配位于 `src/research/`；基础组件位于 `src/ui/`；文档与画布引擎位于 `src/editor/`。Rust 服务位于 `src/` 下的 Rust 源文件中，运行参数和提示词位于 `config/`。

文稿内容与画布布局分别保存。选段引用记录原文、版本、文本块和偏移；原文变化后显示明确的定位状态。上下文预览与实际请求使用同一份快照。修改接口时同步客户端类型、调用点和文档。

所有功能模块统一继承根目录 MPL-2.0。第三方原作者版权、原始许可告知与来源记录集中保存于 `legal/THIRD_PARTY_NOTICES.md` 及其引用文件。

## 验证与提交

根据实际改动运行对应构建和受影响的验证。界面操作需要在真实页面验证；模型行为需要真实服务响应。`tests/backend_acceptance.py` 提供使用仓库调研资料的后端验证入口，命令与运行条件见 [后端说明](docs/backend.md)。真实生成阶段会调用配置的模型服务。

提交和 Pull Request 说明具体问题、最终行为、验证方式及仍需关注的限制。将代码、依赖锁文件、许可及必要文档纳入提交；本地配置、凭据、工作数据库和运行日志保存在被忽略的目录中。
