/**
 * 访问控制相关常量（无 Node/crypto 依赖）。
 * 客户端组件应从此文件引用，勿从 `accessControlRuntime` 引用，否则会误把服务端密码逻辑打进浏览器包。
 */
export const ROOT_PLATFORM_ORG_ID = "org-platform";

/** 内置「普通用户」角色 id；与 `accessControlRuntime` 中模板一致 */
export const NORMAL_USER_ROLE_ID = "role-normal";
