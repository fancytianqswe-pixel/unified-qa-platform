/** 与「用户与权限」中超级管理员行一致：账号用于登录与展示打通 */
export const SUPER_ADMIN_ACCOUNT = "admin";
export const SUPER_ADMIN_PASSWORD = "admin";
export const SUPER_ADMIN_USER_ID = "u-super-admin";
export const SUPER_ADMIN_DISPLAY_NAME = "超级管理员";
export const SUPER_ADMIN_ROLE_NAME = "超级管理员";

/** 为 true 时系统管理 UI 不展示「新增用户 / 新增角色」，且服务端只保留超级管理员一条用户与一个角色 */
export const SINGLE_SUPER_ADMIN_DEPLOYMENT = false;
