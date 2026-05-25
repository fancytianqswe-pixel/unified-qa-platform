/**
 * 未配置 HERMES_GATEWAY_URL / HERMES_TURN_ENDPOINT 时，BFF 仍尝试的常见 Gateway 根地址。
 * - 127.0.0.1 / localhost：本机 Next + 本机或端口映射的 Hermes
 * - host.docker.internal：Next 跑在 Docker 内、Gateway 在宿主机 Docker Desktop 映射端口时
 */
export const HERMES_DEFAULT_GATEWAY_ROOTS = [
  "http://127.0.0.1:8642",
  "http://localhost:8642",
  "http://host.docker.internal:8642",
] as const;

export function appendDefaultHermesGatewayRoots(roots: Set<string>) {
  for (const r of HERMES_DEFAULT_GATEWAY_ROOTS) {
    roots.add(r);
  }
}

export function defaultHermesV1Bases(): string[] {
  return [...new Set(HERMES_DEFAULT_GATEWAY_ROOTS.map((r) => `${r}/v1`))];
}
