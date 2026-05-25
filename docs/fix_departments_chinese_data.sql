-- 修复 departments 中因导入时客户端字符集不当而变成「?」的数据。
-- 推荐执行（注意 --default-character-set）：
--   mysql -h 127.0.0.1 -P 3307 -u root -p --default-character-set=utf8mb4 < docs/fix_departments_chinese_data.sql
SET NAMES utf8mb4;
USE qa_test_biz;

UPDATE departments SET dept_name = 'AI应用部', owner = '张三' WHERE id = 1;
UPDATE departments SET dept_name = '平台研发部', owner = '李四' WHERE id = 2;
UPDATE departments SET dept_name = '质量保障部', owner = '王五' WHERE id = 3;
