-- 已有 qa_test_baodan.reimbursement_bills 表、仅需增量加列时使用（无需整表 DROP）
-- mysql -h127.0.0.1 -P3307 -uroot -p --default-character-set=utf8mb4 < docs/baodan_reimbursement_add_storage_columns.sql

SET NAMES utf8mb4;
USE qa_test_baodan;

ALTER TABLE reimbursement_bills
  ADD COLUMN `附件存储类型` VARCHAR(32) NULL COMMENT '对象存储类型，如 minio、s3；空表示未声明对象存储' AFTER `合同履约信息_toatlpayment`,
  ADD COLUMN `附件存储桶` VARCHAR(128) NULL COMMENT '对象存储桶名（与 BFF/脚本 MINIO_BUCKET 对齐）' AFTER `附件存储类型`,
  ADD COLUMN `附件对象前缀` VARCHAR(512) NULL COMMENT '桶内前缀，如 报账单/<报账单号>/' AFTER `附件存储桶`;
