"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = {
  error: Error | null;
  info: ErrorInfo | null;
};

/**
 * 捕获子树内未处理的 React 渲染错误，在页面上展示 message / digest / stack，
 * 便于本地排查「白屏但终端有栈」以外的客户端可见信息。
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info);
    this.setState({ info });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClear = () => {
    this.setState({ error: null, info: null });
  };

  override render() {
    const { error, info } = this.state;
    if (!error) {
      return this.props.children;
    }

    const digest = (error as Error & { digest?: string }).digest;

    return (
      <div className="fixed inset-0 z-[10001] overflow-auto bg-rose-950/95 p-4 text-left text-rose-50">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-700 bg-rose-900/80 p-5 shadow-xl">
          <h1 className="text-lg font-semibold text-white">React 渲染错误（已拦截）</h1>
          <p className="mt-2 text-sm text-rose-200">
            以下为异常对象在浏览器中可见的字段；完整 Node 栈请仍查看运行 <code className="rounded bg-black/30 px-1">npm run dev</code> 的终端。
          </p>
          {digest ? (
            <p className="mt-2 font-mono text-xs text-rose-300">digest: {digest}</p>
          ) : null}
          <pre className="mt-3 max-h-[30vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-xs">
            {error.message}
          </pre>
          {error.stack ? (
            <pre className="mt-2 max-h-[35vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-[11px] text-rose-100/90">
              {error.stack}
            </pre>
          ) : null}
          {info?.componentStack ? (
            <details className="mt-3 text-xs text-rose-200">
              <summary className="cursor-pointer select-none text-rose-100">组件栈 componentStack</summary>
              <pre className="mt-2 max-h-[25vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-2">
                {info.componentStack}
              </pre>
            </details>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-rose-950 hover:bg-rose-100"
              onClick={this.handleReload}
            >
              整页刷新
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-400 px-4 py-2 text-sm text-rose-100 hover:bg-rose-800/50"
              onClick={this.handleClear}
            >
              仅清除覆盖层（可能再次报错）
            </button>
          </div>
        </div>
      </div>
    );
  }
}
