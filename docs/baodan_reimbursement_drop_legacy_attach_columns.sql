-- 从 qa_test_baodan.reimbursement_bills 删除已弃用列：本地附件目录、附件索引
-- 附件清单以对象存储三列（附件存储类型 / 附件存储桶 / 附件对象前缀）+ BFF ListObjects 为准。
-- 执行前请确认应用与脚本已升级到不再读写这两列。
--
-- mysql -h127.0.0.1 -P3307 -uroot -p --default-character-set=utf8mb4 < docs/baodan_reimbursement_drop_legacy_attach_columns.sql

SET NAMES utf8mb4;
USE qa_test_baodan;

-- 若某列已不存在，注释掉对应一行后重跑。
ALTER TABLE reimbursement_bills DROP COLUMN `附件索引`;
ALTER TABLE reimbursement_bills DROP COLUMN `本地附件目录`;
