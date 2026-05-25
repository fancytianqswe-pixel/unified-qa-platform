# Hermes 注册「数据源 MCP」摘要

完整步骤与 Docker 网络说明见仓库 **`docs/Hermes数据源MCP.md`**；本包实现代码见 **`mcp-servers/datasource-mcp/`**。

要点：

1. `npm run build` 得到 `dist/index.js`。  
2. Hermes `mcp_servers` 使用 **stdio**：`command: node`，`args: [绝对路径/dist/index.js]`，`env.DATASOURCE_MCP_BASE_URL` 指向可访问的 Next 根地址。  
3. 模型在对话中应使用 MCP 工具 **`datasource_*`** 做探活/预览，**仍须**输出 **`hermes-datasource`** 或兼容 yaml，用户在前端草稿卡保存。  
