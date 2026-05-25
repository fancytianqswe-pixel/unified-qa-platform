-- 报账单样例库：建库建表脚本（与 docs/mysql_test_data.sql 同一 MySQL 测试实例）
-- 表字段可与历史 JSON 叶子一一对应；灌库见 scripts/import_qa_test_baodan.mjs。主数据以本表列为准时，可不保留各单号目录下 <报账单号>.json。
--
-- 【测试库连接信息（按数据源表单格式，与 mysql_test_data.sql 第 3 条一致）】
-- 3) 名称: QA报账单库-报账单样例
--    数据库类型: MySQL
--    主机: 127.0.0.1
--    端口: 3307
--    数据库: qa_test_baodan
--    数据表: reimbursement_bills
--    用户名: root
--    密码: Root#2026!AiCursor
--
-- 只读账号（可选，未单独授权本库时请用 root 或先 GRANT）:
--    用户名: qa_readonly
--    密码: Readonly#2026!AiCursor
--
-- 【导入注意】客户端必须使用 utf8mb4；执行本脚本或 mysql 命令请加：--default-character-set=utf8mb4
-- Windows 下若用 PowerShell 管道喂 SQL 易导致中文列名乱码，请用 node scripts/import_qa_test_baodan.mjs 内嵌执行本文件，或 cmd 重定向 UTF-8。

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS qa_test_baodan
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE qa_test_baodan;

DROP TABLE IF EXISTS reimbursement_bills;

CREATE TABLE reimbursement_bills (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `标题` VARCHAR(512) NULL COMMENT '基本信息.标题',
  `经济事项` VARCHAR(256) NULL COMMENT '基本信息.经济事项',
  `报账单号` VARCHAR(64) NOT NULL COMMENT '基本信息.报账单号',
  `报账期间` VARCHAR(64) NULL COMMENT '基本信息.报账期间',
  `费用发生日` VARCHAR(32) NULL COMMENT '基本信息.费用发生日',
  `报账人电话` VARCHAR(32) NULL COMMENT '基本信息.报账人电话',
  `收支方式` VARCHAR(128) NULL COMMENT '基本信息.收支方式',
  `是否员工代垫` VARCHAR(16) NULL COMMENT '基本信息.是否员工代垫',
  `合同编号` TEXT NULL COMMENT '基本信息.合同编号',
  `合同名称` TEXT NULL COMMENT '基本信息.合同名称',
  `合同租赁属性` VARCHAR(128) NULL COMMENT '基本信息.合同租赁属性',
  `票据类型` VARCHAR(128) NULL COMMENT '基本信息.票据类型',
  `附单据张数` VARCHAR(16) NULL COMMENT '基本信息.附单据张数',
  `纳税属性` VARCHAR(64) NULL COMMENT '基本信息.纳税属性',
  `是否涉及进项税转出` VARCHAR(16) NULL COMMENT '基本信息.是否涉及进项税转出',
  `是否涉及影像扫描` VARCHAR(16) NULL COMMENT '基本信息.是否涉及影像扫描',
  `是否ICT涉密项目` VARCHAR(16) NULL COMMENT '基本信息.是否ICT涉密项目',
  `业务场景` VARCHAR(128) NULL COMMENT '基本信息.业务场景',
  `是否被共享` VARCHAR(64) NULL COMMENT '基本信息.是否被共享',
  `预计付款日期` VARCHAR(64) NULL COMMENT '基本信息.预计付款日期',
  `报账说明` TEXT NULL COMMENT '基本信息.报账说明',
  `合同履约信息_toatlpayment` DECIMAL(18,4) NULL COMMENT '合同履约信息.toatlpayment（JSON 字段名保留）',
  `附件存储类型` VARCHAR(32) NULL COMMENT '对象存储类型，如 minio、s3；空表示未声明对象存储',
  `附件存储桶` VARCHAR(128) NULL COMMENT '对象存储桶名（与 BFF/脚本 MINIO_BUCKET 对齐）',
  `附件对象前缀` VARCHAR(512) NULL COMMENT '桶内前缀，如 报账单/<报账单号>/，供审核链路从文件服务器取附件',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_报账单号 (`报账单号`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='报账单样例：列与 JSON 叶子字段对应';
