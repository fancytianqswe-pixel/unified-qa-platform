import { LoginPage } from "@/components/auth/LoginPage";

/**
 * 根路径：登录入口；鉴权通过后由 LoginPage 跳转至 /new-task。
 */
export default function Home() {
  return <LoginPage />;
}
