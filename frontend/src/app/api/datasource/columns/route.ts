import { NextResponse } from "next/server";
import { mysqlListColumns } from "@/lib/datasource-mysql-ops";

export const runtime = "nodejs";

type Payload = {
  type?: string;
  dbKind?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  table?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Payload;
  if (body.type !== "db") {
    return NextResponse.json({ ok: false, message: "仅支持 DB 类型字段读取" }, { status: 400 });
  }
  if (String(body.dbKind ?? "").toLowerCase() !== "mysql") {
    return NextResponse.json({ ok: false, message: "当前仅支持 MySQL 字段读取" }, { status: 501 });
  }
  const result = await mysqlListColumns(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, fields: result.fields });
}
