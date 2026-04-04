/**
 * 本地无限次体验（不提交到 Git）
 *
 * 用法：复制本文件为 unlock-secret.js（已在 .gitignore）
 * - secretOk 必须为 true 才生效
 * - useUsageLimit 设为 true 时「打开」次数限制，与未配置密钥时行为一致
 */
window.__ALPHA_LOCAL = {
  secretOk: true,
  useUsageLimit: true,
  vipUnlimited: false,
  vipAdminToken: ""
};
