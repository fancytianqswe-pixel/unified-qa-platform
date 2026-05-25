/**
 * 数据源 DB 连通性探测的统一实现（供 Route Handler 与 BFF 内 function tools 共用），
 * 避免「页面走 /api、工具直连 mysql」时因 HERMES_DATASOURCE_TEST_ENDPOINT 优先级不一致导致结果相反。
 */
import { probeMysqlConnectivity, validateDbTestPayload, type DbTestBody } from "@/lib/datasource-mysql-ops";

export type DatasourceProbeDiagnostics = {
  network: string;
  auth: string;
  queryProbe: string;
};

export type DatasourceDbTestResult = {
  ok: boolean;
  latencyMs: number;
  status: "success" | "failed";
  errorCode: string;
  message: string;
  diagnostics: DatasourceProbeDiagnostics;
  /** 与 JSON 响应一致；校验失败时为 400，其它失败多为 502 */
  httpStatus: number;
};

function diagFail(): DatasourceProbeDiagnostics {
  return { network: "failed", auth: "failed", queryProbe: "failed" };
}

function diagOk(): DatasourceProbeDiagnostics {
  return { network: "ok", auth: "ok", queryProbe: "ok" };
}

function diagSkipped(): DatasourceProbeDiagnostics {
  return { network: "skipped", auth: "skipped", queryProbe: "skipped" };
}

export async function forwardHermesDbTest(body: unknown, hermesEndpoint: string): Promise<DatasourceDbTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(hermesEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        latencyMs: 0,
        status: "failed",
        errorCode: "HERMES_HTTP_ERROR",
        message: `Hermes 响应异常（HTTP ${response.status}）`,
        diagnostics: { network: "failed", auth: "unknown", queryProbe: "skipped" },
        httpStatus: 502,
      };
    }
    const data = (await response.json()) as Record<string, unknown>;
    const ok = !!data.ok;
    const statusRaw = data.status;
    const status: "success" | "failed" =
      statusRaw === "success" || statusRaw === "failed" ? statusRaw : ok ? "success" : "failed";
    return {
      ok,
      latencyMs: Number(data.latencyMs ?? 0),
      status,
      errorCode: String(data.errorCode ?? ""),
      message: String(data.message ?? ""),
      diagnostics: (data.diagnostics as DatasourceProbeDiagnostics) ?? {
        network: "unknown",
        auth: "unknown",
        queryProbe: "unknown",
      },
      httpStatus: ok ? 200 : 502,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      latencyMs: 0,
      status: "failed",
      errorCode: aborted ? "HERMES_TIMEOUT" : "HERMES_NETWORK_ERROR",
      message: aborted ? "Hermes 连通性请求超时" : "Hermes 连通性请求失败",
      diagnostics: { network: "failed", auth: "unknown", queryProbe: "skipped" },
      httpStatus: 502,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 执行 DB 类型数据源的连通性探测（与 `POST /api/datasource/test` 在 type=db 时语义对齐）。
 *
 * MySQL：**先**在运行本函数的 Node 进程内直连（与数据中心弹窗一致）；若抛错或失败且配置了
 * `HERMES_DATASOURCE_TEST_ENDPOINT`，再转发 Hermes（适配「Next 在容器、库在宿主机」等场景）。
 *
 * 非 MySQL：仅在有 Hermes 端点时转发，否则返回未配置。
 */
export async function runDatasourceDbTest(body: DbTestBody): Promise<DatasourceDbTestResult> {
  const validation = validateDbTestPayload(body);
  if (validation) {
    return {
      ok: false,
      latencyMs: 0,
      status: "failed",
      errorCode: validation.errorCode,
      message: validation.message,
      diagnostics: diagSkipped(),
      httpStatus: 400,
    };
  }

  const hermesEndpoint = process.env.HERMES_DATASOURCE_TEST_ENDPOINT?.trim();
  const isMysql = String(body.dbKind).toLowerCase() === "mysql";

  if (isMysql) {
    try {
      const data = await probeMysqlConnectivity(body);
      if (!data.ok) {
        return {
          ok: false,
          latencyMs: 0,
          status: "failed",
          errorCode: "MYSQL_PROBE_FAILED",
          message: data.message,
          diagnostics: diagFail(),
          httpStatus: 502,
        };
      }
      return {
        ok: true,
        latencyMs: data.latencyMs,
        status: "success",
        errorCode: "",
        message: data.message,
        diagnostics: diagOk(),
        httpStatus: 200,
      };
    } catch (localErr) {
      const localMsg = localErr instanceof Error ? localErr.message : "MySQL 真实探测失败";
      if (hermesEndpoint) {
        const hermesTry = await forwardHermesDbTest(body, hermesEndpoint);
        if (hermesTry.ok) {
          return {
            ...hermesTry,
            message:
              String(hermesTry.message ?? "").trim() ||
              `已由 Hermes 完成探测（本机 Node 直连失败：${localMsg}）。`,
          };
        }
        return {
          ok: false,
          latencyMs: 0,
          status: "failed",
          errorCode: "MYSQL_PROBE_FAILED",
          message: `本机直连：${localMsg}；Hermes 重试：${hermesTry.message || hermesTry.errorCode || "失败"}`,
          diagnostics: diagFail(),
          httpStatus: 502,
        };
      }
      return {
        ok: false,
        latencyMs: 0,
        status: "failed",
        errorCode: "MYSQL_PROBE_FAILED",
        message: `MySQL 真实探测失败：${localMsg}`,
        diagnostics: diagFail(),
        httpStatus: 502,
      };
    }
  }

  if (hermesEndpoint) {
    return forwardHermesDbTest(body, hermesEndpoint);
  }

  return {
    ok: false,
    latencyMs: 0,
    status: "failed",
    errorCode: "NO_REAL_PROBER_CONFIGURED",
    message:
      "未配置 Hermes 真实探测服务，且当前仅内置 MySQL 直连探测。请配置 HERMES_DATASOURCE_TEST_ENDPOINT 或切换为 MySQL。",
    diagnostics: diagSkipped(),
    httpStatus: 501,
  };
}
