import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 不使用 API Routes，所有数据请求走 Elysia API
  // transpilePackages 确保 monorepo workspace 包能被正确编译
  transpilePackages: ["@juchang/api"],
};

export default nextConfig;
