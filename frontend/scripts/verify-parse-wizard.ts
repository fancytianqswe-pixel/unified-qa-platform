/**
 * 数据源向导 parseWizardDbPayload / 过程区启发式 冒烟脚本（无 Jest/Vitest 依赖）。
 * 运行：npm run verify:wizard
 */
import assert from "node:assert/strict";

import { parseWizardDbPayload } from "../src/lib/datasource-wizard";
import { summarizeJsonBlobForPill } from "../src/lib/process-step-heuristic";

let r = parseWizardDbPayload(
  'intro\n```hermes-datasource\n{"name":"A","dbKind":"mysql","host":"h","port":"3306","database":"d","table":"t","username":"u","password":"p"}\n```',
);
assert.equal(r.form?.name, "A");
assert.ok(!r.displayText.includes("hermes-datasource"));

const yamlHermes = `
\`\`\`yaml
hermes_datasources:
  - name: QA
    type: mysql
    host: 127.0.0.1
    port: "3306"
    database: orders
    table: order_line
    username: root
    password: secret
\`\`\`
`;
r = parseWizardDbPayload(yamlHermes);
assert.equal(r.form?.name, "QA");
assert.equal(r.form?.dbKind, "mysql");

const yamlDs = `
\`\`\`yaml
datasource:
  name: DS1
  dbKind: postgresql
  host: pg.local
  port: "5432"
  database: app
  table: users
  username: u
  password: p
\`\`\`
`;
r = parseWizardDbPayload(yamlDs);
assert.equal(r.form?.name, "DS1");
assert.equal(r.form?.dbKind, "postgresql");

const pill1 = summarizeJsonBlobForPill(JSON.stringify({ total_count: 3, matches: [{}, {}, {}] }));
assert.ok(/按模式找到\s*3\s*处匹配/.test(pill1), pill1);

const pill2 = summarizeJsonBlobForPill(JSON.stringify({ files: ["a.ts", "b.ts"] }));
assert.ok(/按文件名找到\s*2\s*个文件/.test(pill2), pill2);

const pill3 = summarizeJsonBlobForPill(
  JSON.stringify({
    path: "/x/y.sql",
    content: "x".repeat(500),
    status: "ok",
  }),
);
assert.ok(/已读取文件/.test(pill3) && /见展开区/.test(pill3), pill3);

const pill4 = summarizeJsonBlobForPill(
  JSON.stringify({ path: "/a/b", content: "short", status: "unchanged" }),
);
assert.ok(/内容未变/.test(pill4), pill4);

const pill5 = summarizeJsonBlobForPill(JSON.stringify({ success: false, error: "file not found" }));
assert.ok(/^工具失败：/.test(pill5), pill5);

console.log("verify:wizard OK");
