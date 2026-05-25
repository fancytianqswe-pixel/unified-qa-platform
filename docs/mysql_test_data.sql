-- MySQL 测试数据初始化脚本
-- 目标：本脚本创建 2 个测试库，每个库 3 张测试表；报账单库 qa_test_baodan 见下方第 3 条及 docs/qa_test_baodan_schema.sql
--
-- 【测试库连接信息（按数据源表单格式）】
-- 1) 名称: QA核心库-用户订单
--    数据库类型: MySQL
--    主机: 127.0.0.1
--    端口: 3307
--    数据库: qa_test_core
--    数据表: users / products / orders
--    用户名: root
--    密码: Root#2026!AiCursor
--
-- 2) 名称: QA业务库-组织考勤
--    数据库类型: MySQL
--    主机: 127.0.0.1
--    端口: 3307
--    数据库: qa_test_biz
--    数据表: departments / employees / attendance
--    用户名: root
--    密码: Root#2026!AiCursor
--
-- 3) 名称: QA报账单库-报账单样例
--    数据库类型: MySQL
--    主机: 127.0.0.1
--    端口: 3307
--    数据库: qa_test_baodan
--    数据表: reimbursement_bills
--    用户名: root
--    密码: Root#2026!AiCursor
--
-- 只读账号（可选）:
--    用户名: qa_readonly
--    密码: Readonly#2026!AiCursor
--
-- 【导入注意】客户端必须使用 utf8mb4，否则 VARCHAR 中文可能被写成字面量「?」。
--    mysql 命令请加：--default-character-set=utf8mb4
--    若已出现问号，可执行：docs/fix_departments_chinese_data.sql

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS qa_test_core
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

CREATE DATABASE IF NOT EXISTS qa_test_biz
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

-- =========================
-- 库 1: qa_test_core
-- =========================
USE qa_test_core;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  total_amount DECIMAL(12,2) NOT NULL,
  order_status VARCHAR(32) NOT NULL DEFAULT 'paid',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_orders_user (user_id),
  KEY idx_orders_product (product_id)
) ENGINE=InnoDB;

INSERT INTO users (username, email, status) VALUES
('alice', 'alice@example.com', 'active'),
('bob', 'bob@example.com', 'active'),
('cindy', 'cindy@example.com', 'inactive')
ON DUPLICATE KEY UPDATE email = VALUES(email), status = VALUES(status);

INSERT INTO products (product_name, category, price) VALUES
('智能分析报告', 'report', 199.00),
('自动采集任务', 'task', 299.00),
('数据清洗服务', 'service', 99.00);

INSERT INTO orders (user_id, product_id, quantity, total_amount, order_status) VALUES
(1, 1, 1, 199.00, 'paid'),
(2, 2, 1, 299.00, 'paid'),
(1, 3, 2, 198.00, 'refunded');

-- =========================
-- 库 2: qa_test_biz
-- =========================
USE qa_test_biz;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  dept_name VARCHAR(128) NOT NULL UNIQUE,
  owner VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employees (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  emp_no VARCHAR(32) NOT NULL UNIQUE,
  emp_name VARCHAR(64) NOT NULL,
  dept_id BIGINT NOT NULL,
  hire_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_employees_dept (dept_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  emp_id BIGINT NOT NULL,
  work_day DATE NOT NULL,
  check_in_time DATETIME NULL,
  check_out_time DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'normal',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_emp_day (emp_id, work_day),
  KEY idx_attendance_emp (emp_id)
) ENGINE=InnoDB;

INSERT INTO departments (dept_name, owner) VALUES
('AI应用部', '张三'),
('平台研发部', '李四'),
('质量保障部', '王五')
ON DUPLICATE KEY UPDATE owner = VALUES(owner);

INSERT INTO employees (emp_no, emp_name, dept_id, hire_date) VALUES
('E1001', '赵一', 1, '2023-03-01'),
('E1002', '钱二', 2, '2022-08-15'),
('E1003', '孙三', 1, '2024-01-10')
ON DUPLICATE KEY UPDATE emp_name = VALUES(emp_name), dept_id = VALUES(dept_id), hire_date = VALUES(hire_date);

INSERT INTO attendance (emp_id, work_day, check_in_time, check_out_time, status) VALUES
(1, '2026-04-28', '2026-04-28 09:03:00', '2026-04-28 18:10:00', 'normal'),
(2, '2026-04-28', '2026-04-28 08:55:00', '2026-04-28 17:58:00', 'normal'),
(3, '2026-04-28', '2026-04-28 09:32:00', '2026-04-28 18:15:00', 'late')
ON DUPLICATE KEY UPDATE
  check_in_time = VALUES(check_in_time),
  check_out_time = VALUES(check_out_time),
  status = VALUES(status);

