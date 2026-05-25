import { NextResponse } from "next/server";
import { forwardHermesDbTest, runDatasourceDbTest } from "@/lib/datasource-test-runner";
import type { DbTestBody } from "@/lib/datasource-mysql-ops";

export const runtime = "nodejs";

type DataSourceTestPayload = DbTestBody & {
  name?: string;
  type?: string;
  url?: string;
  endpoint?: string;
  rootPath?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as DataSourceTestPayload;
  if (!body?.name || !body?.type) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        errorCode: "INVALID_INPUT",
        message: "name/type 为必填项",
        diagnostics: {
          network: "skipped",
          auth: "skipped",
          queryProbe: "skipped",
        },
      },
      { status: 400 },
    );
  }

  if (body.type === "db") {
    const r = await runDatasourceDbTest(body as DbTestBody);
    const { httpStatus, ...json } = r;
    return NextResponse.json(json, { status: httpStatus });
  }

  const hermesEndpoint = process.env.HERMES_DATASOURCE_TEST_ENDPOINT?.trim();
  if (hermesEndpoint) {
    const r = await forwardHermesDbTest(body, hermesEndpoint);
    const { httpStatus, ...json } = r;
    return NextResponse.json(json, { status: httpStatus });
  }

  return NextResponse.json(
    {
      ok: false,
      status: "failed",
      errorCode: "NO_REAL_PROBER_CONFIGURED",
      message:
        "未配置 Hermes 真实探测服务，且当前仅内置 MySQL 直连探测。请配置 HERMES_DATASOURCE_TEST_ENDPOINT 或切换为 MySQL。",
      diagnostics: {
        network: "skipped",
        auth: "skipped",
        queryProbe: "skipped",
      },
    },
    { status: 501 },
  );
}
