# ============================================================
# Medical_PBL Docker 镜像
# 多阶段构建：builder（编译依赖）+ production（运行环境）
# ============================================================

# -------------------- 构建阶段 --------------------
FROM node:18-alpine AS builder

LABEL maintainer="Medical_PBL Team"
LABEL description="Medical PBL Open Source Platform"

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装所有依赖（含 devDependencies，用于构建）
RUN npm ci

# 复制项目源码
COPY . .

# 如果有构建步骤（如前端打包），在此执行
# RUN npm run build

# 清理开发依赖，减小镜像体积
RUN npm prune --production

# -------------------- 生产阶段 --------------------
FROM node:18-alpine

# 安装运行时依赖
RUN apk add --no-cache \
    tini \
    curl \
    tzdata

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# 从构建阶段复制 node_modules 和应用代码
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/server.js ./

# 复制其他必要目录（根据项目结构调整）
COPY --from=builder --chown=nodejs:nodejs /app/routes ./routes
COPY --from=builder --chown=nodejs:nodejs /app/models ./models
COPY --from=builder --chown=nodejs:nodejs /app/middleware ./middleware
COPY --from=builder --chown=nodejs:nodejs /app/utils ./utils
COPY --from=builder --chown=nodejs:nodejs /app/config ./config
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/views ./views

# 创建数据目录并设置权限
RUN mkdir -p /app/data/uploads /app/data/logs /app/data/records && \
    chown -R nodejs:nodejs /app/data

# 切换到非 root 用户
USER nodejs

# 暴露端口（根据 .env 中的 PORT 配置）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 使用 tini 作为 init 进程，正确处理信号
ENTRYPOINT ["/sbin/tini", "--"]

# 启动应用
CMD ["node", "server.js"]
