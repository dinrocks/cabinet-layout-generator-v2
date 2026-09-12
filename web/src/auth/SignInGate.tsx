/** 登录/权限入口。未配置云端时直接进入本地模式。 */
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import "./auth.css";

export function SignInGate({ children }: { children: ReactNode }) {
  const { status, email, signIn, signOut } = useAuth();

  if (status === "offline" || status === "ready") return <>{children}</>;

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-spinner" aria-label="正在连接" />
          <p className="auth-sub">正在连接…</p>
        </div>
      </div>
    );
  }

  if (status === "no_access") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">电柜布局生成器</h1>
          <p className="auth-sub">当前登录账号：<strong>{email}</strong></p>
          <p className="auth-warn">此邮箱尚未加入访问名单。请联系管理员添加后重新登录。</p>
          <button type="button" className="auth-btn ghost" onClick={signOut}>退出登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">电柜布局生成器</h1>
        <p className="auth-sub">登录后可打开和保存团队共享的电柜布局。</p>
        <div className="auth-providers">
          <button type="button" className="auth-btn" onClick={() => signIn("github")}>使用 GitHub 登录</button>
          <button type="button" className="auth-btn" onClick={() => signIn("google")}>使用 Google 登录</button>
        </div>
        <p className="auth-foot">仅已批准的邮箱可以访问云端项目。</p>
      </div>
    </div>
  );
}
