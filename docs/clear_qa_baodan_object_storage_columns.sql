-- 清空报账单表中的对象存储「宣告」三列，避免库内残留 minio/桶/前缀 引导 Hermes 误判为可走本地联调路径。
-- 在可连 MySQL 的客户端执行，库名与表名与 qa 测试库一致时：
--   mysql -h <host> -P <port> -u <user> -p < docs/clear_qa_baodan_object_storage_columns.sql

USE qa_test_baodan;

UPDATE reimbursement_bills
SET
  `附件存储类型` = NULL,
  `附件存储桶` = NULL,
  `附件对象前缀` = NULL;
